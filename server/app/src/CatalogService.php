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
        string $floorKey = 'comic',
    ): array {
        $floorKey = $this->normalizeFloorKey($floorKey);
        $safeCursor = max(0, min(self::MAX_CURSOR, $cursor));
        $safeLimit = max(1, min(12, $limit));
        $filters = $this->normalizeFilters($filters, $floorKey);

        if ($this->database->hasUsableCatalog($floorKey)) {
            return $this->catalogFromDatabase(
                $filters,
                $feedId,
                $safeCursor,
                $safeLimit,
                $cidInput,
                $anonymousUserId,
                $floorKey,
            );
        }

        return $this->catalogFromApi($filters, $safeCursor, $safeLimit, $cidInput, $floorKey);
    }

    public function meta(string $floorKey = 'comic'): array
    {
        $floorKey = $this->normalizeFloorKey($floorKey);
        $floor = $this->safeFloor($floorKey);
        $genres = [];
        $pdo = $this->database->connection();
        if ($pdo) {
            try {
                $stmt = $pdo->prepare(
                    "SELECT DISTINCT g.id, g.name, g.ruby FROM genres g "
                    . "JOIN work_genres wg ON wg.genre_id=g.id JOIN works w ON w.cid=wg.work_cid "
                    . "WHERE w.floor_key=? AND w.is_active=1 ORDER BY COALESCE(NULLIF(g.ruby,''),g.name),g.name"
                );
                $stmt->execute([$floorKey]);
                $genres = $stmt->fetchAll();
            } catch (Throwable) {
                $genres = [];
            }
        }
        if ($genres === [] && $this->fanza->configured() && ($floor['floorId'] ?? '') !== '') {
            $genres = $this->fanza->fetchGenres(
                (string)$floor['floorId'],
                $floorKey === 'comic' ? '' : $floorKey,
            );
        }

        return [
            'floor' => $floor,
            'genres' => $genres,
            'recommenderVersion' => $this->recommenderVersion($floorKey),
        ];
    }

    public function diagnostics(string $genreId, string $floorKey = 'comic'): array
    {
        $floorKey = $this->normalizeFloorKey($floorKey);
        $pdo = $this->database->connection();
        if (!$pdo) {
            throw new RuntimeException('DBが利用できません。');
        }

        $where = ['w.is_active=1', 'w.floor_key=:floor_key'];
        $params = [':floor_key' => $floorKey];
        if ($genreId !== '') {
            $where[] = 'EXISTS (SELECT 1 FROM work_genres wg WHERE wg.work_cid=w.cid AND wg.genre_id=:genre)';
            $params[':genre'] = $genreId;
        }
        $stmt = $pdo->prepare(
            'SELECT COUNT(*) AS total, SUM(sample_count=0) AS zero, '
            . 'SUM(sample_count BETWEEN 1 AND 4) AS one_to_four, '
            . 'SUM(sample_count BETWEEN 5 AND 9) AS five_to_nine, '
            . 'SUM(sample_count>=10) AS ten_plus FROM works w WHERE ' . implode(' AND ', $where)
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
        return ['scanned' => $stats['total'], 'apiTotal' => $stats['total'], 'stats' => [$floorKey => $stats]];
    }

    private function catalogFromDatabase(
        array $filters,
        string $requestedFeedId,
        int $cursor,
        int $limit,
        string $cidInput,
        string $userId,
        string $floorKey,
    ): array {
        $pdo = $this->requirePdo();
        $this->ensureUser($pdo, $userId);
        $filterJson = json_encode([...$filters, 'floorKey' => $floorKey], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        $filterHash = hash('sha256', (string)$filterJson);
        $session = $this->loadSession($pdo, $requestedFeedId, $userId, $filterHash);
        $queryError = '';

        if (!$session) {
            $pdo->prepare('DELETE FROM feed_sessions WHERE expires_at < NOW() LIMIT 500')->execute();
            $feedId = $this->uuid();
            [$where, $params] = $this->databaseWhere($filters, $floorKey);
            $count = $pdo->prepare('SELECT COUNT(*) FROM works w WHERE ' . implode(' AND ', $where));
            $count->execute($params);
            $total = (int)$count->fetchColumn();
            $pivot = (int)sprintf('%u', crc32($userId . '|' . $floorKey . '|' . $feedId . '|' . date('Y-m-d')));
            $insert = $pdo->prepare(
                'INSERT INTO feed_sessions '
                . '(id,anonymous_user_id,filter_hash,filter_json,total_count,generated_count,recommender_version,random_pivot,expires_at) '
                . 'VALUES (?,?,?,?,?,0,?,?,DATE_ADD(NOW(),INTERVAL ' . self::FEED_TTL_HOURS . ' HOUR))'
            );
            $insert->execute([$feedId, $userId, $filterHash, $filterJson, $total, $this->recommenderVersion($floorKey), $pivot]);
            $session = ['id' => $feedId, 'total_count' => $total, 'generated_count' => 0, 'random_pivot' => $pivot];

            if (trim($cidInput) !== '') {
                try {
                    $cid = $this->fanza->normalizeCid($cidInput);
                    $direct = $this->works->feedItemByCid($cid);
                    if (!$direct) {
                        $direct = $this->works->fetchAndUpsert($cid, $floorKey);
                    }
                    if (($direct['floorKey'] ?? 'comic') !== $floorKey) {
                        throw new RuntimeException('指定した作品は現在の表示フロアと異なります。');
                    }
                    if (!$this->displayable($direct, $floorKey)) {
                        throw new RuntimeException('指定した作品に表示可能なサンプルがありません。');
                    }
                    $belongs = $this->cidMatchesDatabaseFilters($pdo, $cid, $filters, $floorKey);
                    $this->insertFeedRows($pdo, $feedId, 0, [['cid' => $cid, 'source' => 'direct', 'score' => 999.0]]);
                    $session['generated_count'] = 1;
                    $session['total_count'] = max(1, $total + ($belongs ? 0 : 1));
                    $pdo->prepare('UPDATE feed_sessions SET generated_count=1,total_count=? WHERE id=?')
                        ->execute([$session['total_count'], $feedId]);
                } catch (Throwable $error) {
                    $queryError = $error->getMessage();
                }
            }
        } else {
            $feedId = (string)$session['id'];
        }

        $needed = $cursor + $limit;
        for ($guard = 0; $guard < 4; $guard++) {
            if ((int)$session['generated_count'] >= $needed || (int)$session['generated_count'] >= (int)$session['total_count']) {
                break;
            }
            if ($this->appendFeedBlock($pdo, $session, $filters, $userId, $floorKey) === 0) {
                $session['total_count'] = (int)$session['generated_count'];
                $pdo->prepare('UPDATE feed_sessions SET total_count=? WHERE id=?')->execute([$session['total_count'], $feedId]);
                break;
            }
        }

        $feedRows = [];
        for ($guard = 0; $guard < 4; $guard++) {
            $stmt = $pdo->prepare(
                'SELECT fi.position,fi.work_cid,fi.source,fi.score FROM feed_items fi '
                . 'JOIN works w ON w.cid=fi.work_cid WHERE fi.feed_id=? AND fi.position>? '
                . 'AND w.is_active=1 AND w.floor_key=? ORDER BY fi.position ASC LIMIT ' . $limit
            );
            $stmt->execute([$feedId, $cursor, $floorKey]);
            $feedRows = $stmt->fetchAll();
            if (count($feedRows) >= $limit || (int)$session['generated_count'] >= (int)$session['total_count']) break;
            if ($this->appendFeedBlock($pdo, $session, $filters, $userId, $floorKey) === 0) break;
        }

        $cids = array_map(static fn(array $row): string => (string)$row['work_cid'], $feedRows);
        $hydrated = $this->works->feedItemsByCids($cids);
        $items = [];
        foreach ($feedRows as $row) {
            $cid = (string)$row['work_cid'];
            $item = $hydrated[$cid] ?? null;
            if (!is_array($item) || !$this->displayable($item, $floorKey)) continue;
            $item['feedId'] = $feedId;
            $item['rank'] = (int)$row['position'];
            $item['recommendationSource'] = (string)$row['source'];
            $items[] = $item;
        }

        $lastPosition = $feedRows === [] ? $cursor : (int)$feedRows[array_key_last($feedRows)]['position'];
        $nextStmt = $pdo->prepare(
            'SELECT 1 FROM feed_items fi JOIN works w ON w.cid=fi.work_cid '
            . 'WHERE fi.feed_id=? AND fi.position>? AND w.is_active=1 AND w.floor_key=? LIMIT 1'
        );
        $nextStmt->execute([$feedId, $lastPosition, $floorKey]);
        $existingNext = (bool)$nextStmt->fetchColumn();
        $hasMore = $existingNext || (int)$session['generated_count'] < (int)$session['total_count'];

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
            'recommenderVersion' => $this->recommenderVersion($floorKey),
            'floor' => $this->safeFloor($floorKey),
        ];
    }

    private function appendFeedBlock(PDO $pdo, array &$session, array $filters, string $userId, string $floorKey): int
    {
        $feedId = (string)$session['id'];
        $pdo->beginTransaction();
        try {
            $lockedStmt = $pdo->prepare('SELECT total_count,generated_count,random_pivot FROM feed_sessions WHERE id=? FOR UPDATE');
            $lockedStmt->execute([$feedId]);
            $locked = $lockedStmt->fetch();
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
            [$where, $params] = $this->databaseWhere($filters, $floorKey);
            $baseWhere = implode(' AND ', $where)
                . ' AND NOT EXISTS (SELECT 1 FROM feed_items fi WHERE fi.feed_id=:feed_id AND fi.work_cid=w.cid)';
            $common = [...$params, ':feed_id' => $feedId];
            $select = 'SELECT w.cid,w.rating,w.review_count,w.release_date,w.updated_at FROM works w WHERE ' . $baseWhere;
            $candidate = [];
            $take = static function (string $sql, array $bind, string $source) use ($pdo, &$candidate): void {
                $stmt = $pdo->prepare($sql);
                $stmt->execute($bind);
                foreach ($stmt->fetchAll() as $row) {
                    $cid = (string)$row['cid'];
                    $candidate[$cid] ??= $row + ['sources' => []];
                    $candidate[$cid]['sources'][$source] = true;
                }
            };
            $take($select . ' ORDER BY w.review_count DESC,w.rating DESC,w.cid ASC LIMIT ' . min(240, max(60, $target)), $common, 'popular');
            $take($select . ' ORDER BY w.release_date DESC,w.cid ASC LIMIT ' . min(180, max(40, $target)), $common, 'recent');
            $exploreParams = [...$common, ':pivot' => (int)$session['random_pivot']];
            $take($select . ' AND w.random_key>=:pivot ORDER BY w.random_key ASC,w.cid ASC LIMIT ' . min(180, max(40, $target)), $exploreParams, 'explore');
            if (count($candidate) < $target) {
                $take($select . ' AND w.random_key<:pivot ORDER BY w.random_key ASC,w.cid ASC LIMIT ' . min(180, max(40, $target)), $exploreParams, 'explore');
            }
            if ($candidate === []) {
                $pdo->commit();
                return 0;
            }

            $genreMap = $this->loadGenreIds($pdo, array_keys($candidate));
            $scores = $this->loadUserGenreScores($pdo, $userId);
            $seen = $this->loadRecentlySeen($pdo, $userId);
            $bySource = ['popular' => [], 'recent' => [], 'explore' => []];
            foreach ($candidate as $cid => $row) {
                $score = $this->boundedAffinity($genreMap[$cid] ?? [], $scores, time())
                    + max(0.0, min(2.0, ((float)$row['rating'] / 5.0) * 2.0))
                    + min(2.8, log10((float)$row['review_count'] + 1.0) * .9)
                    + $this->freshnessScore((string)($row['release_date'] ?: $row['updated_at']))
                    + $this->stableRandom($feedId . '|' . $cid) * 1.25
                    + (isset($seen[$cid]) ? -3.5 : 0.0);
                foreach (array_keys((array)$row['sources']) as $source) $bySource[$source][] = [$cid, $score];
            }
            foreach ($bySource as &$rows) usort($rows, static fn(array $a, array $b): int => $b[1] <=> $a[1] ?: strcmp($a[0], $b[0]));
            unset($rows);

            $quotas = ['popular' => (int)ceil($target * .5), 'recent' => (int)ceil($target * .25)];
            $quotas['explore'] = max(0, $target - $quotas['popular'] - $quotas['recent']);
            $selected = [];
            $used = [];
            foreach (['popular', 'recent', 'explore'] as $source) {
                $taken = 0;
                foreach ($bySource[$source] as [$cid, $score]) {
                    if (isset($used[$cid])) continue;
                    $selected[] = ['cid' => $cid, 'source' => $source, 'score' => $score];
                    $used[$cid] = true;
                    if (++$taken >= $quotas[$source]) break;
                }
            }
            if (count($selected) < $target) {
                $flat = [];
                foreach ($bySource as $source => $rows) foreach ($rows as [$cid, $score]) $flat[] = [$cid, $score, $source];
                usort($flat, static fn(array $a, array $b): int => $b[1] <=> $a[1] ?: strcmp($a[0], $b[0]));
                foreach ($flat as [$cid, $score, $source]) {
                    if (isset($used[$cid])) continue;
                    $selected[] = ['cid' => $cid, 'source' => $source, 'score' => $score];
                    $used[$cid] = true;
                    if (count($selected) >= $target) break;
                }
            }

            $start = (int)$session['generated_count'];
            $added = $this->insertFeedRows($pdo, $feedId, $start, $selected);
            if ($added > 0) {
                $session['generated_count'] = $start + $added;
                $pdo->prepare('UPDATE feed_sessions SET generated_count=?,updated_at=NOW() WHERE id=?')
                    ->execute([$session['generated_count'], $feedId]);
            }
            $pdo->commit();
            return $added;
        } catch (Throwable $error) {
            if ($pdo->inTransaction()) $pdo->rollBack();
            throw $error;
        }
    }

    private function insertFeedRows(PDO $pdo, string $feedId, int $start, array $rows): int
    {
        $stmt = $pdo->prepare('INSERT IGNORE INTO feed_items (feed_id,position,work_cid,source,score) VALUES (?,?,?,?,?)');
        $position = $start;
        $added = 0;
        foreach ($rows as $row) {
            $stmt->execute([$feedId, ++$position, (string)$row['cid'], (string)$row['source'], (float)$row['score']]);
            if ($stmt->rowCount() > 0) $added++;
        }
        return $added;
    }

    private function loadSession(PDO $pdo, string $feedId, string $userId, string $filterHash): ?array
    {
        if (preg_match('/^[a-f0-9-]{36}$/i', $feedId) !== 1) return null;
        $stmt = $pdo->prepare('SELECT * FROM feed_sessions WHERE id=? AND anonymous_user_id=? AND filter_hash=? AND expires_at>NOW() LIMIT 1');
        $stmt->execute([$feedId, $userId, $filterHash]);
        $row = $stmt->fetch();
        return is_array($row) ? $row : null;
    }

    private function catalogFromApi(array $filters, int $cursor, int $limit, string $cidInput, string $floorKey): array
    {
        $floor = $this->safeFloor($floorKey, true);
        $items = [];
        $consumed = 0;
        $apiTotal = 0;
        $sourceExhausted = false;

        for ($pageIndex = 0; $pageIndex < self::LIVE_MAX_PAGES && count($items) < $limit; $pageIndex++) {
            $offset = min(50000, $cursor + $consumed + 1);
            $page = $this->fanza->fetchItemPage($floor, $offset, (string)$filters['genreId'], 'review', self::LIVE_HITS);
            $apiTotal = max($apiTotal, (int)$page['total']);
            if ($page['items'] === []) {
                $sourceExhausted = true;
                break;
            }
            $stoppedInsidePage = false;
            foreach ($page['items'] as $raw) {
                $consumed++;
                if ($floorKey === 'comic' && !$this->fanza->isComicItem($raw)) continue;
                try {
                    $item = $this->fanza->feedItem($raw, $floorKey);
                } catch (Throwable) {
                    continue;
                }
                if (!$this->matches($item, $filters, $floorKey)) continue;
                $items[] = $this->stripInternalFields($item);
                if (count($items) >= $limit) {
                    $stoppedInsidePage = true;
                    break;
                }
            }
            if ($stoppedInsidePage) break;
            if ((int)$page['resultCount'] < self::LIVE_HITS) {
                $sourceExhausted = true;
                break;
            }
        }

        if ($cursor === 0 && trim($cidInput) !== '') {
            try {
                $raw = $this->fanza->fetchItem($this->fanza->normalizeCid($cidInput), $floor);
                $direct = $this->stripInternalFields($this->fanza->feedItem($raw, $floorKey));
                $items = [$direct, ...array_values(array_filter($items, static fn(array $item): bool => $item['cid'] !== $direct['cid']))];
                $items = array_slice($items, 0, $limit);
            } catch (Throwable) {
                // ライブフォールバック時は直接CIDだけの失敗で全体を止めない。
            }
        }

        $next = $cursor + $consumed;
        $hasMore = !$sourceExhausted && $consumed > 0 && ($apiTotal === 0 || $next < $apiTotal) && $next < 50000;
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
            'recommenderVersion' => 'live-fallback-' . $floorKey,
            'floor' => $floor,
        ];
    }

    private function databaseWhere(array $filters, string $floorKey): array
    {
        $where = ['w.floor_key=:floor_key', 'w.review_count>=:min_reviews', 'w.rating>=:min_rating', 'w.is_active=1'];
        $params = [':floor_key' => $floorKey, ':min_reviews' => (int)$filters['minReviews'], ':min_rating' => (float)$filters['minRating']];
        if ($floorKey === 'amateur') {
            $where[] = "w.sample_movie_url IS NOT NULL AND w.sample_movie_url<>''";
        } else {
            $where[] = 'w.sample_count>=:min_samples';
            $params[':min_samples'] = (int)$filters['minSamples'];
        }
        if ($filters['minPrice'] > 0) {
            $where[] = 'w.price_value>=:min_price';
            $params[':min_price'] = (int)$filters['minPrice'];
        }
        if ($filters['maxPrice'] > 0) {
            $where[] = 'w.price_value<=:max_price';
            $params[':max_price'] = (int)$filters['maxPrice'];
        }
        if ($filters['genreId'] !== '') {
            $where[] = 'EXISTS (SELECT 1 FROM work_genres wg WHERE wg.work_cid=w.cid AND wg.genre_id=:genre)';
            $params[':genre'] = (string)$filters['genreId'];
        }
        if ($filters['query'] !== '') {
            $where[] = '(w.title LIKE :q_title ESCAPE \'=\' OR w.maker LIKE :q_maker ESCAPE \'=\' '
                . 'OR EXISTS (SELECT 1 FROM work_series ws JOIN series s ON s.id=ws.series_id WHERE ws.work_cid=w.cid AND s.name LIKE :q_series ESCAPE \'=\'))';
            $escaped = str_replace(['=', '%', '_'], ['==', '=%', '=_'], (string)$filters['query']);
            $pattern = '%' . $escaped . '%';
            $params[':q_title'] = $pattern;
            $params[':q_maker'] = $pattern;
            $params[':q_series'] = $pattern;
        }
        return [$where, $params];
    }

    private function cidMatchesDatabaseFilters(PDO $pdo, string $cid, array $filters, string $floorKey): bool
    {
        [$where, $params] = $this->databaseWhere($filters, $floorKey);
        $stmt = $pdo->prepare('SELECT 1 FROM works w WHERE w.cid=:direct_cid AND ' . implode(' AND ', $where) . ' LIMIT 1');
        $stmt->execute([...$params, ':direct_cid' => $cid]);
        return (bool)$stmt->fetchColumn();
    }

    private function normalizeFilters(array $filters, string $floorKey): array
    {
        $minPrice = max(0, min(10000000, (int)($filters['minPrice'] ?? 0)));
        $maxPrice = max(0, min(10000000, (int)($filters['maxPrice'] ?? 0)));
        if ($minPrice > 0 && $maxPrice > 0 && $minPrice > $maxPrice) [$minPrice, $maxPrice] = [$maxPrice, $minPrice];
        return [
            'minSamples' => $floorKey === 'amateur' ? 1 : max(1, min(100, (int)($filters['minSamples'] ?? 1))),
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
        if ($cids === []) return [];
        $placeholders = implode(',', array_fill(0, count($cids), '?'));
        $stmt = $pdo->prepare("SELECT work_cid,genre_id FROM work_genres WHERE work_cid IN ({$placeholders})");
        $stmt->execute($cids);
        $map = [];
        foreach ($stmt->fetchAll() as $row) $map[(string)$row['work_cid']][] = (string)$row['genre_id'];
        return $map;
    }

    private function loadUserGenreScores(PDO $pdo, string $userId): array
    {
        $stmt = $pdo->prepare('SELECT genre_id,score,updated_at FROM user_genre_scores WHERE anonymous_user_id=?');
        $stmt->execute([$userId]);
        $map = [];
        foreach ($stmt->fetchAll() as $row) $map[(string)$row['genre_id']] = ['score' => (float)$row['score'], 'updated' => (string)$row['updated_at']];
        return $map;
    }

    private function loadRecentlySeen(PDO $pdo, string $userId): array
    {
        $stmt = $pdo->prepare(
            "SELECT work_cid,MAX(created_at) AS last_seen FROM events WHERE anonymous_user_id=? "
            . "AND event_type='work_impression' AND created_at>=DATE_SUB(NOW(),INTERVAL 14 DAY) GROUP BY work_cid ORDER BY last_seen DESC LIMIT 1000"
        );
        $stmt->execute([$userId]);
        $seen = [];
        foreach ($stmt->fetchAll() as $row) $seen[(string)$row['work_cid']] = true;
        return $seen;
    }

    private function boundedAffinity(array $genreIds, array $scores, int $now): float
    {
        if ($genreIds === []) return 0.0;
        $sum = 0.0;
        foreach ($genreIds as $id) {
            $row = $scores[$id] ?? null;
            if (!$row) continue;
            $updated = strtotime((string)$row['updated']) ?: $now;
            $ageDays = max(0.0, ($now - $updated) / 86400.0);
            $sum += tanh(((float)$row['score'] * pow(.5, $ageDays / 45.0)) / 8.0);
        }
        return max(-2.5, min(2.5, $sum / sqrt((float)count($genreIds)) * 2.0));
    }

    private function freshnessScore(string $date): float
    {
        $timestamp = strtotime($date);
        if (!$timestamp) return 0.0;
        $days = max(0.0, (time() - $timestamp) / 86400.0);
        return max(0.0, 1.3 * (1.0 - $days / 120.0));
    }

    private function stableRandom(string $seed): float
    {
        return (int)sprintf('%u', crc32($seed)) / 4294967295;
    }

    private function matches(array $item, array $filters, string $floorKey): bool
    {
        if (!$this->displayable($item, $floorKey)) return false;
        if ($floorKey === 'comic' && (int)$item['sampleCount'] < $filters['minSamples']) return false;
        if ((int)$item['reviews'] < $filters['minReviews'] || (float)$item['rating'] < $filters['minRating']) return false;
        $priceValue = PriceParser::singleValue((string)$item['price']);
        if ($filters['minPrice'] > 0 && ($priceValue === null || $priceValue < $filters['minPrice'])) return false;
        if ($filters['maxPrice'] > 0 && ($priceValue === null || $priceValue > $filters['maxPrice'])) return false;
        if ($filters['query'] !== '') {
            $haystack = mb_strtolower(implode(' ', [
                (string)($item['title'] ?? ''),
                (string)($item['maker'] ?? ''),
                implode(' ', array_map(static fn(array $series): string => (string)($series['name'] ?? ''), (array)($item['seriesRows'] ?? []))),
            ]));
            if (!str_contains($haystack, mb_strtolower((string)$filters['query']))) return false;
        }
        return true;
    }

    private function displayable(array $item, string $floorKey): bool
    {
        if (($item['available'] ?? true) === false || ($item['floorKey'] ?? 'comic') !== $floorKey) return false;
        if ($floorKey === 'amateur') return preg_match('~^https?://~i', (string)($item['sampleMovieUrl'] ?? '')) === 1;
        return (int)($item['sampleCount'] ?? 0) >= 1;
    }

    private function stripInternalFields(array $item): array
    {
        $seriesRows = (array)($item['seriesRows'] ?? []);
        $item['priceValue'] = PriceParser::singleValue((string)($item['price'] ?? ''));
        $item['series'] = array_values(array_filter(array_map(static fn(array $series): string => trim((string)($series['name'] ?? '')), $seriesRows)));
        unset($item['genreRows'], $item['seriesRows'], $item['productUrl'], $item['description']);
        return $item;
    }

    private function ensureUser(PDO $pdo, string $userId): void
    {
        $stmt = $pdo->prepare('INSERT INTO anonymous_users (id,created_at,last_seen_at) VALUES (?,NOW(),NOW()) ON DUPLICATE KEY UPDATE last_seen_at=NOW()');
        $stmt->execute([$userId]);
    }

    private function normalizeFloorKey(string $floorKey): string
    {
        return $floorKey === 'amateur' ? 'amateur' : 'comic';
    }

    private function recommenderVersion(string $floorKey): string
    {
        return $floorKey === 'amateur' ? 'rules-v3.3-amateur' : 'rules-v3.3-comic';
    }

    private function safeFloor(string $floorKey, bool $required = false): array
    {
        if (!$this->fanza->configured()) {
            if ($required) throw new RuntimeException('FANZA APIが設定されていません。');
            return $this->fanza->fallbackFloor($floorKey);
        }
        try {
            return $this->fanza->resolveFloor($floorKey);
        } catch (Throwable $error) {
            if ($required) throw $error;
            return $this->fanza->fallbackFloor($floorKey);
        }
    }

    private function requirePdo(): PDO
    {
        $pdo = $this->database->connection();
        if (!$pdo) throw new RuntimeException('データベースへ接続できません。');
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
