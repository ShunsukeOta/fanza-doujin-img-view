<?php

declare(strict_types=1);

namespace SwipePreview;

use PDO;
use RuntimeException;
use Throwable;

final class CatalogService
{
    private const LIVE_HITS = 100;
    private const LIVE_MAX_PAGES = 5;
    private const FEED_TTL_HOURS = 12;
    private const ADAPTIVE_WINDOW_SIZE = 30;
    private const RECOMMENDER_VERSION = 'rules-v3.3-adaptive';
    private const MAX_CURSOR = 200000;

    public function __construct(
        private readonly Database $database,
        private readonly FanzaClient $fanza,
        private readonly WorkRepository $works,
        private readonly FeedRepository $feedRepository,
        private readonly CandidateSource $candidateSource,
        private readonly RecommendationRanker $ranker,
    ) {
    }

    public function catalog(
        array $filters,
        string $feedId,
        int $cursor,
        int $limit,
        string $cidInput,
        string $anonymousUserId,
    ): array {
        $safeCursor = max(0, min(self::MAX_CURSOR, $cursor));
        $safeLimit = max(1, min(12, $limit));
        $filters = $this->normalizeFilters($filters);

        if ($this->database->hasUsableCatalog()) {
            return $this->catalogFromDatabase(
                $filters,
                $feedId,
                $safeCursor,
                $safeLimit,
                $cidInput,
                $anonymousUserId,
            );
        }

        return $this->catalogFromApi($filters, $safeCursor, $safeLimit, $cidInput);
    }

    public function meta(): array
    {
        $floor = $this->safeFloor();
        $genres = [];
        $pdo = $this->database->connection();
        if ($pdo) {
            try {
                $genres = $pdo->query(
                    "SELECT id, name, ruby FROM genres ORDER BY COALESCE(NULLIF(ruby, ''), name), name"
                )->fetchAll();
            } catch (Throwable) {
                $genres = [];
            }
        }
        if ($genres === [] && $this->fanza->configured() && ($floor['floorId'] ?? '') !== '') {
            $genres = $this->fanza->fetchGenres((string)$floor['floorId']);
        }

        return [
            'floor' => $floor,
            'genres' => $genres,
            'recommenderVersion' => self::RECOMMENDER_VERSION,
        ];
    }

    public function diagnostics(string $genreId): array
    {
        $pdo = $this->database->connection();
        if (!$pdo) {
            throw new RuntimeException('DBが利用できません。');
        }

        $where = ['w.is_active = 1'];
        $params = [];
        if ($genreId !== '') {
            $where[] = 'EXISTS (SELECT 1 FROM work_genres wg WHERE wg.work_cid = w.cid AND wg.genre_id = :genre)';
            $params[':genre'] = $genreId;
        }

        $stmt = $pdo->prepare(
            'SELECT COUNT(*) AS total, '
            . 'SUM(sample_count = 0) AS zero, '
            . 'SUM(sample_count BETWEEN 1 AND 4) AS one_to_four, '
            . 'SUM(sample_count BETWEEN 5 AND 9) AS five_to_nine, '
            . 'SUM(sample_count >= 10) AS ten_plus '
            . 'FROM works w WHERE ' . implode(' AND ', $where)
        );
        $stmt->execute($params);
        $row = $stmt->fetch() ?: [];
        $stats = [
            'total' => (int)($row['total'] ?? 0),
            'zero' => (int)($row['zero'] ?? 0),
            'oneToFour' => (int)($row['one_to_four'] ?? 0),
            'fiveToNine' => (int)($row['five_to_nine'] ?? 0),
            'tenPlus' => (int)($row['ten_plus'] ?? 0),
        ];

        return [
            'scanned' => $stats['total'],
            'apiTotal' => $stats['total'],
            'stats' => ['comic' => $stats],
        ];
    }

    private function catalogFromDatabase(
        array $filters,
        string $requestedFeedId,
        int $cursor,
        int $limit,
        string $cidInput,
        string $userId,
    ): array {
        $pdo = $this->requirePdo();
        $this->ensureUser($pdo, $userId);
        $filterJson = json_encode($filters, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        $filterHash = hash('sha256', (string)$filterJson);
        $session = $this->feedRepository->loadSession(
            $pdo,
            $requestedFeedId,
            $userId,
            $filterHash,
            self::RECOMMENDER_VERSION,
        );
        $queryError = '';

        if (!$session) {
            $pdo->prepare('DELETE FROM feed_sessions WHERE expires_at < NOW() LIMIT 500')->execute();
            $feedId = $this->uuid();
            [$where, $params] = $this->databaseWhere($filters);
            $count = $pdo->prepare('SELECT COUNT(*) FROM works w WHERE ' . implode(' AND ', $where));
            $count->execute($params);
            $total = (int)$count->fetchColumn();
            $pivot = (int)sprintf('%u', crc32($userId . '|' . $feedId . '|' . date('Y-m-d')));

            $insert = $pdo->prepare(
                'INSERT INTO feed_sessions '
                . '(id, anonymous_user_id, filter_hash, filter_json, total_count, generated_count, recommender_version, random_pivot, expires_at) '
                . 'VALUES (?, ?, ?, ?, ?, 0, ?, ?, DATE_ADD(NOW(), INTERVAL ' . self::FEED_TTL_HOURS . ' HOUR))'
            );
            $insert->execute([
                $feedId,
                $userId,
                $filterHash,
                $filterJson,
                $total,
                self::RECOMMENDER_VERSION,
                $pivot,
            ]);
            $session = [
                'id' => $feedId,
                'total_count' => $total,
                'generated_count' => 0,
                'random_pivot' => $pivot,
            ];

            if (trim($cidInput) !== '') {
                try {
                    $cid = $this->fanza->normalizeCid($cidInput);
                    $direct = $this->works->feedItemByCid($cid) ?? $this->works->fetchAndUpsert($cid);
                    if (($direct['sampleCount'] ?? 0) < 1 || ($direct['available'] ?? true) === false) {
                        throw new RuntimeException('指定したコミックに表示可能なサンプルがありません。');
                    }

                    $directBelongsToPool = $this->cidMatchesDatabaseFilters($pdo, $cid, $filters);
                    $this->feedRepository->insertRows($pdo, $feedId, 0, [[
                        'cid' => $cid,
                        'source' => 'direct',
                        'score' => 999.0,
                    ]]);
                    $session['generated_count'] = 1;
                    $session['total_count'] = max(1, $total + ($directBelongsToPool ? 0 : 1));
                    $pdo->prepare(
                        'UPDATE feed_sessions SET generated_count = 1, total_count = ? WHERE id = ?'
                    )->execute([$session['total_count'], $feedId]);
                } catch (Throwable $error) {
                    $queryError = $error->getMessage();
                }
            }
        } else {
            $feedId = (string)$session['id'];
        }

        $needed = $cursor + $limit;
        for ($guard = 0; $guard < 4; $guard++) {
            if ((int)$session['generated_count'] >= $needed) {
                break;
            }
            if ((int)$session['generated_count'] >= (int)$session['total_count']) {
                break;
            }
            $added = $this->appendFeedBlock($pdo, $session, $filters, $userId);
            if ($added === 0) {
                $session['total_count'] = (int)$session['generated_count'];
                $this->feedRepository->updateTotal($pdo, $feedId, $session['total_count']);
                break;
            }
        }

        $feedRows = [];
        for ($guard = 0; $guard < 4; $guard++) {
            $feedRows = $this->feedRepository->fetchRows($pdo, $feedId, $cursor, $limit);
            if (count($feedRows) >= $limit || (int)$session['generated_count'] >= (int)$session['total_count']) {
                break;
            }
            $added = $this->appendFeedBlock($pdo, $session, $filters, $userId);
            if ($added === 0) {
                $session['total_count'] = (int)$session['generated_count'];
                $this->feedRepository->updateTotal($pdo, $feedId, $session['total_count']);
                break;
            }
        }

        $cids = array_map(static fn(array $row): string => (string)$row['work_cid'], $feedRows);
        $hydrated = $this->works->feedItemsByCids($cids);
        $items = [];
        foreach ($feedRows as $row) {
            $cid = (string)$row['work_cid'];
            if (!isset($hydrated[$cid]) || ($hydrated[$cid]['available'] ?? true) === false) {
                continue;
            }
            $item = $hydrated[$cid];
            $item['feedId'] = $feedId;
            $item['rank'] = (int)$row['position'];
            $item['recommendationSource'] = (string)$row['source'];
            $items[] = $item;
        }

        $lastPosition = $feedRows === []
            ? $cursor
            : (int)$feedRows[array_key_last($feedRows)]['position'];
        $existingNext = $feedRows !== [] && $this->feedRepository->hasNext($pdo, $feedId, $lastPosition);
        $canGenerateMore = (int)$session['generated_count'] < (int)$session['total_count'];
        $hasMore = $existingNext || $canGenerateMore;

        return [
            'items' => $items,
            'feedId' => $feedId,
            'cursor' => $cursor,
            'nextCursor' => $hasMore ? $lastPosition : null,
            'hasMore' => $hasMore,
            'apiTotal' => (int)$session['total_count'],
            'scanned' => count($feedRows),
            'effectiveMinSamples' => (int)$filters['minSamples'],
            'source' => 'database',
            'queryError' => $queryError,
            'recommenderVersion' => self::RECOMMENDER_VERSION,
            'floor' => $this->safeFloor(),
        ];
    }

    private function appendFeedBlock(PDO $pdo, array &$session, array $filters, string $userId): int
    {
        $feedId = (string)$session['id'];
        $pdo->beginTransaction();
        try {
            $locked = $this->feedRepository->lockSession($pdo, $feedId);
            if (!is_array($locked)) {
                $pdo->rollBack();
                return 0;
            }

            $session['total_count'] = (int)$locked['total_count'];
            $session['generated_count'] = (int)$locked['generated_count'];
            $session['random_pivot'] = (int)$locked['random_pivot'];
            $remaining = max(0, (int)$session['total_count'] - (int)$session['generated_count']);
            if ($remaining === 0) {
                $pdo->commit();
                return 0;
            }
            $target = min(self::ADAPTIVE_WINDOW_SIZE, $remaining);

            [$where, $params] = $this->databaseWhere($filters);
            $baseWhere = implode(' AND ', $where)
                . ' AND NOT EXISTS (SELECT 1 FROM feed_items fi WHERE fi.feed_id = :feed_id AND fi.work_cid = w.cid)';
            $common = [...$params, ':feed_id' => $feedId];
            $candidate = $this->candidateSource->collect(
                $pdo,
                $baseWhere,
                $common,
                $target,
                (int)$session['random_pivot'],
            );
            $selected = $this->ranker->rank($pdo, $candidate, $feedId, $userId, $target);
            if ($selected === []) {
                $pdo->commit();
                return 0;
            }

            $start = (int)$session['generated_count'];
            $added = $this->feedRepository->insertRows($pdo, $feedId, $start, $selected);
            if ($added > 0) {
                $session['generated_count'] = $start + $added;
                $this->feedRepository->updateGenerated($pdo, $feedId, $session['generated_count']);
            }
            $pdo->commit();
            return $added;
        } catch (Throwable $error) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            throw $error;
        }
    }

    private function catalogFromApi(array $filters, int $cursor, int $limit, string $cidInput): array
    {
        $floor = $this->safeFloor(true);
        $items = [];
        $consumed = 0;
        $apiTotal = 0;
        $sourceExhausted = false;

        for ($pageIndex = 0; $pageIndex < self::LIVE_MAX_PAGES && count($items) < $limit; $pageIndex++) {
            $offset = min(50000, $cursor + $consumed + 1);
            $page = $this->fanza->fetchItemPage(
                $floor,
                $offset,
                (string)$filters['genreId'],
                'review',
                self::LIVE_HITS,
            );
            $apiTotal = max($apiTotal, (int)$page['total']);
            if ($page['items'] === []) {
                $sourceExhausted = true;
                break;
            }

            $stoppedInsidePage = false;
            foreach ($page['items'] as $raw) {
                $consumed++;
                if (!$this->fanza->isComicItem($raw)) {
                    continue;
                }
                $item = $this->fanza->feedItem($raw);
                if (!$this->matches($item, $filters)) {
                    continue;
                }
                $items[] = $this->stripInternalFields($item);
                if (count($items) >= $limit) {
                    $stoppedInsidePage = true;
                    break;
                }
            }

            if ($stoppedInsidePage) {
                break;
            }
            if ((int)$page['resultCount'] < self::LIVE_HITS) {
                $sourceExhausted = true;
                break;
            }
        }

        if ($cursor === 0 && trim($cidInput) !== '') {
            try {
                $raw = $this->fanza->fetchItem($this->fanza->normalizeCid($cidInput), $floor);
                if (!$this->fanza->isComicItem($raw)) {
                    throw new RuntimeException('指定した作品はコミックではありません。');
                }
                $direct = $this->stripInternalFields($this->fanza->feedItem($raw));
                $items = [
                    $direct,
                    ...array_values(array_filter(
                        $items,
                        static fn(array $item): bool => $item['cid'] !== $direct['cid']
                    )),
                ];
                $items = array_slice($items, 0, $limit);
            } catch (Throwable) {
                // DB障害時のfallbackなので、直接CIDの失敗だけでカタログ全体は止めない。
            }
        }

        $next = $cursor + $consumed;
        $hasMore = !$sourceExhausted
            && $consumed > 0
            && ($apiTotal === 0 || $next < $apiTotal)
            && $next < 50000;

        return [
            'items' => $items,
            'feedId' => null,
            'cursor' => $cursor,
            'nextCursor' => $hasMore ? $next : null,
            'hasMore' => $hasMore,
            'apiTotal' => $apiTotal,
            'scanned' => $consumed,
            'effectiveMinSamples' => (int)$filters['minSamples'],
            'source' => 'fanza-api',
            'queryError' => '',
            'recommenderVersion' => 'live-fallback-comic',
            'floor' => $floor,
        ];
    }

    private function databaseWhere(array $filters): array
    {
        $where = [
            'w.sample_count >= :min_samples',
            'w.review_count >= :min_reviews',
            'w.rating >= :min_rating',
            'w.is_active = 1',
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
            $where[] = 'EXISTS (SELECT 1 FROM work_genres wg WHERE wg.work_cid = w.cid AND wg.genre_id = :genre)';
            $params[':genre'] = (string)$filters['genreId'];
        }
        if ($filters['query'] !== '') {
            $where[] = '(w.title LIKE :q_title ESCAPE \'=\' OR w.maker LIKE :q_maker ESCAPE \'=\' '
                . 'OR EXISTS (SELECT 1 FROM work_series ws JOIN series s ON s.id = ws.series_id '
                . 'WHERE ws.work_cid = w.cid AND s.name LIKE :q_series ESCAPE \'=\'))';
            $escaped = str_replace(['=', '%', '_'], ['==', '=%', '=_'], (string)$filters['query']);
            $pattern = '%' . $escaped . '%';
            $params[':q_title'] = $pattern;
            $params[':q_maker'] = $pattern;
            $params[':q_series'] = $pattern;
        }
        return [$where, $params];
    }

    private function cidMatchesDatabaseFilters(PDO $pdo, string $cid, array $filters): bool
    {
        [$where, $params] = $this->databaseWhere($filters);
        $stmt = $pdo->prepare(
            'SELECT 1 FROM works w WHERE w.cid = :direct_cid AND ' . implode(' AND ', $where) . ' LIMIT 1'
        );
        $stmt->execute([...$params, ':direct_cid' => $cid]);
        return (bool)$stmt->fetchColumn();
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
        ];
    }

    private function matches(array $item, array $filters): bool
    {
        if ((int)$item['sampleCount'] < $filters['minSamples']) {
            return false;
        }
        if ((int)$item['reviews'] < $filters['minReviews']) {
            return false;
        }
        if ((float)$item['rating'] < $filters['minRating']) {
            return false;
        }
        $priceValue = PriceParser::singleValue((string)$item['price']);
        if ($filters['minPrice'] > 0 && ($priceValue === null || $priceValue < $filters['minPrice'])) {
            return false;
        }
        if ($filters['maxPrice'] > 0 && ($priceValue === null || $priceValue > $filters['maxPrice'])) {
            return false;
        }
        if ($filters['query'] !== '') {
            $haystack = mb_strtolower(implode(' ', [
                (string)($item['title'] ?? ''),
                (string)($item['maker'] ?? ''),
                implode(' ', array_map(
                    static fn(array $series): string => (string)($series['name'] ?? ''),
                    (array)($item['seriesRows'] ?? []),
                )),
            ]));
            if (!str_contains($haystack, mb_strtolower((string)$filters['query']))) {
                return false;
            }
        }
        return true;
    }

    private function stripInternalFields(array $item): array
    {
        $seriesRows = (array)($item['seriesRows'] ?? []);
        $item['priceValue'] = PriceParser::singleValue((string)($item['price'] ?? ''));
        $item['series'] = array_values(array_filter(array_map(
            static fn(array $series): string => trim((string)($series['name'] ?? '')),
            $seriesRows,
        )));
        unset($item['genreRows'], $item['seriesRows'], $item['productUrl'], $item['description']);
        return $item;
    }

    private function ensureUser(PDO $pdo, string $userId): void
    {
        $stmt = $pdo->prepare(
            'INSERT INTO anonymous_users (id, created_at, last_seen_at) VALUES (?, NOW(), NOW()) '
            . 'ON DUPLICATE KEY UPDATE last_seen_at = NOW()'
        );
        $stmt->execute([$userId]);
    }

    private function safeFloor(bool $required = false): array
    {
        if (!$this->fanza->configured()) {
            if ($required) {
                throw new RuntimeException('FANZA APIが設定されていません。');
            }
            return $this->fanza->fallbackFloor();
        }
        try {
            return $this->fanza->resolveDoujinFloor();
        } catch (Throwable $error) {
            if ($required) {
                throw $error;
            }
            return $this->fanza->fallbackFloor();
        }
    }

    private function requirePdo(): PDO
    {
        $pdo = $this->database->connection();
        if (!$pdo) {
            throw new RuntimeException('データベースへ接続できません。');
        }
        return $pdo;
    }

    private function uuid(): string
    {
        $data = random_bytes(16);
        $data[6] = chr((ord($data[6]) & 0x0f) | 0x40);
        $data[8] = chr((ord($data[8]) & 0x3f) | 0x80);
        return vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex($data), 4));
    }
}
