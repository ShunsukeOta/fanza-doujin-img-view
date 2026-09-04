<?php

declare(strict_types=1);

require dirname(__DIR__, 2) . '/app/bootstrap.php';

try {
    [$anonymousUserId] = anonymous_identity();
    $result = $catalogService->recommendation(
        request_filters(),
        read_int('offset', 1, 1, 50000),
        read_int('limit', 6, 1, 12),
        $anonymousUserId,
    );
    $floor = $fanza->fallbackFloor();
    if ($fanza->configured()) {
        try {
            $floor = $fanza->resolveDoujinFloor();
        } catch (Throwable) {
            $floor = $fanza->fallbackFloor();
        }
    }
    $result['floor'] = $floor;
    $result['queryError'] = '';
    json_response($result, 200, ['Cache-Control' => 'private, no-store']);
} catch (Throwable $error) {
    json_response(['error' => $error->getMessage()], 500, ['Cache-Control' => 'no-store']);
}
