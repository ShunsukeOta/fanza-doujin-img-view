<?php

declare(strict_types=1);

$path = (string)parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH);
if (preg_match('~^/api/(catalog|meta|diagnostics|debug|health|events|reactions|saved|me|work-details)/?$~', $path, $match) === 1) {
    require __DIR__ . '/api/' . $match[1] . '.php';
    return true;
}
return false;
