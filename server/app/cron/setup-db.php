<?php

declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

require dirname(__DIR__) . '/bootstrap.php';

$pdo = $database->connection();
if (!$pdo) {
    fwrite(STDERR, "DBへ接続できません。config.local.php を確認してください。\n");
    exit(1);
}

$schema = file_get_contents(dirname(__DIR__) . '/schema.sql');
if (!is_string($schema) || trim($schema) === '') {
    fwrite(STDERR, "schema.sql を読み込めません。\n");
    exit(1);
}
$statements = preg_split('/;\s*(?:\r?\n|$)/', trim($schema));
if (!is_array($statements)) {
    fwrite(STDERR, "schema.sql を解析できません。\n");
    exit(1);
}
foreach ($statements as $statement) {
    $statement = trim($statement);
    if ($statement !== '') {
        $pdo->exec($statement);
    }
}

function column_exists(PDO $pdo, string $table, string $column): bool
{
    $stmt = $pdo->prepare(
        'SELECT COUNT(*) FROM information_schema.columns '
        . 'WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?'
    );
    $stmt->execute([$table, $column]);
    return (int)$stmt->fetchColumn() > 0;
}

function ensure_column(PDO $pdo, string $table, string $column, string $definition): void
{
    if (!column_exists($pdo, $table, $column)) {
        $pdo->exec("ALTER TABLE `{$table}` ADD COLUMN `{$column}` {$definition}");
    }
}

function index_exists(PDO $pdo, string $table, string $index): bool
{
    $stmt = $pdo->prepare(
        'SELECT COUNT(*) FROM information_schema.statistics '
        . 'WHERE table_schema = DATABASE() AND table_name = ? AND index_name = ?'
    );
    $stmt->execute([$table, $index]);
    return (int)$stmt->fetchColumn() > 0;
}

function ensure_index(PDO $pdo, string $table, string $index, string $definition): void
{
    if (!index_exists($pdo, $table, $index)) {
        $pdo->exec("ALTER TABLE `{$table}` ADD INDEX `{$index}` {$definition}");
    }
}

function drop_index_if_exists(PDO $pdo, string $table, string $index): void
{
    if (index_exists($pdo, $table, $index)) {
        $pdo->exec("ALTER TABLE `{$table}` DROP INDEX `{$index}`");
    }
}

function drop_column_if_exists(PDO $pdo, string $table, string $column): void
{
    if (column_exists($pdo, $table, $column)) {
        $pdo->exec("ALTER TABLE `{$table}` DROP COLUMN `{$column}`");
    }
}

function migration_applied(PDO $pdo, string $id): bool
{
    $stmt = $pdo->prepare('SELECT 1 FROM app_migrations WHERE id = ? LIMIT 1');
    $stmt->execute([$id]);
    return (bool)$stmt->fetchColumn();
}

function mark_migration(PDO $pdo, string $id): void
{
    $stmt = $pdo->prepare('INSERT IGNORE INTO app_migrations (id, applied_at) VALUES (?, NOW())');
    $stmt->execute([$id]);
}

function rebuild_genre_scores(PDO $pdo): void
{
    $pdo->exec('DELETE FROM user_genre_scores');
    $pdo->exec(
        'INSERT INTO user_genre_scores (anonymous_user_id, genre_id, score, updated_at) '
        . 'SELECT signals.anonymous_user_id, wg.genre_id, '
        . 'LEAST(20, GREATEST(-12, SUM(signals.signal_score / SQRT(gc.genre_count)))), NOW() '
        . 'FROM ('
        . 'SELECT s.anonymous_user_id, s.work_cid, 7.0 AS signal_score '
        . 'FROM user_work_states s WHERE s.saved = 1 '
        . 'UNION ALL '
        . 'SELECT e.anonymous_user_id, e.work_cid, 10.0 AS signal_score '
        . 'FROM events e WHERE e.event_type = \'affiliate_click\' AND e.work_cid <> \'\' '
        . 'AND e.created_at >= DATE_SUB(NOW(), INTERVAL 90 DAY) '
        . 'GROUP BY e.anonymous_user_id, e.work_cid '
        . 'UNION ALL '
        . 'SELECT e.anonymous_user_id, e.work_cid, 1.0 AS signal_score '
        . 'FROM events e WHERE e.event_type = \'sample_complete\' AND e.work_cid <> \'\' '
        . 'AND e.created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY) '
        . 'GROUP BY e.anonymous_user_id, e.work_cid '
        . 'UNION ALL '
        . 'SELECT e.anonymous_user_id, e.work_cid, '
        . 'LEAST(3.0, AVG(COALESCE(e.read_ratio, 0)) * 2.5) AS signal_score '
        . 'FROM events e WHERE e.event_type = \'view_end\' AND e.work_cid <> \'\' '
        . 'AND e.created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY) '
        . 'GROUP BY e.anonymous_user_id, e.work_cid'
        . ') signals '
        . 'JOIN work_genres wg ON wg.work_cid = signals.work_cid '
        . 'JOIN (SELECT work_cid, COUNT(*) AS genre_count FROM work_genres GROUP BY work_cid) gc '
        . 'ON gc.work_cid = signals.work_cid '
        . 'GROUP BY signals.anonymous_user_id, wg.genre_id'
    );
}

$workColumns = [
    'product_url' => 'TEXT NULL AFTER title',
    'description' => 'LONGTEXT NULL AFTER affiliate_url',
    'full_page_count' => 'INT UNSIGNED NULL AFTER sample_count',
    'volume' => "VARCHAR(128) NOT NULL DEFAULT '' AFTER full_page_count",
    'price_value' => 'INT UNSIGNED NULL AFTER price',
    'maker_id' => "VARCHAR(64) NOT NULL DEFAULT '' AFTER maker",
    'random_key' => 'INT UNSIGNED NOT NULL DEFAULT 0 AFTER maker_id',
    'availability_status' => "VARCHAR(16) NOT NULL DEFAULT 'active' AFTER is_active",
    'metadata_checked_at' => 'DATETIME NULL AFTER last_seen_at',
    'price_checked_at' => 'DATETIME NULL AFTER metadata_checked_at',
    'availability_checked_at' => 'DATETIME NULL AFTER price_checked_at',
    'details_checked_at' => 'DATETIME NULL AFTER availability_checked_at',
    'details_status' => "VARCHAR(16) NOT NULL DEFAULT 'unknown' AFTER details_checked_at",
    'next_refresh_at' => 'DATETIME NULL AFTER details_status',
    'refresh_fail_count' => 'SMALLINT UNSIGNED NOT NULL DEFAULT 0 AFTER next_refresh_at',
];
foreach ($workColumns as $name => $definition) {
    ensure_column($pdo, 'works', $name, $definition);
}

$eventColumns = [
    'event_id' => 'CHAR(36) NULL AFTER id',
    'view_id' => 'CHAR(36) NULL AFTER event_id',
    'event_version' => 'SMALLINT UNSIGNED NOT NULL DEFAULT 3 AFTER view_id',
    'feed_id' => 'CHAR(36) NULL AFTER event_type',
    'rank_position' => 'INT UNSIGNED NULL AFTER feed_id',
    'placement' => 'VARCHAR(32) NULL AFTER dwell_ms',
    'landing_path' => 'VARCHAR(512) NULL AFTER placement',
    'source_domain' => 'VARCHAR(255) NULL AFTER landing_path',
    'campaign' => 'VARCHAR(128) NULL AFTER source_domain',
];
foreach ($eventColumns as $name => $definition) {
    ensure_column($pdo, 'events', $name, $definition);
}

ensure_column($pdo, 'user_work_states', 'saved_at', 'DATETIME NULL AFTER saved');

ensure_index($pdo, 'works', 'idx_works_feed', '(is_active, sample_count, review_count, rating)');
ensure_index($pdo, 'works', 'idx_works_price', '(is_active, price_value)');
ensure_index($pdo, 'works', 'idx_works_random', '(is_active, random_key, cid)');
ensure_index($pdo, 'works', 'idx_works_refresh', '(is_active, next_refresh_at, cid)');
ensure_index($pdo, 'works', 'idx_works_maker', '(maker_id, is_active)');
ensure_index($pdo, 'events', 'idx_events_user_type_time', '(anonymous_user_id, event_type, created_at)');
ensure_index($pdo, 'events', 'idx_events_user_work_type', '(anonymous_user_id, work_cid, event_type)');
ensure_index($pdo, 'events', 'idx_events_created', '(created_at)');
ensure_index($pdo, 'events', 'idx_events_feed_rank', '(feed_id, rank_position)');
ensure_index($pdo, 'user_work_states', 'idx_user_work_states_saved', '(anonymous_user_id, saved, saved_at, work_cid)');

$uniqueEventIndex = $pdo->prepare(
    'SELECT COUNT(*) FROM information_schema.statistics '
    . 'WHERE table_schema = DATABASE() AND table_name = ? AND index_name = ?'
);
$uniqueEventIndex->execute(['events', 'uq_events_event_id']);
if ((int)$uniqueEventIndex->fetchColumn() === 0) {
    $pdo->exec('ALTER TABLE events ADD UNIQUE INDEX uq_events_event_id (event_id)');
}

$pdo->exec('UPDATE works SET random_key = CRC32(cid) WHERE random_key = 0');
$pdo->exec("UPDATE works SET availability_status = IF(is_active = 1, 'active', 'unavailable') WHERE availability_status = '' OR availability_status IS NULL");
$pdo->exec('UPDATE works SET metadata_checked_at = last_seen_at WHERE metadata_checked_at IS NULL');
$pdo->exec('UPDATE works SET price_checked_at = last_seen_at WHERE price_checked_at IS NULL');
$pdo->exec('UPDATE works SET availability_checked_at = last_seen_at WHERE availability_checked_at IS NULL');
$pdo->exec('UPDATE works SET details_checked_at = last_seen_at WHERE details_checked_at IS NULL');
$pdo->exec('UPDATE works SET next_refresh_at = DATE_ADD(NOW(), INTERVAL MOD(CRC32(cid), 10080) MINUTE) WHERE next_refresh_at IS NULL');
$pdo->exec('UPDATE user_work_states SET saved_at = updated_at WHERE saved = 1 AND saved_at IS NULL');

$priceRows = $pdo->query("SELECT cid, price FROM works WHERE price_value IS NULL AND price <> ''")->fetchAll();
if (is_array($priceRows) && $priceRows !== []) {
    $update = $pdo->prepare('UPDATE works SET price_value = ? WHERE cid = ?');
    foreach ($priceRows as $row) {
        $update->execute([
            \SwipePreview\PriceParser::singleValue((string)$row['price']),
            (string)$row['cid'],
        ]);
    }
}

$pdo->exec(
    'INSERT INTO work_price_history (work_cid, price, price_value, observed_at) '
    . 'SELECT w.cid, w.price, w.price_value, COALESCE(w.last_seen_at, w.updated_at, NOW()) '
    . 'FROM works w LEFT JOIN work_price_history h ON h.work_cid = w.cid '
    . "WHERE h.work_cid IS NULL AND (w.price <> '' OR w.price_value IS NOT NULL)"
);

$rebuildId = 'recommendation-v3-rebuild-20260907';
if (!migration_applied($pdo, $rebuildId)) {
    $pdo->beginTransaction();
    try {
        rebuild_genre_scores($pdo);
        mark_migration($pdo, $rebuildId);
        $pdo->commit();
    } catch (Throwable $error) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        throw $error;
    }
}

$commerceRebuildId = 'recommendation-commerce-signals-20260909';
if (!migration_applied($pdo, $commerceRebuildId)) {
    $pdo->beginTransaction();
    try {
        rebuild_genre_scores($pdo);
        $pdo->exec('DELETE FROM feed_sessions');
        mark_migration($pdo, $commerceRebuildId);
        $pdo->commit();
    } catch (Throwable $error) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        throw $error;
    }
}

$saveOnlyId = 'recommendation-save-only-20260909';
if (!migration_applied($pdo, $saveOnlyId)) {
    // 旧リアクション用indexを先に外し、保存データを維持したままいいね列だけを除去する。
    drop_index_if_exists($pdo, 'user_work_states', 'idx_user_work_states_work_reactions');
    drop_column_if_exists($pdo, 'user_work_states', 'liked_at');
    drop_column_if_exists($pdo, 'user_work_states', 'liked');
    $pdo->exec("DELETE FROM events WHERE event_type = 'like_toggle'");
    rebuild_genre_scores($pdo);
    // 固定Feedは旧重みで生成済みなので全破棄し、次アクセスで保存中心の推薦を作り直す。
    $pdo->exec('DELETE FROM feed_sessions');
    mark_migration($pdo, $saveOnlyId);
}

$works = (int)$pdo->query('SELECT COUNT(*) FROM works')->fetchColumn();
$feeds = (int)$pdo->query('SELECT COUNT(*) FROM feed_sessions')->fetchColumn();
$migrations = (int)$pdo->query('SELECT COUNT(*) FROM app_migrations')->fetchColumn();
fwrite(STDOUT, "DB初期化OK works={$works} feed_sessions={$feeds} migrations={$migrations}\n");
