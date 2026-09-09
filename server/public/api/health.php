<?php

declare(strict_types=1);

require dirname(__DIR__, 2) . '/app/bootstrap.php';

$ready = $database->connection() !== null
    && $database->hasUsableCatalog()
    && $fanza->configured();

json_response([
    'ok' => $ready,
    'time' => date(DATE_ATOM),
], $ready ? 200 : 503, ['Cache-Control' => 'no-store']);
