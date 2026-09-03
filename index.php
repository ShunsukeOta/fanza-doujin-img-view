<?php

declare(strict_types=1);

const DOUJIN_FLOOR_ID = 81;

function h(string $value): string
{
    return htmlspecialchars($value, ENT_QUOTES, 'UTF-8');
}

function loadConfig(): array
{
    $config = [
        'api_id' => getenv('DMM_API_ID') ?: '',
        'affiliate_id' => getenv('DMM_AFFILIATE_ID') ?: '',
    ];

    $configPath = __DIR__ . '/config.php';
    if (is_file($configPath)) {
        $localConfig = require $configPath;
        if (is_array($localConfig)) {
            $config = array_merge($config, $localConfig);
        }
    }

    return $config;
}

function ensureApiConfig(array $config): void
{
    if (empty($config['api_id']) || empty($config['affiliate_id'])) {
        throw new RuntimeException('API設定がありません。config.example.phpをconfig.phpにコピーして、api_idとaffiliate_idを設定してください。');
    }
}

function normalizeCid(string $input): string
{
    $input = trim($input);
    if ($input === '') {
        return '';
    }

    if (preg_match('~(?:^|/)cid=([^/?#&]+)~i', $input, $matches)) {
        $input = $matches[1];
    } elseif (preg_match('~[?&]cid=([^&#]+)~i', $input, $matches)) {
        $input = $matches[1];
    }

    $input = rawurldecode($input);

    if (!preg_match('/^[A-Za-z0-9_-]+$/', $input)) {
        throw new InvalidArgumentException('作品IDの形式が正しくありません。CIDまたはFANZA同人の商品URLを入力してください。');
    }

    return $input;
}

function intParam(string $key, int $default, int $min, int $max): int
{
    $raw = $_GET[$key] ?? null;
    if (!is_scalar($raw) || $raw === '') {
        return $default;
    }

    return max($min, min($max, (int) $raw));
}

function floatParam(string $key, float $default, float $min, float $max): float
{
    $raw = $_GET[$key] ?? null;
    if (!is_scalar($raw) || $raw === '') {
        return $default;
    }

    return max($min, min($max, (float) $raw));
}

function stringParam(string $key, string $default = ''): string
{
    $raw = $_GET[$key] ?? null;
    return is_scalar($raw) ? trim((string) $raw) : $default;
}

function apiRequest(string $endpointName, array $params, array $config): array
{
    ensureApiConfig($config);

    if (!function_exists('curl_init')) {
        throw new RuntimeException('PHPのcURL拡張が有効になっていません。');
    }

    $params = array_merge([
        'api_id' => $config['api_id'],
        'affiliate_id' => $config['affiliate_id'],
        'output' => 'json',
    ], $params);

    $endpoint = 'https://api.dmm.com/affiliate/v3/' . $endpointName . '?' . http_build_query(
        $params,
        '',
        '&',
        PHP_QUERY_RFC3986
    );

    $ch = curl_init($endpoint);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CONNECTTIMEOUT => 10,
        CURLOPT_TIMEOUT => 25,
        CURLOPT_FOLLOWLOCATION => false,
        CURLOPT_USERAGENT => 'fanza-doujin-img-view/1.2',
        CURLOPT_HTTPHEADER => ['Accept: application/json'],
    ]);

    $body = curl_exec($ch);
    if ($body === false) {
        $message = curl_error($ch);
        curl_close($ch);
        throw new RuntimeException('DMM Webサービスへの接続に失敗しました: ' . $message);
    }

    $httpStatus = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    curl_close($ch);

    if ($httpStatus < 200 || $httpStatus >= 300) {
        throw new RuntimeException('DMM WebサービスがHTTP ' . $httpStatus . 'を返しました。');
    }

    $data = json_decode($body, true);
    if (!is_array($data)) {
        throw new RuntimeException('DMM WebサービスのレスポンスをJSONとして解析できませんでした。');
    }

    if (isset($data['result']['status']) && (string) $data['result']['status'] !== '200') {
        $message = isset($data['result']['message']) ? (string) $data['result']['message'] : 'APIエラーが発生しました。';
        throw new RuntimeException($message);
    }

    return $data;
}

function itemListRequest(array $params, array $config): array
{
    return apiRequest('ItemList', array_merge([
        'site' => 'FANZA',
        'service' => 'doujin',
        'floor' => 'digital_doujin',
    ], $params), $config);
}

function fetchItem(string $cid, array $config): array
{
    $data = itemListRequest([
        'cid' => $cid,
        'hits' => 1,
    ], $config);

    $items = $data['result']['items'] ?? [];
    if (!is_array($items) || $items === []) {
        throw new RuntimeException('このCIDは現在のFANZA同人APIでは取得できません。');
    }

    return $items[0];
}

function sampleImages(array $item): array
{
    $images = $item['sampleImageURL']['sample_l']['image'] ?? [];
    if (!is_array($images)) {
        return [];
    }

    $result = [];
    foreach ($images as $imageUrl) {
        if (is_string($imageUrl) && filter_var($imageUrl, FILTER_VALIDATE_URL)) {
            $result[] = $imageUrl;
        }
    }

    return array_values(array_unique($result));
}

function itemGenres(array $item): array
{
    $genres = $item['iteminfo']['genre'] ?? [];
    if (!is_array($genres)) {
        return [];
    }

    $result = [];
    foreach ($genres as $genre) {
        if (!is_array($genre)) {
            continue;
        }

        $name = trim((string) ($genre['name'] ?? ''));
        if ($name === '') {
            continue;
        }

        $result[] = [
            'id' => (string) ($genre['id'] ?? ''),
            'name' => $name,
        ];
    }

    return $result;
}

function categoryDefinitions(): array
{
    return [
        'all' => [
            'label' => 'すべて',
            'patterns' => [],
        ],
        'comic' => [
            'label' => 'コミック',
            'patterns' => ['コミック', '漫画', 'マンガ'],
        ],
        'cg' => [
            'label' => 'CG',
            'patterns' => ['CG', 'イラスト'],
        ],
        'game' => [
            'label' => 'ゲーム',
            'patterns' => ['ゲーム'],
        ],
        'voice' => [
            'label' => 'ボイス・音声',
            'patterns' => ['ボイス', '音声', 'ASMR'],
        ],
    ];
}

function itemMatchesCategory(array $item, string $category): bool
{
    if ($category === 'all') {
        return true;
    }

    $definitions = categoryDefinitions();
    if (!isset($definitions[$category])) {
        return true;
    }

    $patterns = $definitions[$category]['patterns'];
    foreach (itemGenres($item) as $genre) {
        foreach ($patterns as $pattern) {
            if (mb_stripos($genre['name'], $pattern, 0, 'UTF-8') !== false) {
                return true;
            }
        }
    }

    return false;
}

function normalizeGenreRows(array $data): array
{
    $result = $data['result'] ?? [];
    if (!is_array($result)) {
        return [];
    }

    $rows = $result['genre'] ?? ($result['items'] ?? []);
    if (isset($rows['item']) && is_array($rows['item'])) {
        $rows = $rows['item'];
    }

    if (!is_array($rows)) {
        return [];
    }

    if (isset($rows['id']) || isset($rows['genre_id'])) {
        $rows = [$rows];
    }

    $genres = [];
    foreach ($rows as $row) {
        if (!is_array($row)) {
            continue;
        }

        $id = (string) ($row['genre_id'] ?? ($row['id'] ?? ''));
        $name = trim((string) ($row['name'] ?? ''));
        if ($id === '' || $name === '') {
            continue;
        }

        $genres[$id] = [
            'id' => $id,
            'name' => $name,
            'ruby' => (string) ($row['ruby'] ?? ''),
        ];
    }

    return array_values($genres);
}

function fetchGenres(array $config): array
{
    $cacheFile = rtrim(sys_get_temp_dir(), DIRECTORY_SEPARATOR) . DIRECTORY_SEPARATOR . 'fanza-doujin-img-view-genres.json';
    $cacheTtl = 86400;

    if (is_file($cacheFile) && (time() - (int) filemtime($cacheFile)) < $cacheTtl) {
        $cached = json_decode((string) file_get_contents($cacheFile), true);
        if (is_array($cached) && $cached !== []) {
            return $cached;
        }
    }

    $genres = [];
    $hits = 100;

    for ($page = 0; $page < 5; $page++) {
        $data = apiRequest('GenreSearch', [
            'floor_id' => DOUJIN_FLOOR_ID,
            'hits' => $hits,
            'offset' => 1 + ($page * $hits),
        ], $config);

        $rows = normalizeGenreRows($data);
        foreach ($rows as $row) {
            $genres[$row['id']] = $row;
        }

        $resultCount = (int) ($data['result']['result_count'] ?? count($rows));
        $totalCount = (int) ($data['result']['total_count'] ?? count($genres));

        if ($resultCount < $hits || count($genres) >= $totalCount) {
            break;
        }

        usleep(200000);
    }

    $genres = array_values($genres);
    usort($genres, static function (array $a, array $b): int {
        $aKey = $a['ruby'] !== '' ? $a['ruby'] : $a['name'];
        $bKey = $b['ruby'] !== '' ? $b['ruby'] : $b['name'];
        return strnatcasecmp($aKey, $bKey);
    });

    if ($genres !== []) {
        @file_put_contents($cacheFile, json_encode($genres, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
    }

    return $genres;
}

function genreExists(array $genres, string $genreId): bool
{
    if ($genreId === '') {
        return true;
    }

    foreach ($genres as $genre) {
        if ((string) $genre['id'] === $genreId) {
            return true;
        }
    }

    return false;
}

function selectedGenreName(array $genres, string $genreId): string
{
    foreach ($genres as $genre) {
        if ((string) $genre['id'] === $genreId) {
            return (string) $genre['name'];
        }
    }

    return '';
}

function fetchFiltered(
    array $config,
    int $minSamples,
    int $minReviews,
    float $minRating,
    string $category,
    string $genreId
): array {
    $matches = [];
    $scanned = 0;
    $hits = 100;
    $maxPages = 8;

    for ($page = 0; $page < $maxPages; $page++) {
        $params = [
            'hits' => $hits,
            'offset' => 1 + ($page * $hits),
            'sort' => 'review',
        ];

        if ($genreId !== '') {
            $params['article'] = 'genre';
            $params['article_id'] = $genreId;
        }

        $data = itemListRequest($params, $config);
        $items = $data['result']['items'] ?? [];
        if (!is_array($items) || $items === []) {
            break;
        }

        $scanned += count($items);

        foreach ($items as $item) {
            if (!is_array($item)) {
                continue;
            }

            $images = sampleImages($item);
            $reviewCount = (int) ($item['review']['count'] ?? 0);
            $rating = (float) ($item['review']['average'] ?? 0);

            if (count($images) < $minSamples) {
                continue;
            }
            if ($reviewCount < $minReviews) {
                continue;
            }
            if ($rating < $minRating) {
                continue;
            }
            if (!itemMatchesCategory($item, $category)) {
                continue;
            }

            $genreNames = array_map(static function (array $genre): string {
                return $genre['name'];
            }, itemGenres($item));

            $matches[] = [
                'cid' => (string) ($item['content_id'] ?? ''),
                'title' => (string) ($item['title'] ?? ''),
                'cover' => (string) ($item['imageURL']['large'] ?? ''),
                'samples' => count($images),
                'reviews' => $reviewCount,
                'rating' => $rating,
                'genres' => $genreNames,
            ];

            if (count($matches) >= 12) {
                break 2;
            }
        }

        if (count($items) < $hits) {
            break;
        }

        if ($page + 1 < $maxPages) {
            usleep(250000);
        }
    }

    return [
        'items' => $matches,
        'scanned' => $scanned,
    ];
}

$config = loadConfig();
$query = stringParam('cid');
$minSamples = intParam('min_samples', 10, 0, 100);
$minReviews = intParam('min_reviews', 10, 0, 100000);
$minRating = floatParam('min_rating', 4.5, 0, 5);
$category = stringParam('category', 'all');
$genreId = stringParam('genre_id');

$categories = categoryDefinitions();
if (!isset($categories[$category])) {
    $category = 'all';
}

$genres = [];
$genreError = '';
try {
    $genres = fetchGenres($config);
    if (!genreExists($genres, $genreId)) {
        $genreId = '';
    }
} catch (Throwable $e) {
    $genreError = $e->getMessage();
}

$item = null;
$images = [];
$error = '';
if ($query !== '') {
    try {
        $cid = normalizeCid($query);
        $item = fetchItem($cid, $config);
        $images = sampleImages($item);
    } catch (Throwable $e) {
        $error = $e->getMessage();
    }
}

$filtered = ['items' => [], 'scanned' => 0];
$filterError = '';
try {
    $filtered = fetchFiltered($config, $minSamples, $minReviews, $minRating, $category, $genreId);
} catch (Throwable $e) {
    $filterError = $e->getMessage();
}

$title = is_array($item) ? (string) ($item['title'] ?? '') : '';
$cid = is_array($item) ? (string) ($item['content_id'] ?? '') : '';
$affiliateUrl = is_array($item) ? (string) ($item['affiliateURL'] ?? '') : '';
$activeGenreName = selectedGenreName($genres, $genreId);
?>
<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>FANZA同人 サンプル画像ビューアー</title>
<style>
:root{color-scheme:dark;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#111;color:#f5f5f5}*{box-sizing:border-box}body{margin:0;background:#111}button,input,select{font:inherit}.app{width:min(1120px,100%);margin:auto;padding:24px 16px 48px}.title{margin:0 0 18px;font-size:clamp(22px,4vw,34px)}.search{display:grid;grid-template-columns:1fr auto;gap:10px}.search input,.filters input,.filters select{min-width:0;width:100%;padding:13px 14px;border:1px solid #3b3b3b;border-radius:10px;background:#1b1b1b;color:#fff}.btn,.search button{border:0;border-radius:10px;padding:12px 18px;background:#fff;color:#111;font-weight:700;cursor:pointer}.hint,.meta{color:#aaa;font-size:13px}.error,.notice{margin:16px 0;padding:13px 15px;border:1px solid #5d2d2d;border-radius:10px;background:#221b1b}.notice{border-color:#333;background:#181818}.product{margin:24px 0 12px}.product h2{margin:0 0 7px;font-size:20px}.viewer{overflow:hidden;border:1px solid #2d2d2d;border-radius:14px;background:#050505}.track{display:flex;overflow-x:auto;scroll-snap-type:x mandatory;scrollbar-width:none;touch-action:pan-x}.track::-webkit-scrollbar{display:none}.slide{position:relative;display:grid;place-items:center;flex:0 0 100%;height:min(78vh,900px);padding:10px;scroll-snap-align:start;scroll-snap-stop:always}.slide img{display:block;max-width:100%;max-height:100%;object-fit:contain}.page{position:absolute;right:12px;bottom:12px;padding:6px 8px;border-radius:7px;background:#000b;font-size:12px}.controls{display:flex;justify-content:space-between;align-items:center;margin-top:10px}.controls button:disabled{opacity:.35}.cta{display:inline-block;margin-top:14px;text-decoration:none}.section{margin-top:36px;padding-top:28px;border-top:1px solid #2b2b2b}.section h2{margin:0 0 6px}.filters{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;align-items:end;margin:16px 0;padding:14px;border:1px solid #2d2d2d;border-radius:12px;background:#171717}.field label{display:block;margin-bottom:5px;color:#bbb;font-size:12px}.field--wide{grid-column:span 2}.filter-actions{display:flex;align-items:end}.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:12px;margin-top:14px}.card{display:block;overflow:hidden;border:1px solid #333;border-radius:10px;background:#1b1b1b;color:#fff;text-decoration:none}.card:hover{border-color:#555}.card img{display:block;width:100%;aspect-ratio:3/4;object-fit:cover;background:#080808}.card-body{padding:10px}.card-title{display:-webkit-box;overflow:hidden;-webkit-box-orient:vertical;-webkit-line-clamp:2;min-height:2.8em;margin:0;font-size:14px;line-height:1.4}.card-meta{display:grid;gap:3px;margin-top:8px;color:#aaa;font-size:12px}.card-genres{display:-webkit-box;overflow:hidden;-webkit-box-orient:vertical;-webkit-line-clamp:2;margin-top:7px;color:#888;font-size:11px;line-height:1.45}.active-condition{color:#ddd}.genre-note{margin-top:8px;color:#888;font-size:12px}@media(max-width:820px){.filters{grid-template-columns:1fr 1fr}.field--wide{grid-column:span 2}}@media(max-width:560px){.app{padding:16px 10px 32px}.search,.filters{grid-template-columns:1fr}.field--wide{grid-column:auto}.slide{height:72vh}.cards{grid-template-columns:1fr 1fr}}
</style>
</head>
<body>
<main class="app">
<h1 class="title">FANZA同人 サンプル画像ビューアー</h1>

<form class="search" method="get">
<input name="cid" value="<?= h($query) ?>" placeholder="作品ID（CID）またはFANZA同人の商品URL" autocomplete="off" required>
<input type="hidden" name="min_samples" value="<?= $minSamples ?>">
<input type="hidden" name="min_reviews" value="<?= $minReviews ?>">
<input type="hidden" name="min_rating" value="<?= h(number_format($minRating, 1, '.', '')) ?>">
<input type="hidden" name="category" value="<?= h($category) ?>">
<input type="hidden" name="genre_id" value="<?= h($genreId) ?>">
<button>OK</button>
</form>
<div class="hint">商品情報APIの <code>sample_l</code> を使用。下の条件一覧からCIDを選んでもテストできます。</div>

<?php if ($error !== ''): ?><div class="error"><?= h($error) ?></div><?php endif; ?>

<?php if ($item !== null && $error === ''): ?>
<section class="product">
<h2><?= h($title ?: $cid) ?></h2>
<div class="meta">CID: <?= h($cid) ?> / sample_l: <?= count($images) ?>枚 / レビュー: <?= (int) ($item['review']['count'] ?? 0) ?>件 / 評価: <?= h((string) ($item['review']['average'] ?? '-')) ?></div>
</section>

<?php if ($images): ?>
<div class="viewer"><div class="track" id="track" tabindex="0">
<?php foreach ($images as $i => $url): ?>
<div class="slide"><img src="<?= h($url) ?>" alt="<?= h($title) ?> サンプル <?= $i + 1 ?>" <?= $i === 0 ? 'loading="eager"' : 'loading="lazy"' ?> decoding="async"><div class="page"><?= $i + 1 ?> / <?= count($images) ?><span class="size"></span></div></div>
<?php endforeach; ?>
</div></div>
<div class="controls"><button class="btn" id="prev" type="button">← 前へ</button><span id="counter">1 / <?= count($images) ?></span><button class="btn" id="next" type="button">次へ →</button></div>
<?php else: ?><div class="notice">商品は取得できましたが、<code>sample_l</code> がありません。</div><?php endif; ?>

<?php if (filter_var($affiliateUrl, FILTER_VALIDATE_URL)): ?><a class="btn cta" href="<?= h($affiliateUrl) ?>" target="_blank" rel="noopener noreferrer">FANZAの商品ページを開く</a><?php endif; ?>
<?php endif; ?>

<section class="section">
<h2>条件付き作品一覧</h2>
<div class="hint">カテゴリ・ジャンル・サンプル枚数・レビュー・評価を併用できます。レビュー順で最大800件を走査し、条件一致作品を最大12件表示します。</div>

<form class="filters" method="get">
<div class="field">
<label for="category">カテゴリ（作品形式）</label>
<select id="category" name="category">
<?php foreach ($categories as $categoryKey => $definition): ?>
<option value="<?= h($categoryKey) ?>" <?= $category === $categoryKey ? 'selected' : '' ?>><?= h($definition['label']) ?></option>
<?php endforeach; ?>
</select>
</div>

<div class="field field--wide">
<label for="genre_id">ジャンル</label>
<select id="genre_id" name="genre_id">
<option value="">すべてのジャンル</option>
<?php foreach ($genres as $genre): ?>
<option value="<?= h((string) $genre['id']) ?>" <?= $genreId === (string) $genre['id'] ? 'selected' : '' ?>><?= h((string) $genre['name']) ?></option>
<?php endforeach; ?>
</select>
<?php if ($genreError !== ''): ?><div class="genre-note">ジャンル一覧取得エラー: <?= h($genreError) ?></div><?php endif; ?>
</div>

<div class="field"><label for="min_samples">最低サンプル枚数</label><input id="min_samples" type="number" name="min_samples" min="0" max="100" value="<?= $minSamples ?>"></div>
<div class="field"><label for="min_reviews">最低レビュー件数</label><input id="min_reviews" type="number" name="min_reviews" min="0" max="100000" value="<?= $minReviews ?>"></div>
<div class="field"><label for="min_rating">最低平均評価</label><input id="min_rating" type="number" name="min_rating" min="0" max="5" step="0.1" value="<?= h(number_format($minRating, 1, '.', '')) ?>"></div>
<div class="field filter-actions"><button class="btn">条件で絞り込む</button></div>
</form>

<div class="meta active-condition">
カテゴリ: <?= h($categories[$category]['label']) ?> /
ジャンル: <?= h($activeGenreName !== '' ? $activeGenreName : 'すべて') ?> /
sample_l <?= $minSamples ?>枚以上 /
レビュー <?= $minReviews ?>件以上 /
評価 <?= h(number_format($minRating, 1, '.', '')) ?>以上 /
走査 <?= (int) $filtered['scanned'] ?>件
</div>

<?php if ($filterError !== ''): ?><div class="error"><?= h($filterError) ?></div>
<?php elseif (!$filtered['items']): ?><div class="notice">条件一致作品が見つかりませんでした。カテゴリ・ジャンルまたは数値条件を緩めてください。</div>
<?php else: ?><div class="cards">
<?php foreach ($filtered['items'] as $row):
$params = http_build_query([
    'cid' => $row['cid'],
    'category' => $category,
    'genre_id' => $genreId,
    'min_samples' => $minSamples,
    'min_reviews' => $minReviews,
    'min_rating' => number_format($minRating, 1, '.', ''),
], '', '&', PHP_QUERY_RFC3986);
?>
<a class="card" href="?<?= h($params) ?>">
<?php if (filter_var($row['cover'], FILTER_VALIDATE_URL)): ?><img src="<?= h($row['cover']) ?>" alt="<?= h($row['title']) ?>" loading="lazy" decoding="async"><?php endif; ?>
<div class="card-body">
<p class="card-title"><?= h($row['title'] ?: $row['cid']) ?></p>
<div class="card-meta"><span>CID: <?= h($row['cid']) ?></span><span>sample_l: <?= (int) $row['samples'] ?>枚</span><span>レビュー: <?= (int) $row['reviews'] ?>件 / 評価: <?= h(number_format((float) $row['rating'], 1, '.', '')) ?></span></div>
<?php if ($row['genres']): ?><div class="card-genres"><?= h(implode(' / ', $row['genres'])) ?></div><?php endif; ?>
</div>
</a>
<?php endforeach; ?>
</div><?php endif; ?>
</section>
</main>

<?php if ($images): ?>
<script>
(() => {
    const track = document.getElementById('track');
    const slides = [...track.querySelectorAll('.slide')];
    const prev = document.getElementById('prev');
    const next = document.getElementById('next');
    const counter = document.getElementById('counter');
    let index = 0;
    let ticking = false;

    const clamp = value => Math.max(0, Math.min(slides.length - 1, value));
    const update = () => {
        counter.textContent = `${index + 1} / ${slides.length}`;
        prev.disabled = index === 0;
        next.disabled = index === slides.length - 1;
    };
    const go = value => {
        index = clamp(value);
        slides[index].scrollIntoView({behavior: 'smooth', block: 'nearest', inline: 'start'});
        update();
    };

    prev.addEventListener('click', () => go(index - 1));
    next.addEventListener('click', () => go(index + 1));
    track.addEventListener('scroll', () => {
        if (ticking) return;
        ticking = true;
        requestAnimationFrame(() => {
            index = clamp(Math.round(track.scrollLeft / track.clientWidth));
            update();
            ticking = false;
        });
    });
    track.addEventListener('keydown', event => {
        if (event.key === 'ArrowLeft') { event.preventDefault(); go(index - 1); }
        if (event.key === 'ArrowRight') { event.preventDefault(); go(index + 1); }
    });
    track.addEventListener('wheel', event => {
        if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
        event.preventDefault();
        track.scrollLeft += event.deltaY;
    }, {passive: false});

    slides.forEach(slide => {
        const image = slide.querySelector('img');
        const size = slide.querySelector('.size');
        const show = () => {
            if (image.naturalWidth && image.naturalHeight) {
                size.textContent = ` · ${image.naturalWidth}×${image.naturalHeight}px`;
            }
        };
        if (image.complete) show();
        image.addEventListener('load', show, {once: true});
    });

    update();
})();
</script>
<?php endif; ?>
</body>
</html>
