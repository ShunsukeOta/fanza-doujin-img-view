<?php

declare(strict_types=1);

require dirname(__DIR__, 2) . '/app/bootstrap.php';

$connected = $database->connection() !== null;
$catalogReady = $database->hasUsableCatalog();
$configured = $fanza->configured();
$ready = $connected && $catalogReady && $configured;

json_response([
    'ok' => $ready,
    'checks' => [
        'connected' => $connected,
        'catalogReady' => $catalogReady,
        'configured' => $configured,
    ],
    'time' => date(DATE_ATOM),
], $ready ? 200 : 503, ['Cache-Control' => 'no-store']);
