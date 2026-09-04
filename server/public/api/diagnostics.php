<?php

declare(strict_types=1);

require dirname(__DIR__, 2) . '/app/bootstrap.php';

try {
    json_response(
        $catalogService->diagnostics(trim((string)($_GET['genre_id'] ?? ''))),
        200,
        ['Cache-Control' => 'private, no-store'],
    );
} catch (Throwable $error) {
    json_response(['error' => $error->getMessage()], 500, ['Cache-Control' => 'no-store']);
}
