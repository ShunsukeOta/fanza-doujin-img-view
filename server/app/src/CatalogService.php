<?php

declare(strict_types=1);

namespace SwipePreview;

use PDO;
use RuntimeException;
use Throwable;

final class CatalogService
{
    private const LIVE_HITS = 100;
    private const FEED_TTL_HOURS = 12;
    private const BLOCK_SIZE = 120;
    private const RECOMMENDER_VERSION = 'rules-v3';

    public function __construct(
        private readonly Database $database,
        private readonly FanzaClient $fanza,
        private readonly WorkRepository $works,
    ) {}

    public function catalog(array $filters, string $feedId, int $cursor, int $limit, string $cidInput, string $anonymousUserId): array
    {
        $safeCursor=max(0,min(200000,$cursor));$safeLimit=max(1,min(12,$limit));$filters=$this->normalizeFilters($filters);
        if($this->database->hasUsableCatalog()) return $this->catalogFromDatabase($filters,$feedId,$safeCursor,$safeLimit,$cidInput,$anonymousUserId);
        return $this->catalogFromApi($filters,$safeCursor,$safeLimit,$cidInput);
    }

    public function meta(): array
    {
        $floor=$this->safeFloor();$genres=[];$pdo=$this->database->connection();
        if($pdo){try{$genres=$pdo->query("SELECT id,name,ruby FROM genres ORDER BY COALESCE(NULLIF(ruby,''),name),name")->fetchAll();}catch(Throwable){$genres=[];}}
        if($genres===[]&&$this->fanza->configured()&&($floor['floorId']??'')!=='')$genres=$this->fanza->fetchGenres((string)$floor['floorId']);
        return ['floor'=>$floor,'genres'=>$genres,'assetTypes'=>FanzaClient::assetDefinitions(),'recommenderVersion'=>self::RECOMMENDER_VERSION];
    }

    public function diagnostics(string $genreId): array
    {
        $pdo=$this->database->connection();if(!$pdo)throw new RuntimeException('DBが利用できません。');
        $where=['w.is_active=1'];$params=[];
        if($genreId!==''){$where[]='EXISTS (SELECT 1 FROM work_genres wg WHERE wg.work_cid=w.cid AND wg.genre_id=:genre)';$params[':genre']=$genreId;}
        $sql='SELECT COUNT(*) total,SUM(sample_count=0) zero,SUM(sample_count BETWEEN 1 AND 4) one_to_four,SUM(sample_count BETWEEN 5 AND 9) five_to_nine,SUM(sample_count>=10) ten_plus FROM works w WHERE '.implode(' AND ',$where);
        $s=$pdo->prepare($sql);$s->execute($params);$row=$s->fetch()?:[];
        $stats=['total'=>(int)($row['total']??0),'zero'=>(int)($row['zero']??0),'oneToFour'=>(int)($row['one_to_four']??0),'fiveToNine'=>(int)($row['five_to_nine']??0),'tenPlus'=>(int)($row['ten_plus']??0)];
        return ['scanned'=>$stats['total'],'apiTotal'=>$stats['total'],'stats'=>['all'=>$stats,'comic'=>$stats,'cg'=>$stats,'game'=>$stats,'voice'=>$stats,'other'=>$stats,'rawBuckets'=>[]]];
    }

    private function catalogFromDatabase(array $filters,string $requestedFeedId,int $cursor,int $limit,string $cidInput,string $userId): array
    {
        $pdo=$this->requirePdo();$this->ensureUser($pdo,$userId);$filterJson=json_encode($filters,JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES);$filterHash=hash('sha256',(string)$filterJson);
        $session=$this->loadSession($pdo,$requestedFeedId,$userId,$filterHash);
        $queryError='';
        if(!$session){
            $pdo->prepare('DELETE FROM feed_sessions WHERE expires_at<NOW() LIMIT 500')->execute();
            $feedId=$this->uuid();
            [$where,$params]=$this->databaseWhere($filters);
            $count=$pdo->prepare('SELECT COUNT(*) FROM works w WHERE '.implode(' AND ',$where));$count->execute($params);$total=(int)$count->fetchColumn();
            $pivot=(int)sprintf('%u',crc32($userId.'|'.$feedId.'|'.date('Y-m-d')));
            $insert=$pdo->prepare('INSERT INTO feed_sessions(id,anonymous_user_id,filter_hash,filter_json,total_count,generated_count,recommender_version,random_pivot,expires_at) VALUES (?,?,?,?,?,0,?,?,DATE_ADD(NOW(),INTERVAL '.self::FEED_TTL_HOURS.' HOUR))');
            $insert->execute([$feedId,$userId,$filterHash,$filterJson,$total,self::RECOMMENDER_VERSION,$pivot]);
            $session=['id'=>$feedId,'total_count'=>$total,'generated_count'=>0,'random_pivot'=>$pivot];
            if(trim($cidInput)!==''){
                try{
                    $cid=$this->fanza->normalizeCid($cidInput);$direct=$this->works->feedItemByCid($cid)??$this->works->fetchAndUpsert($cid);
                    if(($direct['sampleCount']??0)<1)throw new RuntimeException('指定した作品に表示可能なサンプルがありません。');
                    $this->insertFeedRows($pdo,$feedId,0,[['cid'=>$cid,'source'=>'direct','score'=>999.0]]);
                    $session['generated_count']=1;$session['total_count']=max(1,$total+1);
                    $pdo->prepare('UPDATE feed_sessions SET generated_count=1,total_count=? WHERE id=?')->execute([$session['total_count'],$feedId]);
                }catch(Throwable $e){$queryError=$e->getMessage();}
            }
        }else{$feedId=(string)$session['id'];}

        $needed=$cursor+$limit;
        for($guard=0;$guard<4&&(int)$session['generated_count']<$needed&&((int)$session['generated_count']<(int)$session['total_count']);$guard++){
            $added=$this->appendFeedBlock($pdo,$session,$filters,$userId);
            if($added===0){$session['total_count']=(int)$session['generated_count'];$pdo->prepare('UPDATE feed_sessions SET total_count=? WHERE id=?')->execute([$session['total_count'],$feedId]);break;}
            $session['generated_count']=(int)$session['generated_count']+$added;
        }

        $stmt=$pdo->prepare('SELECT position,work_cid,source,score FROM feed_items WHERE feed_id=? AND position>? ORDER BY position ASC LIMIT '.$limit);
        $stmt->execute([$feedId,$cursor]);$feedRows=$stmt->fetchAll();$cids=array_map(static fn(array $r):string=>(string)$r['work_cid'],$feedRows);$hydrated=$this->works->feedItemsByCids($cids);
        $items=[];foreach($feedRows as $r){$cid=(string)$r['work_cid'];if(!isset($hydrated[$cid]))continue;$item=$hydrated[$cid];$item['feedId']=$feedId;$item['rank']=(int)$r['position'];$item['recommendationSource']=(string)$r['source'];$items[]=$item;}
        $next=$cursor+count($feedRows);$hasMore=$next<(int)$session['total_count'];
        if($hasMore&&(int)$session['generated_count']<=$next){$added=$this->appendFeedBlock($pdo,$session,$filters,$userId);$session['generated_count']+=(int)$added;if($added===0){$session['total_count']=$session['generated_count'];$hasMore=$next<$session['total_count'];}}
        return ['items'=>$items,'feedId'=>$feedId,'cursor'=>$cursor,'nextCursor'=>$hasMore?$next:null,'hasMore'=>$hasMore,'apiTotal'=>(int)$session['total_count'],'scanned'=>count($feedRows),'effectiveMinSamples'=>(int)$filters['minSamples'],'source'=>'database','queryError'=>$queryError,'recommenderVersion'=>self::RECOMMENDER_VERSION,'floor'=>$this->safeFloor()];
    }

    private function appendFeedBlock(PDO $pdo,array &$session,array $filters,string $userId): int
    {
        $feedId=(string)$session['id'];$remaining=max(0,(int)$session['total_count']-(int)$session['generated_count']);if($remaining===0)return 0;$target=min(self::BLOCK_SIZE,$remaining);
        [$where,$params]=$this->databaseWhere($filters);$baseWhere=implode(' AND ',$where).' AND NOT EXISTS (SELECT 1 FROM feed_items fi WHERE fi.feed_id=:feed_id AND fi.work_cid=w.cid)';$common=[...$params,':feed_id'=>$feedId];
        $candidate=[];
        $take=function(string $sql,array $bind,string $source)use($pdo,&$candidate):void{$s=$pdo->prepare($sql);$s->execute($bind);foreach($s->fetchAll() as $r){$cid=(string)$r['cid'];if(!isset($candidate[$source][$cid]))$candidate[$source][$cid]=$r;}};
        $select='SELECT w.cid,w.rating,w.review_count,w.release_date,w.updated_at FROM works w WHERE '.$baseWhere;
        $take($select.' ORDER BY w.review_count DESC,w.rating DESC,w.cid ASC LIMIT '.min(240,max(60,$target)), $common,'popular');
        $take($select.' ORDER BY w.release_date DESC,w.cid ASC LIMIT '.min(180,max(40,$target)), $common,'recent');
        $pivot=(int)$session['random_pivot'];$exploreParams=[...$common,':pivot'=>$pivot];
        $take($select.' AND w.random_key>=:pivot ORDER BY w.random_key ASC,w.cid ASC LIMIT '.min(180,max(40,$target)), $exploreParams,'explore');
        if(count($candidate['explore']??[])<max(30,(int)ceil($target*.25)))$take($select.' AND w.random_key<:pivot ORDER BY w.random_key ASC,w.cid ASC LIMIT '.min(180,max(40,$target)), $exploreParams,'explore');

        $all=[];foreach($candidate as $source=>$rows)foreach($rows as $cid=>$row){if(!isset($all[$cid]))$all[$cid]=$row;$all[$cid]['sources'][]=$source;}
        if($all===[])return 0;$genreMap=$this->loadGenreIds($pdo,array_keys($all));$scores=$this->loadUserGenreScores($pdo,$userId);$now=time();
        $bySource=['popular'=>[],'recent'=>[],'explore'=>[]];
        foreach($all as $cid=>$row){$aff=$this->boundedAffinity($genreMap[$cid]??[],$scores,$now);$rating=max(0,min(2,((float)$row['rating']/5)*2));$pop=min(2.8,log10((float)$row['review_count']+1)*.9);$fresh=$this->freshnessScore((string)($row['release_date']?:$row['updated_at']));$explore=$this->stableRandom($feedId.'|'.$cid)*1.25;$score=$aff+$rating+$pop+$fresh+$explore;foreach($row['sources'] as $source)$bySource[$source][]=[$cid,$score];}
        foreach($bySource as &$rows)usort($rows,static fn($a,$b)=>$b[1]<=>$a[1]?:strcmp($a[0],$b[0]));unset($rows);
        $selected=[];$used=[];$quotas=['popular'=>(int)ceil($target*.5),'recent'=>(int)ceil($target*.25),'explore'=>$target-(int)ceil($target*.5)-(int)ceil($target*.25)];
        foreach(['popular','recent','explore'] as $source){$n=0;foreach($bySource[$source] as [$cid,$score]){if(isset($used[$cid]))continue;$selected[]=['cid'=>$cid,'source'=>$source,'score'=>$score];$used[$cid]=true;if(++$n>=$quotas[$source])break;}}
        if(count($selected)<$target){$flat=[];foreach($bySource as $source=>$rows)foreach($rows as [$cid,$score])if(!isset($used[$cid]))$flat[]=[$cid,$score,$source];usort($flat,static fn($a,$b)=>$b[1]<=>$a[1]?:strcmp($a[0],$b[0]));foreach($flat as [$cid,$score,$source]){if(isset($used[$cid]))continue;$selected[]=['cid'=>$cid,'source'=>$source,'score'=>$score];$used[$cid]=true;if(count($selected)>=$target)break;}}
        if(count($selected)<$target){$needed=$target-count($selected);$fill=$pdo->prepare($select.' ORDER BY w.random_key ASC,w.cid ASC LIMIT '.min(500,$needed*3));$fill->execute($common);foreach($fill->fetchAll() as $r){$cid=(string)$r['cid'];if(isset($used[$cid]))continue;$selected[]=['cid'=>$cid,'source'=>'explore','score'=>0.0];$used[$cid]=true;if(count($selected)>=$target)break;}}
        if($selected===[])return 0;$start=(int)$session['generated_count'];$this->insertFeedRows($pdo,$feedId,$start,$selected);$added=count($selected);$pdo->prepare('UPDATE feed_sessions SET generated_count=generated_count+?,updated_at=NOW() WHERE id=?')->execute([$added,$feedId]);return $added;
    }

    private function insertFeedRows(PDO $pdo,string $feedId,int $start,array $rows):void
    {
        $stmt=$pdo->prepare('INSERT IGNORE INTO feed_items(feed_id,position,work_cid,source,score) VALUES (?,?,?,?,?)');$pos=$start;
        foreach($rows as $r){$pos++;$stmt->execute([$feedId,$pos,(string)$r['cid'],(string)$r['source'],(float)$r['score']]);}
    }

    private function loadSession(PDO $pdo,string $feedId,string $userId,string $hash):?array
    {
        if(preg_match('/^[a-f0-9-]{36}$/i',$feedId)!==1)return null;$s=$pdo->prepare('SELECT * FROM feed_sessions WHERE id=? AND anonymous_user_id=? AND filter_hash=? AND expires_at>NOW() LIMIT 1');$s->execute([$feedId,$userId,$hash]);$row=$s->fetch();return is_array($row)?$row:null;
    }

    private function catalogFromApi(array $filters,int $cursor,int $limit,string $cidInput):array
    {
        $floor=$this->safeFloor(true);$offset=min(50000,$cursor+1);$page=$this->fanza->fetchItemPage($floor,$offset,(string)$filters['genreId'],'review',self::LIVE_HITS);$items=[];$consumed=0;
        foreach($page['items'] as $raw){$consumed++;$item=$this->fanza->feedItem($raw);if(!$this->matches($item,$filters))continue;$items[]=$this->stripInternalFields($item);if(count($items)>=$limit)break;}
        if($cursor===0&&trim($cidInput)!==''){try{$direct=$this->stripInternalFields($this->fanza->feedItem($this->fanza->fetchItem($this->fanza->normalizeCid($cidInput),$floor)));$items=[$direct,...array_values(array_filter($items,fn($x)=>$x['cid']!==$direct['cid']))];}catch(Throwable){}}
        $next=$cursor+$consumed;$hasMore=$consumed>0&&((int)$page['total']===0||$next<(int)$page['total']);return ['items'=>$items,'feedId'=>null,'cursor'=>$cursor,'nextCursor'=>$hasMore?$next:null,'hasMore'=>$hasMore,'apiTotal'=>(int)$page['total'],'scanned'=>$consumed,'effectiveMinSamples'=>(int)$filters['minSamples'],'source'=>'fanza-api','queryError'=>'','recommenderVersion'=>'live-fallback','floor'=>$floor];
    }

    private function databaseWhere(array $filters):array
    {
        $where=['w.sample_count>=:min_samples','w.review_count>=:min_reviews','w.rating>=:min_rating','w.is_active=1'];$params=[':min_samples'=>(int)$filters['minSamples'],':min_reviews'=>(int)$filters['minReviews'],':min_rating'=>(float)$filters['minRating']];
        if($filters['minPrice']>0){$where[]='w.price_value>=:min_price';$params[':min_price']=(int)$filters['minPrice'];}if($filters['maxPrice']>0){$where[]='w.price_value<=:max_price';$params[':max_price']=(int)$filters['maxPrice'];}
        if($filters['assetType']!=='all'){$where[]='w.asset_type=:asset';$params[':asset']=(string)$filters['assetType'];}
        if($filters['genreId']!==''){$where[]='EXISTS (SELECT 1 FROM work_genres wg WHERE wg.work_cid=w.cid AND wg.genre_id=:genre)';$params[':genre']=(string)$filters['genreId'];}
        if($filters['query']!==''){$where[]='(w.title LIKE :q OR w.maker LIKE :q OR EXISTS (SELECT 1 FROM work_series ws JOIN series s ON s.id=ws.series_id WHERE ws.work_cid=w.cid AND s.name LIKE :q))';$params[':q']='%'.str_replace(['%','_'],['\\%','\\_'],(string)$filters['query']).'%';}
        return [$where,$params];
    }

    private function normalizeFilters(array $f):array{return ['minSamples'=>max(1,min(100,(int)($f['minSamples']??1))),'minReviews'=>max(0,(int)($f['minReviews']??0)),'minRating'=>max(0,min(5,(float)($f['minRating']??0))),'minPrice'=>max(0,(int)($f['minPrice']??0)),'maxPrice'=>max(0,(int)($f['maxPrice']??0)),'assetType'=>in_array(($f['assetType']??'all'),['all','comic','cg','game','voice','other'],true)?$f['assetType']:'all','genreId'=>mb_substr(trim((string)($f['genreId']??'')),0,64),'query'=>mb_substr(trim((string)($f['query']??'')),0,100)];}
    private function loadGenreIds(PDO $pdo,array $cids):array{if($cids===[])return[];$p=implode(',',array_fill(0,count($cids),'?'));$s=$pdo->prepare("SELECT work_cid,genre_id FROM work_genres WHERE work_cid IN ({$p})");$s->execute($cids);$m=[];foreach($s->fetchAll() as $r)$m[(string)$r['work_cid']][]=(string)$r['genre_id'];return$m;}
    private function loadUserGenreScores(PDO $pdo,string $uid):array{$s=$pdo->prepare('SELECT genre_id,score,updated_at FROM user_genre_scores WHERE anonymous_user_id=?');$s->execute([$uid]);$m=[];foreach($s->fetchAll() as $r)$m[(string)$r['genre_id']]=['score'=>(float)$r['score'],'updated'=>(string)$r['updated_at']];return$m;}
    private function boundedAffinity(array $genreIds,array $scores,int $now):float{if($genreIds===[])return 0;$sum=0;foreach($genreIds as $id){$r=$scores[$id]??null;if(!$r)continue;$age=max(0,($now-(strtotime($r['updated'])?:$now))/86400);$decayed=$r['score']*pow(.5,$age/45);$sum+=tanh($decayed/8);}return max(-2.5,min(2.5,$sum/sqrt(count($genreIds))*2.0));}
    private function freshnessScore(string $date):float{$t=strtotime($date);if(!$t)return 0;$days=max(0,(time()-$t)/86400);return max(0,1.3*(1-$days/120));}
    private function stableRandom(string $seed):float{$v=(int)sprintf('%u',crc32($seed));return $v/4294967295;}
    private function matches(array $i,array $f):bool{if((int)$i['sampleCount']<$f['minSamples']||(int)$i['reviews']<$f['minReviews']||(float)$i['rating']<$f['minRating'])return false;$pv=PriceParser::singleValue((string)$i['price']);if($f['minPrice']>0&&($pv===null||$pv<$f['minPrice']))return false;if($f['maxPrice']>0&&($pv===null||$pv>$f['maxPrice']))return false;if($f['assetType']!=='all'&&$i['assetType']!==$f['assetType'])return false;return true;}
    private function stripInternalFields(array $item):array{unset($item['genreRows'],$item['seriesRows'],$item['productUrl'],$item['description']);$item['priceValue']=PriceParser::singleValue((string)($item['price']??''));$item['series']=array_values(array_map(static fn($s)=>(string)($s['name']??''),(array)($item['seriesRows']??[])));return$item;}
    private function ensureUser(PDO $pdo,string $uid):void{$s=$pdo->prepare('INSERT INTO anonymous_users(id,created_at,last_seen_at) VALUES (?,NOW(),NOW()) ON DUPLICATE KEY UPDATE last_seen_at=NOW()');$s->execute([$uid]);}
    private function safeFloor(bool $required=false):array{if(!$this->fanza->configured()){if($required)throw new RuntimeException('FANZA APIが設定されていません。');return$this->fanza->fallbackFloor();}try{return$this->fanza->resolveDoujinFloor();}catch(Throwable $e){if($required)throw$e;return$this->fanza->fallbackFloor();}}
    private function requirePdo():PDO{$pdo=$this->database->connection();if(!$pdo)throw new RuntimeException('データベースへ接続できません。');return$pdo;}
    private function uuid():string{$d=random_bytes(16);$d[6]=chr((ord($d[6])&15)|64);$d[8]=chr((ord($d[8])&63)|128);return vsprintf('%s%s-%s-%s-%s-%s%s%s',str_split(bin2hex($d),4));}
}
