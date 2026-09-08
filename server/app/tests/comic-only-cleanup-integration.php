<?php

declare(strict_types=1);

use SwipePreview\ComicOnlyCleanup;

require dirname(__DIR__) . '/src/ComicOnlyCleanup.php';

$pdo = new PDO(
    'mysql:host=127.0.0.1;port=3306;dbname=swipe_preview_test;charset=utf8mb4',
    'swipe',
    'swipe_test_password',
    [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_EMULATE_PREPARES => false],
);

function cleanup_assert(bool $condition, string $message): void
{
    if (!$condition) {
        throw new RuntimeException($message);
    }
}

function cleanup_column_exists(PDO $pdo, string $column): bool
{
    $stmt = $pdo->prepare(
        'SELECT COUNT(*) FROM information_schema.columns '
        . "WHERE table_schema=DATABASE() AND table_name='works' AND column_name=?"
    );
    $stmt->execute([$column]);
    return (int)$stmt->fetchColumn() > 0;
}

$schema = file_get_contents(dirname(__DIR__) . '/schema.sql');
cleanup_assert(is_string($schema) && $schema !== '', 'schema.sqlを読めません');
$statements = preg_split('/;\s*(?:\r?\n|$)/', trim($schema));
cleanup_assert(is_array($statements), 'schema.sqlを解析できません');
foreach ($statements as $statement) {
    if (trim($statement) !== '') {
        $pdo->exec($statement);
    }
}

$comicCid = 'cleanup_comic_001';
$videoCid = 'cleanup_amateur_001';
$uid = '99999999-9999-4999-8999-999999999999';

// PR #24適用済みの本番worksを再現する。
if (!cleanup_column_exists($pdo, 'floor_key')) {
    $pdo->exec("ALTER TABLE works ADD COLUMN floor_key VARCHAR(16) NOT NULL DEFAULT 'comic' AFTER cid");
}
if (!cleanup_column_exists($pdo, 'sample_movie_url')) {
    $pdo->exec('ALTER TABLE works ADD COLUMN sample_movie_url TEXT NULL AFTER sample_images_json');
}
if (!cleanup_column_exists($pdo, 'asset_bucket')) {
    $pdo->exec("ALTER TABLE works ADD COLUMN asset_bucket VARCHAR(64) NOT NULL DEFAULT 'comic' AFTER price_value");
}
if (!cleanup_column_exists($pdo, 'asset_type')) {
    $pdo->exec("ALTER TABLE works ADD COLUMN asset_type VARCHAR(16) NOT NULL DEFAULT 'comic' AFTER asset_bucket");
}
$pdo->exec('ALTER TABLE works DROP INDEX IF EXISTS idx_works_feed');
$pdo->exec('ALTER TABLE works ADD INDEX IF NOT EXISTS idx_works_floor_feed (floor_key,is_active,sample_count,review_count,rating)');

$insertWork = $pdo->prepare(
    'INSERT INTO works '
    . '(cid,floor_key,title,affiliate_url,sample_images_json,sample_movie_url,sample_count,review_count,rating,price,maker,random_key,is_active,asset_bucket,asset_type) '
    . "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE floor_key=VALUES(floor_key), sample_movie_url=VALUES(sample_movie_url), asset_bucket=VALUES(asset_bucket), asset_type=VALUES(asset_type)"
);
$insertWork->execute([$comicCid, 'comic', 'cleanup comic', 'https://example.invalid/comic', '["https://example.invalid/comic.jpg"]', null, 1, 1, 4.0, '100円', 'comic maker', 1, 1, 'comic', 'comic']);
$insertWork->execute([$videoCid, 'amateur', 'cleanup video', 'https://example.invalid/video', '["https://example.invalid/video.jpg"]', 'https://www.dmm.co.jp/litevideo/example/', 1, 1, 4.0, '100円', 'video maker', 2, 1, 'video', 'video']);

$pdo->prepare('INSERT IGNORE INTO anonymous_users (id) VALUES (?)')->execute([$uid]);
$pdo->prepare(
    "INSERT INTO events (event_id,anonymous_user_id,session_id,work_cid,event_type,landing_path,metadata_json) VALUES (UUID(),?,?,?,?,?,?)"
)->execute([$uid, '99999999-9999-4999-8999-999999999998', $videoCid, 'work_impression', '/amateur', '{"floor":"amateur","mediaType":"video"}']);
$pdo->prepare(
    'INSERT INTO user_work_states (anonymous_user_id,work_cid,saved,saved_at) VALUES (?,?,1,NOW()) '
    . 'ON DUPLICATE KEY UPDATE saved=1,saved_at=NOW()'
)->execute([$uid, $videoCid]);
$pdo->exec("INSERT INTO genres (id,name,ruby) VALUES ('amateur:cleanup','動画用ジャンル','') ON DUPLICATE KEY UPDATE name=VALUES(name)");
$pdo->exec("INSERT IGNORE INTO work_genres (work_cid,genre_id) VALUES ('{$videoCid}','amateur:cleanup')");
$pdo->exec(
    "INSERT INTO app_migrations (id) VALUES ('multi-floor-amateur-video-20260908') "
    . 'ON DUPLICATE KEY UPDATE applied_at=applied_at'
);

$result = ComicOnlyCleanup::run($pdo);
cleanup_assert($result['removedWorks'] >= 1, '動画作品を削除していません');
cleanup_assert((int)$pdo->query("SELECT COUNT(*) FROM works WHERE cid='{$videoCid}'")->fetchColumn() === 0, '動画作品が残っています');
cleanup_assert((int)$pdo->query("SELECT COUNT(*) FROM works WHERE cid='{$comicCid}'")->fetchColumn() === 1, 'コミック作品まで削除しています');
cleanup_assert((int)$pdo->query("SELECT COUNT(*) FROM events WHERE work_cid='{$videoCid}' OR landing_path LIKE '/amateur%'")->fetchColumn() === 0, '動画イベントが残っています');
cleanup_assert((int)$pdo->query("SELECT COUNT(*) FROM user_work_states WHERE work_cid='{$videoCid}'")->fetchColumn() === 0, '動画保存状態が残っています');
cleanup_assert((int)$pdo->query("SELECT COUNT(*) FROM genres WHERE id LIKE 'amateur:%'")->fetchColumn() === 0, '動画ジャンルが残っています');
cleanup_assert((int)$pdo->query("SELECT COUNT(*) FROM app_migrations WHERE id='multi-floor-amateur-video-20260908'")->fetchColumn() === 0, '動画migration記録が残っています');
foreach (['floor_key', 'sample_movie_url', 'asset_type', 'asset_bucket'] as $column) {
    cleanup_assert(!cleanup_column_exists($pdo, $column), "旧列{$column}が残っています");
}
cleanup_assert(
    (int)$pdo->query("SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema=DATABASE() AND table_name='works' AND index_name='idx_works_feed'")->fetchColumn() > 0,
    'コミック用feed indexがありません',
);
$expectedRandom = (int)$pdo->query("SELECT CRC32('{$comicCid}')")->fetchColumn();
$actualRandom = (int)$pdo->query("SELECT random_key FROM works WHERE cid='{$comicCid}'")->fetchColumn();
cleanup_assert($actualRandom === $expectedRandom, 'random_keyがコミック専用式へ戻っていません');

$second = ComicOnlyCleanup::run($pdo);
cleanup_assert($second['removedWorks'] === 0 && $second['droppedColumns'] === 0, 'cleanupが冪等ではありません');

// 後続の既存integrationへfixtureを持ち越さない。
$pdo->prepare('DELETE FROM works WHERE cid=?')->execute([$comicCid]);
$pdo->prepare('DELETE FROM anonymous_users WHERE id=?')->execute([$uid]);

fwrite(STDOUT, "comic-only cleanup integration: OK\n");
