<?php

declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

require dirname(__DIR__) . '/bootstrap.php';

$options = getopt('', ['limit::', 'plan-only']);
$limit = max(10, min(500, (int)($options['limit'] ?? 300)));
$planOnly = array_key_exists('plan-only', $options);

$pdo = $database->connection();
if (!$pdo || (!$planOnly && !$fanza->configured())) {
    fwrite(STDERR, $planOnly ? "DBが利用できません。\n" : "DBまたはFANZA APIが利用できません。\n");
    exit(1);
}

$lock = fopen(sys_get_temp_dir() . '/fanza-doujin-refresh.lock', 'c');
if ($lock === false || !flock($lock, LOCK_EX | LOCK_NB)) {
    fwrite(STDOUT, "別の巡回更新が実行中です。\n");
    exit(0);
}

$runId = 0;
$processed = 0;
$failed = 0;

try {
    $targets = [];
    $priorityLimit = min(100, $limit);

    // 保存作品と購入導線へ進んだ作品を優先し、価格/販売状態を最低1日ごとに再確認する。
    $prioritySql =
        'SELECT s.work_cid, MAX(s.updated_at) AS priority_at '
        . 'FROM user_work_states s JOIN works w ON w.cid = s.work_cid '
        . 'WHERE s.saved = 1 AND w.is_active = 1 '
        . 'AND (w.price_checked_at IS NULL OR w.price_checked_at < DATE_SUB(NOW(), INTERVAL 1 DAY)) '
        . 'GROUP BY s.work_cid '
        . 'UNION ALL '
        . "SELECT e.work_cid, MAX(e.created_at) AS priority_at "
        . 'FROM events e JOIN works w ON w.cid = e.work_cid '
        . "WHERE e.event_type = 'affiliate_click' AND e.created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY) "
        . 'AND w.is_active = 1 '
        . 'AND (w.availability_checked_at IS NULL OR w.availability_checked_at < DATE_SUB(NOW(), INTERVAL 1 DAY)) '
        . 'GROUP BY e.work_cid';
    $stmt = $pdo->query(
        'SELECT work_cid, MAX(priority_at) AS priority_at FROM (' . $prioritySql . ') p '
        . 'GROUP BY work_cid ORDER BY priority_at DESC LIMIT ' . $priorityLimit
    );
    foreach ($stmt->fetchAll() as $row) {
        $targets[(string)$row['work_cid']] = true;
    }

    $remaining = max(0, $limit - count($targets));
    if ($remaining > 0) {
        $stmt = $pdo->prepare(
            'SELECT cid FROM works '
            . 'WHERE is_active = 1 AND (next_refresh_at IS NULL OR next_refresh_at <= NOW()) '
            . 'ORDER BY COALESCE(next_refresh_at, \'1970-01-01\') ASC, cid ASC LIMIT ' . $remaining
        );
        $stmt->execute();
        foreach ($stmt->fetchAll() as $row) {
            $targets[(string)$row['cid']] = true;
        }
    }

    if ($planOnly) {
        fwrite(STDOUT, '巡回計画OK targets=' . count($targets) . "\n");
        exit(0);
    }

    $run = $pdo->prepare(
        "INSERT INTO sync_runs (job_type, status, started_at) VALUES ('catalog-refresh', 'running', NOW())"
    );
    $run->execute();
    $runId = (int)$pdo->lastInsertId();

    foreach (array_keys($targets) as $cid) {
        try {
            $workRepository->refreshCid($cid);
        } catch (Throwable $error) {
            $failed++;
            error_log("catalog refresh {$cid}: " . $error->getMessage());
        }
        $processed++;
        usleep(120000);
    }

    $status = $processed > 0 && $failed >= max(10, (int)ceil($processed * 0.25)) ? 'failed' : 'success';
    $message = $failed > 0 ? "failed_items={$failed}" : null;
    $pdo->prepare(
        'UPDATE sync_runs SET status = ?, finished_at = NOW(), processed_count = ?, error_message = ? WHERE id = ?'
    )->execute([$status, $processed, $message, $runId]);

    fwrite(STDOUT, "巡回更新完了 processed={$processed} failed={$failed}\n");
    if ($status === 'failed') {
        fwrite(STDERR, "巡回更新の失敗率が高いためジョブを失敗扱いにします。\n");
        exit(1);
    }
} catch (Throwable $error) {
    if ($runId > 0) {
        $pdo->prepare(
            "UPDATE sync_runs SET status = 'failed', finished_at = NOW(), processed_count = ?, error_message = ? WHERE id = ?"
        )->execute([$processed, mb_substr($error->getMessage(), 0, 512), $runId]);
    }
    fwrite(STDERR, $error->getMessage() . "\n");
    exit(1);
} finally {
    if (is_resource($lock)) {
        flock($lock, LOCK_UN);
        fclose($lock);
    }
}
