<?php

declare(strict_types=1);

require dirname(__DIR__, 2) . '/app/bootstrap.php';

header('X-Robots-Tag: noindex, nofollow, noarchive');

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'GET') {
    header('Allow: GET');
    json_response(['error' => 'GETのみ対応しています。'], 405, ['Cache-Control' => 'no-store']);
}

function search_like_pattern(string $value): string
{
    $escaped = str_replace(['=', '%', '_'], ['==', '=%', '=_'], $value);
    return '%' . $escaped . '%';
}

try {
    [$anonymousUserId] = anonymous_identity();
    $pdo = $database->connection();
    if (!$pdo) {
        json_response(['error' => '検索DBが利用できません。'], 503, ['Cache-Control' => 'no-store']);
    }

    $cursor = read_int('cursor', 0, 0, 200000);
    $limit = read_int('limit', 24, 1, 24);
    $minSamples = read_int('min_samples', 1, 1, 100);
    $minReviews = read_int('min_reviews', 0, 0, 100000);
    $minRating = read_float('min_rating', 0.0, 0.0, 5.0);
    $minPrice = read_int('min_price', 0, 0, 10000000);
    $maxPrice = read_int('max_price', 0, 0, 10000000);
    $genreId = mb_substr(trim((string)($_GET['genre_id'] ?? '')), 0, 64);
    $query = mb_substr(trim((string)($_GET['q'] ?? '')), 0, 100);
    $maker = mb_substr(trim((string)($_GET['maker'] ?? '')), 0, 100);
    $series = mb_substr(trim((string)($_GET['series'] ?? '')), 0, 100);
    $sort = trim((string)($_GET['sort'] ?? 'popular'));
    if (!in_array($sort, ['popular', 'rating', 'new', 'price_asc'], true)) {
        $sort = 'popular';
    }
    if ($minPrice > 0 && $maxPrice > 0 && $maxPrice < $minPrice) {
        [$minPrice, $maxPrice] = [$maxPrice, $minPrice];
    }

    $where = [
        'w.is_active = 1',
        'w.sample_count >= :min_samples',
        'w.review_count >= :min_reviews',
        'w.rating >= :min_rating',
    ];
    $params = [
        ':min_samples' => $minSamples,
        ':min_reviews' => $minReviews,
        ':min_rating' => $minRating,
    ];

    if ($minPrice > 0) {
        $where[] = 'w.price_value >= :min_price';
        $params[':min_price'] = $minPrice;
    }
    if ($maxPrice > 0) {
        $where[] = 'w.price_value <= :max_price';
        $params[':max_price'] = $maxPrice;
    }
    if ($genreId !== '') {
        $where[] = 'EXISTS (SELECT 1 FROM work_genres wg WHERE wg.work_cid = w.cid AND wg.genre_id = :genre_id)';
        $params[':genre_id'] = $genreId;
    }
    if ($query !== '') {
        $where[] = '(w.title LIKE :q_title ESCAPE \'=\' OR w.maker LIKE :q_maker ESCAPE \'=\' '
            . 'OR EXISTS (SELECT 1 FROM work_series ws JOIN series s ON s.id = ws.series_id '
            . 'WHERE ws.work_cid = w.cid AND s.name LIKE :q_series ESCAPE \'=\'))';
        $pattern = search_like_pattern($query);
        $params[':q_title'] = $pattern;
        $params[':q_maker'] = $pattern;
        $params[':q_series'] = $pattern;
    }
    if ($maker !== '') {
        $where[] = 'w.maker LIKE :maker_query ESCAPE \'=\'';
        $params[':maker_query'] = search_like_pattern($maker);
    }
    if ($series !== '') {
        $where[] = 'EXISTS (SELECT 1 FROM work_series ws2 JOIN series s2 ON s2.id = ws2.series_id '
            . 'WHERE ws2.work_cid = w.cid AND s2.name LIKE :series_query ESCAPE \'=\')';
        $params[':series_query'] = search_like_pattern($series);
    }

    $whereSql = implode(' AND ', $where);
    $countStmt = $pdo->prepare('SELECT COUNT(*) FROM works w WHERE ' . $whereSql);
    $countStmt->execute($params);
    $total = (int)$countStmt->fetchColumn();

    $orderSql = match ($sort) {
        'rating' => 'w.rating DESC, w.review_count DESC, w.release_date DESC, w.cid ASC',
        'new' => 'w.release_date DESC, w.review_count DESC, w.cid ASC',
        'price_asc' => 'CASE WHEN w.price_value IS NULL THEN 1 ELSE 0 END ASC, w.price_value ASC, w.review_count DESC, w.cid ASC',
        default => 'w.review_count DESC, w.rating DESC, w.release_date DESC, w.cid ASC',
    };

    $sql = 'SELECT w.cid FROM works w WHERE ' . $whereSql
        . ' ORDER BY ' . $orderSql
        . ' LIMIT ' . $limit . ' OFFSET ' . $cursor;
    $stmt = $pdo->prepare($sql);
    $stmt->execute($params);
    $cids = array_values(array_filter(array_map(
        static fn(array $row): string => trim((string)($row['cid'] ?? '')),
        $stmt->fetchAll(),
    )));

    $hydrated = $workRepository->feedItemsByCids($cids);
    $reactions = $eventService->reactionSummaries($anonymousUserId, $cids);
    $items = [];
    foreach ($cids as $cid) {
        $item = $hydrated[$cid] ?? null;
        if (!is_array($item) || ($item['available'] ?? true) === false) {
            continue;
        }
        $reaction = $reactions[$cid] ?? [
            'likeCount' => 0,
            'saveCount' => 0,
            'viewerLiked' => false,
            'viewerSaved' => false,
        ];
        $item['likeCount'] = (int)($reaction['likeCount'] ?? 0);
        $item['saveCount'] = (int)($reaction['saveCount'] ?? 0);
        $item['viewerLiked'] = (bool)($reaction['viewerLiked'] ?? false);
        $item['viewerSaved'] = (bool)($reaction['viewerSaved'] ?? false);
        $items[] = $item;
    }

    $nextCursor = $cursor + count($cids);
    $hasMore = $nextCursor < $total && count($cids) > 0;

    json_response([
        'ok' => true,
        'items' => $items,
        'total' => $total,
        'cursor' => $cursor,
        'nextCursor' => $hasMore ? $nextCursor : null,
        'hasMore' => $hasMore,
        'sort' => $sort,
    ], 200, ['Cache-Control' => 'private, no-store']);
} catch (Throwable $error) {
    json_response(
        ['error' => public_error_message($error, '検索結果を取得できませんでした。')],
        500,
        ['Cache-Control' => 'no-store'],
    );
}
