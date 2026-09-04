<?php

declare(strict_types=1);

namespace SwipePreview;

use PDO;
use RuntimeException;

final class UserLibraryService
{
    public function __construct(private readonly Database $database)
    {
    }

    public function saved(string $anonymousUserId, int $limit = 60): array
    {
        $pdo = $this->database->connection();
        if (!$pdo) {
            throw new RuntimeException('保存済み作品DBが利用できません。');
        }

        $this->ensureUser($pdo, $anonymousUserId);
        $safeLimit = max(1, min(100, $limit));

        $count = $pdo->prepare(
            'SELECT COUNT(*) FROM user_work_states s '
            . 'JOIN works w ON w.cid = s.work_cid '
            . 'WHERE s.anonymous_user_id = ? AND s.saved = 1 AND w.is_active = 1 AND w.sample_count > 0',
        );
        $count->execute([$anonymousUserId]);
        $total = (int)$count->fetchColumn();

        $stmt = $pdo->prepare(
            'SELECT w.cid, w.title, w.affiliate_url, w.sample_images_json, w.sample_count, '
            . 'w.review_count, w.rating, w.price, w.asset_bucket, w.asset_type, w.full_page_count, s.updated_at AS saved_at '
            . 'FROM user_work_states s JOIN works w ON w.cid = s.work_cid '
            . 'WHERE s.anonymous_user_id = ? AND s.saved = 1 AND w.is_active = 1 AND w.sample_count > 0 '
            . 'ORDER BY s.updated_at DESC LIMIT ' . $safeLimit,
        );
        $stmt->execute([$anonymousUserId]);
        $rows = $stmt->fetchAll();
        $genreMap = $this->loadGenres($pdo, array_values(array_map(
            static fn(array $row): string => (string)$row['cid'],
            $rows,
        )));

        $items = [];
        foreach ($rows as $row) {
            $cid = (string)$row['cid'];
            $images = json_decode((string)$row['sample_images_json'], true);
            $images = is_array($images) ? array_values(array_filter($images, 'is_string')) : [];
            $assetType = (string)$row['asset_type'];
            if (!in_array($assetType, ['comic', 'cg', 'game', 'voice', 'other'], true)) {
                $assetType = 'other';
            }
            $items[] = [
                'cid' => $cid,
                'title' => (string)$row['title'],
                'affiliateUrl' => (string)$row['affiliate_url'],
                'images' => $images,
                'sampleCount' => (int)$row['sample_count'],
                'fullPageCount' => isset($row['full_page_count']) ? (int)$row['full_page_count'] : null,
                'reviews' => (int)$row['review_count'],
                'rating' => (float)$row['rating'],
                'genres' => $genreMap[$cid] ?? [],
                'price' => (string)$row['price'],
                'assetBucket' => (string)$row['asset_bucket'],
                'assetType' => $assetType,
                'assetLabel' => FanzaClient::assetLabel($assetType),
                'savedAt' => (string)$row['saved_at'],
            ];
        }

        return ['items' => $items, 'total' => $total];
    }

    public function profile(string $anonymousUserId): array
    {
        $pdo = $this->database->connection();
        if (!$pdo) {
            throw new RuntimeException('プロフィールDBが利用できません。');
        }

        $this->ensureUser($pdo, $anonymousUserId);

        $user = $pdo->prepare('SELECT created_at, last_seen_at FROM anonymous_users WHERE id = ? LIMIT 1');
        $user->execute([$anonymousUserId]);
        $userRow = $user->fetch() ?: [];

        $state = $pdo->prepare(
            'SELECT COALESCE(SUM(liked), 0) AS liked, COALESCE(SUM(saved), 0) AS saved '
            . 'FROM user_work_states WHERE anonymous_user_id = ?',
        );
        $state->execute([$anonymousUserId]);
        $stateRow = $state->fetch() ?: [];

        $events = $pdo->prepare(
            "SELECT COUNT(DISTINCT CASE WHEN event_type = 'impression' THEN work_cid END) AS viewed "
            . 'FROM events WHERE anonymous_user_id = ?',
        );
        $events->execute([$anonymousUserId]);
        $eventRow = $events->fetch() ?: [];

        $genres = $pdo->prepare(
            'SELECT g.id, g.name, u.score FROM user_genre_scores u '
            . 'JOIN genres g ON g.id = u.genre_id '
            . 'WHERE u.anonymous_user_id = ? AND u.score > 0 '
            . 'ORDER BY u.score DESC LIMIT 8',
        );
        $genres->execute([$anonymousUserId]);
        $topGenres = array_map(
            static fn(array $row): array => [
                'id' => (string)$row['id'],
                'name' => (string)$row['name'],
                'score' => round((float)$row['score'], 2),
            ],
            $genres->fetchAll(),
        );

        return [
            'createdAt' => $userRow['created_at'] ?? null,
            'stats' => [
                'saved' => (int)($stateRow['saved'] ?? 0),
                'viewed' => (int)($eventRow['viewed'] ?? 0),
            ],
            'topGenres' => $topGenres,
        ];
    }

    private function ensureUser(PDO $pdo, string $anonymousUserId): void
    {
        $stmt = $pdo->prepare(
            'INSERT INTO anonymous_users (id, created_at, last_seen_at) VALUES (?, NOW(), NOW()) '
            . 'ON DUPLICATE KEY UPDATE last_seen_at = NOW()',
        );
        $stmt->execute([$anonymousUserId]);
    }

    private function loadGenres(PDO $pdo, array $cids): array
    {
        if ($cids === []) {
            return [];
        }
        $placeholders = implode(',', array_fill(0, count($cids), '?'));
        $stmt = $pdo->prepare(
            'SELECT wg.work_cid, g.name FROM work_genres wg '
            . 'JOIN genres g ON g.id = wg.genre_id '
            . 'WHERE wg.work_cid IN (' . $placeholders . ') ORDER BY g.name',
        );
        $stmt->execute($cids);
        $map = [];
        foreach ($stmt->fetchAll() as $row) {
            $map[(string)$row['work_cid']][] = (string)$row['name'];
        }
        return $map;
    }
}
