<?php

declare(strict_types=1);

require dirname(__DIR__, 2) . '/app/bootstrap.php';

header('X-Robots-Tag: noindex, nofollow, noarchive');

$fetchSite = (string)($_SERVER['HTTP_SEC_FETCH_SITE'] ?? '');
if ($fetchSite !== '' && !in_array($fetchSite, ['same-origin', 'same-site', 'none'], true)) {
    json_response(['error' => 'このリクエストは受け付けられません。'], 403, ['Cache-Control' => 'no-store']);
}

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'GET') {
    header('Allow: GET');
    json_response(['error' => 'GETのみ対応しています。'], 405, ['Cache-Control' => 'no-store']);
}

if ($database->connection() === null) {
    json_response(['error' => '現在この操作を利用できません。'], 503, ['Cache-Control' => 'no-store']);
}

$raw = trim((string)($_GET['cids'] ?? ''));
$cids = $raw === '' ? [] : array_values(array_unique(array_map('trim', explode(',', $raw))));
if ($cids === [] || count($cids) > 50) {
    json_response(['error' => '作品の指定が不正です。'], 422, ['Cache-Control' => 'no-store']);
}
foreach ($cids as $cid) {
    if ($cid === '' || preg_match('/^[A-Za-z0-9_-]+$/', $cid) !== 1) {
        json_response(['error' => '作品の指定が不正です。'], 422, ['Cache-Control' => 'no-store']);
    }
}

try {
    [$anonymousUserId] = anonymous_identity();
    json_response([
        'ok' => true,
        'saveStates' => $eventService->saveStates($anonymousUserId, $cids),
        'generatedAt' => date(DATE_ATOM),
    ], 200, ['Cache-Control' => 'private, no-store']);
} catch (Throwable $error) {
    json_response(['error' => public_error_message($error, '保存状態を取得できませんでした。')], 500, ['Cache-Control' => 'no-store']);
}
