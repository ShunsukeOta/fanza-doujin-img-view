<?php

declare(strict_types=1);

require dirname(__DIR__, 2) . '/app/bootstrap.php';

$pdo = $database->connection();
$catalogReady = $database->hasUsableCatalog();
json_response([
    'ok' => $catalogReady || $fanza->configured(),
    'runtime' => 'php',
    'php' => PHP_VERSION,
    'database' => [
        'configured' => $database->isConfigured(),
        'connected' => $pdo !== null,
        'catalogReady' => $catalogReady,
        'error' => $database->lastError() === null ? null : 'database connection failed',
    ],
    'dmm' => [
        'apiId' => $fanza->configured(),
        'affiliateId' => $fanza->configured(),
    ],
    'time' => date(DATE_ATOM),
], 200, ['Cache-Control' => 'no-store']);
