<?php

declare(strict_types=1);

namespace SwipePreview;

use RuntimeException;

final class FanzaClient
{
    private const API_BASE = 'https://api.dmm.com/affiliate/v3';
    private const USER_AGENT = 'fanza-doujin-img-view-php/2.0';
    private const TIMEOUT_SECONDS = 25;

    public function __construct(private readonly array $config)
    {
    }

    public function configured(): bool
    {
        return trim((string)($this->config['api_id'] ?? '')) !== ''
            && trim((string)($this->config['affiliate_id'] ?? '')) !== '';
    }

    public function resolveDoujinFloor(): array
    {
        $cachePath = rtrim(sys_get_temp_dir(), DIRECTORY_SEPARATOR) . DIRECTORY_SEPARATOR . 'swipe-preview-floor.json';
        if (is_file($cachePath) && (time() - (int)filemtime($cachePath)) < 604800) {
            $cached = json_decode((string)file_get_contents($cachePath), true);
            if (is_array($cached) && !empty($cached['floorId'])) {
                return $cached;
            }
        }

        $root = $this->request('FloorList');
        $result = $this->record($root['result'] ?? null);
        foreach ($this->rows($result['site'] ?? null) as $site) {
            if ($this->string($site['code'] ?? null) !== 'FANZA') continue;
            foreach ($this->rows($site['service'] ?? null) as $service) {
                if ($this->string($service['code'] ?? null) !== 'doujin') continue;
                foreach ($this->rows($service['floor'] ?? null) as $floor) {
                    if ($this->string($floor['code'] ?? null) !== 'digital_doujin') continue;
                    $floorId = $this->string($floor['id'] ?? null);
                    if ($floorId === '') throw new RuntimeException('FloorListでdigital_doujinのfloor_idを取得できませんでした。');
                    $resolved = [
                        'siteCode' => 'FANZA',
                        'siteName' => $this->string($site['name'] ?? null) ?: 'FANZA',
                        'serviceCode' => 'doujin',
                        'serviceName' => $this->string($service['name'] ?? null) ?: '同人',
                        'floorCode' => 'digital_doujin',
                        'floorName' => $this->string($floor['name'] ?? null) ?: '同人',
                        'floorId' => $floorId,
                    ];
                    @file_put_contents($cachePath, json_encode($resolved, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
                    return $resolved;
                }
            }
        }
        throw new RuntimeException('FloorListに FANZA / doujin / digital_doujin が見つかりませんでした。');
    }

    public function fallbackFloor(): array
    {
        return ['siteCode'=>'FANZA','siteName'=>'FANZA','serviceCode'=>'doujin','serviceName'=>'同人','floorCode'=>'digital_doujin','floorName'=>'同人','floorId'=>''];
    }

    public function fetchGenres(string $floorId): array
    {
        $genres = [];
        $hits = 100;
        for ($page = 0; $page < 10; $page++) {
            $root = $this->request('GenreSearch', ['floor_id'=>$floorId,'hits'=>$hits,'offset'=>1+$page*$hits]);
            $result = $this->record($root['result'] ?? null);
            $rows = $this->rows($result['genre'] ?? null);
            foreach ($rows as $row) {
                $id = $this->string($row['genre_id'] ?? null) ?: $this->string($row['id'] ?? null);
                $name = trim($this->string($row['name'] ?? null));
                if ($id === '' || $name === '') continue;
                $genres[$id] = ['id'=>$id,'name'=>$name,'ruby'=>$this->string($row['ruby'] ?? null)];
            }
            $resultCount = (int)($result['result_count'] ?? count($rows));
            $totalCount = (int)($result['total_count'] ?? 0);
            if ($resultCount < $hits || ($totalCount > 0 && count($genres) >= $totalCount)) break;
            usleep(150000);
        }
        $values = array_values($genres);
        usort($values, static fn(array $a, array $b): int => strnatcasecmp($a['ruby'] ?: $a['name'], $b['ruby'] ?: $b['name']));
        return $values;
    }

    public function fetchItem(string $cid, array $floor): array
    {
        $root = $this->itemList($floor, ['cid'=>$cid,'hits'=>1]);
        $result = $this->record($root['result'] ?? null);
        $items = $this->rows($result['items'] ?? null);
        if ($items === []) throw new RuntimeException('このCIDは現在のFANZA同人APIでは取得できません。');
        return $items[0];
    }

    public function fetchItemPage(
        array $floor,
        int $offset,
        string $genreId = '',
        string $sort = 'review',
        int $hits = 100,
        string $gteDate = '',
        string $lteDate = '',
    ): array {
        $params = ['hits'=>max(1,min(100,$hits)),'offset'=>max(1,$offset),'sort'=>$sort];
        if ($genreId !== '') { $params['article']='genre'; $params['article_id']=$genreId; }
        if ($gteDate !== '') $params['gte_date'] = $gteDate;
        if ($lteDate !== '') $params['lte_date'] = $lteDate;
        $root = $this->itemList($floor, $params);
        $result = $this->record($root['result'] ?? null);
        return ['items'=>$this->rows($result['items'] ?? null),'total'=>(int)($result['total_count'] ?? 0),'resultCount'=>(int)($result['result_count'] ?? 0)];
    }

    public function normalizeCid(string $input): string
    {
        $value = trim($input);
        if ($value === '') return '';
        if (preg_match('~(?:^|/)cid=([^/?#&]+)~i',$value,$match)===1) $value=$match[1];
        elseif (preg_match('~[?&]cid=([^&#]+)~i',$value,$match)===1) $value=$match[1];
        $decoded = rawurldecode($value);
        if ($decoded === '' || preg_match('/^[A-Za-z0-9_-]+$/',$decoded)!==1) throw new RuntimeException('作品IDの形式が正しくありません。CIDまたはFANZA同人の商品URLを入力してください。');
        return $decoded;
    }

    public function feedItem(array $item): array
    {
        $images = $this->sampleImages($item);
        $bucket = $this->detectAssetBucket($item);
        $assetType = in_array($bucket, ['comic', 'cg', 'game', 'voice'], true) ? $bucket : 'other';
        $review = $this->record($item['review'] ?? null);
        $prices = $this->record($item['prices'] ?? null);
        $genres = $this->itemGenres($item);
        $series = $this->itemSeries($item);
        $volume = trim($this->string($item['volume'] ?? null));

        return [
            'cid' => $this->string($item['content_id'] ?? null),
            'title' => $this->string($item['title'] ?? null),
            'productUrl' => $this->string($item['URL'] ?? null),
            'affiliateUrl' => $this->string($item['affiliateURL'] ?? null),
            // ItemListは通常説明文を返さないが、将来/フロア差で返る場合はそのまま保存できる受け口を持つ。
            'description' => $this->itemDescription($item),
            'images' => $images,
            'sampleCount' => count($images),
            'fullPageCount' => $this->pageCountFromVolume($volume),
            'volume' => $volume,
            'reviews' => (int)($review['count'] ?? 0),
            'rating' => (float)($review['average'] ?? 0),
            'genres' => array_values(array_map(static fn(array $genre): string => $genre['name'], $genres)),
            'genreRows' => $genres,
            'seriesRows' => $series,
            'price' => $this->string($prices['price'] ?? null),
            'assetBucket' => $bucket,
            'assetType' => $assetType,
            'assetLabel' => self::assetLabel($assetType),
            'releaseDate' => $this->string($item['date'] ?? null),
            'maker' => $this->makerName($item),
        ];
    }

    public static function assetDefinitions(): array
    {
        return [['key'=>'all','label'=>'すべて'],['key'=>'comic','label'=>'コミック系'],['key'=>'cg','label'=>'CG・イラスト系'],['key'=>'game','label'=>'ゲーム系'],['key'=>'voice','label'=>'ボイス・音声系'],['key'=>'other','label'=>'その他・不明']];
    }

    public static function assetLabel(string $type): string
    {
        return match($type){'comic'=>'コミック系','cg'=>'CG・イラスト系','game'=>'ゲーム系','voice'=>'ボイス・音声系','all'=>'すべて',default=>'その他・不明'};
    }

    private function pageCountFromVolume(string $volume): ?int
    {
        if ($volume === '') return null;
        $normalized = str_replace([',', '，'], '', $volume);
        if (preg_match('/([0-9]{1,5})\s*(?:ページ|頁)/u', $normalized, $match) !== 1) return null;
        $pages = (int)$match[1];
        return $pages > 0 ? $pages : null;
    }

    private function itemList(array $floor,array $params): array
    {
        return $this->request('ItemList',['site'=>$floor['siteCode']??'FANZA','service'=>$floor['serviceCode']??'doujin','floor'=>$floor['floorCode']??'digital_doujin',...$params]);
    }

    private function request(string $endpoint,array $params=[]): array
    {
        if(!$this->configured()) throw new RuntimeException('DMM_API_ID または DMM_AFFILIATE_ID が設定されていません。');
        $query=http_build_query(['api_id'=>trim((string)$this->config['api_id']),'affiliate_id'=>trim((string)$this->config['affiliate_id']),'output'=>'json',...$params],'','&',PHP_QUERY_RFC3986);
        $body=$this->httpGet(self::API_BASE.'/'.$endpoint.'?'.$query); $decoded=json_decode($body,true);
        if(!is_array($decoded)) throw new RuntimeException('DMM WebサービスのレスポンスをJSONとして解析できませんでした。');
        $result=$this->record($decoded['result']??null); $status=$this->string($result['status']??null);
        if($status!==''&&$status!=='200') throw new RuntimeException($endpoint.': '.($this->string($result['message']??null)?:'APIエラーが発生しました。'));
        return $decoded;
    }

    private function httpGet(string $url): string
    {
        if(function_exists('curl_init')){
            $curl=curl_init($url); if($curl===false) throw new RuntimeException('cURLを初期化できませんでした。');
            curl_setopt_array($curl,[CURLOPT_RETURNTRANSFER=>true,CURLOPT_FOLLOWLOCATION=>true,CURLOPT_CONNECTTIMEOUT=>8,CURLOPT_TIMEOUT=>self::TIMEOUT_SECONDS,CURLOPT_HTTPHEADER=>['Accept: application/json','User-Agent: '.self::USER_AGENT]]);
            $body=curl_exec($curl); $status=(int)curl_getinfo($curl,CURLINFO_RESPONSE_CODE); $error=curl_error($curl); curl_close($curl);
            if(!is_string($body)) throw new RuntimeException('DMM Webサービスへの接続に失敗しました: '.($error?:'unknown error'));
            if($status<200||$status>=300) throw new RuntimeException('DMM WebサービスがHTTP '.$status.'を返しました。');
            return $body;
        }
        $context=stream_context_create(['http'=>['method'=>'GET','timeout'=>self::TIMEOUT_SECONDS,'header'=>"Accept: application/json\r\nUser-Agent: ".self::USER_AGENT."\r\n",'ignore_errors'=>true]]);
        $body=@file_get_contents($url,false,$context); if(!is_string($body)) throw new RuntimeException('DMM Webサービスへの接続に失敗しました。'); return $body;
    }

    private function sampleImages(array $item): array
    {
        $sample=$this->record($item['sampleImageURL']??null); $large=$this->record($sample['sample_l']??null); $images=$large['image']??null; if(!is_array($images)) return [];
        $urls=[]; foreach($images as $url){if(is_string($url)&&preg_match('~^https?://~i',$url)===1)$urls[$url]=true;} return array_keys($urls);
    }

    private function itemGenres(array $item): array
    {
        return $this->itemInfoRows($item, 'genre', 'genre_id');
    }

    private function itemSeries(array $item): array
    {
        return $this->itemInfoRows($item, 'series', 'series_id');
    }

    private function itemInfoRows(array $item, string $key, string $fallbackIdKey): array
    {
        $itemInfo = $this->record($item['iteminfo'] ?? null);
        $values = [];
        foreach ($this->rows($itemInfo[$key] ?? null) as $row) {
            $name = trim($this->string($row['name'] ?? null));
            if ($name === '') continue;
            $id = $this->string($row['id'] ?? null) ?: $this->string($row[$fallbackIdKey] ?? null);
            if ($id === '') continue;
            $values[$id] = ['id'=>$id,'name'=>$name,'ruby'=>$this->string($row['ruby'] ?? null)];
        }
        return array_values($values);
    }

    private function itemDescription(array $item): string
    {
        foreach (['description', 'comment', 'summary', 'introduction'] as $key) {
            $value = trim($this->string($item[$key] ?? null));
            if ($value !== '') return $value;
        }
        return '';
    }

    private function makerName(array $item): string
    {
        $itemInfo=$this->record($item['iteminfo']??null); $makers=$this->rows($itemInfo['maker']??null); return $makers===[]?'':$this->string($makers[0]['name']??null);
    }

    private function detectAssetBucket(array $item): string
    {
        $imageUrl=$this->record($item['imageURL']??null); $urls=[];
        foreach(['large','list','small'] as $key){$url=$imageUrl[$key]??null;if(is_string($url)&&preg_match('~^https?://~i',$url)===1)$urls[]=$url;}
        $urls=array_merge($urls,$this->sampleImages($item));
        foreach($urls as $url){$path=(string)parse_url($url,PHP_URL_PATH);if(preg_match('~/digital/([^/]+)/~i',$path,$match)===1){$bucket=strtolower($match[1]);return in_array($bucket,['comic','cg','game','voice'],true)?$bucket:'other:'.$bucket;}}
        return 'unknown';
    }

    private function record(mixed $value): array
    {
        return is_array($value)&&!array_is_list($value)?$value:[];
    }

    private function rows(mixed $value): array
    {
        if(is_array($value)&&array_is_list($value))return array_values(array_filter($value,static fn(mixed $row):bool=>is_array($row)));
        if(!is_array($value))return []; if(isset($value['item'])&&is_array($value['item']))return $this->rows($value['item']); return $value===[]?[]:[$value];
    }

    private function string(mixed $value): string
    {
        return is_string($value)||is_int($value)||is_float($value)?(string)$value:'';
    }
}
