<?php

declare(strict_types=1);

require dirname(__DIR__, 2) . '/app/bootstrap.php';

try {
    json_response($catalogService->meta(), 200, ['Cache-Control' => 'public, max-age=3600']);
} catch (Throwable $error) {
    json_response(['error' => public_error_message($error, 'メタ情報の取得に失敗しました。')], 500, ['Cache-Control' => 'no-store']);
}
