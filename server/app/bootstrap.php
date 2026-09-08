<?php

declare(strict_types=1);

use SwipePreview\CatalogService;
use SwipePreview\Database;
use SwipePreview\EventService;
use SwipePreview\FanzaClient;
use SwipePreview\SearchService;
use SwipePreview\UserLibraryService;
use SwipePreview\WorkRepository;

require_once __DIR__ . '/src/Database.php';
require_once __DIR__ . '/src/PriceParser.php';
require_once __DIR__ . '/src/FanzaClient.php';
require_once __DIR__ . '/src/WorkRepository.php';
require_once __DIR__ . '/src/CatalogService.php';
require_once __DIR__ . '/src/EventService.php';
require_once __DIR__ . '/src/SearchService.php';
require_once __DIR__ . '/src/UserLibraryService.php';

$configPath = __DIR__ . '/config.local.php';
$config = is_file($configPath)
    ? require $configPath
    : require __DIR__ . '/config.example.php';
if (!is_array($config)) {
    throw new RuntimeException('サーバー設定ファイルが不正です。');
}

date_default_timezone_set((string)($config['app']['timezone'] ?? 'Asia/Tokyo'));

$database = new Database((array)($config['db'] ?? []));
$fanza = new FanzaClient((array)($config['dmm'] ?? []));
$workRepository = new WorkRepository($database, $fanza);
$catalogService = new CatalogService($database, $fanza, $workRepository);
$eventService = new EventService($database);
$searchService = new SearchService($database, $workRepository, $eventService);
$userLibraryService = new UserLibraryService($database, $workRepository);

function json_response(array $payload, int $status = 200, array $headers = []): never
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('X-Content-Type-Options: nosniff');
    foreach ($headers as $name => $value) {
        header($name . ': ' . $value);
    }
    echo json_encode(
        $payload,
        JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE,
    );
    exit;
}

function public_error_message(Throwable $error, string $fallback): string
{
    if ($error instanceof PDOException) {
        error_log('PDOException: ' . $error->getMessage());
        return $fallback;
    }
    if ($error instanceof RuntimeException) {
        $message = trim($error->getMessage());
        return $message !== '' ? $message : $fallback;
    }
    error_log(get_class($error) . ': ' . $error->getMessage());
    return $fallback;
}

function read_int(string $key, int $fallback, int $min, int $max): int
{
    $raw = $_GET[$key] ?? null;
    if ($raw === null || $raw === '' || filter_var($raw, FILTER_VALIDATE_INT) === false) {
        return $fallback;
    }
    return max($min, min($max, (int)$raw));
}

function read_float(string $key, float $fallback, float $min, float $max): float
{
    $raw = $_GET[$key] ?? null;
    if ($raw === null || $raw === '' || !is_numeric($raw)) {
        return $fallback;
    }
    return max($min, min($max, (float)$raw));
}

function request_filters(): array
{
    return [
        'minSamples' => read_int('min_samples', 1, 1, 100),
        'minReviews' => read_int('min_reviews', 0, 0, 100000),
        'minRating' => read_float('min_rating', 0.0, 0.0, 5.0),
        'minPrice' => read_int('min_price', 0, 0, 10000000),
        'maxPrice' => read_int('max_price', 0, 0, 10000000),
        'genreId' => mb_substr(trim((string)($_GET['genre_id'] ?? '')), 0, 64),
        'query' => mb_substr(trim((string)($_GET['q'] ?? '')), 0, 100),
    ];
}

function uuid_v4(): string
{
    $data = random_bytes(16);
    $data[6] = chr((ord($data[6]) & 0x0f) | 0x40);
    $data[8] = chr((ord($data[8]) & 0x3f) | 0x80);
    return vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex($data), 4));
}

function anonymous_identity(): array
{
    global $config;

    $secure = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
        || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https');
    $profileRetentionDays = max(
        30,
        min(730, (int)($config['app']['profile_retention_days'] ?? 180)),
    );
    $cookieOptions = [
        'expires' => time() + 86400 * $profileRetentionDays,
        'path' => '/',
        'secure' => $secure,
        'httponly' => true,
        'samesite' => 'Lax',
    ];

    $userId = (string)($_COOKIE['fp_uid'] ?? '');
    if (preg_match('/^[a-f0-9-]{36}$/i', $userId) !== 1) {
        $userId = uuid_v4();
    }
    setcookie('fp_uid', $userId, $cookieOptions);

    $sessionId = (string)($_COOKIE['fp_sid'] ?? '');
    if (preg_match('/^[a-f0-9-]{36}$/i', $sessionId) !== 1) {
        $sessionId = uuid_v4();
    }
    setcookie('fp_sid', $sessionId, [
        ...$cookieOptions,
        'expires' => time() + 60 * 60 * 8,
    ]);

    return [$userId, $sessionId];
}

function clear_anonymous_identity(): void
{
    $secure = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
        || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https');
    $options = [
        'expires' => time() - 3600,
        'path' => '/',
        'secure' => $secure,
        'httponly' => true,
        'samesite' => 'Lax',
    ];
    setcookie('fp_uid', '', $options);
    setcookie('fp_sid', '', $options);
}

function admin_request_authorized(): bool
{
    global $config;

    $expected = trim((string)($config['app']['admin_token'] ?? ''));
    if ($expected === '') {
        return false;
    }
    $provided = trim((string)($_SERVER['HTTP_X_ADMIN_TOKEN'] ?? ''));
    return $provided !== '' && hash_equals($expected, $provided);
}

function enforce_json_body_limit(int $maxBytes = 65536): void
{
    $length = (int)($_SERVER['CONTENT_LENGTH'] ?? 0);
    if ($length > $maxBytes) {
        json_response(
            ['error' => 'リクエストが大きすぎます。'],
            413,
            ['Cache-Control' => 'no-store'],
        );
    }
}
