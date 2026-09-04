<?php

declare(strict_types=1);

require dirname(__DIR__, 2) . '/app/bootstrap.php';

$fetchSite = (string)($_SERVER['HTTP_SEC_FETCH_SITE'] ?? '');
if ($fetchSite !== '' && !in_array($fetchSite, ['same-origin', 'same-site', 'none'], true)) {
    json_response(['error' => 'Cross-site request is not allowed.'], 403, ['Cache-Control' => 'no-store']);
}

$origin = trim((string)($_SERVER['HTTP_ORIGIN'] ?? ''));
if ($origin !== '') {
    $originHost = parse_url($origin, PHP_URL_HOST);
    $requestHost = strtolower((string)preg_replace('/:\d+$/', '', (string)($_SERVER['HTTP_HOST'] ?? '')));
    if (!is_string($originHost) || $requestHost === '' || !hash_equals($requestHost, strtolower($originHost))) {
        json_response(['error' => 'Origin is not allowed.'], 403, ['Cache-Control' => 'no-store']);
    }
}

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
    header('Allow: POST');
    json_response(['error' => 'POSTのみ対応しています。'], 405, ['Cache-Control' => 'no-store']);
}

$contentType = strtolower(trim(explode(';', (string)($_SERVER['CONTENT_TYPE'] ?? ''))[0]));
if ($contentType !== 'application/json') {
    json_response(['error' => 'Content-Type は application/json を指定してください。'], 415, ['Cache-Control' => 'no-store']);
}

if ($database->connection() === null) {
    json_response(['error' => '行動ログDBがまだ利用できません。'], 503, ['Cache-Control' => 'no-store']);
}

try {
    [$anonymousUserId, $sessionId] = anonymous_identity();
    $raw = file_get_contents('php://input');
    $payload = json_decode(is_string($raw) ? $raw : '', true);
    if (!is_array($payload)) {
        throw new RuntimeException('JSONリクエストが不正です。');
    }
    $reaction = $eventService->record($anonymousUserId, $sessionId, $payload);
    json_response(['ok' => true, 'reaction' => $reaction], 201, ['Cache-Control' => 'no-store']);
} catch (Throwable $error) {
    $status = 500;
    if ($error instanceof RuntimeException && !($error instanceof PDOException)) {
        $status = str_contains($error->getMessage(), '多すぎます') ? 429 : 422;
    }
    json_response(['error' => public_error_message($error, '行動ログの保存に失敗しました。')], $status, ['Cache-Control' => 'no-store']);
}
