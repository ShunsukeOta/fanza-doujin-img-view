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
    $result = $userLibraryService->saved($anonymousUserId, read_int('limit', 60, 1, 100));
    $cids = array_values(array_map(
        static fn(array $item): string => (string)$item['cid'],
        $result['items'],
    ));
    $reactions = $eventService->reactionSummaries($anonymousUserId, $cids);
    foreach ($result['items'] as &$item) {
        $reaction = $reactions[(string)$item['cid']] ?? null;
        $item['likeCount'] = (int)($reaction['likeCount'] ?? 0);
        $item['saveCount'] = (int)($reaction['saveCount'] ?? 0);
        $item['viewerLiked'] = (bool)($reaction['viewerLiked'] ?? false);
        $item['viewerSaved'] = (bool)($reaction['viewerSaved'] ?? true);
    }
    unset($item);

    json_response([
        'ok' => true,
        'items' => $result['items'],
        'total' => (int)$result['total'],
        'generatedAt' => date(DATE_ATOM),
    ], 200, ['Cache-Control' => 'private, no-store']);
} catch (Throwable $error) {
    json_response(['error' => public_error_message($error, '保存済み作品を取得できませんでした。')], 500, ['Cache-Control' => 'no-store']);
}
