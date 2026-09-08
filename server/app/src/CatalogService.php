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
    private const BLOCK_SIZE = 120;
    private const RECOMMENDER_VERSION = 'rules-v3.2-comic';
    private const MAX_CURSOR = 200000;

    public function __construct(
        private readonly Database $database,
        private readonly FanzaClient $fanza,
        private readonly WorkRepository $works,
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
        $session = $this->loadSession($pdo, $requestedFeedId, $userId, $filterHash);
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
                    $this->insertFeedRows($pdo, $feedId, 0, [[
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
                $pdo->prepare('UPDATE feed_sessions SET total_count = ? WHERE id = ?')
                    ->execute([$session['total_count'], $feedId]);
                break;
            }
        }

        $feedRows = [];
        for ($guard = 0; $guard < 4; $guard++) {
            $stmt = $pdo->prepare(
                'SELECT fi.position, fi.work_cid, fi.source, fi.score '
                . 'FROM feed_items fi JOIN works w ON w.cid = fi.work_cid '
                . 'WHERE fi.feed_id = ? AND fi.position > ? AND w.is_active = 1 '
                . 'ORDER BY fi.position ASC LIMIT ' . $limit
            );
            $stmt->execute([$feedId, $cursor]);
            $feedRows = $stmt->fetchAll();
            if (count($feedRows) >= $limit || (int)$session['generated_count'] >= (int)$session['total_count']) {
                break;
            }
            $added = $this->appendFeedBlock($pdo, $session, $filters, $userId);
            if ($added === 0) {
                $session['total_count'] = (int)$session['generated_count'];
                $pdo->prepare('UPDATE feed_sessions SET total_count = ? WHERE id = ?')
                    ->execute([$session['total_count'], $feedId]);
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
        $existingNext = false;
        if ($feedRows !== []) {
            $nextStmt = $pdo->prepare(
                'SELECT 1 FROM feed_items fi JOIN works w ON w.cid = fi.work_cid '
                . 'WHERE fi.feed_id = ? AND fi.position > ? AND w.is_active = 1 LIMIT 1'
            );
            $nextStmt->execute([$feedId, $lastPosition]);
            $existingNext = (bool)$nextStmt->fetchColumn();
        }
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
            $sessionStmt = $pdo->prepare(
                'SELECT total_count, generated_count, random_pivot FROM feed_sessions WHERE id = ? FOR UPDATE'
            );
            $sessionStmt->execute([$feedId]);
            $locked = $sessionStmt->fetch();
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
            $target = min(self::BLOCK_SIZE, $remaining);

            [$where, $params] = $this->databaseWhere($filters);
            $baseWhere = implode(' AND ', $where)
                . ' AND NOT EXISTS (SELECT 1 FROM feed_items fi WHERE fi.feed_id = :feed_id AND fi.work_cid = w.cid)';
            $common = [...$params, ':feed_id' => $feedId];
            $candidate = [];
            $take = static function (string $sql, array $bind, string $source) use ($pdo, &$candidate): void {
                $stmt = $pdo->prepare($sql);
                $stmt->execute($bind);
                foreach ($stmt->fetchAll() as $row) {
                    $cid = (string)$row['cid'];
                    $candidate[$source][$cid] ??= $row;
                }
            };

            $select = 'SELECT w.cid, w.rating, w.review_count, w.release_date, w.updated_at '
                . 'FROM works w WHERE ' . $baseWhere;
            $take(
                $select . ' ORDER BY w.review_count DESC, w.rating DESC, w.cid ASC LIMIT ' . min(240, max(60, $target)),
                $common,
                'popular'
            );
            $take(
                $select . ' ORDER BY w.release_date DESC, w.cid ASC LIMIT ' . min(180, max(40, $target)),
                $common,
                'recent'
            );

            $pivot = (int)$session['random_pivot'];
            $exploreParams = [...$common, ':pivot' => $pivot];
            $take(
                $select . ' AND w.random_key >= :pivot ORDER BY w.random_key ASC, w.cid ASC LIMIT ' . min(180, max(40, $target)),
                $exploreParams,
                'explore'
            );
            if (count($candidate['explore'] ?? []) < max(30, (int)ceil($target * 0.25))) {
                $take(
                    $select . ' AND w.random_key < :pivot ORDER BY w.random_key ASC, w.cid ASC LIMIT ' . min(180, max(40, $target)),
                    $exploreParams,
                    'explore'
                );
            }

            $all = [];
            foreach ($candidate as $source => $rows) {
                foreach ($rows as $cid => $row) {
                    $all[$cid] ??= $row;
                    $all[$cid]['sources'][] = $source;
                }
            }
            if ($all === []) {
                $pdo->commit();
                return 0;
            }

            $genreMap = $this->loadGenreIds($pdo, array_keys($all));
            $scores = $this->loadUserGenreScores($pdo, $userId);
            $seen = $this->loadRecentlySeen($pdo, $userId);
            $now = time();
            $bySource = ['popular' => [], 'recent' => [], 'explore' => []];

            foreach ($all as $cid => $row) {
                $affinity = $this->boundedAffinity($genreMap[$cid] ?? [], $scores, $now);
                $rating = max(0.0, min(2.0, ((float)$row['rating'] / 5.0) * 2.0));
                $popularity = min(2.8, log10((float)$row['review_count'] + 1.0) * 0.9);
                $freshness = $this->freshnessScore((string)($row['release_date'] ?: $row['updated_at']));
                $explore = $this->stableRandom($feedId . '|' . $cid) * 1.25;
                $seenPenalty = isset($seen[$cid]) ? -3.5 : 0.0;
                $score = $affinity + $rating + $popularity + $freshness + $explore + $seenPenalty;
                foreach ($row['sources'] as $source) {
                    $bySource[$source][] = [$cid, $score];
                }
            }

            foreach ($bySource as &$rows) {
                usort($rows, static fn(array $a, array $b): int => $b[1] <=> $a[1] ?: strcmp($a[0], $b[0]));
            }
            unset($rows);

            $popularQuota = (int)ceil($target * 0.50);
            $recentQuota = (int)ceil($target * 0.25);
            $quotas = [
                'popular' => $popularQuota,
                'recent' => $recentQuota,
                'explore' => max(0, $target - $popularQuota - $recentQuota),
            ];
            $selected = [];
            $used = [];
            foreach (['popular', 'recent', 'explore'] as $source) {
                $selectedForSource = 0;
                foreach ($bySource[$source] as [$cid, $score]) {
                    if (isset($used[$cid])) {
                        continue;
                    }
                    $selected[] = ['cid' => $cid, 'source' => $source, 'score' => $score];
                    $used[$cid] = true;
                    $selectedForSource++;
                    if ($selectedForSource >= $quotas[$source]) {
                        break;
                    }
                }
            }

            if (count($selected) < $target) {
                $flat = [];
                foreach ($bySource as $source => $rows) {
                    foreach ($rows as [$cid, $score]) {
                        if (!isset($used[$cid])) {
                            $flat[] = [$cid, $score, $source];
                        }
                    }
                }
                usort($flat, static fn(array $a, array $b): int => $b[1] <=> $a[1] ?: strcmp($a[0], $b[0]));
                foreach ($flat as [$cid, $score, $source]) {
                    if (isset($used[$cid])) {
                        continue;
                    }
                    $selected[] = ['cid' => $cid, 'source' => $source, 'score' => $score];
                    $used[$cid] = true;
                    if (count($selected) >= $target) {
                        break;
                    }
                }
            }

            if (count($selected) < $target) {
                $needed = $target - count($selected);
                $fill = $pdo->prepare(
                    $select . ' ORDER BY w.random_key ASC, w.cid ASC LIMIT ' . min(500, max(1, $needed * 3))
                );
                $fill->execute($common);
                foreach ($fill->fetchAll() as $row) {
                    $cid = (string)$row['cid'];
                    if (isset($used[$cid])) {
                        continue;
                    }
                    $selected[] = ['cid' => $cid, 'source' => 'explore', 'score' => 0.0];
                    $used[$cid] = true;
                    if (count($selected) >= $target) {
                        break;
                    }
                }
            }

            if ($selected === []) {
                $pdo->commit();
                return 0;
            }

            $start = (int)$session['generated_count'];
            $added = $this->insertFeedRows($pdo, $feedId, $start, $selected);
            if ($added > 0) {
                $session['generated_count'] = $start + $added;
                $pdo->prepare(
                    'UPDATE feed_sessions SET generated_count = ?, updated_at = NOW() WHERE id = ?'
                )->execute([$session['generated_count'], $feedId]);
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

    private function insertFeedRows(PDO $pdo, string $feedId, int $start, array $rows): int
    {
        $stmt = $pdo->prepare(
            'INSERT IGNORE INTO feed_items (feed_id, position, work_cid, source, score) VALUES (?, ?, ?, ?, ?)'
        );
        $position = $start;
        $added = 0;
        foreach ($rows as $row) {
            $position++;
            $stmt->execute([
                $feedId,
                $position,
                (string)$row['cid'],
                (string)$row['source'],
                (float)$row['score'],
            ]);
            if ($stmt->rowCount() > 0) {
                $added++;
            }
        }
        return $added;
    }

    private function loadSession(PDO $pdo, string $feedId, string $userId, string $filterHash): ?array
    {
        if (preg_match('/^[a-f0-9-]{36}$/i', $feedId) !== 1) {
            return null;
        }
        $stmt = $pdo->prepare(
            'SELECT * FROM feed_sessions '
            . 'WHERE id = ? AND anonymous_user_id = ? AND filter_hash = ? AND expires_at > NOW() LIMIT 1'
        );
        $stmt->execute([$feedId, $userId, $filterHash]);
        $row = $stmt->fetch();
        return is_array($row) ? $row : null;
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
                    break;
                }
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

    private function loadGenreIds(PDO $pdo, array $cids): array
    {
        if ($cids === []) {
            return [];
        }
        $placeholders = implode(',', array_fill(0, count($cids), '?'));
        $stmt = $pdo->prepare(
            "SELECT work_cid, genre_id FROM work_genres WHERE work_cid IN ({$placeholders})"
        );
        $stmt->execute($cids);
        $map = [];
        foreach ($stmt->fetchAll() as $row) {
            $map[(string)$row['work_cid']][] = (string)$row['genre_id'];
        }
        return $map;
    }

    private function loadUserGenreScores(PDO $pdo, string $userId): array
    {
        $stmt = $pdo->prepare(
            'SELECT genre_id, score, updated_at FROM user_genre_scores WHERE anonymous_user_id = ?'
        );
        $stmt->execute([$userId]);
        $map = [];
        foreach ($stmt->fetchAll() as $row) {
            $map[(string)$row['genre_id']] = [
                'score' => (float)$row['score'],
                'updated' => (string)$row['updated_at'],
            ];
        }
        return $map;
    }

    private function loadRecentlySeen(PDO $pdo, string $userId): array
    {
        $stmt = $pdo->prepare(
            "SELECT work_cid, MAX(created_at) AS last_seen FROM events "
            . "WHERE anonymous_user_id = ? AND event_type = 'work_impression' "
            . 'AND created_at >= DATE_SUB(NOW(), INTERVAL 14 DAY) '
            . 'GROUP BY work_cid ORDER BY last_seen DESC LIMIT 1000'
        );
        $stmt->execute([$userId]);
        $seen = [];
        foreach ($stmt->fetchAll() as $row) {
            $seen[(string)$row['work_cid']] = true;
        }
        return $seen;
    }

    private function boundedAffinity(array $genreIds, array $scores, int $now): float
    {
        if ($genreIds === []) {
            return 0.0;
        }
        $sum = 0.0;
        foreach ($genreIds as $id) {
            $row = $scores[$id] ?? null;
            if (!$row) {
                continue;
            }
            $updated = strtotime((string)$row['updated']) ?: $now;
            $ageDays = max(0.0, ($now - $updated) / 86400.0);
            $decayed = (float)$row['score'] * pow(0.5, $ageDays / 45.0);
            $sum += tanh($decayed / 8.0);
        }
        return max(-2.5, min(2.5, $sum / sqrt((float)count($genreIds)) * 2.0));
    }

    private function freshnessScore(string $date): float
    {
        $timestamp = strtotime($date);
        if (!$timestamp) {
            return 0.0;
        }
        $days = max(0.0, (time() - $timestamp) / 86400.0);
        return max(0.0, 1.3 * (1.0 - $days / 120.0));
    }

    private function stableRandom(string $seed): float
    {
        return (int)sprintf('%u', crc32($seed)) / 4294967295;
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
