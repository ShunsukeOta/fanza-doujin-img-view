<?php

declare(strict_types=1);

require dirname(__DIR__) . '/app/bootstrap.php';

function work_html_escape(string $value): string
{
    return htmlspecialchars($value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

function work_public_origin(array $config): string
{
    $configured = rtrim(trim((string)($config['app']['public_origin'] ?? '')), '/');
    if ($configured !== '' && preg_match('~^https?://[A-Za-z0-9.-]+(?::\d+)?$~', $configured) === 1) {
        return $configured;
    }

    $https = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
        || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https');
    $host = preg_replace('/[^A-Za-z0-9.:-]/', '', (string)($_SERVER['HTTP_HOST'] ?? '')) ?: 'localhost';
    return ($https ? 'https://' : 'http://') . $host;
}

$rawCid = rawurldecode(mb_substr(trim((string)($_GET['cid'] ?? '')), 0, 256));
if ($rawCid === '') {
    http_response_code(404);
    header('Content-Type: text/plain; charset=utf-8');
    echo '作品が見つかりません。';
    exit;
}

try {
    $cid = $fanza->normalizeCid($rawCid);
} catch (Throwable) {
    http_response_code(404);
    header('Content-Type: text/plain; charset=utf-8');
    echo '作品が見つかりません。';
    exit;
}

$item = null;
try {
    $item = $workRepository->feedItemByCid($cid);
    if ($item === null && $fanza->configured()) {
        $item = $workRepository->fetchAndUpsert($cid);
    }
} catch (Throwable $error) {
    error_log('work share page lookup failed: ' . $error->getMessage());
}

if (!is_array($item)) {
    http_response_code(404);
    header('Content-Type: text/plain; charset=utf-8');
    echo '作品が見つかりません。';
    exit;
}

$indexPath = __DIR__ . '/index.html';
if (!is_file($indexPath)) {
    http_response_code(500);
    header('Content-Type: text/plain; charset=utf-8');
    echo 'アプリケーションを読み込めません。';
    exit;
}

$title = trim((string)($item['title'] ?? '')) ?: 'FANZA同人コミック';
$maker = trim((string)($item['maker'] ?? ''));
$rating = max(0.0, min(5.0, (float)($item['rating'] ?? 0)));
$reviews = max(0, (int)($item['reviews'] ?? 0));
$price = trim((string)($item['price'] ?? ''));
$image = '';
foreach ((array)($item['images'] ?? []) as $candidate) {
    if (is_string($candidate) && preg_match('~^https?://~i', $candidate) === 1) {
        $image = $candidate;
        break;
    }
}

$descriptionParts = [];
if ($maker !== '') $descriptionParts[] = $maker;
if ($rating > 0) $descriptionParts[] = '★' . number_format($rating, 1) . '（' . $reviews . '件）';
if ($price !== '') $descriptionParts[] = $price;
$descriptionParts[] = '無料サンプルを横スワイプで読めます。';
$description = implode(' / ', $descriptionParts);

$origin = work_public_origin($config);
$canonical = $origin . '/work/' . rawurlencode($cid);
$pageTitle = $title . ' | Swipe Preview';

$meta = "\n"
    . '<link rel="canonical" href="' . work_html_escape($canonical) . '">' . "\n"
    . '<meta property="og:type" content="website">' . "\n"
    . '<meta property="og:site_name" content="Swipe Preview">' . "\n"
    . '<meta property="og:title" content="' . work_html_escape($title) . '">' . "\n"
    . '<meta property="og:description" content="' . work_html_escape($description) . '">' . "\n"
    . '<meta property="og:url" content="' . work_html_escape($canonical) . '">' . "\n"
    . '<meta name="twitter:card" content="summary_large_image">' . "\n"
    . '<meta name="twitter:title" content="' . work_html_escape($title) . '">' . "\n"
    . '<meta name="twitter:description" content="' . work_html_escape($description) . '">' . "\n";

if ($image !== '') {
    $meta .= '<meta property="og:image" content="' . work_html_escape($image) . '">' . "\n"
        . '<meta name="twitter:image" content="' . work_html_escape($image) . '">' . "\n";
}

$html = (string)file_get_contents($indexPath);
$html = preg_replace('~<title>.*?</title>~is', '<title>' . work_html_escape($pageTitle) . '</title>', $html, 1) ?? $html;
$html = str_replace('</head>', $meta . '</head>', $html);

header('Content-Type: text/html; charset=utf-8');
header('Cache-Control: public, max-age=300, stale-while-revalidate=600');
header('X-Robots-Tag: noindex, nofollow, noarchive');
echo $html;
