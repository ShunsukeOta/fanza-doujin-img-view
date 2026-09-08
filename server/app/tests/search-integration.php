<?php

declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

require dirname(__DIR__) . '/bootstrap.php';

function search_assert(bool $condition, string $message): void
{
    if (!$condition) {
        fwrite(STDERR, "search integration failure: {$message}\n");
        exit(1);
    }
}

$uid = '44444444-4444-4444-8444-444444444444';
$base = [
    'minSamples' => 1,
    'minReviews' => 0,
    'minRating' => 0,
    'minPrice' => 0,
    'maxPrice' => 0,
    'genreId' => '',
    'query' => '',
    'maker' => '',
    'series' => '',
];

$literal = $searchService->search([...$base, 'query' => '100%_SPECIAL'], 0, 24, 'popular', $uid);
search_assert($literal['total'] === 1, '特殊文字を含むキーワード検索が1件ではない');
search_assert(($literal['items'][0]['cid'] ?? '') === 'audit_001', '特殊文字検索のCIDが不正');

$maker = $searchService->search([...$base, 'maker' => '監査サークル'], 0, 24, 'popular', $uid);
search_assert($maker['total'] === 1, 'サークル単独検索が1件ではない');
search_assert(($maker['items'][0]['cid'] ?? '') === 'audit_003', 'サークル単独検索のCIDが不正');

$series = $searchService->search([...$base, 'series' => '監査シリーズ'], 0, 24, 'popular', $uid);
search_assert($series['total'] === 1, 'シリーズ単独検索が1件ではない');
search_assert(($series['items'][0]['cid'] ?? '') === 'audit_002', 'シリーズ単独検索のCIDが不正');

$genre = $searchService->search([...$base, 'genreId' => 'audit_genre'], 0, 24, 'popular', $uid);
search_assert($genre['total'] === 14, 'ジャンル検索の件数が不正');

$rating = $searchService->search([...$base, 'minRating' => 4], 0, 24, 'rating', $uid);
search_assert($rating['total'] === 5, '最低評価4の件数が不正');
search_assert(($rating['items'][0]['cid'] ?? '') === 'audit_014', '評価順の先頭が不正');

$price = $searchService->search($base, 0, 24, 'price_asc', $uid);
search_assert(($price['items'][0]['cid'] ?? '') === 'audit_002', '価格が安い順の先頭が不正');

$first = $searchService->search($base, 0, 5, 'popular', $uid);
$second = $searchService->search($base, 5, 5, 'popular', $uid);
search_assert(count($first['items']) === 5, '詳細検索1ページ目が5件ではない');
search_assert(count($second['items']) === 5, '詳細検索2ページ目が5件ではない');
search_assert($first['nextCursor'] === 5, '詳細検索のnextCursorが不正');
search_assert(array_intersect(array_column($first['items'], 'cid'), array_column($second['items'], 'cid')) === [], '詳細検索ページ間に重複がある');

$normalizedSort = $searchService->search($base, 0, 3, 'invalid-sort', $uid);
search_assert($normalizedSort['sort'] === 'popular', '不正な並び順がpopularへ正規化されない');

fwrite(STDOUT, "search integration tests: OK\n");
