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
    $private = trim((string)($_GET['cid'] ?? '')) !== '' || (($result['source'] ?? '') === 'database');
    json_response(
        $result,
        200,
        ['Cache-Control' => $private ? 'private, no-store' : 'public, max-age=60'],
    );
} catch (Throwable $error) {
    json_response(['error' => $error->getMessage()], 500, ['Cache-Control' => 'no-store']);
}
