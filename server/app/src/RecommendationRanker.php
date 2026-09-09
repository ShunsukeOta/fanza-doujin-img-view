<?php

declare(strict_types=1);

namespace SwipePreview;

use PDO;

final class RecommendationRanker
{
    public function rank(PDO $pdo, array $candidate, string $feedId, string $userId, int $target): array
    {
        $all = [];
        foreach ($candidate as $source => $rows) {
            foreach ($rows as $cid => $row) {
                $all[$cid] ??= $row;
                $all[$cid]['sources'][] = $source;
            }
        }
        if ($all === []) {
            return [];
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

        return array_slice($selected, 0, $target);
    }

    private function loadGenreIds(PDO $pdo, array $cids): array
    {
        if ($cids === []) {
            return [];
        }
        $placeholders = implode(',', array_fill(0, count($cids), '?'));
        $stmt = $pdo->prepare("SELECT work_cid, genre_id FROM work_genres WHERE work_cid IN ({$placeholders})");
        $stmt->execute($cids);
        $map = [];
        foreach ($stmt->fetchAll() as $row) {
            $map[(string)$row['work_cid']][] = (string)$row['genre_id'];
        }
        return $map;
    }

    private function loadUserGenreScores(PDO $pdo, string $userId): array
    {
        $stmt = $pdo->prepare('SELECT genre_id, score, updated_at FROM user_genre_scores WHERE anonymous_user_id = ?');
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
}
