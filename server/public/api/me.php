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
    json_response([
        'ok' => true,
        'profile' => $userLibraryService->profile($anonymousUserId),
        'generatedAt' => date(DATE_ATOM),
    ], 200, ['Cache-Control' => 'private, no-store']);
} catch (Throwable $error) {
    json_response(['error' => public_error_message($error, 'マイページ情報を取得できませんでした。')], 500, ['Cache-Control' => 'no-store']);
}
