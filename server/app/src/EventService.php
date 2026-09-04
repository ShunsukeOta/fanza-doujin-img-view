<?php

declare(strict_types=1);

namespace SwipePreview;

use PDO;
use RuntimeException;
use Throwable;

final class EventService
{
    private const ALLOWED_EVENTS = [
        'impression',
        'view_end',
        'sample_page',
        'like_toggle',
        'save_toggle',
        'share',
        'affiliate_click',
    ];

    public function __construct(private readonly Database $database)
    {
    }

    public function record(string $anonymousUserId, string $sessionId, array $payload): void
    {
        $pdo = $this->database->connection();
        if (!$pdo) {
            throw new RuntimeException('行動ログDBがまだ設定されていません。');
        }

        $eventType = trim((string)($payload['eventType'] ?? ''));
        if (!in_array($eventType, self::ALLOWED_EVENTS, true)) {
            throw new RuntimeException('eventType が不正です。');
        }

        $cid = trim((string)($payload['cid'] ?? ''));
        if ($cid === '' || preg_match('/^[A-Za-z0-9_-]+$/', $cid) !== 1) {
            throw new RuntimeException('cid が不正です。');
        }

        $pageIndex = isset($payload['pageIndex']) ? max(0, min(999, (int)$payload['pageIndex'])) : null;
        $maxPage = isset($payload['maxPage']) ? max(0, min(999, (int)$payload['maxPage'])) : null;
        $readRatio = isset($payload['readRatio']) ? max(0.0, min(1.0, (float)$payload['readRatio'])) : null;
        $dwellMs = isset($payload['dwellMs']) ? max(0, min(3600000, (int)$payload['dwellMs'])) : null;
        $metadata = isset($payload['metadata']) && is_array($payload['metadata']) ? $payload['metadata'] : null;
        $metadataJson = $metadata === null ? null : json_encode($metadata, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        if (is_string($metadataJson) && strlen($metadataJson) > 2048) {
            throw new RuntimeException('metadata が大きすぎます。');
        }

        $rate = $pdo->prepare('SELECT COUNT(*) FROM events WHERE anonymous_user_id = ? AND created_at >= DATE_SUB(NOW(), INTERVAL 1 MINUTE)');
        $rate->execute([$anonymousUserId]);
        if ((int)$rate->fetchColumn() >= 240) {
            throw new RuntimeException('イベント送信が多すぎます。');
        }

        $pdo->beginTransaction();
        try {
            $this->ensureAnonymousUser($pdo, $anonymousUserId);
            $stmt = $pdo->prepare(
                'INSERT INTO events (anonymous_user_id, session_id, work_cid, event_type, page_index, max_page, read_ratio, dwell_ms, metadata_json) '
                . 'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
            );
            $stmt->execute([
                $anonymousUserId,
                $sessionId,
                $cid,
                $eventType,
                $pageIndex,
                $maxPage,
                $readRatio,
                $dwellMs,
                $metadataJson,
            ]);

            $delta = $this->affinityDelta($pdo, $anonymousUserId, $cid, $eventType, $dwellMs, $readRatio, $metadata);
            if (abs($delta) > 0.00001) {
                $this->applyGenreAffinity($pdo, $anonymousUserId, $cid, $delta);
            }
            $pdo->commit();
        } catch (Throwable $error) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            throw $error;
        }
    }

    private function ensureAnonymousUser(PDO $pdo, string $anonymousUserId): void
    {
        $stmt = $pdo->prepare(
            'INSERT INTO anonymous_users (id, created_at, last_seen_at) VALUES (?, NOW(), NOW()) '
            . 'ON DUPLICATE KEY UPDATE last_seen_at = NOW()',
        );
        $stmt->execute([$anonymousUserId]);
    }

    private function affinityDelta(
        PDO $pdo,
        string $anonymousUserId,
        string $cid,
        string $eventType,
        ?int $dwellMs,
        ?float $readRatio,
        ?array $metadata,
    ): float {
        $active = isset($metadata['active']) && is_bool($metadata['active']) ? $metadata['active'] : null;

        return match ($eventType) {
            'affiliate_click' => 8.0,
            'share' => 3.0,
            'like_toggle' => $this->toggleDelta($pdo, $anonymousUserId, $cid, 'liked', 4.0, $active),
            'save_toggle' => $this->toggleDelta($pdo, $anonymousUserId, $cid, 'saved', 5.0, $active),
            'view_end' => $this->viewDelta($dwellMs ?? 0, $readRatio ?? 0.0),
            default => 0.0,
        };
    }

    private function toggleDelta(
        PDO $pdo,
        string $anonymousUserId,
        string $cid,
        string $column,
        float $weight,
        ?bool $active,
    ): float {
        if ($active === null) {
            return 0.0;
        }

        $state = $pdo->prepare(
            'SELECT liked, saved FROM user_work_states WHERE anonymous_user_id = ? AND work_cid = ? FOR UPDATE',
        );
        $state->execute([$anonymousUserId, $cid]);
        $row = $state->fetch();
        $previous = is_array($row) ? (bool)$row[$column] : false;

        if (!is_array($row)) {
            $insert = $pdo->prepare(
                'INSERT INTO user_work_states (anonymous_user_id, work_cid, liked, saved, updated_at) VALUES (?, ?, ?, ?, NOW())',
            );
            $insert->execute([
                $anonymousUserId,
                $cid,
                $column === 'liked' && $active ? 1 : 0,
                $column === 'saved' && $active ? 1 : 0,
            ]);
        } elseif ($previous !== $active) {
            $update = $pdo->prepare(
                'UPDATE user_work_states SET ' . $column . ' = ?, updated_at = NOW() WHERE anonymous_user_id = ? AND work_cid = ?',
            );
            $update->execute([$active ? 1 : 0, $anonymousUserId, $cid]);
        }

        if ($previous === $active) {
            return 0.0;
        }
        return $active ? $weight : -$weight;
    }

    private function viewDelta(int $dwellMs, float $readRatio): float
    {
        if ($dwellMs < 1500 && $readRatio < 0.2) {
            return -1.5;
        }
        if ($dwellMs < 3000 && $readRatio < 0.2) {
            return -0.5;
        }
        $dwellScore = min(2.5, $dwellMs / 12000.0);
        $readScore = min(3.0, $readRatio * 3.0);
        return $dwellScore + $readScore;
    }

    private function applyGenreAffinity(PDO $pdo, string $anonymousUserId, string $cid, float $delta): void
    {
        $stmt = $pdo->prepare('SELECT genre_id FROM work_genres WHERE work_cid = ?');
        $stmt->execute([$cid]);
        $genreIds = array_values(array_filter(array_map(
            static fn(array $row): string => (string)($row['genre_id'] ?? ''),
            $stmt->fetchAll(),
        )));
        if ($genreIds === []) {
            return;
        }

        $perGenre = $delta / sqrt((float)count($genreIds));
        $upsert = $pdo->prepare(
            'INSERT INTO user_genre_scores (anonymous_user_id, genre_id, score, updated_at) VALUES (?, ?, ?, NOW()) '
            . 'ON DUPLICATE KEY UPDATE score = LEAST(60, GREATEST(-30, score * 0.985 + VALUES(score))), updated_at = NOW()',
        );
        foreach ($genreIds as $genreId) {
            $upsert->execute([$anonymousUserId, $genreId, $perGenre]);
        }
    }
}
