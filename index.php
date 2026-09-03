<?php

declare(strict_types=1);

function h(string $v): string { return htmlspecialchars($v, ENT_QUOTES, 'UTF-8'); }

function loadConfig(): array
{
    $config = [
        'api_id' => getenv('DMM_API_ID') ?: '',
        'affiliate_id' => getenv('DMM_AFFILIATE_ID') ?: '',
    ];
    $path = __DIR__ . '/config.php';
    if (is_file($path)) {
        $local = require $path;
        if (is_array($local)) $config = array_merge($config, $local);
    }
    return $config;
}

function normalizeCid(string $input): string
{
    $input = trim($input);
    if (preg_match('~(?:^|/)cid=([^/?#&]+)~i', $input, $m) || preg_match('~[?&]cid=([^&#]+)~i', $input, $m)) {
        $input = $m[1];
    }
    $input = rawurldecode($input);
    if ($input !== '' && !preg_match('/^[A-Za-z0-9_-]+$/', $input)) {
        throw new InvalidArgumentException('CIDまたはFANZA同人の商品URLを入力してください。');
    }
    return $input;
}

function dmmRequest(array $params, array $config): array
{
    if (!function_exists('curl_init')) throw new RuntimeException('PHPのcURL拡張が有効になっていません。');
    if (empty($config['api_id']) || empty($config['affiliate_id'])) throw new RuntimeException('config.php に api_id と affiliate_id を設定してください。');

    $params = array_merge([
        'api_id' => $config['api_id'],
        'affiliate_id' => $config['affiliate_id'],
        'site' => 'FANZA',
        'service' => 'doujin',
        'floor' => 'digital_doujin',
        'output' => 'json',
    ], $params);

    $url = 'https://api.dmm.com/affiliate/v3/ItemList?' . http_build_query($params, '', '&', PHP_QUERY_RFC3986);
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CONNECTTIMEOUT => 10,
        CURLOPT_TIMEOUT => 20,
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
    $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    curl_close($ch);
    if ($status < 200 || $status >= 300) throw new RuntimeException('DMM WebサービスがHTTP ' . $status . 'を返しました。');

    $data = json_decode($body, true);
    if (!is_array($data)) throw new RuntimeException('APIレスポンスをJSONとして解析できませんでした。');
    if (isset($data['result']['status']) && (string)$data['result']['status'] !== '200') {
        throw new RuntimeException((string)($data['result']['message'] ?? 'APIエラーが発生しました。'));
    }
    return $data;
}

function sampleImages(array $item): array
{
    $images = $item['sampleImageURL']['sample_l']['image'] ?? [];
    if (!is_array($images)) return [];
    return array_values(array_unique(array_filter($images, fn($url) => is_string($url) && filter_var($url, FILTER_VALIDATE_URL))));
}

function fetchItem(string $cid, array $config): array
{
    $data = dmmRequest(['cid' => $cid, 'hits' => 1], $config);
    $items = $data['result']['items'] ?? [];
    if (!is_array($items) || !$items) throw new RuntimeException('このCIDは現在のFANZA同人APIでは取得できません。');
    return $items[0];
}

function intParam(string $key, int $default, int $min, int $max): int
{
    $value = isset($_GET[$key]) && is_scalar($_GET[$key]) ? (int)$_GET[$key] : $default;
    return max($min, min($max, $value));
}

function floatParam(string $key, float $default, float $min, float $max): float
{
    $value = isset($_GET[$key]) && is_scalar($_GET[$key]) ? (float)$_GET[$key] : $default;
    return max($min, min($max, $value));
}

function fetchFiltered(array $config, int $minSamples, int $minReviews, float $minRating): array
{
    $matches = [];
    $scanned = 0;
    $hits = 100;
    $maxPages = 8;

    for ($page = 0; $page < $maxPages && count($matches) < 12; $page++) {
        $data = dmmRequest([
            'hits' => $hits,
            'offset' => 1 + ($page * $hits),
            'sort' => 'review',
        ], $config);
        $items = $data['result']['items'] ?? [];
        if (!is_array($items) || !$items) break;
        $scanned += count($items);

        foreach ($items as $item) {
            if (!is_array($item)) continue;
            $images = sampleImages($item);
            $reviewCount = (int)($item['review']['count'] ?? 0);
            $rating = (float)($item['review']['average'] ?? 0);
            if (count($images) < $minSamples || $reviewCount < $minReviews || $rating < $minRating) continue;

            $matches[] = [
                'cid' => (string)($item['content_id'] ?? ''),
                'title' => (string)($item['title'] ?? ''),
                'cover' => (string)($item['imageURL']['large'] ?? ''),
                'samples' => count($images),
                'reviews' => $reviewCount,
                'rating' => $rating,
            ];
            if (count($matches) >= 12) break;
        }

        if (count($items) < $hits) break;
        if ($page + 1 < $maxPages) usleep(250000);
    }

    return ['items' => $matches, 'scanned' => $scanned];
}

$config = loadConfig();
$query = isset($_GET['cid']) && is_scalar($_GET['cid']) ? (string)$_GET['cid'] : '';
$minSamples = intParam('min_samples', 10, 0, 100);
$minReviews = intParam('min_reviews', 10, 0, 100000);
$minRating = floatParam('min_rating', 4.5, 0, 5);

$item = null;
$images = [];
$error = '';
if ($query !== '') {
    try {
        $cid = normalizeCid($query);
        $item = fetchItem($cid, $config);
        $images = sampleImages($item);
    } catch (Throwable $e) { $error = $e->getMessage(); }
}

$filtered = ['items' => [], 'scanned' => 0];
$filterError = '';
try { $filtered = fetchFiltered($config, $minSamples, $minReviews, $minRating); }
catch (Throwable $e) { $filterError = $e->getMessage(); }

$title = is_array($item) ? (string)($item['title'] ?? '') : '';
$cid = is_array($item) ? (string)($item['content_id'] ?? '') : '';
$affiliateUrl = is_array($item) ? (string)($item['affiliateURL'] ?? '') : '';
?>
<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>FANZA同人 サンプル画像ビューアー</title>
<style>
:root{color-scheme:dark;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#111;color:#f5f5f5}*{box-sizing:border-box}body{margin:0;background:#111}button,input{font:inherit}.app{width:min(1120px,100%);margin:auto;padding:24px 16px 48px}.title{margin:0 0 18px;font-size:clamp(22px,4vw,34px)}.search{display:grid;grid-template-columns:1fr auto;gap:10px}.search input,.filters input{min-width:0;padding:13px 14px;border:1px solid #3b3b3b;border-radius:10px;background:#1b1b1b;color:#fff}.btn,.search button{border:0;border-radius:10px;padding:12px 18px;background:#fff;color:#111;font-weight:700;cursor:pointer}.hint,.meta{color:#aaa;font-size:13px}.error,.notice{margin:16px 0;padding:13px 15px;border:1px solid #5d2d2d;border-radius:10px;background:#221b1b}.notice{border-color:#333;background:#181818}.product{margin:24px 0 12px}.product h2{margin:0 0 7px;font-size:20px}.viewer{overflow:hidden;border:1px solid #2d2d2d;border-radius:14px;background:#050505}.track{display:flex;overflow-x:auto;scroll-snap-type:x mandatory;scrollbar-width:none;touch-action:pan-x}.track::-webkit-scrollbar{display:none}.slide{position:relative;display:grid;place-items:center;flex:0 0 100%;height:min(78vh,900px);padding:10px;scroll-snap-align:start;scroll-snap-stop:always}.slide img{display:block;max-width:100%;max-height:100%;object-fit:contain}.page{position:absolute;right:12px;bottom:12px;padding:6px 8px;border-radius:7px;background:#000b;font-size:12px}.controls{display:flex;justify-content:space-between;align-items:center;margin-top:10px}.controls button:disabled{opacity:.35}.cta{display:inline-block;margin-top:14px;text-decoration:none}.section{margin-top:36px;padding-top:28px;border-top:1px solid #2b2b2b}.section h2{margin:0 0 6px}.filters{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;align-items:end;margin:16px 0;padding:14px;border:1px solid #2d2d2d;border-radius:12px;background:#171717}.field label{display:block;margin-bottom:5px;color:#bbb;font-size:12px}.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:12px;margin-top:14px}.card{display:block;overflow:hidden;border:1px solid #333;border-radius:10px;background:#1b1b1b;color:#fff;text-decoration:none}.card img{display:block;width:100%;aspect-ratio:3/4;object-fit:cover;background:#080808}.card-body{padding:10px}.card-title{display:-webkit-box;overflow:hidden;-webkit-box-orient:vertical;-webkit-line-clamp:2;min-height:2.8em;margin:0;font-size:14px;line-height:1.4}.card-meta{display:grid;gap:3px;margin-top:8px;color:#aaa;font-size:12px}@media(max-width:760px){.filters{grid-template-columns:1fr 1fr}}@media(max-width:560px){.app{padding:16px 10px 32px}.search,.filters{grid-template-columns:1fr}.slide{height:72vh}.cards{grid-template-columns:1fr 1fr}}
</style>
</head>
<body>
<main class="app">
<h1 class="title">FANZA同人 サンプル画像ビューアー</h1>
<form class="search" method="get">
<input name="cid" value="<?= h($query) ?>" placeholder="作品ID（CID）またはFANZA同人の商品URL" autocomplete="off" required>
<input type="hidden" name="min_samples" value="<?= $minSamples ?>"><input type="hidden" name="min_reviews" value="<?= $minReviews ?>"><input type="hidden" name="min_rating" value="<?= h(number_format($minRating,1,'.','')) ?>">
<button>OK</button>
</form>
<div class="hint">商品情報APIの <code>sample_l</code> を使用。下の条件一覧からCIDを選んでもテストできます。</div>

<?php if ($error !== ''): ?><div class="error"><?= h($error) ?></div><?php endif; ?>

<?php if ($item !== null && $error === ''): ?>
<section class="product"><h2><?= h($title ?: $cid) ?></h2><div class="meta">CID: <?= h($cid) ?> / sample_l: <?= count($images) ?>枚 / レビュー: <?= (int)($item['review']['count'] ?? 0) ?>件 / 評価: <?= h((string)($item['review']['average'] ?? '-')) ?></div></section>
<?php if ($images): ?>
<div class="viewer"><div class="track" id="track" tabindex="0">
<?php foreach ($images as $i => $url): ?><div class="slide"><img src="<?= h($url) ?>" alt="<?= h($title) ?> サンプル <?= $i+1 ?>" <?= $i===0?'loading="eager"':'loading="lazy"' ?> decoding="async"><div class="page"><?= $i+1 ?> / <?= count($images) ?><span class="size"></span></div></div><?php endforeach; ?>
</div></div>
<div class="controls"><button class="btn" id="prev" type="button">← 前へ</button><span id="counter">1 / <?= count($images) ?></span><button class="btn" id="next" type="button">次へ →</button></div>
<?php else: ?><div class="notice">商品は取得できましたが、<code>sample_l</code> がありません。</div><?php endif; ?>
<?php if (filter_var($affiliateUrl,FILTER_VALIDATE_URL)): ?><a class="btn cta" href="<?= h($affiliateUrl) ?>" target="_blank" rel="noopener noreferrer">FANZAの商品ページを開く</a><?php endif; ?>
<?php endif; ?>

<section class="section">
<h2>条件付き作品一覧</h2>
<div class="hint">レビュー順で最大800件を走査し、指定条件をすべて満たす作品を最大12件表示します。</div>
<form class="filters" method="get">
<div class="field"><label>最低サンプル枚数</label><input type="number" name="min_samples" min="0" max="100" value="<?= $minSamples ?>"></div>
<div class="field"><label>最低レビュー件数</label><input type="number" name="min_reviews" min="0" max="100000" value="<?= $minReviews ?>"></div>
<div class="field"><label>最低平均評価</label><input type="number" name="min_rating" min="0" max="5" step="0.1" value="<?= h(number_format($minRating,1,'.','')) ?>"></div>
<div class="field"><button class="btn">条件で絞り込む</button></div>
</form>
<div class="meta">条件: sample_l <?= $minSamples ?>枚以上 / レビュー <?= $minReviews ?>件以上 / 評価 <?= h(number_format($minRating,1,'.','')) ?>以上 / 走査 <?= (int)$filtered['scanned'] ?>件</div>
<?php if ($filterError !== ''): ?><div class="error"><?= h($filterError) ?></div>
<?php elseif (!$filtered['items']): ?><div class="notice">条件一致作品が見つかりませんでした。条件を緩めてください。</div>
<?php else: ?><div class="cards">
<?php foreach ($filtered['items'] as $row):
$params=http_build_query(['cid'=>$row['cid'],'min_samples'=>$minSamples,'min_reviews'=>$minReviews,'min_rating'=>number_format($minRating,1,'.','')],'','&',PHP_QUERY_RFC3986); ?>
<a class="card" href="?<?= h($params) ?>">
<?php if (filter_var($row['cover'],FILTER_VALIDATE_URL)): ?><img src="<?= h($row['cover']) ?>" alt="<?= h($row['title']) ?>" loading="lazy" decoding="async"><?php endif; ?>
<div class="card-body"><p class="card-title"><?= h($row['title'] ?: $row['cid']) ?></p><div class="card-meta"><span>CID: <?= h($row['cid']) ?></span><span>sample_l: <?= $row['samples'] ?>枚</span><span>レビュー: <?= $row['reviews'] ?>件</span><span>評価: <?= h(number_format($row['rating'],1,'.','')) ?></span></div></div>
</a><?php endforeach; ?>
</div><?php endif; ?>
</section>
</main>
<?php if ($images): ?>
<script>
(()=>{const t=document.getElementById('track'),s=[...t.querySelectorAll('.slide')],p=document.getElementById('prev'),n=document.getElementById('next'),c=document.getElementById('counter');let i=0,r=false;const u=()=>{c.textContent=`${i+1} / ${s.length}`;p.disabled=i<=0;n.disabled=i>=s.length-1},g=x=>{i=Math.max(0,Math.min(s.length-1,x));s[i].scrollIntoView({behavior:'smooth',block:'nearest',inline:'start'});u()};p.onclick=()=>g(i-1);n.onclick=()=>g(i+1);t.addEventListener('scroll',()=>{if(r)return;r=true;requestAnimationFrame(()=>{i=Math.max(0,Math.min(s.length-1,Math.round(t.scrollLeft/t.clientWidth)));u();r=false})});t.addEventListener('keydown',e=>{if(e.key==='ArrowLeft'){e.preventDefault();g(i-1)}if(e.key==='ArrowRight'){e.preventDefault();g(i+1)}});t.addEventListener('wheel',e=>{if(Math.abs(e.deltaY)>Math.abs(e.deltaX)){e.preventDefault();t.scrollLeft+=e.deltaY}},{passive:false});s.forEach(x=>{const im=x.querySelector('img'),z=x.querySelector('.size'),f=()=>{if(im.naturalWidth)z.textContent=` · ${im.naturalWidth}×${im.naturalHeight}px`};if(im.complete)f();im.addEventListener('load',f,{once:true})});u()})();
</script>
<?php endif; ?>
</body>
</html>
