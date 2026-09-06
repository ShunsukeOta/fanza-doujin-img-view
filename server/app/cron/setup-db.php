<?php

declare(strict_types=1);

if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
require dirname(__DIR__) . '/bootstrap.php';

$pdo = $database->connection();
if (!$pdo) { fwrite(STDERR, "DBへ接続できません。config.local.php を確認してください。\n"); exit(1); }

$schema = file_get_contents(dirname(__DIR__) . '/schema.sql');
if (!is_string($schema) || trim($schema) === '') { fwrite(STDERR, "schema.sql を読み込めません。\n"); exit(1); }
$statements = preg_split('/;\s*(?:\r?\n|$)/', trim($schema));
if (!is_array($statements)) { fwrite(STDERR, "schema.sql を解析できません。\n"); exit(1); }
foreach ($statements as $statement) { if (trim($statement) !== '') $pdo->exec(trim($statement)); }

function ensure_column(PDO $pdo, string $table, string $column, string $definition): void {
    $stmt=$pdo->prepare('SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name=? AND column_name=?');
    $stmt->execute([$table,$column]);
    if ((int)$stmt->fetchColumn()===0) $pdo->exec("ALTER TABLE `{$table}` ADD COLUMN `{$column}` {$definition}");
}
function ensure_index(PDO $pdo, string $table, string $index, string $definition): void {
    $stmt=$pdo->prepare('SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema=DATABASE() AND table_name=? AND index_name=?');
    $stmt->execute([$table,$index]);
    if ((int)$stmt->fetchColumn()===0) $pdo->exec("ALTER TABLE `{$table}` ADD INDEX `{$index}` {$definition}");
}
function migration_applied(PDO $pdo,string $id): bool { $s=$pdo->prepare('SELECT 1 FROM app_migrations WHERE id=? LIMIT 1');$s->execute([$id]);return (bool)$s->fetchColumn(); }
function mark_migration(PDO $pdo,string $id): void { $s=$pdo->prepare('INSERT IGNORE INTO app_migrations(id,applied_at) VALUES (?,NOW())');$s->execute([$id]); }

$workColumns = [
    'product_url'=>'TEXT NULL AFTER title','description'=>'LONGTEXT NULL AFTER affiliate_url','full_page_count'=>'INT UNSIGNED NULL AFTER sample_count',
    'volume'=>"VARCHAR(128) NOT NULL DEFAULT '' AFTER full_page_count",'price_value'=>'INT UNSIGNED NULL AFTER price',
    'maker_id'=>"VARCHAR(64) NOT NULL DEFAULT '' AFTER maker",'random_key'=>'INT UNSIGNED NOT NULL DEFAULT 0 AFTER maker_id',
    'availability_status'=>"VARCHAR(16) NOT NULL DEFAULT 'active' AFTER is_active",'metadata_checked_at'=>'DATETIME NULL AFTER last_seen_at',
    'price_checked_at'=>'DATETIME NULL AFTER metadata_checked_at','availability_checked_at'=>'DATETIME NULL AFTER price_checked_at',
    'details_checked_at'=>'DATETIME NULL AFTER availability_checked_at','details_status'=>"VARCHAR(16) NOT NULL DEFAULT 'unknown' AFTER details_checked_at",
    'next_refresh_at'=>'DATETIME NULL AFTER details_status','refresh_fail_count'=>'SMALLINT UNSIGNED NOT NULL DEFAULT 0 AFTER next_refresh_at',
];
foreach($workColumns as $name=>$def) ensure_column($pdo,'works',$name,$def);
foreach([
    'event_id'=>'CHAR(36) NULL AFTER id','view_id'=>'CHAR(36) NULL AFTER event_id','event_version'=>'SMALLINT UNSIGNED NOT NULL DEFAULT 3 AFTER view_id',
    'feed_id'=>'CHAR(36) NULL AFTER event_type','rank_position'=>'INT UNSIGNED NULL AFTER feed_id','placement'=>'VARCHAR(32) NULL AFTER dwell_ms',
    'landing_path'=>'VARCHAR(512) NULL AFTER placement','source_domain'=>'VARCHAR(255) NULL AFTER landing_path','campaign'=>'VARCHAR(128) NULL AFTER source_domain',
] as $name=>$def) ensure_column($pdo,'events',$name,$def);
ensure_column($pdo,'user_work_states','liked_at','DATETIME NULL AFTER saved');
ensure_column($pdo,'user_work_states','saved_at','DATETIME NULL AFTER liked_at');

ensure_index($pdo,'works','idx_works_price','(is_active, price_value)');
ensure_index($pdo,'works','idx_works_random','(is_active, random_key, cid)');
ensure_index($pdo,'works','idx_works_refresh','(is_active, next_refresh_at, cid)');
ensure_index($pdo,'works','idx_works_maker','(maker_id, is_active)');
ensure_index($pdo,'events','idx_events_user_type_time','(anonymous_user_id,event_type,created_at)');
ensure_index($pdo,'events','idx_events_user_work_type','(anonymous_user_id,work_cid,event_type)');
ensure_index($pdo,'events','idx_events_created','(created_at)');
ensure_index($pdo,'events','idx_events_feed_rank','(feed_id,rank_position)');
ensure_index($pdo,'user_work_states','idx_user_work_states_work_reactions','(work_cid,liked,saved)');
ensure_index($pdo,'user_work_states','idx_user_work_states_saved','(anonymous_user_id,saved,saved_at,work_cid)');
try { $pdo->exec('ALTER TABLE events ADD UNIQUE INDEX uq_events_event_id (event_id)'); } catch (Throwable) { /* already exists */ }

// 既存約12万件も一度のSQLで探索キー・鮮度管理を初期化する。
$pdo->exec("UPDATE works SET random_key=CRC32(cid) WHERE random_key=0");
$pdo->exec("UPDATE works SET availability_status=IF(is_active=1,'active','unavailable') WHERE availability_status='' OR availability_status IS NULL");
$pdo->exec("UPDATE works SET metadata_checked_at=COALESCE(metadata_checked_at,last_seen_at),price_checked_at=COALESCE(price_checked_at,last_seen_at),availability_checked_at=COALESCE(availability_checked_at,last_seen_at),details_checked_at=COALESCE(details_checked_at,last_seen_at),next_refresh_at=COALESCE(next_refresh_at,DATE_ADD(NOW(), INTERVAL MOD(CRC32(cid),10080) MINUTE))");
$pdo->exec("UPDATE user_work_states SET liked_at=COALESCE(liked_at,updated_at) WHERE liked=1 AND liked_at IS NULL");
$pdo->exec("UPDATE user_work_states SET saved_at=COALESCE(saved_at,updated_at) WHERE saved=1 AND saved_at IS NULL");

$rows=$pdo->query("SELECT cid,price FROM works WHERE price_value IS NULL AND price<>''")->fetchAll();
if(is_array($rows)&&$rows!==[]){$u=$pdo->prepare('UPDATE works SET price_value=? WHERE cid=?');foreach($rows as $r)$u->execute([\SwipePreview\PriceParser::singleValue((string)$r['price']),(string)$r['cid']]);}
$pdo->exec("INSERT INTO work_price_history(work_cid,price,price_value,observed_at) SELECT w.cid,w.price,w.price_value,COALESCE(w.last_seen_at,w.updated_at,NOW()) FROM works w LEFT JOIN work_price_history h ON h.work_cid=w.cid WHERE h.work_cid IS NULL AND (w.price<>'' OR w.price_value IS NOT NULL)");

// v2の誤読了率で汚染した派生ジャンルスコアを破棄し、信頼できる現在のLike/Save状態だけから再構築する。
$rebuildId='recommendation-v3-rebuild-20260907';
if(!migration_applied($pdo,$rebuildId)){
    $pdo->beginTransaction();
    try{
        $pdo->exec('DELETE FROM user_genre_scores');
        $pdo->exec("INSERT INTO user_genre_scores(anonymous_user_id,genre_id,score,updated_at) SELECT s.anonymous_user_id,wg.genre_id,LEAST(20,GREATEST(-12,SUM((s.liked*4+s.saved*5)/SQRT(GREATEST(1,(SELECT COUNT(*) FROM work_genres x WHERE x.work_cid=s.work_cid))))),NOW() FROM user_work_states s JOIN work_genres wg ON wg.work_cid=s.work_cid WHERE s.liked=1 OR s.saved=1 GROUP BY s.anonymous_user_id,wg.genre_id");
        mark_migration($pdo,$rebuildId);$pdo->commit();
    }catch(Throwable $e){if($pdo->inTransaction())$pdo->rollBack();throw $e;}
}

$works=(int)$pdo->query('SELECT COUNT(*) FROM works')->fetchColumn();
$feeds=(int)$pdo->query('SELECT COUNT(*) FROM feed_sessions')->fetchColumn();
fwrite(STDOUT,"DB初期化OK works={$works} feed_sessions={$feeds}\n");
