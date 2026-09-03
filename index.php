<?php

declare(strict_types=1);

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

function normalizeContentId(string $input): string
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

function dmmRequest(array $params, array $config): array
{
    if (!function_exists('curl_init')) {
        throw new RuntimeException('PHPのcURL拡張が有効になっていません。');
    }

    if (empty($config['api_id']) || empty($config['affiliate_id'])) {
        throw new RuntimeException('API設定がありません。config.example.phpをconfig.phpにコピーして、api_idとaffiliate_idを設定してください。');
    }

    $params = array_merge([
        'api_id' => $config['api_id'],
        'affiliate_id' => $config['affiliate_id'],
        'site' => 'FANZA',
        'service' => 'doujin',
        'floor' => 'digital_doujin',
        'output' => 'json',
    ], $params);

    $endpoint = 'https://api.dmm.com/affiliate/v3/ItemList?' . http_build_query($params, '', '&', PHP_QUERY_RFC3986);

    $ch = curl_init($endpoint);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CONNECTTIMEOUT => 10,
        CURLOPT_TIMEOUT => 20,
        CURLOPT_FOLLOWLOCATION => false,
        CURLOPT_USERAGENT => 'fanza-doujin-img-view/1.1',
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

function fetchDoujinItem(string $contentId, array $config): array
{
    $data = dmmRequest([
        'cid' => $contentId,
        'hits' => 1,
    ], $config);

    $items = $data['result']['items'] ?? [];
    if (!is_array($items) || $items === []) {
        throw new RuntimeException('このCIDは現在のFANZA同人APIでは取得できません。販売終了作品・別フロア作品・誤ったCIDの可能性があります。下の「APIから取得できる作品」からテストしてください。');
    }

    return $items[0];
}

function fetchRecentDoujinItems(array $config): array
{
    $data = dmmRequest([
        'hits' => 100,
        'sort' => 'date',
    ], $config);

    $items = $data['result']['items'] ?? [];
    if (!is_array($items)) {
        return [];
    }

    $usable = [];
    foreach ($items as $item) {
        if (!is_array($item)) {
            continue;
        }

        $contentId = isset($item['content_id']) ? (string) $item['content_id'] : '';
        $images = $item['sampleImageURL']['sample_l']['image'] ?? [];

        if ($contentId === '' || !is_array($images) || $images === []) {
            continue;
        }

        $usable[] = $item;
        if (count($usable) >= 12) {
            break;
        }
    }

    return $usable;
}

function getSampleImages(?array $item): array
{
    if ($item === null) {
        return [];
    }

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

$config = loadConfig();
$query = isset($_GET['cid']) ? (string) $_GET['cid'] : '';
$contentId = '';
$item = null;
$sampleImages = [];
$recentItems = [];
$error = '';
$recentError = '';

if ($query !== '') {
    try {
        $contentId = normalizeContentId($query);
        $item = fetchDoujinItem($contentId, $config);
        $sampleImages = getSampleImages($item);
    } catch (Throwable $e) {
        $error = $e->getMessage();
    }
}

try {
    $recentItems = fetchRecentDoujinItems($config);
} catch (Throwable $e) {
    $recentError = $e->getMessage();
}

$title = is_array($item) && isset($item['title']) ? (string) $item['title'] : '';
$affiliateUrl = is_array($item) && isset($item['affiliateURL']) ? (string) $item['affiliateURL'] : '';
$coverUrl = is_array($item) && isset($item['imageURL']['large']) ? (string) $item['imageURL']['large'] : '';
?>
<!doctype html>
<html lang="ja">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>FANZA同人 サンプル画像ビューアー</title>
    <style>
        :root { color-scheme: dark; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #111; color: #f5f5f5; }
        * { box-sizing: border-box; }
        body { margin: 0; background: #111; }
        button, input { font: inherit; }
        .app { width: min(1100px, 100%); margin: 0 auto; padding: 24px 16px 48px; }
        .title { margin: 0 0 18px; font-size: clamp(22px, 4vw, 34px); }
        .search { display: grid; grid-template-columns: 1fr auto; gap: 10px; margin-bottom: 10px; }
        .search input { min-width: 0; padding: 14px 16px; border: 1px solid #3d3d3d; border-radius: 10px; background: #1b1b1b; color: #fff; outline: none; }
        .search input:focus { border-color: #888; }
        .search button, .controls button, .cta, .sample-card { border: 0; border-radius: 10px; padding: 12px 18px; background: #fff; color: #111; font-weight: 700; cursor: pointer; }
        .hint, .meta { color: #aaa; font-size: 13px; }
        .error, .notice { margin: 18px 0; padding: 14px 16px; border-radius: 10px; background: #221b1b; border: 1px solid #5d2d2d; }
        .notice { background: #191919; border-color: #343434; }
        .product { margin: 24px 0 14px; }
        .product h2 { margin: 0 0 8px; font-size: clamp(17px, 3vw, 24px); line-height: 1.45; }
        .viewer { position: relative; overflow: hidden; border: 1px solid #2d2d2d; border-radius: 14px; background: #050505; }
        .viewer__track { display: flex; width: 100%; overflow-x: auto; overflow-y: hidden; scroll-snap-type: x mandatory; overscroll-behavior-x: contain; scrollbar-width: none; touch-action: pan-x; }
        .viewer__track::-webkit-scrollbar { display: none; }
        .viewer__slide { position: relative; display: grid; place-items: center; flex: 0 0 100%; min-width: 100%; height: min(78vh, 900px); padding: 12px; scroll-snap-align: start; scroll-snap-stop: always; }
        .viewer__slide img { display: block; max-width: 100%; max-height: 100%; width: auto; height: auto; object-fit: contain; user-select: none; -webkit-user-drag: none; }
        .viewer__pageinfo { position: absolute; right: 12px; bottom: 12px; padding: 6px 9px; border-radius: 8px; background: rgba(0, 0, 0, .72); font-size: 12px; color: #ddd; }
        .controls { display: flex; justify-content: space-between; align-items: center; gap: 10px; margin-top: 12px; }
        .controls button:disabled { opacity: .35; cursor: default; }
        .counter { min-width: 80px; text-align: center; font-variant-numeric: tabular-nums; }
        .actions { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 16px; }
        .cta { display: inline-block; text-decoration: none; }
        .samples { margin-top: 36px; padding-top: 28px; border-top: 1px solid #2b2b2b; }
        .samples h2 { margin: 0 0 6px; font-size: 20px; }
        .sample-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(210px, 1fr)); gap: 12px; margin-top: 16px; }
        .sample-card { display: block; padding: 0; overflow: hidden; text-decoration: none; background: #1b1b1b; color: #fff; border: 1px solid #333; font-weight: 400; }
        .sample-card img { display: block; width: 100%; aspect-ratio: 3 / 4; object-fit: cover; background: #080808; }
        .sample-card__body { padding: 10px; }
        .sample-card__title { display: -webkit-box; overflow: hidden; -webkit-box-orient: vertical; -webkit-line-clamp: 2; min-height: 2.8em; font-size: 14px; line-height: 1.4; }
        .sample-card__meta { margin-top: 7px; color: #aaa; font-size: 12px; }
        @media (max-width: 640px) {
            .app { padding: 16px 10px 32px; }
            .search { grid-template-columns: 1fr; }
            .viewer__slide { height: 72vh; padding: 6px; }
            .sample-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        }
    </style>
</head>
<body>
<main class="app">
    <h1 class="title">FANZA同人 サンプル画像ビューアー</h1>

    <form class="search" method="get" action="">
        <input type="text" name="cid" value="<?= h($query) ?>" placeholder="作品ID（CID）またはFANZA同人の商品URL" autocomplete="off" required>
        <button type="submit">OK</button>
    </form>
    <div class="hint">CIDが分からない場合は、ページ下部の「APIから取得できる作品」をクリックすればそのままテストできます。</div>

    <?php if ($error !== ''): ?>
        <div class="error"><?= h($error) ?></div>
    <?php endif; ?>

    <?php if ($item !== null && $error === ''): ?>
        <section class="product">
            <h2><?= h($title !== '' ? $title : $contentId) ?></h2>
            <div class="meta">CID: <?= h($contentId) ?> / sample_l: <?= count($sampleImages) ?>枚</div>
        </section>

        <?php if ($sampleImages !== []): ?>
            <section class="viewer" aria-label="サンプル画像ビューアー">
                <div class="viewer__track" id="viewerTrack" tabindex="0">
                    <?php foreach ($sampleImages as $index => $imageUrl): ?>
                        <article class="viewer__slide">
                            <img src="<?= h($imageUrl) ?>" alt="<?= h($title) ?> サンプル <?= $index + 1 ?>" <?= $index === 0 ? 'loading="eager"' : 'loading="lazy"' ?> decoding="async">
                            <div class="viewer__pageinfo"><?= $index + 1 ?> / <?= count($sampleImages) ?><span class="image-size"></span></div>
                        </article>
                    <?php endforeach; ?>
                </div>
            </section>

            <div class="controls">
                <button type="button" id="prevButton">← 前へ</button>
                <div class="counter" id="counter">1 / <?= count($sampleImages) ?></div>
                <button type="button" id="nextButton">次へ →</button>
            </div>
        <?php else: ?>
            <div class="notice">商品は取得できましたが、APIの <code>sampleImageURL.sample_l.image</code> に画像がありません。</div>
        <?php endif; ?>

        <?php if ($affiliateUrl !== '' && filter_var($affiliateUrl, FILTER_VALIDATE_URL)): ?>
            <div class="actions"><a class="cta" href="<?= h($affiliateUrl) ?>" target="_blank" rel="noopener noreferrer">FANZAの商品ページを開く</a></div>
        <?php endif; ?>
    <?php endif; ?>

    <section class="samples">
        <h2>APIから取得できる作品</h2>
        <div class="hint">最新100件から sample_l が1枚以上ある作品を最大12件表示しています。ここに出るCIDならAPI取得自体は通ります。</div>

        <?php if ($recentError !== ''): ?>
            <div class="error"><?= h($recentError) ?></div>
        <?php elseif ($recentItems === []): ?>
            <div class="notice">APIには接続できましたが、最新100件からサンプル付き作品を取得できませんでした。</div>
        <?php else: ?>
            <div class="sample-grid">
                <?php foreach ($recentItems as $recentItem):
                    $recentCid = (string) ($recentItem['content_id'] ?? '');
                    $recentTitle = (string) ($recentItem['title'] ?? $recentCid);
                    $recentSamples = getSampleImages($recentItem);
                    $recentCover = (string) ($recentItem['imageURL']['large'] ?? ($recentSamples[0] ?? ''));
                ?>
                    <a class="sample-card" href="?cid=<?= rawurlencode($recentCid) ?>">
                        <?php if ($recentCover !== '' && filter_var($recentCover, FILTER_VALIDATE_URL)): ?>
                            <img src="<?= h($recentCover) ?>" alt="" loading="lazy" decoding="async">
                        <?php endif; ?>
                        <div class="sample-card__body">
                            <div class="sample-card__title"><?= h($recentTitle) ?></div>
                            <div class="sample-card__meta">CID: <?= h($recentCid) ?> / sample_l: <?= count($recentSamples) ?>枚</div>
                        </div>
                    </a>
                <?php endforeach; ?>
            </div>
        <?php endif; ?>
    </section>
</main>

<?php if ($sampleImages !== []): ?>
<script>
(() => {
    const track = document.getElementById('viewerTrack');
    const slides = Array.from(track.querySelectorAll('.viewer__slide'));
    const prevButton = document.getElementById('prevButton');
    const nextButton = document.getElementById('nextButton');
    const counter = document.getElementById('counter');
    let currentIndex = 0;
    let ticking = false;

    const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
    const updateControls = () => {
        counter.textContent = `${currentIndex + 1} / ${slides.length}`;
        prevButton.disabled = currentIndex <= 0;
        nextButton.disabled = currentIndex >= slides.length - 1;
    };
    const goTo = (index) => {
        currentIndex = clamp(index, 0, slides.length - 1);
        slides[currentIndex].scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'start' });
        updateControls();
    };
    const syncIndexFromScroll = () => {
        if (track.clientWidth <= 0) return;
        currentIndex = clamp(Math.round(track.scrollLeft / track.clientWidth), 0, slides.length - 1);
        updateControls();
    };

    prevButton.addEventListener('click', () => goTo(currentIndex - 1));
    nextButton.addEventListener('click', () => goTo(currentIndex + 1));
    track.addEventListener('scroll', () => {
        if (ticking) return;
        ticking = true;
        requestAnimationFrame(() => { syncIndexFromScroll(); ticking = false; });
    });
    track.addEventListener('keydown', (event) => {
        if (event.key === 'ArrowLeft') { event.preventDefault(); goTo(currentIndex - 1); }
        if (event.key === 'ArrowRight') { event.preventDefault(); goTo(currentIndex + 1); }
    });
    track.addEventListener('wheel', (event) => {
        if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
        event.preventDefault();
        track.scrollLeft += event.deltaY;
    }, { passive: false });

    slides.forEach((slide) => {
        const image = slide.querySelector('img');
        const size = slide.querySelector('.image-size');
        const showSize = () => {
            if (image.naturalWidth && image.naturalHeight) size.textContent = ` · ${image.naturalWidth}×${image.naturalHeight}px`;
        };
        if (image.complete) showSize();
        image.addEventListener('load', showSize, { once: true });
    });

    window.addEventListener('resize', syncIndexFromScroll);
    updateControls();
})();
</script>
<?php endif; ?>
</body>
</html>
