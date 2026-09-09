<?php

declare(strict_types=1);

namespace SwipePreview;

use PDO;

final class CandidateSource
{
    public function collect(PDO $pdo, string $baseWhere, array $common, int $target, int $pivot): array
    {
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
            $select . ' ORDER BY w.review_count DESC, w.rating DESC, w.cid ASC LIMIT ' . min(120, max(45, $target * 3)),
            $common,
            'popular'
        );
        $take(
            $select . ' ORDER BY w.release_date DESC, w.cid ASC LIMIT ' . min(90, max(30, $target * 2)),
            $common,
            'recent'
        );

        $exploreParams = [...$common, ':pivot' => $pivot];
        $exploreLimit = min(90, max(30, $target * 2));
        $take(
            $select . ' AND w.random_key >= :pivot ORDER BY w.random_key ASC, w.cid ASC LIMIT ' . $exploreLimit,
            $exploreParams,
            'explore'
        );
        if (count($candidate['explore'] ?? []) < max(12, (int)ceil($target * 0.25))) {
            $take(
                $select . ' AND w.random_key < :pivot ORDER BY w.random_key ASC, w.cid ASC LIMIT ' . $exploreLimit,
                $exploreParams,
                'explore'
            );
        }

        return $candidate;
    }
}
