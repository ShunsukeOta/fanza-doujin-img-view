<?php

declare(strict_types=1);

require dirname(__DIR__, 2) . '/app/bootstrap.php';

header('X-Robots-Tag: noindex, nofollow, noarchive');

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'GET') {
    header('Allow: GET');
    json_response(['error' => 'GETのみ対応しています。'], 405, ['Cache-Control' => 'no-store']);
}

try {
    [$anonymousUserId] = anonymous_identity();
    $floorKey = (string)($_GET['floor'] ?? '') === 'amateur' ? 'amateur' : 'comic';
    $filters = [
        ...request_filters(),
        'maker' => mb_substr(trim((string)($_GET['maker'] ?? '')), 0, 100),
        'series' => mb_substr(trim((string)($_GET['series'] ?? '')), 0, 100),
    ];
    $result = $searchService->search(
        $filters,
        read_int('cursor', 0, 0, 200000),
        read_int('limit', 24, 1, 24),
        mb_substr(trim((string)($_GET['sort'] ?? 'popular')), 0, 32),
        $anonymousUserId,
        $floorKey,
    );

    json_response($result, 200, ['Cache-Control' => 'private, no-store']);
} catch (Throwable $error) {
    json_response(
        ['error' => public_error_message($error, '検索結果を取得できませんでした。')],
        500,
        ['Cache-Control' => 'no-store'],
    );
}
