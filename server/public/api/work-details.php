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

    $stmt = $pdo->prepare('SELECT cid, sample_count, full_page_count, volume, price, affiliate_url, updated_at FROM works WHERE cid = ? LIMIT 1');
    $stmt->execute([$cid]);
    $row = $stmt->fetch();
    if (!is_array($row)) {
        json_response(['error' => '作品がDBに見つかりません。'], 404, ['Cache-Control' => 'no-store']);
    }

    $fullPageCount = isset($row['full_page_count']) && $row['full_page_count'] !== null ? (int)$row['full_page_count'] : null;
    $volume = (string)($row['volume'] ?? '');
    $price = (string)($row['price'] ?? '');
    $affiliateUrl = (string)($row['affiliate_url'] ?? '');
    $updatedAt = strtotime((string)($row['updated_at'] ?? '')) ?: 0;
    $needsRefresh = $fullPageCount === null || $updatedAt < time() - 600;

    // CTAに到達した作品だけFANZA APIを確認。10分以内の同一作品はDBキャッシュを使う。
    if ($needsRefresh && $fanza->configured()) {
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
            $update = $pdo->prepare('UPDATE works SET full_page_count = ?, volume = ?, price = ?, affiliate_url = ?, updated_at = NOW() WHERE cid = ?');
            $update->execute([$fullPageCount, $volume, $price, $affiliateUrl, $cid]);
        } catch (Throwable $error) {
            // FANZA側の一時失敗でもCTAを止めず、最後に取得済みの価格とURLを使う。
            error_log('work-details FANZA更新失敗: ' . $error->getMessage());
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
