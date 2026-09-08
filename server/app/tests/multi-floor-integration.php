<?php

declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

require dirname(__DIR__) . '/bootstrap.php';

$pdo = $database->connection();
if (!$pdo) {
    fwrite(STDERR, "multi-floor integration: DBへ接続できません。\n");
    exit(1);
}

function assert_multi_floor(bool $condition, string $message): void
{
    if (!$condition) {
        fwrite(STDERR, "multi-floor integration failure: {$message}\n");
        exit(1);
    }
}

$sampleRaw = [
    'content_id' => 'amateur_audit_001',
    'title' => '素人動画 監査作品 1',
    'URL' => 'https://example.invalid/amateur/amateur_audit_001',
    'affiliateURL' => 'https://example.invalid/affiliate/amateur_audit_001',
    'imageURL' => [
        'large' => 'https://example.invalid/images/amateur_audit_001.jpg',
    ],
    'sampleMovieURL' => [
        'flag' => 1,
        'size_720_480' => 'https://www.dmm.co.jp/litevideo/-/part/=/cid=amateur_audit_001/size=720_480/',
        'size_560_360' => 'https://www.dmm.co.jp/litevideo/-/part/=/cid=amateur_audit_001/size=560_360/',
    ],
    'review' => ['count' => 31, 'average' => 4.6],
    'prices' => ['price' => '980円'],
    'date' => date('Y-m-d H:i:s'),
    'iteminfo' => [
        'maker' => [['id' => 'amateur_maker_1', 'name' => '素人動画メーカー']],
        'genre' => [['id' => '501', 'name' => '素人動画監査ジャンル', 'ruby' => 'しろうとどうが']],
        'series' => [['id' => '601', 'name' => '素人動画監査シリーズ', 'ruby' => 'しろうとどうがしりーず']],
    ],
];

$normalized = $fanza->feedItem($sampleRaw, 'amateur');
assert_multi_floor(($normalized['floorKey'] ?? '') === 'amateur', '素人動画のfloorKeyがamateurではない');
assert_multi_floor(($normalized['mediaType'] ?? '') === 'video', '素人動画のmediaTypeがvideoではない');
assert_multi_floor(
    ($normalized['sampleMovieUrl'] ?? '') === 'https://www.dmm.co.jp/litevideo/-/part/=/cid=amateur_audit_001/size=720_480/',
    '最大サイズのsampleMovieURLを選択できていない',
);
assert_multi_floor(($normalized['genreRows'][0]['id'] ?? '') === 'amateur:501', '素人動画ジャンルIDが名前空間化されていない');
assert_multi_floor(($normalized['seriesRows'][0]['id'] ?? '') === 'amateur:601', '素人動画シリーズIDが名前空間化されていない');

$workRepository->upsertNormalized($normalized);
for ($index = 2; $index <= 8; $index++) {
    $cid = sprintf('amateur_audit_%03d', $index);
    $workRepository->upsertNormalized([
        'cid' => $cid,
        'floorKey' => 'amateur',
        'mediaType' => 'video',
        'title' => "素人動画 監査作品 {$index}",
        'productUrl' => "https://example.invalid/amateur/{$cid}",
        'affiliateUrl' => "https://example.invalid/affiliate/{$cid}",
        'description' => '',
        'images' => ["https://example.invalid/images/{$cid}.jpg"],
        'sampleMovieUrl' => "https://www.dmm.co.jp/litevideo/-/part/=/cid={$cid}/size=720_480/",
        'sampleCount' => 1,
        'fullPageCount' => null,
        'volume' => '',
        'reviews' => 20 + $index,
        'rating' => 4.0 + $index / 100,
        'price' => (900 + $index * 10) . '円',
        'releaseDate' => date('Y-m-d H:i:s', time() - $index * 1800),
        'maker' => '素人動画メーカー',
        'makerId' => 'amateur_maker_1',
        'genreRows' => [['id' => 'amateur:501', 'name' => '素人動画監査ジャンル', 'ruby' => 'しろうとどうが']],
        'seriesRows' => [],
    ]);
}

assert_multi_floor($database->hasUsableCatalog('comic'), 'コミックカタログが利用可能ではない');
assert_multi_floor($database->hasUsableCatalog('amateur'), '素人動画カタログが利用可能ではない');

$uid = '44444444-4444-4444-8444-444444444444';
$baseFilters = [
    'minSamples' => 1,
    'minReviews' => 0,
    'minRating' => 0,
    'minPrice' => 0,
    'maxPrice' => 0,
    'genreId' => '',
    'query' => '',
];

$comicFeed = $catalogService->catalog($baseFilters, '', 0, 6, '', $uid, 'comic');
$amateurFeed = $catalogService->catalog($baseFilters, '', 0, 6, '', $uid, 'amateur');
assert_multi_floor(is_string($comicFeed['feedId']) && $comicFeed['feedId'] !== '', 'コミックfeedIdがない');
assert_multi_floor(is_string($amateurFeed['feedId']) && $amateurFeed['feedId'] !== '', '素人動画feedIdがない');
assert_multi_floor($comicFeed['feedId'] !== $amateurFeed['feedId'], '異なるフロアでfeedIdが共有されている');
assert_multi_floor(count($amateurFeed['items']) === 6, '素人動画feedが6件ではない');
foreach ($amateurFeed['items'] as $item) {
    assert_multi_floor(($item['floorKey'] ?? '') === 'amateur', '素人動画feedへ別フロア作品が混入した');
    assert_multi_floor(($item['mediaType'] ?? '') === 'video', '素人動画feedのmediaTypeがvideoではない');
    assert_multi_floor(preg_match('~^https?://~i', (string)($item['sampleMovieUrl'] ?? '')) === 1, '素人動画feedに動画URLがない');
}
foreach ($comicFeed['items'] as $item) {
    assert_multi_floor(($item['floorKey'] ?? 'comic') === 'comic', 'コミックfeedへ素人動画が混入した');
}

$sessionStmt = $pdo->prepare('SELECT filter_json FROM feed_sessions WHERE id = ? LIMIT 1');
$sessionStmt->execute([(string)$amateurFeed['feedId']]);
$amateurFilterJson = (string)$sessionStmt->fetchColumn();
assert_multi_floor(str_contains($amateurFilterJson, '"floorKey":"amateur"'), '固定feedのfilter_hash元へフロアが含まれていない');

$search = $searchService->search(
    [...$baseFilters, 'query' => '素人動画 監査作品'],
    0,
    24,
    'popular',
    $uid,
    'amateur',
);
assert_multi_floor(($search['floorKey'] ?? '') === 'amateur', '検索結果のfloorKeyがamateurではない');
assert_multi_floor(count($search['items']) === 8, '素人動画検索が8件ではない');
foreach ($search['items'] as $item) {
    assert_multi_floor(($item['floorKey'] ?? '') === 'amateur', '素人動画検索へコミックが混入した');
}

$pdo->prepare(
    'INSERT INTO anonymous_users (id, created_at, last_seen_at) VALUES (?, NOW(), NOW()) '
    . 'ON DUPLICATE KEY UPDATE last_seen_at=NOW()'
)->execute([$uid]);
$state = $pdo->prepare(
    'INSERT INTO user_work_states (anonymous_user_id, work_cid, liked, saved, liked_at, saved_at, updated_at) '
    . 'VALUES (?, ?, 0, 1, NULL, NOW(), NOW()) '
    . 'ON DUPLICATE KEY UPDATE saved=1, saved_at=NOW(), updated_at=NOW()'
);
$state->execute([$uid, 'amateur_audit_001']);
$state->execute([$uid, 'audit_001']);

$amateurSaved = $userLibraryService->saved($uid, 24, '', 'amateur');
$comicSaved = $userLibraryService->saved($uid, 24, '', 'comic');
assert_multi_floor($amateurSaved['total'] === 1, '素人動画の保存件数がフロア分離されていない');
assert_multi_floor(($amateurSaved['items'][0]['cid'] ?? '') === 'amateur_audit_001', '素人動画保存一覧の作品が不正');
assert_multi_floor($comicSaved['total'] === 1, 'コミックの保存件数がフロア分離されていない');
assert_multi_floor(($comicSaved['items'][0]['cid'] ?? '') === 'audit_001', 'コミック保存一覧の作品が不正');

assert_multi_floor($userLibraryService->deleteProfile($uid) === true, 'テスト用匿名プロフィールを削除できない');

fwrite(STDOUT, "multi-floor integration tests: OK\n");
