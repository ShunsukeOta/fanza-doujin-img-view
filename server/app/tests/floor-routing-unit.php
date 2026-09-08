<?php

declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

require dirname(__DIR__) . '/src/FanzaClient.php';

use SwipePreview\FanzaClient;

function assert_floor_unit(bool $condition, string $message): void
{
    if (!$condition) {
        fwrite(STDERR, "floor routing unit failure: {$message}\n");
        exit(1);
    }
}

$client = new FanzaClient(['api_id' => '', 'affiliate_id' => '']);
$comic = $client->fallbackFloor('comic');
$amateur = $client->fallbackFloor('amateur');

assert_floor_unit(($comic['serviceCode'] ?? '') === 'doujin', 'comic serviceがdoujinではない');
assert_floor_unit(($comic['floorCode'] ?? '') === 'digital_doujin', 'comic floorがdigital_doujinではない');
assert_floor_unit(($amateur['serviceCode'] ?? '') === 'digital', 'amateur serviceがdigitalではない');
assert_floor_unit(($amateur['floorCode'] ?? '') === 'videoc', 'amateur floorがvideocではない');
assert_floor_unit(($amateur['key'] ?? '') === 'amateur', 'amateur keyが不正');

fwrite(STDOUT, "floor routing unit tests: OK\n");
