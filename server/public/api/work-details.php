<?php

declare(strict_types=1);

require dirname(__DIR__, 2) . '/app/bootstrap.php';

header('X-Robots-Tag: noindex, nofollow, noarchive');

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'GET') {
    header('Allow: GET');
    json_response(['error' => 'GETのみ対応しています。'], 405, ['Cache-Control' => 'no-store']);
}

try {
    $cid = $fanza->normalizeCid(trim((string)($_GET['cid'] ?? '')));
    if ($cid === '') {
        json_response(['error' => 'cidが必要です。'], 400, ['Cache-Control' => 'no-store']);
    }

    $pdo = $database->connection();
    if (!$pdo) {
        throw new RuntimeException('作品DBが利用できません。');
    }

    $stmt = $pdo->prepare('SELECT cid, sample_count, full_page_count, volume, price, affiliate_url FROM works WHERE cid = ? LIMIT 1');
    $stmt->execute([$cid]);
    $row = $stmt->fetch();
    if (!is_array($row)) {
        json_response(['error' => '作品がDBに見つかりません。'], 404, ['Cache-Control' => 'no-store']);
    }

    $fullPageCount = isset($row['full_page_count']) && $row['full_page_count'] !== null ? (int)$row['full_page_count'] : null;
    $volume = (string)($row['volume'] ?? '');
    $price = (string)($row['price'] ?? '');
    $affiliateUrl = (string)($row['affiliate_url'] ?? '');

    // 既存DBにページ数が無い作品だけ、CTA到達時にFANZA APIから1回補完する。
    if ($fullPageCount === null && $fanza->configured()) {
        try {
            $item = $fanza->feedItem($fanza->fetchItem($cid, $fanza->resolveDoujinFloor()));
            $fullPageCount = isset($item['fullPageCount']) && is_int($item['fullPageCount']) ? $item['fullPageCount'] : null;
            $volume = (string)($item['volume'] ?? '');
            if ((string)($item['price'] ?? '') !== '') {
                $price = (string)$item['price'];
            }
            if ((string)($item['affiliateUrl'] ?? '') !== '') {
                $affiliateUrl = (string)$item['affiliateUrl'];
            }
            $update = $pdo->prepare('UPDATE works SET full_page_count = ?, volume = ?, price = ?, affiliate_url = ? WHERE cid = ?');
            $update->execute([$fullPageCount, $volume, $price, $affiliateUrl, $cid]);
        } catch (Throwable $error) {
            // CTA自体はDB情報で表示し、ページ数補完失敗だけで購入導線を止めない。
            error_log('work-details FANZA補完失敗: ' . $error->getMessage());
        }
    }

    $sampleCount = (int)$row['sample_count'];
    $remainingPages = $fullPageCount !== null ? max(0, $fullPageCount - $sampleCount) : null;

    json_response([
        'ok' => true,
        'cid' => $cid,
        'fullPageCount' => $fullPageCount,
        'remainingPages' => $remainingPages,
        'volume' => $volume,
        'price' => $price,
        'affiliateUrl' => $affiliateUrl,
    ], 200, ['Cache-Control' => 'private, max-age=300']);
} catch (Throwable $error) {
    json_response(['error' => public_error_message($error, '作品情報を取得できませんでした。')], 500, ['Cache-Control' => 'no-store']);
}
