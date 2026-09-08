<?php

declare(strict_types=1);

$path = (string)parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH);
if (preg_match('~^/api/(catalog|search|meta|diagnostics|debug|health|events|reactions|saved|history|me|work-details)/?$~', $path, $match) === 1) {
    require __DIR__ . '/api/' . $match[1] . '.php';
    return true;
}
if (preg_match('~^/work/([A-Za-z0-9_-]{1,128})/?$~', $path, $match) === 1) {
    $_GET['cid'] = $match[1];
    require __DIR__ . '/work.php';
    return true;
}
return false;
