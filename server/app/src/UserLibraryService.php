<?php

declare(strict_types=1);

namespace SwipePreview;

use PDO;
use RuntimeException;

final class UserLibraryService
{
    public function __construct(
        private readonly Database $database,
        private readonly WorkRepository $works,
    ) {
    }

    public function saved(string $uid, int $limit = 24, string $cursor = ''): array
    {
        $pdo = $this->requirePdo();
        $this->ensureUser($pdo, $uid);
        $safeLimit = max(1, min(50, $limit));
        $cursorData = $this->decodeCursor($cursor);

        $count = $pdo->prepare(
            'SELECT COUNT(*) FROM user_work_states s JOIN works w ON w.cid = s.work_cid '
            . 'WHERE s.anonymous_user_id = ? AND s.saved = 1'
        );
        $count->execute([$uid]);
        $total = (int)$count->fetchColumn();

        $where = 's.anonymous_user_id = :uid AND s.saved = 1';
        $params = [':uid' => $uid];
        if ($cursorData !== null) {
            $where .= ' AND (s.saved_at < :saved_before OR (s.saved_at = :saved_equal AND s.work_cid < :cursor_cid))';
            $params[':saved_before'] = $cursorData['date'];
            $params[':saved_equal'] = $cursorData['date'];
            $params[':cursor_cid'] = $cursorData['cid'];
        }

        $stmt = $pdo->prepare(
            'SELECT s.work_cid, s.saved_at, '
            . '(SELECT h.price_value FROM work_price_history h '
            . ' WHERE h.work_cid = s.work_cid AND h.observed_at <= s.saved_at '
            . ' ORDER BY h.observed_at DESC, h.id DESC LIMIT 1) AS saved_price_value '
            . 'FROM user_work_states s JOIN works w ON w.cid = s.work_cid '
            . "WHERE {$where} ORDER BY s.saved_at DESC, s.work_cid DESC LIMIT {$safeLimit}"
        );
        $stmt->execute($params);
        $states = $stmt->fetchAll();
        $cids = array_map(static fn(array $row): string => (string)$row['work_cid'], $states);
        $workMap = $this->works->feedItemsByCids($cids);
        $items = [];

        foreach ($states as $state) {
            $cid = (string)$state['work_cid'];
            if (!isset($workMap[$cid])) {
                continue;
            }
            $item = $workMap[$cid];
            $savedPrice = $state['saved_price_value'] === null ? null : (int)$state['saved_price_value'];
            $currentPrice = isset($item['priceValue']) && is_int($item['priceValue']) ? $item['priceValue'] : null;
            $item['savedAt'] = (string)($state['saved_at'] ?? '');
            $item['savedPriceValue'] = $savedPrice;
            $item['priceDropValue'] = $savedPrice !== null && $currentPrice !== null && $currentPrice < $savedPrice
                ? $savedPrice - $currentPrice
                : null;
            $item['viewerSaved'] = true;
            $items[] = $item;
        }

        $nextCursor = null;
        if (count($states) === $safeLimit) {
            $last = end($states);
            if (is_array($last) && ($last['saved_at'] ?? '') !== '') {
                $nextCursor = $this->encodeCursor((string)$last['saved_at'], (string)$last['work_cid']);
            }
        }

        return [
            'items' => $items,
            'total' => $total,
            'nextCursor' => $nextCursor,
            'hasMore' => $nextCursor !== null,
        ];
    }

    public function history(string $uid, int $limit = 24, string $cursor = ''): array
    {
        $pdo = $this->requirePdo();
        $this->ensureUser($pdo, $uid);
        $safeLimit = max(1, min(50, $limit));
        $cursorData = $this->decodeCursor($cursor);

        $count = $pdo->prepare(
            "SELECT COUNT(DISTINCT work_cid) FROM events "
            . "WHERE anonymous_user_id = ? AND event_type IN ('work_impression', 'impression') AND work_cid <> ''"
        );
        $count->execute([$uid]);
        $total = (int)$count->fetchColumn();

        $cursorWhere = '';
        $params = [':uid' => $uid];
        if ($cursorData !== null) {
            $cursorWhere = 'WHERE (h.viewed_at < :viewed_before '
                . 'OR (h.viewed_at = :viewed_equal AND h.work_cid < :cursor_cid))';
            $params[':viewed_before'] = $cursorData['date'];
            $params[':viewed_equal'] = $cursorData['date'];
            $params[':cursor_cid'] = $cursorData['cid'];
        }

        $stmt = $pdo->prepare(
            'SELECT h.work_cid, h.viewed_at FROM ('
            . 'SELECT work_cid, MAX(created_at) AS viewed_at FROM events '
            . "WHERE anonymous_user_id = :uid AND event_type IN ('work_impression', 'impression') AND work_cid <> '' "
            . 'GROUP BY work_cid'
            . ") h {$cursorWhere} ORDER BY h.viewed_at DESC, h.work_cid DESC LIMIT {$safeLimit}"
        );
        $stmt->execute($params);
        $rows = $stmt->fetchAll();
        $cids = array_map(static fn(array $row): string => (string)$row['work_cid'], $rows);
        $workMap = $this->works->feedItemsByCids($cids);
        $items = [];

        foreach ($rows as $row) {
            $cid = (string)$row['work_cid'];
            if (!isset($workMap[$cid])) {
                continue;
            }
            $item = $workMap[$cid];
            $item['viewedAt'] = (string)($row['viewed_at'] ?? '');
            $items[] = $item;
        }

        $nextCursor = null;
        if (count($rows) === $safeLimit) {
            $last = end($rows);
            if (is_array($last) && ($last['viewed_at'] ?? '') !== '') {
                $nextCursor = $this->encodeCursor((string)$last['viewed_at'], (string)$last['work_cid']);
            }
        }

        return [
            'items' => $items,
            'total' => $total,
            'nextCursor' => $nextCursor,
            'hasMore' => $nextCursor !== null,
        ];
    }

    public function profile(string $uid): array
    {
        $pdo = $this->requirePdo();
        $this->ensureUser($pdo, $uid);

        $userStmt = $pdo->prepare('SELECT created_at FROM anonymous_users WHERE id = ? LIMIT 1');
        $userStmt->execute([$uid]);
        $user = $userStmt->fetch() ?: [];

        $savedStmt = $pdo->prepare(
            'SELECT COUNT(*) FROM user_work_states WHERE anonymous_user_id = ? AND saved = 1'
        );
        $savedStmt->execute([$uid]);
        $saved = (int)$savedStmt->fetchColumn();

        $viewedStmt = $pdo->prepare(
            "SELECT COUNT(DISTINCT work_cid) FROM events "
            . "WHERE anonymous_user_id = ? AND event_type IN ('work_impression', 'impression')"
        );
        $viewedStmt->execute([$uid]);
        $viewed = (int)$viewedStmt->fetchColumn();

        $genreStmt = $pdo->prepare(
            'SELECT g.id, g.name, u.score FROM user_genre_scores u '
            . 'JOIN genres g ON g.id = u.genre_id '
            . 'WHERE u.anonymous_user_id = ? AND u.score > 0 ORDER BY u.score DESC LIMIT 8'
        );
        $genreStmt->execute([$uid]);
        $topGenres = array_map(
            static fn(array $row): array => [
                'id' => (string)$row['id'],
                'name' => (string)$row['name'],
                'score' => round((float)$row['score'], 2),
            ],
            $genreStmt->fetchAll(),
        );

        return [
            'createdAt' => $user['created_at'] ?? null,
            'stats' => ['saved' => $saved, 'viewed' => $viewed],
            'topGenres' => $topGenres,
            'recentHistory' => $this->history($uid, 4)['items'],
        ];
    }

    public function deleteProfile(string $uid): bool
    {
        $pdo = $this->requirePdo();
        $stmt = $pdo->prepare('DELETE FROM anonymous_users WHERE id = ?');
        $stmt->execute([$uid]);
        return $stmt->rowCount() > 0;
    }

    private function encodeCursor(string $date, string $cid): string
    {
        return rtrim(strtr(base64_encode($date . '|' . $cid), '+/', '-_'), '=');
    }

    private function decodeCursor(string $cursor): ?array
    {
        $cursor = trim($cursor);
        if ($cursor === '') {
            return null;
        }
        if (strlen($cursor) > 320) {
            return null;
        }
        $padded = strtr($cursor, '-_', '+/');
        $padded .= str_repeat('=', (4 - strlen($padded) % 4) % 4);
        $decoded = base64_decode($padded, true);
        if (!is_string($decoded)) {
            return null;
        }
        $parts = explode('|', $decoded, 2);
        if (
            count($parts) !== 2
            || preg_match('/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/', $parts[0]) !== 1
            || strtotime($parts[0]) === false
            || preg_match('/^[A-Za-z0-9_-]{1,128}$/', $parts[1]) !== 1
        ) {
            return null;
        }
        return ['date' => $parts[0], 'cid' => $parts[1]];
    }

    private function ensureUser(PDO $pdo, string $uid): void
    {
        $stmt = $pdo->prepare(
            'INSERT INTO anonymous_users (id, created_at, last_seen_at) VALUES (?, NOW(), NOW()) '
            . 'ON DUPLICATE KEY UPDATE last_seen_at = NOW()'
        );
        $stmt->execute([$uid]);
    }

    private function requirePdo(): PDO
    {
        $pdo = $this->database->connection();
        if (!$pdo) {
            throw new RuntimeException('ユーザーDBが利用できません。');
        }
        return $pdo;
    }
}
