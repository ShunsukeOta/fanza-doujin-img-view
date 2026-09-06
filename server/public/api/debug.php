<?php

declare(strict_types=1);

require dirname(__DIR__, 2) . '/app/bootstrap.php';
header('X-Robots-Tag: noindex, nofollow, noarchive');
if(!admin_request_authorized()){http_response_code(404);exit;}
if(($_SERVER['REQUEST_METHOD']??'GET')!=='GET'){header('Allow: GET');json_response(['error'=>'GETのみ対応しています。'],405,['Cache-Control'=>'no-store']);}

$pdo=$database->connection();$counts=[];$latest=[];$sizeBytes=null;
if($pdo){
    foreach(['works'=>'SELECT COUNT(*) FROM works','activeWorks'=>'SELECT COUNT(*) FROM works WHERE is_active=1','worksWithSamples'=>'SELECT COUNT(*) FROM works WHERE is_active=1 AND sample_count>0','genres'=>'SELECT COUNT(*) FROM genres','series'=>'SELECT COUNT(*) FROM series','events'=>'SELECT COUNT(*) FROM events','feedSessions'=>'SELECT COUNT(*) FROM feed_sessions WHERE expires_at>NOW()'] as $key=>$sql)$counts[$key]=(int)$pdo->query($sql)->fetchColumn();
    $latest=['workUpdatedAt'=>$pdo->query('SELECT MAX(updated_at) FROM works')->fetchColumn()?:null,'eventAt'=>$pdo->query('SELECT MAX(created_at) FROM events')->fetchColumn()?:null,'syncAt'=>$pdo->query("SELECT MAX(finished_at) FROM sync_runs WHERE status='success'")->fetchColumn()?:null];
    $size=$pdo->query('SELECT COALESCE(SUM(data_length+index_length),0) FROM information_schema.tables WHERE table_schema=DATABASE()')->fetchColumn();$sizeBytes=is_numeric($size)?(int)$size:null;
}
json_response(['ok'=>$pdo!==null&&$database->hasUsableCatalog(),'generatedAt'=>date(DATE_ATOM),'database'=>['configured'=>$database->isConfigured(),'connected'=>$pdo!==null,'catalogReady'=>$database->hasUsableCatalog(),'sizeBytes'=>$sizeBytes,'counts'=>$counts,'latest'=>$latest],'dmm'=>['configured'=>$fanza->configured()]],200,['Cache-Control'=>'private, no-store']);
