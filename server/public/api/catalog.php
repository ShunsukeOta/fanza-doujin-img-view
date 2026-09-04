<?php

declare(strict_types=1);

require dirname(__DIR__, 2) . '/app/bootstrap.php';

try {
    [$anonymousUserId] = anonymous_identity();
    $result = $catalogService->catalog(
        request_filters(),
        read_int('offset', 1, 1, 50000),
        read_int('limit', 6, 1, 12),
        trim((string)($_GET['cid'] ?? '')),
        $anonymousUserId,
    );

    $cids = array_values(array_filter(array_map(
        static fn(array $item): string => trim((string)($item['cid'] ?? '')),
        (array)($result['items'] ?? []),
    )));
    $reactions = $eventService->reactionSummaries($anonymousUserId, $cids);
    foreach ($result['items'] as &$item) {
        $cid = (string)($item['cid'] ?? '');
        $reaction = $reactions[$cid] ?? [
            'likeCount' => 0,
            'saveCount' => 0,
            'viewerLiked' => false,
            'viewerSaved' => false,
        ];
        $item['likeCount'] = (int)($reaction['likeCount'] ?? 0);
        $item['saveCount'] = (int)($reaction['saveCount'] ?? 0);
        $item['viewerLiked'] = (bool)($reaction['viewerLiked'] ?? false);
        $item['viewerSaved'] = (bool)($reaction['viewerSaved'] ?? false);
    }
    unset($item);

    // viewerLiked / viewerSaved を含むため、カタログはユーザーごとに非共有キャッシュとする。
    json_response($result, 200, ['Cache-Control' => 'private, no-store']);
} catch (Throwable $error) {
    json_response(['error' => public_error_message($error, '作品取得に失敗しました。')], 500, ['Cache-Control' => 'no-store']);
}
