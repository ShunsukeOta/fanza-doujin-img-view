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
        if (is_array($localConfig)) $config = array_merge($config, $localConfig);
    }
    return $config;
}

function ensureApiConfig(array $config): void
{
    if (empty($config['api_id']) || empty($config['affiliate_id'])) throw new RuntimeException('API設定がありません。config.php に api_id と affiliate_id を設定してください。');
}

function normalizeCid(string $input): string
{
    $input = trim($input);
    if ($input === '') return '';
    if (preg_match('~(?:^|/)cid=([^/?#&]+)~i', $input, $matches)) $input = $matches[1];
    elseif (preg_match('~[?&]cid=([^&#]+)~i', $input, $matches)) $input = $matches[1];
    $input = rawurldecode($input);
    if (!preg_match('/^[A-Za-z0-9_-]+$/', $input)) throw new InvalidArgumentException('作品IDの形式が正しくありません。CIDまたはFANZA同人の商品URLを入力してください。');
    return $input;
}

function intParam(string $key, int $default, int $min, int $max): int
{
    $raw = $_GET[$key] ?? null;
    if (!is_scalar($raw) || $raw === '') return $default;
    return max($min, min($max, (int) $raw));
}

function floatParam(string $key, float $default, float $min, float $max): float
{
    $raw = $_GET[$key] ?? null;
    if (!is_scalar($raw) || $raw === '') return $default;
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
    if (!function_exists('curl_init')) throw new RuntimeException('PHPのcURL拡張が有効になっていません。');
    $params = array_merge(['api_id' => $config['api_id'], 'affiliate_id' => $config['affiliate_id'], 'output' => 'json'], $params);
    $endpoint = 'https://api.dmm.com/affiliate/v3/' . $endpointName . '?' . http_build_query($params, '', '&', PHP_QUERY_RFC3986);
    $ch = curl_init($endpoint);
    curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_CONNECTTIMEOUT => 10, CURLOPT_TIMEOUT => 25, CURLOPT_FOLLOWLOCATION => false, CURLOPT_USERAGENT => 'fanza-doujin-img-view/2.0', CURLOPT_HTTPHEADER => ['Accept: application/json']]);
    $body = curl_exec($ch);
    if ($body === false) {
        $message = curl_error($ch);
        curl_close($ch);
        throw new RuntimeException('DMM Webサービスへの接続に失敗しました: ' . $message);
    }
    $httpStatus = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    curl_close($ch);
    if ($httpStatus < 200 || $httpStatus >= 300) throw new RuntimeException('DMM WebサービスがHTTP ' . $httpStatus . 'を返しました。');
    $data = json_decode($body, true);
    if (!is_array($data)) throw new RuntimeException('DMM WebサービスのレスポンスをJSONとして解析できませんでした。');
    if (isset($data['result']['status']) && (string) $data['result']['status'] !== '200') {
        $message = isset($data['result']['message']) ? (string) $data['result']['message'] : 'APIエラーが発生しました。';
        throw new RuntimeException($message);
    }
    return $data;
}

function itemListRequest(array $params, array $config): array
{
    return apiRequest('ItemList', array_merge(['site' => 'FANZA', 'service' => 'doujin', 'floor' => 'digital_doujin'], $params), $config);
}

function fetchItem(string $cid, array $config): array
{
    $data = itemListRequest(['cid' => $cid, 'hits' => 1], $config);
    $items = $data['result']['items'] ?? [];
    if (!is_array($items) || $items === []) throw new RuntimeException('このCIDは現在のFANZA同人APIでは取得できません。');
    return $items[0];
}

function sampleImages(array $item): array
{
    $images = $item['sampleImageURL']['sample_l']['image'] ?? [];
    if (!is_array($images)) return [];
    $result = [];
    foreach ($images as $imageUrl) if (is_string($imageUrl) && filter_var($imageUrl, FILTER_VALIDATE_URL)) $result[] = $imageUrl;
    return array_values(array_unique($result));
}

function itemGenres(array $item): array
{
    $genres = $item['iteminfo']['genre'] ?? [];
    if (!is_array($genres)) return [];
    $result = [];
    foreach ($genres as $genre) {
        if (!is_array($genre)) continue;
        $name = trim((string) ($genre['name'] ?? ''));
        if ($name === '') continue;
        $result[] = ['id' => (string) ($genre['id'] ?? ''), 'name' => $name];
    }
    return $result;
}

function categoryDefinitions(): array
{
    return [
        'all' => ['label' => 'すべて', 'patterns' => []],
        'comic' => ['label' => 'コミック', 'patterns' => ['コミック', '漫画', 'マンガ']],
        'cg' => ['label' => 'CG', 'patterns' => ['CG', 'イラスト']],
        'game' => ['label' => 'ゲーム', 'patterns' => ['ゲーム']],
        'voice' => ['label' => 'ボイス・音声', 'patterns' => ['ボイス', '音声', 'ASMR']],
    ];
}

function itemMatchesCategory(array $item, string $category): bool
{
    if ($category === 'all') return true;
    $definitions = categoryDefinitions();
    if (!isset($definitions[$category])) return true;
    foreach (itemGenres($item) as $genre) {
        foreach ($definitions[$category]['patterns'] as $pattern) if (mb_stripos($genre['name'], $pattern, 0, 'UTF-8') !== false) return true;
    }
    return false;
}

function normalizeGenreRows(array $data): array
{
    $result = $data['result'] ?? [];
    if (!is_array($result)) return [];
    $rows = $result['genre'] ?? ($result['items'] ?? []);
    if (isset($rows['item']) && is_array($rows['item'])) $rows = $rows['item'];
    if (!is_array($rows)) return [];
    if (isset($rows['id']) || isset($rows['genre_id'])) $rows = [$rows];
    $genres = [];
    foreach ($rows as $row) {
        if (!is_array($row)) continue;
        $id = (string) ($row['genre_id'] ?? ($row['id'] ?? ''));
        $name = trim((string) ($row['name'] ?? ''));
        if ($id === '' || $name === '') continue;
        $genres[$id] = ['id' => $id, 'name' => $name, 'ruby' => (string) ($row['ruby'] ?? '')];
    }
    return array_values($genres);
}

function fetchGenres(array $config): array
{
    $cacheFile = rtrim(sys_get_temp_dir(), DIRECTORY_SEPARATOR) . DIRECTORY_SEPARATOR . 'fanza-doujin-img-view-genres.json';
    $cacheTtl = 86400;
    if (is_file($cacheFile) && (time() - (int) filemtime($cacheFile)) < $cacheTtl) {
        $cached = json_decode((string) file_get_contents($cacheFile), true);
        if (is_array($cached) && $cached !== []) return $cached;
    }
    $genres = [];
    $hits = 100;
    for ($page = 0; $page < 5; $page++) {
        $data = apiRequest('GenreSearch', ['floor_id' => DOUJIN_FLOOR_ID, 'hits' => $hits, 'offset' => 1 + ($page * $hits)], $config);
        $rows = normalizeGenreRows($data);
        foreach ($rows as $row) $genres[$row['id']] = $row;
        $resultCount = (int) ($data['result']['result_count'] ?? count($rows));
        $totalCount = (int) ($data['result']['total_count'] ?? count($genres));
        if ($resultCount < $hits || count($genres) >= $totalCount) break;
        usleep(150000);
    }
    $genres = array_values($genres);
    usort($genres, static function (array $a, array $b): int {
        $aKey = $a['ruby'] !== '' ? $a['ruby'] : $a['name'];
        $bKey = $b['ruby'] !== '' ? $b['ruby'] : $b['name'];
        return strnatcasecmp($aKey, $bKey);
    });
    if ($genres !== []) @file_put_contents($cacheFile, json_encode($genres, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
    return $genres;
}

function genreExists(array $genres, string $genreId): bool
{
    if ($genreId === '') return true;
    foreach ($genres as $genre) if ((string) $genre['id'] === $genreId) return true;
    return false;
}

function selectedGenreName(array $genres, string $genreId): string
{
    foreach ($genres as $genre) if ((string) $genre['id'] === $genreId) return (string) $genre['name'];
    return '';
}

function feedRowFromItem(array $item): array
{
    $genres = array_map(static fn(array $genre): string => $genre['name'], itemGenres($item));
    return [
        'cid' => (string) ($item['content_id'] ?? ''),
        'title' => (string) ($item['title'] ?? ''),
        'affiliate_url' => (string) ($item['affiliateURL'] ?? ''),
        'images' => sampleImages($item),
        'reviews' => (int) ($item['review']['count'] ?? 0),
        'rating' => (float) ($item['review']['average'] ?? 0),
        'genres' => $genres,
        'price' => (string) ($item['prices']['price'] ?? ''),
    ];
}

function fetchFiltered(array $config, int $minSamples, int $minReviews, float $minRating, string $category, string $genreId): array
{
    $matches = [];
    $seen = [];
    $scanned = 0;
    $hits = 100;
    $maxPages = 8;
    $targetCount = 20;
    for ($page = 0; $page < $maxPages; $page++) {
        $params = ['hits' => $hits, 'offset' => 1 + ($page * $hits), 'sort' => 'review'];
        if ($genreId !== '') {
            $params['article'] = 'genre';
            $params['article_id'] = $genreId;
        }
        $data = itemListRequest($params, $config);
        $items = $data['result']['items'] ?? [];
        if (!is_array($items) || $items === []) break;
        $scanned += count($items);
        foreach ($items as $item) {
            if (!is_array($item)) continue;
            $row = feedRowFromItem($item);
            if ($row['cid'] === '' || isset($seen[$row['cid']])) continue;
            $seen[$row['cid']] = true;
            if (count($row['images']) < $minSamples || $row['reviews'] < $minReviews || $row['rating'] < $minRating || !itemMatchesCategory($item, $category)) continue;
            $matches[] = $row;
            if (count($matches) >= $targetCount) break 2;
        }
        if (count($items) < $hits) break;
        if ($page + 1 < $maxPages) usleep(220000);
    }
    return ['items' => $matches, 'scanned' => $scanned];
}

$config = loadConfig();
$query = stringParam('cid');
$minSamples = intParam('min_samples', 10, 0, 100);
$minReviews = intParam('min_reviews', 10, 0, 100000);
$minRating = floatParam('min_rating', 4.5, 0, 5);
$category = stringParam('category', 'all');
$genreId = stringParam('genre_id');
$categories = categoryDefinitions();
if (!isset($categories[$category])) $category = 'all';
$genres = [];
$genreError = '';
try {
    $genres = fetchGenres($config);
    if (!genreExists($genres, $genreId)) $genreId = '';
} catch (Throwable $e) {
    $genreError = $e->getMessage();
}
$filtered = ['items' => [], 'scanned' => 0];
$filterError = '';
try {
    $filtered = fetchFiltered($config, $minSamples, $minReviews, $minRating, $category, $genreId);
} catch (Throwable $e) {
    $filterError = $e->getMessage();
}
$feedItems = $filtered['items'];
$queryError = '';
if ($query !== '') {
    try {
        $queryItem = fetchItem(normalizeCid($query), $config);
        $queryRow = feedRowFromItem($queryItem);
        if ($queryRow['images'] === []) throw new RuntimeException('指定した作品には sample_l がありません。');
        $feedItems = array_values(array_filter($feedItems, static fn(array $row): bool => $row['cid'] !== $queryRow['cid']));
        array_unshift($feedItems, $queryRow);
    } catch (Throwable $e) {
        $queryError = $e->getMessage();
    }
}
$activeGenreName = selectedGenreName($genres, $genreId);
$activeConditionText = $categories[$category]['label'] . ' · ' . ($activeGenreName !== '' ? $activeGenreName : '全ジャンル');
?>
<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#090909">
<title>FANZA同人 Swipe Preview</title>
<style>
:root{color-scheme:dark;--bg:#090909;--header-h:56px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans JP",sans-serif}*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}html,body{height:100%;margin:0;background:var(--bg);color:#f5f5f5;overscroll-behavior:none}body{overflow:hidden}button,input,select{font:inherit}button,a{touch-action:manipulation}
.app-header{position:fixed;z-index:50;top:0;left:0;right:0;height:calc(var(--header-h) + env(safe-area-inset-top));padding:env(safe-area-inset-top) 12px 0;display:flex;align-items:center;justify-content:space-between;gap:10px;background:linear-gradient(180deg,rgba(8,8,8,.94),rgba(8,8,8,.62) 64%,transparent);pointer-events:none}.brand{display:flex;align-items:center;gap:9px;min-width:0;pointer-events:auto}.brand-mark{width:27px;height:27px;border-radius:8px;background:#f2f2f2;color:#0b0b0b;display:grid;place-items:center;font-weight:900;font-size:12px}.brand-copy{min-width:0}.brand-title{font-weight:800;font-size:14px}.brand-condition{margin-top:1px;color:#bdbdbd;font-size:10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:52vw}.header-actions{display:flex;align-items:center;gap:7px;pointer-events:auto}.icon-btn{height:40px;padding:0 12px;border:1px solid #ffffff24;border-radius:999px;background:#0f0f0fad;backdrop-filter:blur(12px);color:#fff;font-weight:700;font-size:12px;display:flex;align-items:center;justify-content:center;gap:6px;cursor:pointer}.icon-btn svg{width:17px;height:17px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}.feed-count{min-width:40px;text-align:center;color:#ddd;font-size:11px;font-variant-numeric:tabular-nums}
.feed{height:100dvh;overflow-y:auto;overflow-x:hidden;scroll-snap-type:y mandatory;scrollbar-width:none;overscroll-behavior-y:contain;background:#050505}.feed::-webkit-scrollbar,.preview-track::-webkit-scrollbar{display:none}.feed-item{position:relative;height:100dvh;min-height:100dvh;scroll-snap-align:start;scroll-snap-stop:always;overflow:hidden;background:#050505}.preview-track{position:absolute;inset:0;display:flex;overflow-x:auto;overflow-y:hidden;scroll-snap-type:x mandatory;scrollbar-width:none;overscroll-behavior-x:contain;z-index:1}.preview-page{position:relative;flex:0 0 100%;width:100%;height:100%;display:grid;place-items:center;scroll-snap-align:start;scroll-snap-stop:always;padding:calc(var(--header-h) + env(safe-area-inset-top) + 10px) 0 calc(154px + env(safe-area-inset-bottom));background:#080808}.preview-page::before{content:"";position:absolute;inset:0;background:radial-gradient(circle at 50% 38%,#292929 0,#101010 48%,#050505 100%)}.preview-page img{position:relative;z-index:1;display:block;max-width:100%;max-height:100%;width:auto;height:auto;object-fit:contain;user-select:none;-webkit-user-drag:none;box-shadow:0 12px 42px #00000052}.page-counter{position:absolute;z-index:12;top:calc(var(--header-h) + env(safe-area-inset-top) + 8px);left:50%;transform:translateX(-50%);height:26px;padding:0 10px;border-radius:999px;display:flex;align-items:center;background:#0000008a;backdrop-filter:blur(10px);color:#eee;font-size:11px;font-variant-numeric:tabular-nums;pointer-events:none}.swipe-hint{position:absolute;z-index:12;top:50%;left:50%;transform:translate(-50%,-50%);padding:8px 11px;border-radius:999px;background:#00000094;color:#ddd;font-size:11px;pointer-events:none;opacity:0}.feed-item:first-child .swipe-hint{animation:hint 3.3s .65s ease both}@keyframes hint{0%,100%{opacity:0}18%,62%{opacity:1}}
.item-gradient{position:absolute;z-index:8;left:0;right:0;bottom:0;height:44%;pointer-events:none;background:linear-gradient(180deg,transparent,#0000003b 18%,#000000e0 70%,#050505)}.item-info{position:absolute;z-index:15;left:14px;right:78px;bottom:calc(18px + env(safe-area-inset-bottom));pointer-events:none}.item-title{margin:0;color:#fff;font-size:16px;font-weight:760;line-height:1.42;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden}.item-stats{display:flex;align-items:center;flex-wrap:wrap;gap:6px;margin-top:8px;color:#d4d4d4;font-size:11px}.stat-chip{height:25px;padding:0 8px;border-radius:999px;background:#ffffff1a;display:flex;align-items:center;gap:4px;backdrop-filter:blur(8px)}.stat-chip strong{font-weight:800;color:#fff}.genre-line{margin-top:8px;color:#bdbdbd;font-size:11px;line-height:1.5;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.open-link{pointer-events:auto;display:inline-flex;align-items:center;justify-content:center;gap:7px;margin-top:12px;height:40px;padding:0 16px;border-radius:999px;background:#fff;color:#090909;text-decoration:none;font-size:12px;font-weight:850;box-shadow:0 7px 20px #00000047}.open-link svg{width:15px;height:15px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.action-rail{position:absolute;z-index:20;right:9px;bottom:calc(18px + env(safe-area-inset-bottom));display:flex;flex-direction:column;align-items:center;gap:11px}.action-btn{width:52px;border:0;background:none;color:#fff;padding:0;display:grid;justify-items:center;gap:4px;cursor:pointer}.action-icon{width:43px;height:43px;border-radius:50%;display:grid;place-items:center;background:#0f0f0f8c;border:1px solid #ffffff21;backdrop-filter:blur(10px)}.action-btn svg{width:21px;height:21px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}.action-btn.is-active .action-icon{background:#fff;color:#0a0a0a}.action-label{font-size:9px;color:#ddd}.next-hint{position:absolute;z-index:16;bottom:calc(4px + env(safe-area-inset-bottom));left:50%;transform:translateX(-50%);color:#777;font-size:9px;letter-spacing:.08em;pointer-events:none}
.empty-state{height:100dvh;display:grid;place-items:center;padding:30px;text-align:center;background:#0b0b0b}.empty-card{max-width:360px}.empty-card h2{margin:0 0 8px;font-size:20px}.empty-card p{margin:0;color:#aaa;font-size:13px;line-height:1.7}.empty-card button{margin-top:18px}.error-banner{position:fixed;z-index:65;top:calc(var(--header-h) + env(safe-area-inset-top) + 6px);left:12px;right:12px;padding:10px 12px;border:1px solid #6b3434;border-radius:10px;background:#281717;color:#ffdede;font-size:11px;line-height:1.5}
.sheet-backdrop{position:fixed;z-index:80;inset:0;background:#00000094;opacity:0;pointer-events:none;transition:opacity .2s}.sheet{position:fixed;z-index:90;left:0;right:0;bottom:0;max-height:min(82dvh,760px);overflow:auto;padding:8px 14px calc(18px + env(safe-area-inset-bottom));border-radius:20px 20px 0 0;background:#141414;border-top:1px solid #292929;transform:translateY(102%);transition:transform .24s cubic-bezier(.2,.75,.2,1);box-shadow:0 -18px 45px #00000059}body.sheet-open .sheet-backdrop{opacity:1;pointer-events:auto}body.sheet-open .sheet{transform:translateY(0)}.sheet-handle{width:38px;height:4px;margin:2px auto 12px;border-radius:999px;background:#444}.sheet-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:14px}.sheet-title{font-size:17px;font-weight:800}.close-btn{width:36px;height:36px;border:0;border-radius:50%;background:#252525;color:#fff;font-size:20px;cursor:pointer}.filters{display:grid;grid-template-columns:1fr 1fr;gap:12px}.field{min-width:0}.field--full{grid-column:1/-1}.field label{display:block;margin-bottom:6px;color:#aaa;font-size:11px}.field input,.field select{width:100%;height:46px;border:1px solid #343434;border-radius:11px;background:#1b1b1b;color:#fff;padding:0 12px;outline:none}.filter-summary{margin:14px 0 0;padding:11px 12px;border-radius:11px;background:#1a1a1a;color:#999;font-size:10px;line-height:1.55}.sheet-actions{position:sticky;bottom:0;display:grid;grid-template-columns:1fr 1.7fr;gap:9px;margin-top:14px;padding-top:10px;background:linear-gradient(180deg,transparent,#141414 18%)}.btn{height:46px;border:0;border-radius:11px;font-weight:800;cursor:pointer}.btn-secondary{background:#252525;color:#fff}.btn-primary{background:#fff;color:#080808}.cid-test{display:grid;grid-template-columns:1fr auto;gap:8px;margin-top:16px;padding-top:16px;border-top:1px solid #292929}.cid-test input{height:44px;border:1px solid #343434;border-radius:11px;background:#1b1b1b;color:#fff;padding:0 12px;min-width:0}.cid-test button{height:44px;padding:0 14px;border:0;border-radius:11px;background:#2b2b2b;color:#fff;font-weight:700}.genre-note{margin-top:5px;color:#a76d6d;font-size:10px}.toast{position:fixed;z-index:120;left:50%;bottom:calc(24px + env(safe-area-inset-bottom));transform:translate(-50%,20px);padding:9px 13px;border-radius:999px;background:#f5f5f5;color:#111;font-size:11px;font-weight:750;opacity:0;pointer-events:none;transition:.2s}.toast.is-show{opacity:1;transform:translate(-50%,0)}
@media(min-width:760px){body{background:#111}.feed{width:min(480px,100%);margin:0 auto;border-left:1px solid #1d1d1d;border-right:1px solid #1d1d1d}.app-header{left:50%;right:auto;width:min(480px,100%);transform:translateX(-50%)}.sheet{left:50%;right:auto;width:min(480px,100%);transform:translate(-50%,102%)}body.sheet-open .sheet{transform:translate(-50%,0)}.error-banner{left:50%;right:auto;width:min(456px,calc(100% - 24px));transform:translateX(-50%)}}@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto!important;animation:none!important;transition:none!important}}
</style>
</head>
<body>
<header class="app-header"><div class="brand"><div class="brand-mark">F</div><div class="brand-copy"><div class="brand-title">Swipe Preview</div><div class="brand-condition"><?= h($activeConditionText) ?></div></div></div><div class="header-actions"><div class="feed-count"><span id="activeWork">1</span> / <?= count($feedItems) ?></div><button class="icon-btn" id="filterOpen" type="button"><svg viewBox="0 0 24 24"><path d="M4 6h16M7 12h10M10 18h4"/></svg>絞り込み</button></div></header>
<?php if ($queryError !== ''): ?><div class="error-banner">CID取得エラー: <?= h($queryError) ?></div><?php endif; ?>
<main class="feed" id="feed" aria-label="作品フィード">
<?php if ($filterError !== '' || $feedItems === []): ?>
<section class="empty-state"><div class="empty-card"><h2><?= $filterError !== '' ? 'API取得に失敗しました' : '条件に合う作品がありません' ?></h2><p><?= h($filterError !== '' ? $filterError : '絞り込み条件を少し緩めて、もう一度試してください。') ?></p><button class="btn btn-primary" type="button" id="emptyFilterOpen">条件を変更する</button></div></section>
<?php else: ?>
<?php foreach ($feedItems as $workIndex => $row): ?>
<article class="feed-item" data-work-index="<?= $workIndex ?>" data-cid="<?= h($row['cid']) ?>" data-title="<?= h($row['title']) ?>" data-url="<?= h($row['affiliate_url']) ?>">
<div class="preview-track" data-preview-track tabindex="0">
<?php foreach ($row['images'] as $pageIndex => $url): ?>
<div class="preview-page"><img src="<?= h($url) ?>" alt="<?= h($row['title']) ?> サンプル <?= $pageIndex + 1 ?>" <?= ($workIndex < 2 && $pageIndex < 2) ? 'loading="eager"' : 'loading="lazy"' ?> decoding="async"></div>
<?php endforeach; ?>
</div>
<div class="page-counter"><span data-current-page>1</span>&nbsp;/&nbsp;<?= count($row['images']) ?></div>
<?php if (count($row['images']) > 1): ?><div class="swipe-hint">← 横にスワイプして読む →</div><?php endif; ?>
<div class="item-gradient"></div>
<div class="item-info"><h2 class="item-title"><?= h($row['title'] ?: $row['cid']) ?></h2><div class="item-stats"><span class="stat-chip">★ <strong><?= h(number_format((float) $row['rating'], 1, '.', '')) ?></strong></span><span class="stat-chip">レビュー <strong><?= (int) $row['reviews'] ?></strong></span><span class="stat-chip">サンプル <strong><?= count($row['images']) ?></strong>P</span><?php if ($row['price'] !== ''): ?><span class="stat-chip"><strong><?= h($row['price']) ?></strong></span><?php endif; ?></div><?php if ($row['genres']): ?><div class="genre-line"><?= h(implode(' / ', array_slice($row['genres'], 0, 6))) ?></div><?php endif; ?><?php if (filter_var($row['affiliate_url'], FILTER_VALIDATE_URL)): ?><a class="open-link" href="<?= h($row['affiliate_url']) ?>" target="_blank" rel="noopener noreferrer">FANZAで続きを読む <svg viewBox="0 0 24 24"><path d="M7 17 17 7M9 7h8v8"/></svg></a><?php endif; ?></div>
<div class="action-rail"><button class="action-btn" type="button" data-like><span class="action-icon"><svg viewBox="0 0 24 24"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8Z"/></svg></span><span class="action-label">いいね</span></button><button class="action-btn" type="button" data-save><span class="action-icon"><svg viewBox="0 0 24 24"><path d="M6 4h12v17l-6-4-6 4V4Z"/></svg></span><span class="action-label">保存</span></button><button class="action-btn" type="button" data-share><span class="action-icon"><svg viewBox="0 0 24 24"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 10.5 6.8-4M8.6 13.5l6.8 4"/></svg></span><span class="action-label">共有</span></button></div>
<?php if ($workIndex < count($feedItems) - 1): ?><div class="next-hint">SWIPE UP</div><?php endif; ?>
</article>
<?php endforeach; ?>
<?php endif; ?>
</main>
<div class="sheet-backdrop" id="sheetBackdrop"></div><aside class="sheet" id="filterSheet" aria-hidden="true"><div class="sheet-handle"></div><div class="sheet-head"><div class="sheet-title">作品を絞り込む</div><button class="close-btn" id="filterClose" type="button">×</button></div><form method="get" id="filterForm"><div class="filters"><div class="field"><label for="category">カテゴリ</label><select id="category" name="category"><?php foreach ($categories as $key => $definition): ?><option value="<?= h($key) ?>" <?= $category === $key ? 'selected' : '' ?>><?= h($definition['label']) ?></option><?php endforeach; ?></select></div><div class="field"><label for="genre_id">ジャンル</label><select id="genre_id" name="genre_id"><option value="">すべて</option><?php foreach ($genres as $genre): ?><option value="<?= h((string) $genre['id']) ?>" <?= $genreId === (string) $genre['id'] ? 'selected' : '' ?>><?= h((string) $genre['name']) ?></option><?php endforeach; ?></select><?php if ($genreError !== ''): ?><div class="genre-note">ジャンル一覧取得エラー: <?= h($genreError) ?></div><?php endif; ?></div><div class="field"><label for="min_samples">最低サンプル枚数</label><input id="min_samples" type="number" name="min_samples" min="0" max="100" value="<?= $minSamples ?>"></div><div class="field"><label for="min_reviews">最低レビュー件数</label><input id="min_reviews" type="number" name="min_reviews" min="0" max="100000" value="<?= $minReviews ?>"></div><div class="field field--full"><label for="min_rating">最低平均評価</label><input id="min_rating" type="number" name="min_rating" min="0" max="5" step="0.1" value="<?= h(number_format($minRating, 1, '.', '')) ?>"></div></div><div class="filter-summary">現在: <?= h($activeConditionText) ?> / sample_l <?= $minSamples ?>枚以上 / レビュー <?= $minReviews ?>件以上 / 評価 <?= h(number_format($minRating, 1, '.', '')) ?>以上<br>API走査: <?= (int) $filtered['scanned'] ?>件 / フィード: <?= count($feedItems) ?>作品</div><div class="sheet-actions"><button class="btn btn-secondary" type="button" id="resetFilters">初期値に戻す</button><button class="btn btn-primary" type="submit">この条件で見る</button></div></form><form class="cid-test" method="get"><input name="cid" placeholder="CID / FANZA商品URLで直接テスト" autocomplete="off"><input type="hidden" name="category" value="<?= h($category) ?>"><input type="hidden" name="genre_id" value="<?= h($genreId) ?>"><input type="hidden" name="min_samples" value="<?= $minSamples ?>"><input type="hidden" name="min_reviews" value="<?= $minReviews ?>"><input type="hidden" name="min_rating" value="<?= h(number_format($minRating, 1, '.', '')) ?>"><button type="submit">開く</button></form></aside><div class="toast" id="toast"></div>
<script>
(() => {
const body=document.body,feed=document.getElementById('feed'),works=[...document.querySelectorAll('.feed-item')],activeWork=document.getElementById('activeWork'),filterOpen=document.getElementById('filterOpen'),emptyFilterOpen=document.getElementById('emptyFilterOpen'),filterClose=document.getElementById('filterClose'),sheetBackdrop=document.getElementById('sheetBackdrop'),filterSheet=document.getElementById('filterSheet'),resetFilters=document.getElementById('resetFilters'),toast=document.getElementById('toast');let toastTimer=null;
const showToast=message=>{if(!toast)return;toast.textContent=message;toast.classList.add('is-show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>toast.classList.remove('is-show'),1600)};const openSheet=()=>{body.classList.add('sheet-open');filterSheet.setAttribute('aria-hidden','false')};const closeSheet=()=>{body.classList.remove('sheet-open');filterSheet.setAttribute('aria-hidden','true')};filterOpen?.addEventListener('click',openSheet);emptyFilterOpen?.addEventListener('click',openSheet);filterClose?.addEventListener('click',closeSheet);sheetBackdrop?.addEventListener('click',closeSheet);document.addEventListener('keydown',e=>{if(e.key==='Escape')closeSheet()});resetFilters?.addEventListener('click',()=>{const f=document.getElementById('filterForm');f.querySelector('[name="category"]').value='all';f.querySelector('[name="genre_id"]').value='';f.querySelector('[name="min_samples"]').value='10';f.querySelector('[name="min_reviews"]').value='10';f.querySelector('[name="min_rating"]').value='4.5'});if(!works.length)return;
const observer=new IntersectionObserver(entries=>entries.forEach(entry=>{if(!entry.isIntersecting||entry.intersectionRatio<.62)return;const index=Number(entry.target.dataset.workIndex||0);activeWork.textContent=String(index+1);entry.target.querySelector('img[loading="lazy"]')?.setAttribute('loading','eager')}),{root:feed,threshold:[.62,.82]});works.forEach(w=>observer.observe(w));
works.forEach(work=>{const track=work.querySelector('[data-preview-track]'),pages=[...track.querySelectorAll('.preview-page')],current=work.querySelector('[data-current-page]');let ticking=false;const sync=()=>{if(!track.clientWidth)return;const i=Math.max(0,Math.min(pages.length-1,Math.round(track.scrollLeft/track.clientWidth)));current.textContent=String(i+1);pages[i+1]?.querySelector('img[loading="lazy"]')?.setAttribute('loading','eager')};track.addEventListener('scroll',()=>{if(ticking)return;ticking=true;requestAnimationFrame(()=>{sync();ticking=false})},{passive:true});track.addEventListener('keydown',e=>{if(e.key!=='ArrowLeft'&&e.key!=='ArrowRight')return;e.preventDefault();const p=Math.round(track.scrollLeft/track.clientWidth),n=Math.max(0,Math.min(pages.length-1,p+(e.key==='ArrowRight'?1:-1)));track.scrollTo({left:n*track.clientWidth,behavior:'smooth'})});const cid=work.dataset.cid,like=work.querySelector('[data-like]'),save=work.querySelector('[data-save]'),share=work.querySelector('[data-share]'),key=t=>`fanza-preview:${t}:${cid}`,syncLocal=(b,t)=>b?.classList.toggle('is-active',localStorage.getItem(key(t))==='1');syncLocal(like,'like');syncLocal(save,'save');const toggle=(b,t,on,off)=>{if(!b)return;const active=localStorage.getItem(key(t))==='1';if(active){localStorage.removeItem(key(t));b.classList.remove('is-active');showToast(off)}else{localStorage.setItem(key(t),'1');b.classList.add('is-active');showToast(on)}};like?.addEventListener('click',()=>toggle(like,'like','いいねしました','いいねを解除しました'));save?.addEventListener('click',()=>toggle(save,'save','保存しました','保存を解除しました'));share?.addEventListener('click',async()=>{const title=work.dataset.title||'FANZA同人作品',url=work.dataset.url||location.href;try{if(navigator.share)await navigator.share({title,url});else{await navigator.clipboard.writeText(url);showToast('リンクをコピーしました')}}catch(error){if(error?.name!=='AbortError')showToast('共有できませんでした')}})});
let wheelLock=false;feed.addEventListener('wheel',e=>{const target=e.target.closest('[data-preview-track]');if(target&&Math.abs(e.deltaX)>Math.abs(e.deltaY))return;if(wheelLock||Math.abs(e.deltaY)<18)return;e.preventDefault();const i=Math.round(feed.scrollTop/feed.clientHeight),n=Math.max(0,Math.min(works.length-1,i+(e.deltaY>0?1:-1)));works[n].scrollIntoView({behavior:'smooth',block:'start'});wheelLock=true;setTimeout(()=>wheelLock=false,430)},{passive:false});
})();
</script>
</body>
</html>
