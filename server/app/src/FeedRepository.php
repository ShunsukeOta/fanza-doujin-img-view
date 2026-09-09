<?php

declare(strict_types=1);

namespace SwipePreview;

use PDO;

final class FeedRepository
{
    public function loadSession(PDO $pdo, string $feedId, string $userId, string $filterHash, string $version): ?array
    {
        if (preg_match('/^[a-f0-9-]{36}$/i', $feedId) !== 1) {
            return null;
        }
        $stmt = $pdo->prepare(
            'SELECT * FROM feed_sessions '
            . 'WHERE id = ? AND anonymous_user_id = ? AND filter_hash = ? '
            . 'AND recommender_version = ? AND expires_at > NOW() LIMIT 1'
        );
        $stmt->execute([$feedId, $userId, $filterHash, $version]);
        $row = $stmt->fetch();
        return is_array($row) ? $row : null;
    }

    public function lockSession(PDO $pdo, string $feedId): ?array
    {
        $stmt = $pdo->prepare(
            'SELECT total_count, generated_count, random_pivot FROM feed_sessions WHERE id = ? FOR UPDATE'
        );
        $stmt->execute([$feedId]);
        $row = $stmt->fetch();
        return is_array($row) ? $row : null;
    }

    public function fetchRows(PDO $pdo, string $feedId, int $cursor, int $limit): array
    {
        $stmt = $pdo->prepare(
            'SELECT fi.position, fi.work_cid, fi.source, fi.score '
            . 'FROM feed_items fi JOIN works w ON w.cid = fi.work_cid '
            . 'WHERE fi.feed_id = ? AND fi.position > ? AND w.is_active = 1 '
            . 'ORDER BY fi.position ASC LIMIT ' . max(1, $limit)
        );
        $stmt->execute([$feedId, $cursor]);
        return $stmt->fetchAll();
    }

    public function hasNext(PDO $pdo, string $feedId, int $position): bool
    {
        $stmt = $pdo->prepare(
            'SELECT 1 FROM feed_items fi JOIN works w ON w.cid = fi.work_cid '
            . 'WHERE fi.feed_id = ? AND fi.position > ? AND w.is_active = 1 LIMIT 1'
        );
        $stmt->execute([$feedId, $position]);
        return (bool)$stmt->fetchColumn();
    }

    public function insertRows(PDO $pdo, string $feedId, int $start, array $rows): int
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

    public function updateGenerated(PDO $pdo, string $feedId, int $generatedCount): void
    {
        $pdo->prepare(
            'UPDATE feed_sessions SET generated_count = ?, updated_at = NOW() WHERE id = ?'
        )->execute([$generatedCount, $feedId]);
    }

    public function updateTotal(PDO $pdo, string $feedId, int $totalCount): void
    {
        $pdo->prepare('UPDATE feed_sessions SET total_count = ? WHERE id = ?')
            ->execute([$totalCount, $feedId]);
    }
}
