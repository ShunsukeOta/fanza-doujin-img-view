<?php

declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

require dirname(__DIR__) . '/bootstrap.php';

$pdo = $database->connection();
if (!$pdo) {
    fwrite(STDERR, "DBへ接続できません。\n");
    exit(1);
}
if (!$fanza->configured()) {
    fwrite(STDERR, "DMM API設定がありません。\n");
    exit(1);
}

$options = getopt('', ['pages::', 'sort::', 'since::', 'until::', 'floor::']);
$pages = max(1, min(500, (int)($options['pages'] ?? ($config['app']['sync_pages'] ?? 5))));
$sort = trim((string)($options['sort'] ?? 'date')) ?: 'date';
$since = trim((string)($options['since'] ?? ''));
$until = trim((string)($options['until'] ?? ''));
$requestedFloor = trim((string)($options['floor'] ?? 'all')) ?: 'all';
if (!in_array($requestedFloor, ['all', 'comic', 'amateur'], true)) {
    fwrite(STDERR, "floorはall / comic / amateurを指定してください。\n");
    exit(1);
}
$floorKeys = $requestedFloor === 'all' ? ['comic', 'amateur'] : [$requestedFloor];

$lock = fopen(sys_get_temp_dir() . '/fanza-catalog-sync.lock', 'c');
if ($lock === false || !flock($lock, LOCK_EX | LOCK_NB)) {
    fwrite(STDOUT, "別の同期処理が実行中です。\n");
    exit(0);
}

$run = $pdo->prepare("INSERT INTO sync_runs (job_type,status,started_at) VALUES ('fanza-sync','running',NOW())");
$run->execute();
$runId = (int)$pdo->lastInsertId();
$processed = 0;
$skipped = 0;

function parse_sync_date(string $raw, bool $end = false): ?DateTimeImmutable
{
    if ($raw === '') return null;
    $value = preg_match('/^\d{4}-\d{2}-\d{2}$/', $raw) === 1 ? $raw . ($end ? ' 23:59:59' : ' 00:00:00') : $raw;
    try {
        return new DateTimeImmutable($value, new DateTimeZone(date_default_timezone_get()));
    } catch (Throwable) {
        throw new RuntimeException("日時形式が不正です: {$raw}");
    }
}

try {
    $ranges = [];
    $start = parse_sync_date($since);
    $end = parse_sync_date($until, true) ?? new DateTimeImmutable('now');
    if ($start) {
        if ($start > $end) throw new RuntimeException('sinceはuntil以前にしてください。');
        $cursor = $start;
        while ($cursor <= $end) {
            $rangeEnd = $cursor->modify('+13 days')->setTime(23, 59, 59);
            if ($rangeEnd > $end) $rangeEnd = $end;
            $ranges[] = [$cursor->format('Y-m-d\TH:i:s'), $rangeEnd->format('Y-m-d\TH:i:s')];
            $cursor = $rangeEnd->modify('+1 second');
        }
    } else {
        $ranges = [['', '']];
    }

    foreach ($floorKeys as $floorKey) {
        $floor = $fanza->resolveFloor($floorKey);
        $floorProcessed = 0;
        $floorSkipped = 0;
        foreach ($ranges as [$gte, $lte]) {
            $label = $gte !== '' ? "{$gte} - {$lte}" : 'latest';
            fwrite(STDOUT, "同期範囲開始 floor={$floorKey} range={$label}\n");
            for ($pageIndex = 0; $pageIndex < $pages; $pageIndex++) {
                $offset = 1 + $pageIndex * 100;
                if ($offset > 50000) throw new RuntimeException("API offset上限50000に到達: {$floorKey} {$label}");
                $page = $fanza->fetchItemPage($floor, $offset, '', $sort, 100, $gte, $lte);
                if ($pageIndex === 0 && $gte !== '' && (int)$page['total'] > $pages * 100) {
                    throw new RuntimeException("期間内件数がページ上限を超えています: {$floorKey} {$label} total={$page['total']}");
                }
                if ($page['items'] === []) break;

                foreach ($page['items'] as $raw) {
                    if ($floorKey === 'comic' && !$fanza->isComicItem($raw)) {
                        $skipped++;
                        $floorSkipped++;
                        continue;
                    }
                    try {
                        $item = $fanza->feedItem($raw, $floorKey);
                    } catch (Throwable) {
                        $skipped++;
                        $floorSkipped++;
                        continue;
                    }
                    if (trim((string)($item['cid'] ?? '')) === '') continue;
                    $workRepository->upsertNormalized($item);
                    $processed++;
                    $floorProcessed++;
                }

                fwrite(STDOUT, 'floor=' . $floorKey . ' range=' . $label . ' page=' . ($pageIndex + 1)
                    . ' rows=' . count($page['items']) . ' stored=' . $floorProcessed . ' skipped=' . $floorSkipped
                    . ' total=' . $page['total'] . "\n");
                if (count($page['items']) < 100 || (int)$page['resultCount'] < 100) break;
                usleep(120000);
            }
        }
        fwrite(STDOUT, "floor完了 {$floorKey} stored={$floorProcessed} skipped={$floorSkipped}\n");
    }

    $pdo->prepare("UPDATE sync_runs SET status='success',finished_at=NOW(),processed_count=? WHERE id=?")->execute([$processed, $runId]);
    $works = (int)$pdo->query('SELECT COUNT(*) FROM works')->fetchColumn();
    fwrite(STDOUT, "同期完了 stored={$processed} skipped={$skipped} works={$works}\n");
} catch (Throwable $error) {
    $pdo->prepare("UPDATE sync_runs SET status='failed',finished_at=NOW(),processed_count=?,error_message=? WHERE id=?")
        ->execute([$processed, mb_substr($error->getMessage(), 0, 512), $runId]);
    fwrite(STDERR, "同期失敗: {$error->getMessage()}\n");
    exit(1);
} finally {
    if (is_resource($lock)) {
        flock($lock, LOCK_UN);
        fclose($lock);
    }
}
