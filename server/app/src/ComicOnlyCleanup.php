<?php

declare(strict_types=1);

namespace SwipePreview;

use PDO;
use Throwable;

final class ComicOnlyCleanup
{
    private const OBSOLETE_COLUMNS = ['floor_key', 'sample_movie_url', 'asset_type', 'asset_bucket'];

    public static function run(PDO $pdo): array
    {
        $columns = array_values(array_filter(
            self::OBSOLETE_COLUMNS,
            static fn(string $column): bool => self::columnExists($pdo, 'works', $column),
        ));

        if ($columns === []) {
            self::removeLegacyFloorCaches();
            return ['removedWorks' => 0, 'removedEvents' => 0, 'removedStates' => 0, 'droppedColumns' => 0];
        }

        $conditions = [];
        if (in_array('floor_key', $columns, true)) {
            $conditions[] = "COALESCE(floor_key, 'comic') <> 'comic'";
        }
        if (in_array('asset_type', $columns, true)) {
            $conditions[] = "COALESCE(asset_type, 'comic') <> 'comic'";
        }
        if (in_array('asset_bucket', $columns, true)) {
            $conditions[] = "COALESCE(asset_bucket, 'comic') <> 'comic'";
        }

        $pdo->exec('DROP TEMPORARY TABLE IF EXISTS comic_only_cleanup_cids');
        $pdo->exec(
            'CREATE TEMPORARY TABLE comic_only_cleanup_cids '
            . '(cid VARCHAR(128) NOT NULL PRIMARY KEY) ENGINE=MEMORY '
            . 'DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
        );
        if ($conditions !== []) {
            $pdo->exec(
                'INSERT IGNORE INTO comic_only_cleanup_cids (cid) SELECT cid FROM works WHERE '
                . implode(' OR ', $conditions)
            );
        }

        $removedWorks = (int)$pdo->query('SELECT COUNT(*) FROM comic_only_cleanup_cids')->fetchColumn();
        $removedEvents = 0;
        $removedStates = 0;

        $pdo->beginTransaction();
        try {
            $removedEvents += $pdo->exec(
                'DELETE e FROM events e JOIN comic_only_cleanup_cids c ON c.cid = e.work_cid'
            );
            $removedEvents += $pdo->exec(
                "DELETE FROM events WHERE landing_path LIKE '/amateur%' "
                . "OR metadata_json LIKE '%\"floor\":\"amateur\"%' "
                . "OR metadata_json LIKE '%\"mediaType\":\"video\"%'"
            );
            $removedStates = $pdo->exec(
                'DELETE s FROM user_work_states s JOIN comic_only_cleanup_cids c ON c.cid = s.work_cid'
            );
            $pdo->exec('DELETE w FROM works w JOIN comic_only_cleanup_cids c ON c.cid = w.cid');

            // 固定Feedは旧フロア条件・削除済み作品を含み得るため全破棄し、次回アクセスで再生成する。
            $pdo->exec('DELETE FROM feed_sessions');

            // 動画フロア用に名前空間化されたメタデータと、作品削除後の孤立データを除去する。
            $pdo->exec("DELETE FROM user_genre_scores WHERE genre_id LIKE 'amateur:%'");
            $pdo->exec("DELETE FROM genres WHERE id LIKE 'amateur:%'");
            $pdo->exec("DELETE FROM series WHERE id LIKE 'amateur:%'");
            $pdo->exec(
                'DELETE g FROM genres g LEFT JOIN work_genres wg ON wg.genre_id = g.id WHERE wg.genre_id IS NULL'
            );
            $pdo->exec(
                'DELETE s FROM series s LEFT JOIN work_series ws ON ws.series_id = s.id WHERE ws.series_id IS NULL'
            );

            self::rebuildGenreScores($pdo);
            $pdo->exec(
                "DELETE FROM app_migrations WHERE id IN ('multi-floor-amateur-video-20260908','comic-only-catalog-20260908')"
            );
            $pdo->commit();
        } catch (Throwable $error) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            throw $error;
        }

        // MariaDBのDDLは暗黙COMMITを伴うため、データ削除の完了後に冪等にschemaを縮退させる。
        self::dropIndexesUsingColumns($pdo, 'works', $columns);
        foreach (self::OBSOLETE_COLUMNS as $column) {
            self::dropColumnIfExists($pdo, 'works', $column);
        }
        self::ensureIndex($pdo, 'works', 'idx_works_feed', '(is_active, sample_count, review_count, rating)');
        $pdo->exec('UPDATE works SET random_key = CRC32(cid)');
        $pdo->exec('DROP TEMPORARY TABLE IF EXISTS comic_only_cleanup_cids');
        self::removeLegacyFloorCaches();

        return [
            'removedWorks' => $removedWorks,
            'removedEvents' => $removedEvents,
            'removedStates' => $removedStates,
            'droppedColumns' => count($columns),
        ];
    }

    private static function columnExists(PDO $pdo, string $table, string $column): bool
    {
        $stmt = $pdo->prepare(
            'SELECT COUNT(*) FROM information_schema.columns '
            . 'WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?'
        );
        $stmt->execute([$table, $column]);
        return (int)$stmt->fetchColumn() > 0;
    }

    private static function dropColumnIfExists(PDO $pdo, string $table, string $column): void
    {
        if (self::columnExists($pdo, $table, $column)) {
            $pdo->exec("ALTER TABLE `{$table}` DROP COLUMN `{$column}`");
        }
    }

    private static function dropIndexesUsingColumns(PDO $pdo, string $table, array $columns): void
    {
        if ($columns === []) {
            return;
        }
        $placeholders = implode(',', array_fill(0, count($columns), '?'));
        $stmt = $pdo->prepare(
            'SELECT DISTINCT index_name FROM information_schema.statistics '
            . "WHERE table_schema = DATABASE() AND table_name = ? AND column_name IN ({$placeholders}) "
            . "AND index_name <> 'PRIMARY'"
        );
        $stmt->execute([$table, ...$columns]);
        foreach ($stmt->fetchAll(PDO::FETCH_COLUMN) as $index) {
            if (is_string($index) && $index !== '') {
                $pdo->exec("ALTER TABLE `{$table}` DROP INDEX `{$index}`");
            }
        }
    }

    private static function ensureIndex(PDO $pdo, string $table, string $index, string $definition): void
    {
        $stmt = $pdo->prepare(
            'SELECT COUNT(*) FROM information_schema.statistics '
            . 'WHERE table_schema = DATABASE() AND table_name = ? AND index_name = ?'
        );
        $stmt->execute([$table, $index]);
        if ((int)$stmt->fetchColumn() === 0) {
            $pdo->exec("ALTER TABLE `{$table}` ADD INDEX `{$index}` {$definition}");
        }
    }

    private static function rebuildGenreScores(PDO $pdo): void
    {
        $pdo->exec('DELETE FROM user_genre_scores');
        $pdo->exec(
            'INSERT INTO user_genre_scores (anonymous_user_id, genre_id, score, updated_at) '
            . 'SELECT s.anonymous_user_id, wg.genre_id, '
            . 'LEAST(20, GREATEST(-12, SUM((s.liked * 4 + s.saved * 5) / SQRT(gc.genre_count)))), NOW() '
            . 'FROM user_work_states s '
            . 'JOIN work_genres wg ON wg.work_cid = s.work_cid '
            . 'JOIN (SELECT work_cid, COUNT(*) AS genre_count FROM work_genres GROUP BY work_cid) gc ON gc.work_cid = s.work_cid '
            . 'WHERE s.liked = 1 OR s.saved = 1 '
            . 'GROUP BY s.anonymous_user_id, wg.genre_id'
        );
    }

    private static function removeLegacyFloorCaches(): void
    {
        $base = rtrim(sys_get_temp_dir(), DIRECTORY_SEPARATOR) . DIRECTORY_SEPARATOR;
        @unlink($base . 'swipe-preview-floor-amateur.json');
        @unlink($base . 'swipe-preview-floor-comic.json');
    }
}
