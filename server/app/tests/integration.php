<?php

declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

require dirname(__DIR__) . '/bootstrap.php';

$pdo = $database->connection();
if (!$pdo) {
    fwrite(STDERR, "integration: DBへ接続できません。\n");
    exit(1);
}

function assert_test(bool $condition, string $message): void
{
    if (!$condition) {
        fwrite(STDERR, "integration failure: {$message}\n");
        exit(1);
    }
}

function test_item(int $index): array
{
    $cid = sprintf('audit_%03d', $index);
    $title = $index === 1 ? '100%_SPECIAL 検索対象' : "監査作品 {$index}";
    $maker = $index === 3 ? '監査サークル' : 'テストサークル';
    $seriesRows = $index === 2
        ? [['id' => 'audit_series', 'name' => '監査シリーズ', 'ruby' => 'かんさしりーず']]
        : [];

    return [
        'cid' => $cid,
        'title' => $title,
        'productUrl' => "https://example.invalid/product/{$cid}",
        'affiliateUrl' => "https://example.invalid/affiliate/{$cid}",
        'description' => '',
        'images' => ["https://example.invalid/images/{$cid}-1.jpg"],
        'sampleCount' => 1,
        'fullPageCount' => 12,
        'volume' => '',
        'reviews' => $index * 3,
        'rating' => min(5.0, 3.0 + $index / 10),
        'price' => $index === 1 ? '1,000円' : (string)(500 + $index * 10) . '円',
        'assetBucket' => 'doujin',
        'assetType' => 'comic',
        'releaseDate' => date('Y-m-d H:i:s', time() - $index * 3600),
        'maker' => $maker,
        'makerId' => 'maker_' . $index,
        'genreRows' => [['id' => 'audit_genre', 'name' => '監査ジャンル', 'ruby' => 'かんさ']],
        'seriesRows' => $seriesRows,
    ];
}

for ($index = 1; $index <= 14; $index++) {
    $workRepository->upsertNormalized(test_item($index), 'test');
}

$uid = '11111111-1111-4111-8111-111111111111';
$baseFilters = [
    'minSamples' => 1,
    'minReviews' => 0,
    'minRating' => 0,
    'minPrice' => 0,
    'maxPrice' => 0,
    'assetType' => 'all',
    'genreId' => '',
    'query' => '',
];

// Native prepared statement + LIKEエスケープ。% と _ をワイルドカードとして扱わない。
$literalFilters = [...$baseFilters, 'query' => '100%_SPECIAL'];
$literal = $catalogService->catalog($literalFilters, '', 0, 6, '', $uid);
assert_test(count($literal['items']) === 1, '特殊文字を含む作品名検索が1件にならない');
assert_test(($literal['items'][0]['cid'] ?? '') === 'audit_001', '特殊文字を含む作品名検索のCIDが不正');

$series = $catalogService->catalog([...$baseFilters, 'query' => '監査シリーズ'], '', 0, 6, '', $uid);
assert_test(count($series['items']) === 1, 'シリーズ名検索が1件にならない');
assert_test(($series['items'][0]['cid'] ?? '') === 'audit_002', 'シリーズ名検索のCIDが不正');

$maker = $catalogService->catalog([...$baseFilters, 'query' => '監査サークル'], '', 0, 6, '', $uid);
assert_test(count($maker['items']) === 1, 'サークル名検索が1件にならない');
assert_test(($maker['items'][0]['cid'] ?? '') === 'audit_003', 'サークル名検索のCIDが不正');

// 直接CID + 検索条件でもcidMatchesDatabaseFiltersがnative prepareで失敗しない。
$direct = $catalogService->catalog($literalFilters, '', 0, 6, 'audit_002', $uid);
assert_test(($direct['items'][0]['cid'] ?? '') === 'audit_002', '直接CIDが先頭に固定されていない');

// feed_id + cursor の固定順序。2ページで重複せず、同じfeed_idを維持する。
$first = $catalogService->catalog($baseFilters, '', 0, 6, '', $uid);
assert_test(is_string($first['feedId']) && $first['feedId'] !== '', 'feedIdが発行されていない');
assert_test(is_int($first['nextCursor']), '1ページ目のnextCursorがない');
assert_test(count($first['items']) === 6, '1ページ目が6件ではない');
$second = $catalogService->catalog($baseFilters, (string)$first['feedId'], (int)$first['nextCursor'], 6, '', $uid);
assert_test($second['feedId'] === $first['feedId'], '2ページ目でfeedIdが変わった');
assert_test(count($second['items']) === 6, '2ページ目が6件ではない');
$firstCids = array_column($first['items'], 'cid');
$secondCids = array_column($second['items'], 'cid');
assert_test(array_intersect($firstCids, $secondCids) === [], '固定feedの1・2ページに重複がある');

// 保存時価格より現在価格が下がったケースを作る。現在価格履歴はNOW()なので保存時刻より後になる。
$history = $pdo->prepare(
    'INSERT INTO work_price_history (work_cid, price, price_value, observed_at) '
    . 'VALUES (?, ?, ?, DATE_SUB(NOW(), INTERVAL 4 HOUR))'
);
$history->execute(['audit_001', '1,500円', 1500]);

$state = $pdo->prepare(
    'INSERT INTO user_work_states (anonymous_user_id, work_cid, liked, saved, liked_at, saved_at, updated_at) '
    . 'VALUES (?, ?, 0, 1, NULL, DATE_SUB(NOW(), INTERVAL ? HOUR), NOW()) '
    . 'ON DUPLICATE KEY UPDATE saved=1, saved_at=VALUES(saved_at), updated_at=NOW()'
);
$state->execute([$uid, 'audit_001', 1]);
$state->execute([$uid, 'audit_002', 2]);
$state->execute([$uid, 'audit_003', 3]);

$savedFirst = $userLibraryService->saved($uid, 2);
assert_test($savedFirst['total'] === 3, '保存件数が3件ではない');
assert_test(count($savedFirst['items']) === 2, '保存1ページ目が2件ではない');
assert_test(is_string($savedFirst['nextCursor']) && $savedFirst['nextCursor'] !== '', '保存カーソルが発行されていない');
assert_test(($savedFirst['items'][0]['cid'] ?? '') === 'audit_001', '保存順序がsaved_at順ではない');
assert_test(($savedFirst['items'][0]['savedPriceValue'] ?? null) === 1500, '保存時価格を取得できていない');
assert_test(($savedFirst['items'][0]['priceDropValue'] ?? null) === 500, '値下げ差額が500円にならない');

$savedSecond = $userLibraryService->saved($uid, 2, (string)$savedFirst['nextCursor']);
assert_test(count($savedSecond['items']) === 1, '保存2ページ目が1件ではない');
assert_test(($savedSecond['items'][0]['cid'] ?? '') === 'audit_003', '保存カーソルの続きが不正');
assert_test($savedSecond['hasMore'] === false, '保存最終ページでhasMoreがfalseではない');

fwrite(STDOUT, "integration tests: OK\n");
