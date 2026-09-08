<?php

declare(strict_types=1);

namespace SwipePreview;

use RuntimeException;

final class FanzaClient
{
    private const API_BASE = 'https://api.dmm.com/affiliate/v3';
    private const USER_AGENT = 'fanza-doujin-img-view-php/2.1';
    private const TIMEOUT_SECONDS = 25;
    private const FLOOR_CACHE_SECONDS = 604800;
    private const FLOOR_DEFINITIONS = [
        'comic' => [
            'serviceCode' => 'doujin',
            'serviceName' => '同人',
            'floorCode' => 'digital_doujin',
            'floorName' => '同人',
        ],
        'amateur' => [
            'serviceCode' => 'digital',
            'serviceName' => '動画',
            'floorCode' => 'videoc',
            'floorName' => '素人',
        ],
    ];

    public function __construct(private readonly array $config)
    {
    }

    public function configured(): bool
    {
        return trim((string)($this->config['api_id'] ?? '')) !== ''
            && trim((string)($this->config['affiliate_id'] ?? '')) !== '';
    }

    public function normalizeFloorKey(string $floorKey): string
    {
        return isset(self::FLOOR_DEFINITIONS[$floorKey]) ? $floorKey : 'comic';
    }

    public function resolveFloor(string $floorKey): array
    {
        $floorKey = $this->normalizeFloorKey($floorKey);
        $definition = self::FLOOR_DEFINITIONS[$floorKey];
        $cachePath = rtrim(sys_get_temp_dir(), DIRECTORY_SEPARATOR)
            . DIRECTORY_SEPARATOR
            . 'swipe-preview-floor-' . $floorKey . '.json';

        if (is_file($cachePath) && (time() - (int)filemtime($cachePath)) < self::FLOOR_CACHE_SECONDS) {
            $cached = json_decode((string)file_get_contents($cachePath), true);
            if (is_array($cached) && !empty($cached['floorId']) && ($cached['key'] ?? '') === $floorKey) {
                return $cached;
            }
        }

        $root = $this->request('FloorList');
        $result = $this->record($root['result'] ?? null);
        foreach ($this->rows($result['site'] ?? null) as $site) {
            if ($this->string($site['code'] ?? null) !== 'FANZA') {
                continue;
            }
            foreach ($this->rows($site['service'] ?? null) as $service) {
                if ($this->string($service['code'] ?? null) !== $definition['serviceCode']) {
                    continue;
                }
                foreach ($this->rows($service['floor'] ?? null) as $floor) {
                    if ($this->string($floor['code'] ?? null) !== $definition['floorCode']) {
                        continue;
                    }
                    $floorId = $this->string($floor['id'] ?? null);
                    if ($floorId === '') {
                        throw new RuntimeException('FloorListで' . $definition['floorCode'] . 'のfloor_idを取得できませんでした。');
                    }

                    $resolved = [
                        'key' => $floorKey,
                        'siteCode' => 'FANZA',
                        'siteName' => $this->string($site['name'] ?? null) ?: 'FANZA',
                        'serviceCode' => $definition['serviceCode'],
                        'serviceName' => $this->string($service['name'] ?? null) ?: $definition['serviceName'],
                        'floorCode' => $definition['floorCode'],
                        'floorName' => $this->string($floor['name'] ?? null) ?: $definition['floorName'],
                        'floorId' => $floorId,
                    ];
                    @file_put_contents(
                        $cachePath,
                        json_encode($resolved, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
                    );
                    return $resolved;
                }
            }
        }

        throw new RuntimeException(
            'FloorListに FANZA / ' . $definition['serviceCode'] . ' / ' . $definition['floorCode'] . ' が見つかりませんでした。'
        );
    }

    public function resolveDoujinFloor(): array
    {
        return $this->resolveFloor('comic');
    }

    public function fallbackFloor(string $floorKey = 'comic'): array
    {
        $floorKey = $this->normalizeFloorKey($floorKey);
        $definition = self::FLOOR_DEFINITIONS[$floorKey];
        return [
            'key' => $floorKey,
            'siteCode' => 'FANZA',
            'siteName' => 'FANZA',
            'serviceCode' => $definition['serviceCode'],
            'serviceName' => $definition['serviceName'],
            'floorCode' => $definition['floorCode'],
            'floorName' => $definition['floorName'],
            'floorId' => '',
        ];
    }

    public function fetchGenres(string $floorId, string $namespace = ''): array
    {
        $genres = [];
        $hits = 100;
        for ($page = 0; $page < 10; $page++) {
            $root = $this->request('GenreSearch', [
                'floor_id' => $floorId,
                'hits' => $hits,
                'offset' => 1 + $page * $hits,
            ]);
            $result = $this->record($root['result'] ?? null);
            $rows = $this->rows($result['genre'] ?? null);

            foreach ($rows as $row) {
                $rawId = $this->string($row['genre_id'] ?? null) ?: $this->string($row['id'] ?? null);
                $name = trim($this->string($row['name'] ?? null));
                if ($rawId === '' || $name === '') {
                    continue;
                }
                $id = $namespace !== '' ? $namespace . ':' . $rawId : $rawId;
                $genres[$id] = [
                    'id' => $id,
                    'name' => $name,
                    'ruby' => $this->string($row['ruby'] ?? null),
                ];
            }

            $resultCount = (int)($result['result_count'] ?? count($rows));
            $totalCount = (int)($result['total_count'] ?? 0);
            if ($resultCount < $hits || ($totalCount > 0 && count($genres) >= $totalCount)) {
                break;
            }
            usleep(150000);
        }

        $values = array_values($genres);
        usort(
            $values,
            static fn(array $a, array $b): int => strnatcasecmp(
                $a['ruby'] ?: $a['name'],
                $b['ruby'] ?: $b['name'],
            ),
        );
        return $values;
    }

    public function fetchItem(string $cid, array $floor): array
    {
        $root = $this->itemList($floor, ['cid' => $cid, 'hits' => 1]);
        $result = $this->record($root['result'] ?? null);
        $items = $this->rows($result['items'] ?? null);
        if ($items === []) {
            throw new RuntimeException('このCIDは現在のFANZA APIでは取得できません。');
        }
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
        $params = [
            'hits' => max(1, min(100, $hits)),
            'offset' => max(1, $offset),
            'sort' => $sort,
        ];
        if ($genreId !== '') {
            $params['article'] = 'genre';
            $params['article_id'] = preg_replace('/^[a-z]+:/', '', $genreId) ?: $genreId;
        }
        if ($gteDate !== '') {
            $params['gte_date'] = $gteDate;
        }
        if ($lteDate !== '') {
            $params['lte_date'] = $lteDate;
        }

        $root = $this->itemList($floor, $params);
        $result = $this->record($root['result'] ?? null);
        return [
            'items' => $this->rows($result['items'] ?? null),
            'total' => (int)($result['total_count'] ?? 0),
            'resultCount' => (int)($result['result_count'] ?? 0),
        ];
    }

    public function normalizeCid(string $input): string
    {
        $value = trim($input);
        if ($value === '') {
            return '';
        }
        if (preg_match('~(?:^|/)cid=([^/?#&]+)~i', $value, $match) === 1) {
            $value = $match[1];
        } elseif (preg_match('~[?&]cid=([^&#]+)~i', $value, $match) === 1) {
            $value = $match[1];
        }

        $decoded = rawurldecode($value);
        if ($decoded === '' || preg_match('/^[A-Za-z0-9_-]+$/', $decoded) !== 1) {
            throw new RuntimeException('作品IDの形式が正しくありません。CIDまたはFANZAの商品URLを入力してください。');
        }
        return $decoded;
    }

    public function isComicItem(array $item): bool
    {
        $imageUrl = $this->record($item['imageURL'] ?? null);
        $urls = [];
        foreach (['large', 'list', 'small'] as $key) {
            $url = $imageUrl[$key] ?? null;
            if (is_string($url) && preg_match('~^https?://~i', $url) === 1) {
                $urls[] = $url;
            }
        }
        $urls = array_merge($urls, $this->sampleImages($item));

        foreach ($urls as $url) {
            $path = (string)parse_url($url, PHP_URL_PATH);
            if (preg_match('~/digital/([^/]+)/~i', $path, $match) !== 1) {
                continue;
            }
            return strtolower($match[1]) === 'comic';
        }
        return false;
    }

    public function feedItem(array $item, string $floorKey = 'comic'): array
    {
        $floorKey = $this->normalizeFloorKey($floorKey);
        if ($floorKey === 'comic' && !$this->isComicItem($item)) {
            throw new RuntimeException('この作品はコミック作品ではありません。');
        }

        $sampleMovieUrl = $floorKey === 'amateur' ? $this->sampleMovieUrl($item) : '';
        if ($floorKey === 'amateur' && $sampleMovieUrl === '') {
            throw new RuntimeException('この素人動画には表示可能な動画サンプルがありません。');
        }

        $images = $floorKey === 'comic' ? $this->sampleImages($item) : $this->posterImages($item);
        $review = $this->record($item['review'] ?? null);
        $prices = $this->record($item['prices'] ?? null);
        $namespace = $floorKey === 'comic' ? '' : $floorKey;
        $genres = $this->itemGenres($item, $namespace);
        $series = $this->itemSeries($item, $namespace);
        $maker = $this->makerInfo($item);
        $volume = trim($this->string($item['volume'] ?? null));

        return [
            'cid' => $this->string($item['content_id'] ?? null),
            'floorKey' => $floorKey,
            'mediaType' => $floorKey === 'amateur' ? 'video' : 'comic',
            'title' => $this->string($item['title'] ?? null),
            'productUrl' => $this->string($item['URL'] ?? null),
            'affiliateUrl' => $this->string($item['affiliateURL'] ?? null),
            'description' => $this->itemDescription($item),
            'images' => $images,
            'sampleMovieUrl' => $sampleMovieUrl,
            'sampleCount' => $floorKey === 'amateur' ? 1 : count($images),
            'fullPageCount' => $floorKey === 'comic' ? $this->pageCountFromVolume($volume) : null,
            'volume' => $volume,
            'reviews' => (int)($review['count'] ?? 0),
            'rating' => (float)($review['average'] ?? 0),
            'genres' => array_values(array_map(
                static fn(array $genre): string => $genre['name'],
                $genres,
            )),
            'genreRows' => $genres,
            'seriesRows' => $series,
            'price' => $this->string($prices['price'] ?? null),
            'releaseDate' => $this->string($item['date'] ?? null),
            'maker' => $maker['name'],
            'makerId' => $maker['id'],
        ];
    }

    private function pageCountFromVolume(string $volume): ?int
    {
        if ($volume === '') {
            return null;
        }
        $normalized = str_replace([',', '，'], '', $volume);
        if (preg_match('/([0-9]{1,5})\s*(?:ページ|頁)/u', $normalized, $match) !== 1) {
            return null;
        }
        $pages = (int)$match[1];
        return $pages > 0 ? $pages : null;
    }

    private function itemList(array $floor, array $params): array
    {
        return $this->request('ItemList', [
            'site' => $floor['siteCode'] ?? 'FANZA',
            'service' => $floor['serviceCode'] ?? 'doujin',
            'floor' => $floor['floorCode'] ?? 'digital_doujin',
            ...$params,
        ]);
    }

    private function request(string $endpoint, array $params = []): array
    {
        if (!$this->configured()) {
            throw new RuntimeException('DMM_API_ID または DMM_AFFILIATE_ID が設定されていません。');
        }

        $query = http_build_query([
            'api_id' => trim((string)$this->config['api_id']),
            'affiliate_id' => trim((string)$this->config['affiliate_id']),
            'output' => 'json',
            ...$params,
        ], '', '&', PHP_QUERY_RFC3986);

        $body = $this->httpGet(self::API_BASE . '/' . $endpoint . '?' . $query);
        $decoded = json_decode($body, true);
        if (!is_array($decoded)) {
            throw new RuntimeException('DMM WebサービスのレスポンスをJSONとして解析できませんでした。');
        }

        $result = $this->record($decoded['result'] ?? null);
        $status = $this->string($result['status'] ?? null);
        if ($status !== '' && $status !== '200') {
            $message = $this->string($result['message'] ?? null) ?: 'APIエラーが発生しました。';
            throw new RuntimeException($endpoint . ': ' . $message);
        }
        return $decoded;
    }

    private function httpGet(string $url): string
    {
        if (function_exists('curl_init')) {
            $curl = curl_init($url);
            if ($curl === false) {
                throw new RuntimeException('cURLを初期化できませんでした。');
            }
            curl_setopt_array($curl, [
                CURLOPT_RETURNTRANSFER => true,
                CURLOPT_FOLLOWLOCATION => true,
                CURLOPT_CONNECTTIMEOUT => 8,
                CURLOPT_TIMEOUT => self::TIMEOUT_SECONDS,
                CURLOPT_HTTPHEADER => [
                    'Accept: application/json',
                    'User-Agent: ' . self::USER_AGENT,
                ],
            ]);
            $body = curl_exec($curl);
            $status = (int)curl_getinfo($curl, CURLINFO_RESPONSE_CODE);
            $error = curl_error($curl);
            curl_close($curl);

            if (!is_string($body)) {
                throw new RuntimeException('DMM Webサービスへの接続に失敗しました: ' . ($error ?: 'unknown error'));
            }
            if ($status < 200 || $status >= 300) {
                throw new RuntimeException('DMM WebサービスがHTTP ' . $status . 'を返しました。');
            }
            return $body;
        }

        $context = stream_context_create(['http' => [
            'method' => 'GET',
            'timeout' => self::TIMEOUT_SECONDS,
            'header' => "Accept: application/json\r\nUser-Agent: " . self::USER_AGENT . "\r\n",
            'ignore_errors' => true,
        ]]);
        $body = @file_get_contents($url, false, $context);
        if (!is_string($body)) {
            throw new RuntimeException('DMM Webサービスへの接続に失敗しました。');
        }
        return $body;
    }

    private function sampleImages(array $item): array
    {
        $sample = $this->record($item['sampleImageURL'] ?? null);
        $large = $this->record($sample['sample_l'] ?? null);
        $images = $large['image'] ?? null;
        if (!is_array($images)) {
            return [];
        }

        $urls = [];
        foreach ($images as $url) {
            if (is_string($url) && preg_match('~^https?://~i', $url) === 1) {
                $urls[$url] = true;
            }
        }
        return array_keys($urls);
    }

    private function posterImages(array $item): array
    {
        $image = $this->record($item['imageURL'] ?? null);
        $urls = [];
        foreach (['large', 'list', 'small'] as $key) {
            $url = $image[$key] ?? null;
            if (is_string($url) && preg_match('~^https?://~i', $url) === 1) {
                $urls[$url] = true;
            }
        }
        return array_keys($urls);
    }

    private function sampleMovieUrl(array $item): string
    {
        $sample = $this->record($item['sampleMovieURL'] ?? null);
        foreach (['size_720_480', 'size_644_414', 'size_560_360', 'size_476_306'] as $key) {
            $url = $sample[$key] ?? null;
            if (is_string($url) && preg_match('~^https?://~i', $url) === 1) {
                return $url;
            }
        }
        foreach ($sample as $url) {
            if (is_string($url) && preg_match('~^https?://~i', $url) === 1) {
                return $url;
            }
        }
        return '';
    }

    private function itemGenres(array $item, string $namespace = ''): array
    {
        return $this->itemInfoRows($item, 'genre', 'genre_id', $namespace);
    }

    private function itemSeries(array $item, string $namespace = ''): array
    {
        return $this->itemInfoRows($item, 'series', 'series_id', $namespace);
    }

    private function itemInfoRows(array $item, string $key, string $fallbackIdKey, string $namespace = ''): array
    {
        $itemInfo = $this->record($item['iteminfo'] ?? null);
        $values = [];
        foreach ($this->rows($itemInfo[$key] ?? null) as $row) {
            $name = trim($this->string($row['name'] ?? null));
            if ($name === '') {
                continue;
            }
            $rawId = $this->string($row['id'] ?? null)
                ?: $this->string($row[$fallbackIdKey] ?? null);
            if ($rawId === '') {
                continue;
            }
            $id = $namespace !== '' ? $namespace . ':' . $rawId : $rawId;
            $values[$id] = [
                'id' => $id,
                'name' => $name,
                'ruby' => $this->string($row['ruby'] ?? null),
            ];
        }
        return array_values($values);
    }

    private function itemDescription(array $item): string
    {
        foreach (['description', 'comment', 'summary', 'introduction'] as $key) {
            $value = trim($this->string($item[$key] ?? null));
            if ($value !== '') {
                return $value;
            }
        }
        return '';
    }

    /** @return array{id:string,name:string} */
    private function makerInfo(array $item): array
    {
        $itemInfo = $this->record($item['iteminfo'] ?? null);
        $makers = $this->rows($itemInfo['maker'] ?? null);
        if ($makers === []) {
            return ['id' => '', 'name' => ''];
        }
        $maker = $makers[0];
        return [
            'id' => $this->string($maker['id'] ?? null)
                ?: $this->string($maker['maker_id'] ?? null),
            'name' => $this->string($maker['name'] ?? null),
        ];
    }

    private function record(mixed $value): array
    {
        return is_array($value) && !array_is_list($value) ? $value : [];
    }

    private function rows(mixed $value): array
    {
        if (is_array($value) && array_is_list($value)) {
            return array_values(array_filter($value, static fn(mixed $row): bool => is_array($row)));
        }
        if (!is_array($value)) {
            return [];
        }
        if (isset($value['item']) && is_array($value['item'])) {
            return $this->rows($value['item']);
        }
        return $value === [] ? [] : [$value];
    }

    private function string(mixed $value): string
    {
        return is_string($value) || is_int($value) || is_float($value)
            ? (string)$value
            : '';
    }
}
