<?php

declare(strict_types=1);

require dirname(__DIR__, 2) . '/app/bootstrap.php';

$fetchSite = (string)($_SERVER['HTTP_SEC_FETCH_SITE'] ?? '');
if ($fetchSite !== '' && !in_array($fetchSite, ['same-origin', 'same-site', 'none'], true)) {
    json_response(['error' => 'Cross-site request is not allowed.'], 403, ['Cache-Control' => 'no-store']);
}

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
    header('Allow: POST');
    json_response(['error' => 'POSTのみ対応しています。'], 405, ['Cache-Control' => 'no-store']);
}

try {
    [$anonymousUserId, $sessionId] = anonymous_identity();
    $raw = file_get_contents('php://input');
    $payload = json_decode(is_string($raw) ? $raw : '', true);
    if (!is_array($payload)) {
        throw new RuntimeException('JSONリクエストが不正です。');
    }
    $eventService->record($anonymousUserId, $sessionId, $payload);
    json_response(['ok' => true], 201, ['Cache-Control' => 'no-store']);
} catch (Throwable $error) {
    json_response(['error' => $error->getMessage()], 503, ['Cache-Control' => 'no-store']);
}
