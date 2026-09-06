<?php

declare(strict_types=1);

namespace SwipePreview;

use PDO;
use RuntimeException;
use Throwable;

final class EventService
{
    private const ALLOWED_EVENTS = [
        'session_start','work_impression','first_sample_loaded','sample_page_view','sample_complete','cta_view','view_end',
        'like_toggle','save_toggle','share','affiliate_click',
    ];
    private const RATE_LIMIT_PER_MINUTE = 600;

    public function __construct(private readonly Database $database) {}

    public function record(string $anonymousUserId,string $sessionId,array $payload):?array
    {
        $pdo=$this->requirePdo();$this->assertRate($pdo,$anonymousUserId,1);return $this->recordOne($pdo,$anonymousUserId,$sessionId,$payload);
    }

    public function recordBatch(string $anonymousUserId,string $sessionId,array $payloads):array
    {
        if($payloads===[]||count($payloads)>25)throw new RuntimeException('events の件数が不正です。');
        $pdo=$this->requirePdo();$this->assertRate($pdo,$anonymousUserId,count($payloads));$accepted=0;$duplicates=0;
        foreach($payloads as $payload){if(!is_array($payload))continue;$result=$this->recordOne($pdo,$anonymousUserId,$sessionId,$payload,true);$accepted++;if(($result['_duplicate']??false)===true)$duplicates++;}
        return ['accepted'=>$accepted,'duplicates'=>$duplicates];
    }

    public function reactionSummaries(string $anonymousUserId,array $cids):array
    {
        $normalized=$this->normalizeCids($cids);if($normalized===[])return[];$pdo=$this->database->connection();if(!$pdo)return$this->emptyReactionSummaries($normalized);return$this->reactionSummariesWithPdo($pdo,$anonymousUserId,$normalized);
    }

    private function recordOne(PDO $pdo,string $uid,string $sid,array $payload,bool $batch=false):?array
    {
        $eventType=trim((string)($payload['eventType']??''));if(!in_array($eventType,self::ALLOWED_EVENTS,true))throw new RuntimeException('eventType が不正です。');
        $cid=trim((string)($payload['cid']??''));$requiresWork=$eventType!=='session_start';
        if(($requiresWork&&($cid===''||preg_match('/^[A-Za-z0-9_-]{1,128}$/',$cid)!==1))||(!$requiresWork&&strlen($cid)>128))throw new RuntimeException('cid が不正です。');
        $eventId=$this->uuidOrNull($payload['eventId']??null);$viewId=$this->uuidOrNull($payload['viewId']??null);$version=max(1,min(99,(int)($payload['eventVersion']??3)));
        if($eventId!==null){$existing=$pdo->prepare('SELECT event_type,work_cid FROM events WHERE event_id=? LIMIT 1');$existing->execute([$eventId]);if($existing->fetch()){if($eventType==='like_toggle'||$eventType==='save_toggle')return$this->reactionSummariesWithPdo($pdo,$uid,[$cid])[$cid]??null;return ['_duplicate'=>true];}}
        $pageIndex=isset($payload['pageIndex'])?max(0,min(999,(int)$payload['pageIndex'])):null;$maxPage=isset($payload['maxPage'])?max(0,min(999,(int)$payload['maxPage'])):null;$readRatio=isset($payload['readRatio'])?max(0,min(1,(float)$payload['readRatio'])):null;$dwellMs=isset($payload['dwellMs'])?max(0,min(3600000,(int)$payload['dwellMs'])):null;
        $feedId=$this->uuidOrNull($payload['feedId']??null);$rank=isset($payload['rank'])?max(1,min(200000,(int)$payload['rank'])):null;$placement=mb_substr(trim((string)($payload['placement']??'')),0,32)?:null;
        $landingPath=mb_substr(trim((string)($payload['landingPath']??'')),0,512)?:null;$sourceDomain=mb_substr(trim((string)($payload['sourceDomain']??'')),0,255)?:null;$campaign=mb_substr(trim((string)($payload['campaign']??'')),0,128)?:null;
        $metadata=isset($payload['metadata'])&&is_array($payload['metadata'])?$payload['metadata']:null;$metadataJson=$metadata===null?null:json_encode($metadata,JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES);
        if(is_string($metadataJson)&&strlen($metadataJson)>4096)throw new RuntimeException('metadata が大きすぎます。');

        $pdo->beginTransaction();
        try{
            $this->ensureUser($pdo,$uid);
            $stmt=$pdo->prepare('INSERT INTO events(event_id,view_id,event_version,anonymous_user_id,session_id,work_cid,event_type,feed_id,rank_position,page_index,max_page,read_ratio,dwell_ms,placement,landing_path,source_domain,campaign,metadata_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
            $stmt->execute([$eventId,$viewId,$version,$uid,$sid,$cid,$eventType,$feedId,$rank,$pageIndex,$maxPage,$readRatio,$dwellMs,$placement,$landingPath,$sourceDomain,$campaign,$metadataJson]);
            $delta=$this->affinityDelta($pdo,$uid,$cid,$eventType,$dwellMs,$readRatio,$metadata);
            if(abs($delta)>.00001&&$cid!=='')$this->applyGenreAffinity($pdo,$uid,$cid,$delta);
            $reaction=null;if($eventType==='like_toggle'||$eventType==='save_toggle')$reaction=$this->reactionSummariesWithPdo($pdo,$uid,[$cid])[$cid]??null;
            $pdo->commit();return$reaction;
        }catch(Throwable $e){if($pdo->inTransaction())$pdo->rollBack();if($eventId!==null&&str_contains(strtolower($e->getMessage()),'duplicate'))return['_duplicate'=>true];throw$e;}
    }

    private function affinityDelta(PDO $pdo,string $uid,string $cid,string $type,?int $dwell,?float $ratio,?array $meta):float
    {
        $active=isset($meta['active'])&&is_bool($meta['active'])?$meta['active']:null;
        return match($type){
            'affiliate_click'=>8.0,'share'=>2.0,
            'like_toggle'=>$this->toggleDelta($pdo,$uid,$cid,'liked','liked_at',4.0,$active),
            'save_toggle'=>$this->toggleDelta($pdo,$uid,$cid,'saved','saved_at',5.0,$active),
            'view_end'=>$this->viewDelta($dwell??0,$ratio??0.0,$meta),default=>0.0,
        };
    }

    private function viewDelta(int $dwell,float $ratio,?array $meta):float
    {
        $loaded=($meta['sampleLoaded']??false)===true;$progress=max(0,(int)($meta['progressedPages']??0));
        // 画像未表示や初期1枚を見ただけの短時間離脱は読了率に関係なく加点しない。
        if(!$loaded)return 0.0;
        if($progress===0){if($dwell<1500)return-1.0;if($dwell<3000)return-.35;return min(.6,$dwell/60000);}
        if($dwell<1000)return-.25;
        $dwellScore=min(1.6,$dwell/18000);$readScore=min(2.2,max(0,$ratio)*2.2);$progressScore=min(1.2,$progress*.3);return$dwellScore+$readScore+$progressScore;
    }

    private function toggleDelta(PDO $pdo,string $uid,string $cid,string $column,string $timeColumn,float $weight,?bool $active):float
    {
        if($active===null)return 0;$state=$pdo->prepare('SELECT liked,saved FROM user_work_states WHERE anonymous_user_id=? AND work_cid=? FOR UPDATE');$state->execute([$uid,$cid]);$row=$state->fetch();$previous=is_array($row)?(bool)$row[$column]:false;
        if(!is_array($row)){$insert=$pdo->prepare('INSERT INTO user_work_states(anonymous_user_id,work_cid,liked,saved,liked_at,saved_at,updated_at) VALUES (?,?,?,?,?,?,NOW())');$insert->execute([$uid,$cid,$column==='liked'&&$active?1:0,$column==='saved'&&$active?1:0,$column==='liked'&&$active?date('Y-m-d H:i:s'):null,$column==='saved'&&$active?date('Y-m-d H:i:s'):null]);}
        elseif($previous!==$active){$sql="UPDATE user_work_states SET {$column}=?, {$timeColumn}=".($active?'NOW()':'NULL').", updated_at=NOW() WHERE anonymous_user_id=? AND work_cid=?";$pdo->prepare($sql)->execute([$active?1:0,$uid,$cid]);}
        if($previous===$active)return 0;return$active?$weight:-$weight;
    }

    private function applyGenreAffinity(PDO $pdo,string $uid,string $cid,float $delta):void
    {
        $s=$pdo->prepare('SELECT genre_id FROM work_genres WHERE work_cid=?');$s->execute([$cid]);$ids=array_values(array_filter(array_map(static fn($r)=>(string)($r['genre_id']??''),$s->fetchAll())));if($ids===[])return;$per=$delta/sqrt(count($ids));
        $up=$pdo->prepare("INSERT INTO user_genre_scores(anonymous_user_id,genre_id,score,updated_at) VALUES (?,?,?,NOW()) ON DUPLICATE KEY UPDATE score=LEAST(20,GREATEST(-12,score*POW(0.5,TIMESTAMPDIFF(DAY,updated_at,NOW())/45.0)+VALUES(score))),updated_at=NOW()");foreach($ids as $id)$up->execute([$uid,$id,$per]);
    }

    private function reactionSummariesWithPdo(PDO $pdo,string $uid,array $cids):array
    {
        $cids=$this->normalizeCids($cids);$out=$this->emptyReactionSummaries($cids);if($cids===[])return$out;$p=implode(',',array_fill(0,count($cids),'?'));
        $a=$pdo->prepare("SELECT work_cid,COALESCE(SUM(liked),0) like_count,COALESCE(SUM(saved),0) save_count FROM user_work_states WHERE work_cid IN ({$p}) GROUP BY work_cid");$a->execute($cids);foreach($a->fetchAll() as $r){$cid=(string)$r['work_cid'];$out[$cid]['likeCount']=(int)$r['like_count'];$out[$cid]['saveCount']=(int)$r['save_count'];}
        $v=$pdo->prepare("SELECT work_cid,liked,saved FROM user_work_states WHERE anonymous_user_id=? AND work_cid IN ({$p})");$v->execute([$uid,...$cids]);foreach($v->fetchAll() as $r){$cid=(string)$r['work_cid'];$out[$cid]['viewerLiked']=(bool)$r['liked'];$out[$cid]['viewerSaved']=(bool)$r['saved'];}return$out;
    }
    private function emptyReactionSummaries(array $cids):array{$o=[];foreach($cids as $c)$o[$c]=['cid'=>$c,'likeCount'=>0,'saveCount'=>0,'viewerLiked'=>false,'viewerSaved'=>false];return$o;}
    private function normalizeCids(array $cids):array{$o=[];foreach($cids as $c){$v=trim((string)$c);if($v!==''&&preg_match('/^[A-Za-z0-9_-]{1,128}$/',$v)===1)$o[$v]=true;if(count($o)>=100)break;}return array_keys($o);}
    private function assertRate(PDO $pdo,string $uid,int $incoming):void{$s=$pdo->prepare('SELECT COUNT(*) FROM events WHERE anonymous_user_id=? AND created_at>=DATE_SUB(NOW(),INTERVAL 1 MINUTE)');$s->execute([$uid]);if((int)$s->fetchColumn()+$incoming>self::RATE_LIMIT_PER_MINUTE)throw new RuntimeException('イベント送信が多すぎます。');}
    private function ensureUser(PDO $pdo,string $uid):void{$s=$pdo->prepare('INSERT INTO anonymous_users(id,created_at,last_seen_at) VALUES (?,NOW(),NOW()) ON DUPLICATE KEY UPDATE last_seen_at=NOW()');$s->execute([$uid]);}
    private function uuidOrNull(mixed $value):?string{$v=trim((string)$value);return preg_match('/^[a-f0-9-]{36}$/i',$v)===1?$v:null;}
    private function requirePdo():PDO{$pdo=$this->database->connection();if(!$pdo)throw new RuntimeException('行動ログDBがまだ設定されていません。');return$pdo;}
}
