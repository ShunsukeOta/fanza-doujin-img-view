<?php

declare(strict_types=1);

function h(string $value): string { return htmlspecialchars($value, ENT_QUOTES, 'UTF-8'); }
function loadConfig(): array {
    $config = ['api_id' => getenv('DMM_API_ID') ?: '', 'affiliate_id' => getenv('DMM_AFFILIATE_ID') ?: ''];
    $path = __DIR__ . '/config.php';
    if (is_file($path)) { $local = require $path; if (is_array($local)) $config = array_merge($config, $local); }
    return $config;
}
function ensureApiConfig(array $config): void {
    if (empty($config['api_id']) || empty($config['affiliate_id'])) throw new RuntimeException('API設定がありません。config.php に api_id と affiliate_id を設定してください。');
}
function normalizeCid(string $input): string {
    $input = trim($input); if ($input === '') return '';
    if (preg_match('~(?:^|/)cid=([^/?#&]+)~i', $input, $m)) $input = $m[1];
    elseif (preg_match('~[?&]cid=([^&#]+)~i', $input, $m)) $input = $m[1];
    $input = rawurldecode($input);
    if (!preg_match('/^[A-Za-z0-9_-]+$/', $input)) throw new InvalidArgumentException('作品IDの形式が正しくありません。CIDまたはFANZA同人の商品URLを入力してください。');
    return $input;
}
function intParam(string $key, int $default, int $min, int $max): int {
    $raw = $_GET[$key] ?? null; if (!is_scalar($raw) || $raw === '') return $default; return max($min, min($max, (int)$raw));
}
function floatParam(string $key, float $default, float $min, float $max): float {
    $raw = $_GET[$key] ?? null; if (!is_scalar($raw) || $raw === '') return $default; return max($min, min($max, (float)$raw));
}
function stringParam(string $key, string $default = ''): string { $raw = $_GET[$key] ?? null; return is_scalar($raw) ? trim((string)$raw) : $default; }
function normalizeRows($value): array {
    if (!is_array($value)) return [];
    if (isset($value['item']) && is_array($value['item'])) $value = $value['item'];
    if ($value === []) return [];
    return array_keys($value) === range(0, count($value)-1) ? $value : [$value];
}
function cachePath(string $name): string { return rtrim(sys_get_temp_dir(), DIRECTORY_SEPARATOR) . DIRECTORY_SEPARATOR . 'fanza-doujin-img-view-' . $name . '.json'; }
function readCache(string $name, int $ttl): ?array {
    $path = cachePath($name); if (!is_file($path) || time()-(int)filemtime($path) >= $ttl) return null;
    $data = json_decode((string)@file_get_contents($path), true); return is_array($data) ? $data : null;
}
function writeCache(string $name, array $value): void { @file_put_contents(cachePath($name), json_encode($value, JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES)); }
function apiRequest(string $endpointName, array $params, array $config): array {
    ensureApiConfig($config); if (!function_exists('curl_init')) throw new RuntimeException('PHPのcURL拡張が有効になっていません。');
    $params = array_merge(['api_id'=>$config['api_id'],'affiliate_id'=>$config['affiliate_id'],'output'=>'json'], $params);
    $url = 'https://api.dmm.com/affiliate/v3/' . $endpointName . '?' . http_build_query($params, '', '&', PHP_QUERY_RFC3986);
    $ch = curl_init($url); curl_setopt_array($ch,[CURLOPT_RETURNTRANSFER=>true,CURLOPT_CONNECTTIMEOUT=>10,CURLOPT_TIMEOUT=>30,CURLOPT_FOLLOWLOCATION=>false,CURLOPT_USERAGENT=>'fanza-doujin-img-view/3.0',CURLOPT_HTTPHEADER=>['Accept: application/json']]);
    $body = curl_exec($ch); if ($body === false) { $msg=curl_error($ch); curl_close($ch); throw new RuntimeException('DMM Webサービスへの接続に失敗しました: '.$msg); }
    $http=(int)curl_getinfo($ch,CURLINFO_RESPONSE_CODE); curl_close($ch); if ($http<200||$http>=300) throw new RuntimeException('DMM WebサービスがHTTP '.$http.'を返しました。');
    $data=json_decode($body,true); if(!is_array($data)) throw new RuntimeException('DMM WebサービスのレスポンスをJSONとして解析できませんでした。');
    $status=(string)($data['result']['status']??''); if($status!==''&&$status!=='200') throw new RuntimeException($endpointName.': '.(string)($data['result']['message']??'APIエラーが発生しました。'));
    return $data;
}
function resolveDoujinFloor(array $config): array {
    $cached=readCache('floor',7*86400); if(is_array($cached)&&($cached['site_code']??'')==='FANZA'&&($cached['service_code']??'')==='doujin'&&($cached['floor_code']??'')==='digital_doujin') return $cached;
    $data=apiRequest('FloorList',[],$config);
    foreach(normalizeRows($data['result']['site']??[]) as $site){ if(!is_array($site)||(string)($site['code']??'')!=='FANZA')continue;
        foreach(normalizeRows($site['service']??[]) as $service){ if(!is_array($service)||(string)($service['code']??'')!=='doujin')continue;
            foreach(normalizeRows($service['floor']??[]) as $floor){ if(!is_array($floor)||(string)($floor['code']??'')!=='digital_doujin')continue;
                $r=['site_code'=>'FANZA','site_name'=>(string)($site['name']??'FANZA'),'service_code'=>'doujin','service_name'=>(string)($service['name']??'同人'),'floor_code'=>'digital_doujin','floor_name'=>(string)($floor['name']??'同人'),'floor_id'=>(string)($floor['id']??'')];
                if($r['floor_id']==='')throw new RuntimeException('FloorListでdigital_doujinのfloor_idを取得できませんでした。'); writeCache('floor',$r); return $r;
            }
        }
    }
    throw new RuntimeException('FloorListに FANZA / doujin / digital_doujin が見つかりませんでした。');
}
function itemListRequest(array $params,array $config,array $floor):array{return apiRequest('ItemList',array_merge(['site'=>$floor['site_code'],'service'=>$floor['service_code'],'floor'=>$floor['floor_code']],$params),$config);}
function fetchItem(string $cid,array $config,array $floor):array{$d=itemListRequest(['cid'=>$cid,'hits'=>1],$config,$floor);$items=normalizeRows($d['result']['items']??[]);if($items===[]||!is_array($items[0]))throw new RuntimeException('このCIDは現在のFANZA同人APIでは取得できません。');return $items[0];}
function normalizeGenreRows(array $data):array{$rows=normalizeRows($data['result']['genre']??[]);$out=[];foreach($rows as $r){if(!is_array($r))continue;$id=(string)($r['genre_id']??($r['id']??''));$name=trim((string)($r['name']??''));if($id!==''&&$name!=='')$out[$id]=['id'=>$id,'name'=>$name,'ruby'=>(string)($r['ruby']??'')];}return array_values($out);}
function fetchGenres(array $config,string $floorId):array{
    $name='genres-'.preg_replace('/[^A-Za-z0-9_-]/','',$floorId);$cached=readCache($name,86400);if(is_array($cached)&&$cached!==[])return $cached;$genres=[];$hits=100;
    for($p=0;$p<10;$p++){$d=apiRequest('GenreSearch',['floor_id'=>$floorId,'hits'=>$hits,'offset'=>1+$p*$hits],$config);$rows=normalizeGenreRows($d);foreach($rows as $r)$genres[$r['id']]=$r;$rc=(int)($d['result']['result_count']??count($rows));$tc=(int)($d['result']['total_count']??count($genres));if($rc<$hits||($tc>0&&count($genres)>=$tc))break;usleep(300000);}
    $genres=array_values($genres);usort($genres,static function(array $a,array $b):int{return strnatcasecmp($a['ruby']!==''?$a['ruby']:$a['name'],$b['ruby']!==''?$b['ruby']:$b['name']);});if($genres!==[])writeCache($name,$genres);return $genres;
}
function genreExists(array $genres,string $id):bool{if($id==='')return true;foreach($genres as $g)if((string)$g['id']===$id)return true;return false;}
function selectedGenreName(array $genres,string $id):string{foreach($genres as $g)if((string)$g['id']===$id)return(string)$g['name'];return'';}
function sampleImages(array $item):array{$images=$item['sampleImageURL']['sample_l']['image']??[];if(!is_array($images))return[];$out=[];foreach($images as $u)if(is_string($u)&&filter_var($u,FILTER_VALIDATE_URL))$out[]=$u;return array_values(array_unique($out));}
function itemGenres(array $item):array{$rows=normalizeRows($item['iteminfo']['genre']??[]);$out=[];foreach($rows as $g){if(!is_array($g))continue;$name=trim((string)($g['name']??''));if($name!=='')$out[]=['id'=>(string)($g['id']??($g['genre_id']??'')),'name'=>$name];}return$out;}
function assetTypeDefinitions():array{return['all'=>['label'=>'すべて'],'comic'=>['label'=>'コミック系'],'cg'=>['label'=>'CG・イラスト系'],'game'=>['label'=>'ゲーム系'],'voice'=>['label'=>'ボイス・音声系'],'other'=>['label'=>'その他・不明']];}
function itemAssetUrls(array $item):array{$urls=[];foreach(['large','list','small']as$s){$u=$item['imageURL'][$s]??null;if(is_string($u)&&filter_var($u,FILTER_VALIDATE_URL))$urls[]=$u;}return array_values(array_unique(array_merge($urls,sampleImages($item))));}
function detectAssetBucket(array $item):string{foreach(itemAssetUrls($item)as$u){$path=(string)parse_url($u,PHP_URL_PATH);if(preg_match('~/digital/([^/]+)/~i',$path,$m)){ $b=strtolower($m[1]);return in_array($b,['comic','cg','game','voice'],true)?$b:'other:'.$b;}}return'unknown';}
function normalizedAssetType(string $bucket):string{return in_array($bucket,['comic','cg','game','voice'],true)?$bucket:'other';}
function assetLabel(string $bucket):string{$defs=assetTypeDefinitions();return$defs[normalizedAssetType($bucket)]['label'];}
function itemHasGenreId(array $item,string $id):bool{if($id==='')return true;foreach(itemGenres($item)as$g)if((string)$g['id']===$id)return true;return false;}
function feedRowFromItem(array $item):array{$genres=array_map(static function(array $g):string{return$g['name'];},itemGenres($item));$bucket=detectAssetBucket($item);$images=sampleImages($item);return['cid'=>(string)($item['content_id']??''),'title'=>(string)($item['title']??''),'affiliate_url'=>(string)($item['affiliateURL']??''),'images'=>$images,'sample_count'=>count($images),'reviews'=>(int)($item['review']['count']??0),'rating'=>(float)($item['review']['average']??0),'genres'=>$genres,'price'=>(string)($item['prices']['price']??''),'asset_bucket'=>$bucket,'asset_type'=>normalizedAssetType($bucket),'asset_label'=>assetLabel($bucket)];}
function emptySampleStats():array{return['total'=>0,'zero'=>0,'one_to_four'=>0,'five_to_nine'=>0,'ten_plus'=>0];}
function initialScanStats():array{return['all'=>emptySampleStats(),'comic'=>emptySampleStats(),'cg'=>emptySampleStats(),'game'=>emptySampleStats(),'voice'=>emptySampleStats(),'other'=>emptySampleStats(),'raw_buckets'=>[]];}
function incrementSampleStats(array &$stats,string $type,string $raw,int $count):void{foreach(['all',$type]as$k){$stats[$k]['total']++;if($count===0)$stats[$k]['zero']++;elseif($count<=4)$stats[$k]['one_to_four']++;elseif($count<=9)$stats[$k]['five_to_nine']++;else$stats[$k]['ten_plus']++;}if($type==='other'){$stats['raw_buckets'][$raw]=($stats['raw_buckets'][$raw]??0)+1;}}
function fetchCatalog(array $config,array $floor,int $minSamples,int $minReviews,float $minRating,string $assetType,string $genreId):array{
    $feed=[];$seen=[];$stats=initialScanStats();$scanned=0;$apiTotal=0;$hits=100;$pages=8;$effective=max(1,$minSamples);
    for($p=0;$p<$pages;$p++){$params=['hits'=>$hits,'offset'=>1+$p*$hits,'sort'=>'review'];if($genreId!==''){$params['article']='genre';$params['article_id']=$genreId;}$d=itemListRequest($params,$config,$floor);$rows=normalizeRows($d['result']['items']??[]);if($rows===[])break;if($p===0)$apiTotal=(int)($d['result']['total_count']??0);$scanned+=count($rows);
        foreach($rows as $item){if(!is_array($item))continue;$row=feedRowFromItem($item);if($row['cid']===''||isset($seen[$row['cid']]))continue;$seen[$row['cid']]=true;incrementSampleStats($stats,$row['asset_type'],$row['asset_bucket'],$row['sample_count']);if($genreId!==''&&!itemHasGenreId($item,$genreId))continue;if($assetType!=='all'&&$row['asset_type']!==$assetType)continue;if($row['sample_count']<$effective||$row['reviews']<$minReviews||$row['rating']<$minRating)continue;if(count($feed)<20)$feed[]=$row;}
        $rc=(int)($d['result']['result_count']??count($rows));if(count($rows)<$hits||$rc<$hits)break;if($p+1<$pages)usleep(350000);
    }
    return['items'=>$feed,'scanned'=>$scanned,'api_total'=>$apiTotal,'stats'=>$stats,'effective_min_samples'=>$effective];
}
