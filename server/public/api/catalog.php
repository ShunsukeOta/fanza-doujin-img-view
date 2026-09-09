<?php

declare(strict_types=1);

require dirname(__DIR__, 2) . '/app/bootstrap.php';

try {
    [$anonymousUserId] = anonymous_identity();
    $feedId = mb_substr(trim((string)($_GET['feed_id'] ?? '')), 0, 36);
    $result = $catalogService->catalog(
        request_filters(),
        $feedId,
        read_int('cursor', 0, 0, 200000),
        read_int('limit', 6, 1, 12),
        mb_substr(trim((string)($_GET['cid'] ?? '')), 0, 256),
        $anonymousUserId,
    );

    $cids = array_values(array_filter(array_map(
        static fn(array $item): string => trim((string)($item['cid'] ?? '')),
        (array)($result['items'] ?? []),
    )));
    $saveStates = $eventService->saveStates($anonymousUserId, $cids);

    foreach ($result['items'] as &$item) {
        $cid = (string)($item['cid'] ?? '');
        $item['viewerSaved'] = (bool)($saveStates[$cid]['viewerSaved'] ?? false);
    }
    unset($item);

    json_response($result, 200, ['Cache-Control' => 'private, no-store']);
} catch (Throwable $error) {
    json_response(
        ['error' => public_error_message($error, '作品取得に失敗しました。')],
        500,
        ['Cache-Control' => 'no-store'],
    );
}
