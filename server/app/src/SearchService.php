<?php

declare(strict_types=1);

namespace SwipePreview;

use PDO;
use RuntimeException;

final class SearchService
{
    public function __construct(
        private readonly Database $database,
        private readonly WorkRepository $works,
        private readonly EventService $events,
    ) {
    }

    public function search(
        array $filters,
        int $cursor,
        int $limit,
        string $sort,
        string $anonymousUserId,
    ): array {
        $pdo = $this->database->connection();
        if (!$pdo) {
            throw new RuntimeException('検索DBが利用できません。');
        }

        $filters = $this->normalizeFilters($filters);
        $cursor = max(0, min(200000, $cursor));
        $limit = max(1, min(24, $limit));
        $sort = in_array($sort, ['popular', 'rating', 'new', 'price_asc'], true) ? $sort : 'popular';

        [$where, $params] = $this->where($filters);
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

        $stmt = $pdo->prepare(
            'SELECT w.cid FROM works w WHERE ' . $whereSql
            . ' ORDER BY ' . $orderSql
            . ' LIMIT ' . $limit . ' OFFSET ' . $cursor
        );
        $stmt->execute($params);
        $cids = array_values(array_filter(array_map(
            static fn(array $row): string => trim((string)($row['cid'] ?? '')),
            $stmt->fetchAll(),
        )));

        $hydrated = $this->works->feedItemsByCids($cids);
        $reactions = $this->events->reactionSummaries($anonymousUserId, $cids);
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

        return [
            'ok' => true,
            'items' => $items,
            'total' => $total,
            'cursor' => $cursor,
            'nextCursor' => $hasMore ? $nextCursor : null,
            'hasMore' => $hasMore,
            'sort' => $sort,
        ];
    }

    private function normalizeFilters(array $filters): array
    {
        $minPrice = max(0, min(10000000, (int)($filters['minPrice'] ?? 0)));
        $maxPrice = max(0, min(10000000, (int)($filters['maxPrice'] ?? 0)));
        if ($minPrice > 0 && $maxPrice > 0 && $minPrice > $maxPrice) {
            [$minPrice, $maxPrice] = [$maxPrice, $minPrice];
        }

        return [
            'minSamples' => max(1, min(100, (int)($filters['minSamples'] ?? 1))),
            'minReviews' => max(0, min(100000, (int)($filters['minReviews'] ?? 0))),
            'minRating' => max(0.0, min(5.0, (float)($filters['minRating'] ?? 0))),
            'minPrice' => $minPrice,
            'maxPrice' => $maxPrice,
            'genreId' => mb_substr(trim((string)($filters['genreId'] ?? '')), 0, 64),
            'query' => mb_substr(trim((string)($filters['query'] ?? '')), 0, 100),
            'maker' => mb_substr(trim((string)($filters['maker'] ?? '')), 0, 100),
            'series' => mb_substr(trim((string)($filters['series'] ?? '')), 0, 100),
        ];
    }

    private function where(array $filters): array
    {
        $where = [
            'w.is_active = 1',
            'w.sample_count >= :min_samples',
            'w.review_count >= :min_reviews',
            'w.rating >= :min_rating',
        ];
        $params = [
            ':min_samples' => (int)$filters['minSamples'],
            ':min_reviews' => (int)$filters['minReviews'],
            ':min_rating' => (float)$filters['minRating'],
        ];

        if ($filters['minPrice'] > 0) {
            $where[] = 'w.price_value >= :min_price';
            $params[':min_price'] = (int)$filters['minPrice'];
        }
        if ($filters['maxPrice'] > 0) {
            $where[] = 'w.price_value <= :max_price';
            $params[':max_price'] = (int)$filters['maxPrice'];
        }
        if ($filters['genreId'] !== '') {
            $where[] = 'EXISTS (SELECT 1 FROM work_genres wg WHERE wg.work_cid = w.cid AND wg.genre_id = :genre_id)';
            $params[':genre_id'] = (string)$filters['genreId'];
        }
        if ($filters['query'] !== '') {
            $where[] = '(w.title LIKE :q_title ESCAPE \'=\' OR w.maker LIKE :q_maker ESCAPE \'=\' '
                . 'OR EXISTS (SELECT 1 FROM work_series ws JOIN series s ON s.id = ws.series_id '
                . 'WHERE ws.work_cid = w.cid AND s.name LIKE :q_series ESCAPE \'=\'))';
            $pattern = $this->likePattern((string)$filters['query']);
            $params[':q_title'] = $pattern;
            $params[':q_maker'] = $pattern;
            $params[':q_series'] = $pattern;
        }
        if ($filters['maker'] !== '') {
            $where[] = 'w.maker LIKE :maker_query ESCAPE \'=\'';
            $params[':maker_query'] = $this->likePattern((string)$filters['maker']);
        }
        if ($filters['series'] !== '') {
            $where[] = 'EXISTS (SELECT 1 FROM work_series ws2 JOIN series s2 ON s2.id = ws2.series_id '
                . 'WHERE ws2.work_cid = w.cid AND s2.name LIKE :series_query ESCAPE \'=\')';
            $params[':series_query'] = $this->likePattern((string)$filters['series']);
        }

        return [$where, $params];
    }

    private function likePattern(string $value): string
    {
        return '%' . str_replace(['=', '%', '_'], ['==', '=%', '=_'], $value) . '%';
    }
}
