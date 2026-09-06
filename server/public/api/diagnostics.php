<?php

declare(strict_types=1);

require dirname(__DIR__, 2) . '/app/bootstrap.php';
header('X-Robots-Tag: noindex, nofollow, noarchive');
if(!admin_request_authorized()){http_response_code(404);exit;}
try{json_response($catalogService->diagnostics(mb_substr(trim((string)($_GET['genre_id']??'')),0,64)),200,['Cache-Control'=>'private, no-store']);}
catch(Throwable $error){json_response(['error'=>public_error_message($error,'API診断の取得に失敗しました。')],500,['Cache-Control'=>'no-store']);}
