<?php

declare(strict_types=1);

namespace SwipePreview;

use PDO;
use RuntimeException;
use Throwable;

final class CatalogService
{
    private const LIVE_HITS = 100;
    private const DIAGNOSTIC_MAX_PAGES = 8;

    public function __construct(
        private readonly Database $database,
        private readonly FanzaClient $fanza,
    ) {
    }

    public function catalog(array $filters, int $offset, int $limit, string $cidInput, string $anonymousUserId): array
    {
        $safeOffset = max(1, min(50000, $offset));
        $safeLimit = max(1, min(12, $limit));
        $filters = $this->normalizeFilters($filters);

        if ($this->database->hasUsableCatalog()) {
            $result = $this->catalogFromDatabase($filters, $safeOffset, $safeLimit, $anonymousUserId);
        } else {
            $result = $this->catalogFromApi($filters, $safeOffset, $safeLimit);
        }

        $queryError = '';
        if (trim($cidInput) !== '' && $safeOffset === 1) {
            try {
                $cid = $this->fanza->normalizeCid($cidInput);
                $direct = $this->findDatabaseItem($cid);
                if ($direct === null) {
                    $floor = $this->safeFloor();
                    $direct = $this->stripInternalFields($this->fanza->feedItem($this->fanza->fetchItem($cid, $floor)));
                }
                if (($direct['sampleCount'] ?? 0) < 1) {
                    throw new RuntimeException('指定した作品には sampleImageURL.sample_l.image がありません。');
                }
                $result['items'] = [
                    $direct,
                    ...array_values(array_filter(
                        $result['items'],
                        static fn(array $item): bool => ($item['cid'] ?? '') !== $cid,
                    )),
                ];
            } catch (Throwable $error) {
                $queryError = $error->getMessage();
            }
        }

        $result['floor'] = $this->safeFloor();
        $result['queryError'] = $queryError;
        return $result;
    }

    public function meta(): array
    {
        $floor = $this->safeFloor();
        $genres = [];
        $pdo = $this->database->connection();
        if ($pdo) {
            try {
                $genres = $pdo->query('SELECT id, name, ruby FROM genres ORDER BY COALESCE(NULLIF(ruby, \'\'), name), name')->fetchAll();
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
            'assetTypes' => FanzaClient::assetDefinitions(),
        ];
    }

    public function diagnostics(string $genreId): array
    {
        if ($this->database->hasUsableCatalog()) {
            return $this->diagnosticsFromDatabase(trim($genreId));
        }
        return $this->diagnosticsFromApi(trim($genreId));
    }

    private function catalogFromDatabase(array $filters, int $offset, int $limit, string $anonymousUserId): array
    {
        $pdo = $this->database->connection();
        if (!$pdo) {
            throw new RuntimeException('データベースへ接続できません。');
        }

        [$where, $params] = $this->databaseWhere($filters);
        $countSql = 'SELECT COUNT(*) FROM works w WHERE ' . implode(' AND ', $where);
        $countStmt = $pdo->prepare($countSql);
        $countStmt->execute($params);
        $apiTotal = (int)$countStmt->fetchColumn();

        $candidateTarget = min(1500, max(600, $offset + $limit + 250));
        $popularLimit = (int)ceil($candidateTarget * 0.50);
        $recentLimit = (int)ceil($candidateTarget * 0.30);
        $exploreLimit = max(1, $candidateTarget - $popularLimit - $recentLimit);
        $select = 'SELECT w.cid, w.title, w.affiliate_url, w.sample_images_json, w.sample_count, '
            . 'w.review_count, w.rating, w.price, w.asset_bucket, w.asset_type, w.release_date, w.updated_at '
            . 'FROM works w WHERE ' . implode(' AND ', $where);
        $worksByCid = [];
        $pools = [
            [$select . ' ORDER BY w.review_count DESC, w.rating DESC LIMIT ' . $popularLimit, $params],
            [$select . ' ORDER BY COALESCE(w.release_date, w.updated_at) DESC LIMIT ' . $recentLimit, $params],
            [$select . ' ORDER BY CRC32(CONCAT(w.cid, :candidate_seed)) ASC LIMIT ' . $exploreLimit, [...$params, ':candidate_seed' => gmdate('Y-m-d') . '|' . $anonymousUserId]],
        ];
        foreach ($pools as [$sql, $poolParams]) {
            $stmt = $pdo->prepare($sql);
            $stmt->execute($poolParams);
            foreach ($stmt->fetchAll() as $work) {
                $worksByCid[(string)$work['cid']] = $work;
            }
        }
        $works = array_values($worksByCid);
        if ($works === []) {
            return [
                'items' => [],
                'scanned' => 0,
                'apiTotal' => $apiTotal,
                'effectiveMinSamples' => max(1, (int)$filters['minSamples']),
                'offset' => $offset,
                'nextOffset' => null,
                'hasMore' => false,
                'source' => 'database',
            ];
        }

        $cids = array_column($works, 'cid');
        $genreMap = $this->loadWorkGenres($pdo, $cids);
        $userScores = $this->loadUserGenreScores($pdo, $anonymousUserId);
        $seen = $this->loadRecentlySeen($pdo, $anonymousUserId);
        $daySalt = gmdate('Y-m-d');

        $ranked = [];
        foreach ($works as $work) {
            $cid = (string)$work['cid'];
            $genreRows = $genreMap[$cid] ?? [];
            $genreAffinity = 0.0;
            foreach ($genreRows as $genre) {
                $genreAffinity += (float)($userScores[$genre['id']] ?? 0.0);
            }
            if ($genreRows !== []) {
                $genreAffinity /= sqrt((float)count($genreRows));
            }

            $rating = (float)$work['rating'];
            $reviews = (int)$work['review_count'];
            $ratingScore = max(0.0, min(2.0, ($rating / 5.0) * 2.0));
            $popularityScore = min(2.8, log10((float)$reviews + 1.0) * 0.9);
            $freshnessScore = $this->freshnessScore((string)($work['release_date'] ?: $work['updated_at']));
            $exploreScore = $this->stableRandom($anonymousUserId . '|' . $cid . '|' . $daySalt) * 1.25;
            $seenPenalty = isset($seen[$cid]) ? -3.5 : 0.0;
            $score = $genreAffinity * 0.78 + $ratingScore + $popularityScore + $freshnessScore + $exploreScore + $seenPenalty;

            $ranked[] = [
                'score' => $score,
                'item' => $this->databaseRowToFeedItem($work, $genreRows),
            ];
        }

        usort($ranked, static fn(array $a, array $b): int => $b['score'] <=> $a['score']);
        $start = max(0, $offset - 1);
        $slice = array_slice($ranked, $start, $limit);
        $items = array_map(static fn(array $row): array => $row['item'], $slice);
        $next = $start + count($items) + 1;
        $hasMore = $next <= min($apiTotal, count($ranked));

        return [
            'items' => $items,
            'scanned' => count($works),
            'apiTotal' => $apiTotal,
            'effectiveMinSamples' => max(1, (int)$filters['minSamples']),
            'offset' => $offset,
            'nextOffset' => $hasMore ? $next : null,
            'hasMore' => $hasMore,
            'source' => 'database',
        ];
    }

    private function catalogFromApi(array $filters, int $offset, int $limit): array
    {
        $floor = $this->safeFloor(true);
        $effectiveMinSamples = max(1, (int)$filters['minSamples']);
        $page = $this->fanza->fetchItemPage($floor, $offset, (string)$filters['genreId'], 'review', self::LIVE_HITS);
        $items = [];
        $lastConsumedIndex = -1;
        foreach ($page['items'] as $index => $rawItem) {
            $item = $this->fanza->feedItem($rawItem);
            if (!$this->matches($item, $filters, $effectiveMinSamples)) {
                continue;
            }
            $items[] = $this->stripInternalFields($item);
            $lastConsumedIndex = (int)$index;
            if (count($items) >= $limit) {
                break;
            }
        }

        if ($lastConsumedIndex >= 0 && count($items) >= $limit) {
            $candidateNextOffset = $offset + $lastConsumedIndex + 1;
        } else {
            $candidateNextOffset = $offset + count($page['items']);
        }
        $total = (int)$page['total'];
        $hasMore = count($page['items']) > 0
            && ($total > 0 ? $candidateNextOffset <= $total : count($page['items']) >= self::LIVE_HITS);

        return [
            'items' => $items,
            'scanned' => count($page['items']),
            'apiTotal' => $total,
            'effectiveMinSamples' => $effectiveMinSamples,
            'offset' => $offset,
            'nextOffset' => $hasMore ? $candidateNextOffset : null,
            'hasMore' => $hasMore,
            'source' => 'fanza-api',
        ];
    }

    private function findDatabaseItem(string $cid): ?array
    {
        $pdo = $this->database->connection();
        if (!$pdo) {
            return null;
        }
        try {
            $stmt = $pdo->prepare('SELECT w.cid, w.title, w.affiliate_url, w.sample_images_json, w.sample_count, w.review_count, w.rating, w.price, w.asset_bucket, w.asset_type, w.release_date, w.updated_at FROM works w WHERE w.cid = ? LIMIT 1');
            $stmt->execute([$cid]);
            $work = $stmt->fetch();
            if (!is_array($work)) {
                return null;
            }
            $genres = $this->loadWorkGenres($pdo, [$cid]);
            return $this->databaseRowToFeedItem($work, $genres[$cid] ?? []);
        } catch (Throwable) {
            return null;
        }
    }

    private function databaseRowToFeedItem(array $work, array $genreRows): array
    {
        $images = json_decode((string)$work['sample_images_json'], true);
        if (!is_array($images)) {
            $images = [];
        }
        $assetType = (string)$work['asset_type'];
        if (!in_array($assetType, ['comic', 'cg', 'game', 'voice', 'other'], true)) {
            $assetType = 'other';
        }
        return [
            'cid' => (string)$work['cid'],
            'title' => (string)$work['title'],
            'affiliateUrl' => (string)$work['affiliate_url'],
            'images' => array_values(array_filter($images, 'is_string')),
            'sampleCount' => (int)$work['sample_count'],
            'reviews' => (int)$work['review_count'],
            'rating' => (float)$work['rating'],
            'genres' => array_values(array_map(static fn(array $genre): string => (string)$genre['name'], $genreRows)),
            'price' => (string)$work['price'],
            'assetBucket' => (string)$work['asset_bucket'],
            'assetType' => $assetType,
            'assetLabel' => FanzaClient::assetLabel($assetType),
        ];
    }

    private function loadWorkGenres(PDO $pdo, array $cids): array
    {
        if ($cids === []) {
            return [];
        }
        $placeholders = implode(',', array_fill(0, count($cids), '?'));
        $stmt = $pdo->prepare(
            'SELECT wg.work_cid, g.id, g.name FROM work_genres wg JOIN genres g ON g.id = wg.genre_id WHERE wg.work_cid IN (' . $placeholders . ')',
        );
        $stmt->execute(array_values($cids));
        $map = [];
        foreach ($stmt->fetchAll() as $row) {
            $cid = (string)$row['work_cid'];
            $map[$cid][] = ['id' => (string)$row['id'], 'name' => (string)$row['name']];
        }
        return $map;
    }

    private function loadUserGenreScores(PDO $pdo, string $anonymousUserId): array
    {
        if ($anonymousUserId === '') {
            return [];
        }
        try {
            $stmt = $pdo->prepare('SELECT genre_id, score FROM user_genre_scores WHERE anonymous_user_id = ?');
            $stmt->execute([$anonymousUserId]);
            $scores = [];
            foreach ($stmt->fetchAll() as $row) {
                $scores[(string)$row['genre_id']] = (float)$row['score'];
            }
            return $scores;
        } catch (Throwable) {
            return [];
        }
    }

    private function loadRecentlySeen(PDO $pdo, string $anonymousUserId): array
    {
        if ($anonymousUserId === '') {
            return [];
        }
        try {
            $stmt = $pdo->prepare(
                "SELECT work_cid, MAX(created_at) AS last_seen FROM events WHERE anonymous_user_id = ? AND event_type = 'impression' AND created_at >= DATE_SUB(NOW(), INTERVAL 14 DAY) GROUP BY work_cid ORDER BY last_seen DESC LIMIT 500",
            );
            $stmt->execute([$anonymousUserId]);
            $seen = [];
            foreach ($stmt->fetchAll() as $row) {
                $seen[(string)$row['work_cid']] = true;
            }
            return $seen;
        } catch (Throwable) {
            return [];
        }
    }

    private function databaseWhere(array $filters): array
    {
        $where = ['w.sample_count >= :min_samples', 'w.review_count >= :min_reviews', 'w.rating >= :min_rating', 'w.is_active = 1'];
        $params = [
            ':min_samples' => max(1, (int)$filters['minSamples']),
            ':min_reviews' => (int)$filters['minReviews'],
            ':min_rating' => (float)$filters['minRating'],
        ];
        if ($filters['assetType'] !== 'all') {
            $where[] = 'w.asset_type = :asset_type';
            $params[':asset_type'] = $filters['assetType'];
        }
        if ($filters['genreId'] !== '') {
            $where[] = 'EXISTS (SELECT 1 FROM work_genres wg_filter WHERE wg_filter.work_cid = w.cid AND wg_filter.genre_id = :genre_id)';
            $params[':genre_id'] = $filters['genreId'];
        }
        return [$where, $params];
    }

    private function diagnosticsFromDatabase(string $genreId): array
    {
        $pdo = $this->database->connection();
        if (!$pdo) {
            throw new RuntimeException('データベースへ接続できません。');
        }
        $where = ['w.is_active = 1'];
        $params = [];
        if ($genreId !== '') {
            $where[] = 'EXISTS (SELECT 1 FROM work_genres wg_filter WHERE wg_filter.work_cid = w.cid AND wg_filter.genre_id = :genre_id)';
            $params[':genre_id'] = $genreId;
        }
        $stmt = $pdo->prepare('SELECT w.sample_count, w.asset_type, w.asset_bucket FROM works w WHERE ' . implode(' AND ', $where));
        $stmt->execute($params);
        $stats = $this->emptyStats();
        $scanned = 0;
        while (($row = $stmt->fetch()) !== false) {
            $scanned++;
            $this->incrementStats($stats, (string)$row['asset_type'], (string)$row['asset_bucket'], (int)$row['sample_count']);
        }
        return ['scanned' => $scanned, 'apiTotal' => $scanned, 'stats' => $stats];
    }

    private function diagnosticsFromApi(string $genreId): array
    {
        $floor = $this->safeFloor(true);
        $stats = $this->emptyStats();
        $seen = [];
        $scanned = 0;
        $apiTotal = 0;
        for ($pageIndex = 0; $pageIndex < self::DIAGNOSTIC_MAX_PAGES; $pageIndex++) {
            $offset = 1 + $pageIndex * self::LIVE_HITS;
            $page = $this->fanza->fetchItemPage($floor, $offset, $genreId, 'review', self::LIVE_HITS);
            if ($pageIndex === 0) {
                $apiTotal = (int)$page['total'];
            }
            if ($page['items'] === []) {
                break;
            }
            $scanned += count($page['items']);
            foreach ($page['items'] as $rawItem) {
                $item = $this->fanza->feedItem($rawItem);
                $cid = (string)$item['cid'];
                if ($cid === '' || isset($seen[$cid])) {
                    continue;
                }
                $seen[$cid] = true;
                $this->incrementStats($stats, (string)$item['assetType'], (string)$item['assetBucket'], (int)$item['sampleCount']);
            }
            if (count($page['items']) < self::LIVE_HITS || (int)$page['resultCount'] < self::LIVE_HITS) {
                break;
            }
            usleep(120000);
        }
        return ['scanned' => $scanned, 'apiTotal' => $apiTotal, 'stats' => $stats];
    }

    private function emptyStats(): array
    {
        $row = static fn(): array => ['total' => 0, 'zero' => 0, 'oneToFour' => 0, 'fiveToNine' => 0, 'tenPlus' => 0];
        return [
            'all' => $row(),
            'comic' => $row(),
            'cg' => $row(),
            'game' => $row(),
            'voice' => $row(),
            'other' => $row(),
            'rawBuckets' => [],
        ];
    }

    private function incrementStats(array &$stats, string $assetType, string $assetBucket, int $sampleCount): void
    {
        if (!isset($stats[$assetType])) {
            $assetType = 'other';
        }
        foreach (['all', $assetType] as $key) {
            $stats[$key]['total']++;
            if ($sampleCount === 0) {
                $stats[$key]['zero']++;
            } elseif ($sampleCount <= 4) {
                $stats[$key]['oneToFour']++;
            } elseif ($sampleCount <= 9) {
                $stats[$key]['fiveToNine']++;
            } else {
                $stats[$key]['tenPlus']++;
            }
        }
        if ($assetType === 'other') {
            $stats['rawBuckets'][$assetBucket] = ($stats['rawBuckets'][$assetBucket] ?? 0) + 1;
        }
    }

    private function normalizeFilters(array $filters): array
    {
        $assetTypes = ['all', 'comic', 'cg', 'game', 'voice', 'other'];
        $assetType = (string)($filters['assetType'] ?? 'all');
        return [
            'minSamples' => max(0, min(100, (int)($filters['minSamples'] ?? 10))),
            'minReviews' => max(0, min(100000, (int)($filters['minReviews'] ?? 10))),
            'minRating' => max(0.0, min(5.0, (float)($filters['minRating'] ?? 4.5))),
            'assetType' => in_array($assetType, $assetTypes, true) ? $assetType : 'all',
            'genreId' => trim((string)($filters['genreId'] ?? '')),
        ];
    }

    private function matches(array $item, array $filters, int $effectiveMinSamples): bool
    {
        if (($item['sampleCount'] ?? 0) < $effectiveMinSamples) {
            return false;
        }
        if (($item['reviews'] ?? 0) < $filters['minReviews']) {
            return false;
        }
        if (($item['rating'] ?? 0.0) < $filters['minRating']) {
            return false;
        }
        return $filters['assetType'] === 'all' || ($item['assetType'] ?? '') === $filters['assetType'];
    }

    private function stripInternalFields(array $item): array
    {
        unset($item['genreRows'], $item['releaseDate'], $item['maker']);
        return $item;
    }

    private function safeFloor(bool $requireConfiguredApi = false): array
    {
        if ($requireConfiguredApi && !$this->fanza->configured()) {
            throw new RuntimeException('作品DBがまだ空で、DMM API設定もありません。config.local.php を設定して同期してください。');
        }
        if ($this->fanza->configured()) {
            try {
                return $this->fanza->resolveDoujinFloor();
            } catch (Throwable $error) {
                if ($requireConfiguredApi) {
                    throw $error;
                }
            }
        }
        return $this->fanza->fallbackFloor();
    }

    private function freshnessScore(string $date): float
    {
        $timestamp = strtotime($date);
        if ($timestamp === false) {
            return 0.0;
        }
        $ageDays = max(0.0, (time() - $timestamp) / 86400.0);
        return max(0.0, 1.3 - min(1.3, $ageDays / 120.0 * 1.3));
    }

    private function stableRandom(string $value): float
    {
        $hex = substr(hash('sha256', $value), 0, 8);
        return hexdec($hex) / 4294967295.0;
    }
}
