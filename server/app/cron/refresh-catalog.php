<?php

declare(strict_types=1);

if(PHP_SAPI!=='cli'){http_response_code(404);exit;}
require dirname(__DIR__).'/bootstrap.php';
$pdo=$database->connection();if(!$pdo||!$fanza->configured()){fwrite(STDERR,"DBまたはFANZA APIが利用できません。\n");exit(1);}
$options=getopt('',['limit::']);$limit=max(10,min(500,(int)($options['limit']??200)));
$lock=fopen(sys_get_temp_dir().'/fanza-doujin-refresh.lock','c');if($lock===false||!flock($lock,LOCK_EX|LOCK_NB)){fwrite(STDOUT,"別の巡回更新が実行中です。\n");exit(0);}
$run=$pdo->prepare("INSERT INTO sync_runs(job_type,status,started_at) VALUES ('catalog-refresh','running',NOW())");$run->execute();$runId=(int)$pdo->lastInsertId();$processed=0;$failed=0;
try{
    $priority=[];
    $sql="SELECT work_cid FROM (SELECT s.work_cid,MAX(s.updated_at) priority_at FROM user_work_states s WHERE s.saved=1 OR s.liked=1 GROUP BY s.work_cid UNION ALL SELECT e.work_cid,MAX(e.created_at) priority_at FROM events e WHERE e.event_type='affiliate_click' AND e.created_at>=DATE_SUB(NOW(),INTERVAL 30 DAY) GROUP BY e.work_cid) p GROUP BY work_cid ORDER BY MAX(priority_at) DESC LIMIT ".min(80,$limit);
    foreach($pdo->query($sql)->fetchAll() as $row)$priority[(string)$row['work_cid']]=true;
    $remaining=max(0,$limit-count($priority));
    if($remaining>0){$s=$pdo->prepare('SELECT cid FROM works WHERE next_refresh_at IS NULL OR next_refresh_at<=NOW() ORDER BY COALESCE(next_refresh_at,\'1970-01-01\') ASC,cid ASC LIMIT '.$remaining);$s->execute();foreach($s->fetchAll() as $row)$priority[(string)$row['cid']]=true;}
    foreach(array_keys($priority) as $cid){try{$workRepository->refreshCid($cid);}catch(Throwable $e){$failed++;error_log("catalog refresh {$cid}: ".$e->getMessage());}$processed++;usleep(120000);}
    $pdo->prepare("UPDATE sync_runs SET status='success',finished_at=NOW(),processed_count=?,error_message=? WHERE id=?")->execute([$processed,$failed>0?"failed_items={$failed}":null,$runId]);fwrite(STDOUT,"巡回更新完了 processed={$processed} failed={$failed}\n");
}catch(Throwable $e){$pdo->prepare("UPDATE sync_runs SET status='failed',finished_at=NOW(),processed_count=?,error_message=? WHERE id=?")->execute([$processed,mb_substr($e->getMessage(),0,512),$runId]);fwrite(STDERR,$e->getMessage()."\n");exit(1);}finally{if(is_resource($lock)){flock($lock,LOCK_UN);fclose($lock);}}
