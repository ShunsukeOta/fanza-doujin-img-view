<?php

declare(strict_types=1);

require dirname(__DIR__, 2) . '/app/bootstrap.php';

header('X-Robots-Tag: noindex, nofollow, noarchive');

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'GET') {
    header('Allow: GET');
    json_response(['error' => 'GETのみ対応しています。'], 405, ['Cache-Control' => 'no-store']);
}

try {
    $rawCid = mb_substr(trim((string)($_GET['cid'] ?? '')), 0, 256);
    if ($rawCid === '') {
        json_response(['error' => 'cidが必要です。'], 400, ['Cache-Control' => 'no-store']);
    }

    try {
        $cid = $fanza->normalizeCid($rawCid);
    } catch (RuntimeException $error) {
        json_response(['error' => $error->getMessage()], 422, ['Cache-Control' => 'no-store']);
    }

    $pdo = $database->connection();
    if (!$pdo) {
        throw new RuntimeException('作品DBが利用できません。');
    }

    $stmt = $pdo->prepare(
        'SELECT cid, sample_count, full_page_count, volume, price, price_value, affiliate_url, '
        . 'details_checked_at, details_status, is_active, availability_status '
        . 'FROM works WHERE cid = ? LIMIT 1'
    );
    $stmt->execute([$cid]);
    $row = $stmt->fetch();
    if (!is_array($row)) {
        json_response(['error' => '作品がDBに見つかりません。'], 404, ['Cache-Control' => 'no-store']);
    }

    $checkedAt = strtotime((string)($row['details_checked_at'] ?? '')) ?: 0;
    $detailsStatus = (string)($row['details_status'] ?? 'unknown');
    $ttl = $detailsStatus === 'error' ? 900 : 21600;
    $needsRefresh = $checkedAt < time() - $ttl;

    if ($needsRefresh && $fanza->configured()) {
        $lockName = 'work-details:' . substr(hash('sha256', $cid), 0, 40);
        $lock = $pdo->prepare('SELECT GET_LOCK(?, 0)');
        $lock->execute([$lockName]);
        $acquired = (int)$lock->fetchColumn() === 1;

        if ($acquired) {
            try {
                try {
                    $workRepository->refreshCid($cid);
                    $pdo->prepare(
                        "UPDATE works SET details_checked_at = NOW(), "
                        . "details_status = IF(full_page_count IS NULL, 'unknown', 'known') WHERE cid = ?"
                    )->execute([$cid]);
                } catch (Throwable $error) {
                    $pdo->prepare(
                        "UPDATE works SET details_checked_at = NOW(), details_status = 'error' WHERE cid = ?"
                    )->execute([$cid]);
                    error_log('work-details refresh failed: ' . $error->getMessage());
                }
            } finally {
                $release = $pdo->prepare('SELECT RELEASE_LOCK(?)');
                $release->execute([$lockName]);
            }
        }

        $stmt->execute([$cid]);
        $fresh = $stmt->fetch();
        if (is_array($fresh)) {
            $row = $fresh;
        }
    }

    $sampleCount = (int)$row['sample_count'];
    $fullPageCount = $row['full_page_count'] === null ? null : (int)$row['full_page_count'];
    $remainingPages = $fullPageCount === null ? null : max(0, $fullPageCount - $sampleCount);

    json_response([
        'ok' => true,
        'cid' => $cid,
        'fullPageCount' => $fullPageCount,
        'remainingPages' => $remainingPages,
        'volume' => (string)($row['volume'] ?? ''),
        'price' => (string)($row['price'] ?? ''),
        'priceValue' => $row['price_value'] === null ? null : (int)$row['price_value'],
        'affiliateUrl' => (string)($row['affiliate_url'] ?? ''),
        'available' => (bool)$row['is_active'],
        'availabilityStatus' => (string)($row['availability_status'] ?? 'unknown'),
        'checkedAt' => $row['details_checked_at'] ?? null,
        'detailsStatus' => $row['details_status'] ?? 'unknown',
    ], 200, ['Cache-Control' => 'private, max-age=300']);
} catch (Throwable $error) {
    json_response(
        ['error' => public_error_message($error, '作品情報を取得できませんでした。')],
        500,
        ['Cache-Control' => 'no-store'],
    );
}
