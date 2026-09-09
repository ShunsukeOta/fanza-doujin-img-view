<?php

declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

require dirname(__DIR__) . '/bootstrap.php';

$pdo = $database->connection();
if (!$pdo) {
    fwrite(STDERR, "adaptive integration: DBへ接続できません。\n");
    exit(1);
}

function adaptive_assert(bool $condition, string $message): void
{
    if (!$condition) {
        fwrite(STDERR, "adaptive integration failure: {$message}\n");
        exit(1);
    }
}

for ($index = 1; $index <= 70; $index++) {
    $cid = sprintf('adaptive_%03d', $index);
    $workRepository->upsertNormalized([
        'cid' => $cid,
        'title' => "Adaptive {$index}",
        'productUrl' => "https://example.invalid/product/{$cid}",
        'affiliateUrl' => "https://example.invalid/affiliate/{$cid}",
        'description' => '',
        'images' => ["https://example.invalid/images/{$cid}.jpg"],
        'sampleCount' => 1,
        'fullPageCount' => 10,
        'volume' => '',
        'reviews' => 100 - $index,
        'rating' => 4.0 + (($index % 10) / 10),
        'price' => '1,000円',
        'releaseDate' => date('Y-m-d H:i:s', time() - $index * 60),
        'maker' => 'Adaptive Circle',
        'makerId' => 'adaptive-maker',
        'genreRows' => [['id' => 'adaptive_genre', 'name' => 'Adaptive Genre', 'ruby' => '']],
        'seriesRows' => [],
    ]);
}

$uid = '77777777-7777-4777-8777-777777777777';
$filters = [
    'minSamples' => 1,
    'minReviews' => 0,
    'minRating' => 0,
    'minPrice' => 0,
    'maxPrice' => 0,
    'genreId' => 'adaptive_genre',
    'query' => '',
];

$first = $catalogService->catalog($filters, '', 0, 6, '', $uid);
adaptive_assert(($first['recommenderVersion'] ?? '') === 'rules-v3.3-adaptive', '推薦versionがadaptiveではない');
adaptive_assert(is_string($first['feedId'] ?? null), 'feedIdがない');
$feedId = (string)$first['feedId'];

$stmt = $pdo->prepare('SELECT generated_count, recommender_version FROM feed_sessions WHERE id = ?');
$stmt->execute([$feedId]);
$session = $stmt->fetch();
adaptive_assert((int)($session['generated_count'] ?? 0) === 30, '初回生成が30件windowではない');
adaptive_assert(($session['recommender_version'] ?? '') === 'rules-v3.3-adaptive', 'sessionの推薦versionが不正');

$next = $catalogService->catalog($filters, $feedId, 30, 6, '', $uid);
adaptive_assert(($next['feedId'] ?? '') === $feedId, 'adaptive continuationでfeedIdが変わった');
$stmt->execute([$feedId]);
$session = $stmt->fetch();
adaptive_assert((int)($session['generated_count'] ?? 0) === 60, '次windowが30件単位で生成されていない');

fwrite(STDOUT, "adaptive recommendation integration: OK\n");
