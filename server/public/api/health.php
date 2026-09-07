<?php

declare(strict_types=1);

require dirname(__DIR__, 2) . '/app/bootstrap.php';

$pdo = $database->connection();
$catalogReady = $database->hasUsableCatalog();
$dmmConfigured = $fanza->configured();
$ready = $pdo !== null && $catalogReady && $dmmConfigured;

json_response([
    'ok' => $ready,
    'runtime' => 'php',
    'php' => PHP_VERSION,
    'database' => [
        'configured' => $database->isConfigured(),
        'connected' => $pdo !== null,
        'catalogReady' => $catalogReady,
        'error' => $database->lastError() === null ? null : 'database connection failed',
    ],
    'dmm' => [
        'configured' => $dmmConfigured,
    ],
    'time' => date(DATE_ATOM),
], $ready ? 200 : 503, ['Cache-Control' => 'no-store']);
