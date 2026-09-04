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

$schemaPath = dirname(__DIR__) . '/schema.sql';
$schema = file_get_contents($schemaPath);
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
    if ($statement === '') {
        continue;
    }
    $pdo->exec($statement);
}

function ensure_index(PDO $pdo, string $table, string $index, string $definition): void
{
    $stmt = $pdo->prepare(
        'SELECT COUNT(*) FROM information_schema.statistics '
        . 'WHERE table_schema = DATABASE() AND table_name = ? AND index_name = ?',
    );
    $stmt->execute([$table, $index]);
    if ((int)$stmt->fetchColumn() > 0) {
        return;
    }
    $pdo->exec('ALTER TABLE `' . $table . '` ADD INDEX `' . $index . '` ' . $definition);
}

ensure_index($pdo, 'events', 'idx_events_user_type_time', '(anonymous_user_id, event_type, created_at)');
ensure_index($pdo, 'events', 'idx_events_user_work_type', '(anonymous_user_id, work_cid, event_type)');
ensure_index($pdo, 'user_work_states', 'idx_user_work_states_work_reactions', '(work_cid, liked, saved)');

$works = (int)$pdo->query('SELECT COUNT(*) FROM works')->fetchColumn();
fwrite(STDOUT, "DB初期化OK works={$works}\n");
