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
if (!$fanza->configured()) {
    fwrite(STDERR, "DMM API設定がありません。config.local.php を確認してください。\n");
    exit(1);
}

$options = getopt('', ['pages::', 'sort::', 'since::', 'until::']);
$pages = max(1, min(500, (int)($options['pages'] ?? ($config['app']['sync_pages'] ?? 5))));
$sort = trim((string)($options['sort'] ?? 'date')) ?: 'date';
$sinceRaw = trim((string)($options['since'] ?? ''));
$untilRaw = trim((string)($options['until'] ?? ''));

$lockPath = sys_get_temp_dir() . '/fanza-doujin-sync.lock';
$lock = fopen($lockPath, 'c');
if ($lock === false || !flock($lock, LOCK_EX | LOCK_NB)) {
    fwrite(STDOUT, "別の同期処理が実行中です。\n");
    exit(0);
}

function sync_numeric_price(string $price): ?int
{
    if (preg_match('/[0-9][0-9,]*/', $price, $match) !== 1) {
        return null;
    }
    $digits = str_replace(',', '', $match[0]);
    return $digits !== '' && ctype_digit($digits) ? (int)$digits : null;
}

function sync_parse_date(string $raw, bool $endOfDay = false): ?DateTimeImmutable
{
    if ($raw === '') return null;
    $timezone = new DateTimeZone(date_default_timezone_get());
    $value = $raw;
    if (preg_match('/^\d{4}-\d{2}-\d{2}$/', $raw) === 1) {
        $value .= $endOfDay ? 'T23:59:59' : 'T00:00:00';
    }
    try {
        return new DateTimeImmutable($value, $timezone);
    } catch (Throwable) {
        throw new RuntimeException("日時の形式が不正です: {$raw}");
    }
}

function sync_existing_prices(PDO $pdo, array $cids): array
{
    $cids = array_values(array_unique(array_filter($cids, static fn(string $cid): bool => $cid !== '')));
    if ($cids === []) return [];
    $placeholders = implode(',', array_fill(0, count($cids), '?'));
    $stmt = $pdo->prepare('SELECT cid, price, price_value FROM works WHERE cid IN (' . $placeholders . ')');
    $stmt->execute($cids);
    $map = [];
    foreach ($stmt->fetchAll() as $row) {
        $map[(string)$row['cid']] = [
            'price' => (string)($row['price'] ?? ''),
            'price_value' => $row['price_value'] === null ? null : (int)$row['price_value'],
        ];
    }
    return $map;
}

$floor = $fanza->resolveDoujinFloor();
$seen = 0;
$saved = 0;
$genreSaved = 0;
$seriesSaved = 0;
$priceChanges = 0;
$ranges = 0;

$upsertWork = $pdo->prepare(
    'INSERT INTO works '
    . '(cid, title, product_url, affiliate_url, description, sample_images_json, sample_count, full_page_count, volume, review_count, rating, price, price_value, asset_bucket, asset_type, release_date, maker, is_active, first_seen_at, last_seen_at) '
    . 'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, NOW(), NOW()) '
    . 'ON DUPLICATE KEY UPDATE title=VALUES(title), '
    . 'product_url=COALESCE(NULLIF(VALUES(product_url), \'\'), product_url), affiliate_url=VALUES(affiliate_url), '
    . 'description=CASE WHEN VALUES(description) IS NULL OR VALUES(description)=\'\' THEN description ELSE VALUES(description) END, '
    . 'sample_images_json=VALUES(sample_images_json), sample_count=VALUES(sample_count), full_page_count=VALUES(full_page_count), volume=VALUES(volume), '
    . 'review_count=VALUES(review_count), rating=VALUES(rating), '
    . 'price=CASE WHEN VALUES(price)<>\'\' THEN VALUES(price) ELSE price END, price_value=COALESCE(VALUES(price_value), price_value), '
    . 'asset_bucket=VALUES(asset_bucket), asset_type=VALUES(asset_type), release_date=VALUES(release_date), maker=VALUES(maker), '
    . 'is_active=1, last_seen_at=NOW()'
);
$upsertGenre = $pdo->prepare(
    'INSERT INTO genres (id, name, ruby) VALUES (?, ?, ?) '
    . 'ON DUPLICATE KEY UPDATE name=VALUES(name), ruby=VALUES(ruby)'
);
$upsertSeries = $pdo->prepare(
    'INSERT INTO series (id, name, ruby) VALUES (?, ?, ?) '
    . 'ON DUPLICATE KEY UPDATE name=VALUES(name), ruby=VALUES(ruby)'
);
$insertPriceHistory = $pdo->prepare(
    'INSERT INTO work_price_history (work_cid, price, price_value, observed_at) VALUES (?, ?, ?, NOW())'
);
$deleteWorkGenres = $pdo->prepare('DELETE FROM work_genres WHERE work_cid = ?');
$insertWorkGenre = $pdo->prepare('INSERT IGNORE INTO work_genres (work_cid, genre_id) VALUES (?, ?)');
$deleteWorkSeries = $pdo->prepare('DELETE FROM work_series WHERE work_cid = ?');
$insertWorkSeries = $pdo->prepare('INSERT IGNORE INTO work_series (work_cid, series_id) VALUES (?, ?)');

foreach ($fanza->fetchGenres((string)$floor['floorId']) as $genre) {
    $upsertGenre->execute([(string)$genre['id'], (string)$genre['name'], (string)($genre['ruby'] ?? '')]);
    $genreSaved++;
}

$syncRange = function (string $gteDate, string $lteDate) use (
    $pdo,
    $fanza,
    $floor,
    $sort,
    $pages,
    $upsertWork,
    $upsertGenre,
    $upsertSeries,
    $insertPriceHistory,
    $deleteWorkGenres,
    $insertWorkGenre,
    $deleteWorkSeries,
    $insertWorkSeries,
    &$seen,
    &$saved,
    &$genreSaved,
    &$seriesSaved,
    &$priceChanges,
    &$ranges,
): void {
    $ranges++;
    $label = $gteDate !== '' ? "{$gteDate} - {$lteDate}" : 'latest';
    fwrite(STDOUT, "同期範囲開始: {$label}\n");

    for ($pageIndex = 0; $pageIndex < $pages; $pageIndex++) {
        $offset = 1 + $pageIndex * 100;
        if ($offset > 50000) {
            throw new RuntimeException("API offset上限50000に到達しました: {$label}");
        }
        $page = $fanza->fetchItemPage($floor, $offset, '', $sort, 100, $gteDate, $lteDate);
        if ($pageIndex === 0 && $gteDate !== '' && (int)$page['total'] > $pages * 100) {
            throw new RuntimeException("指定期間の件数がページ上限を超えています: {$label} total={$page['total']}");
        }
        if ($page['items'] === []) break;

        $items = [];
        $cids = [];
        foreach ($page['items'] as $rawItem) {
            $seen++;
            $item = $fanza->feedItem($rawItem);
            $cid = trim((string)$item['cid']);
            if ($cid === '') continue;

            $releaseDate = null;
            if (($item['releaseDate'] ?? '') !== '') {
                $timestamp = strtotime((string)$item['releaseDate']);
                if ($timestamp !== false) $releaseDate = date('Y-m-d H:i:s', $timestamp);
            }
            $price = (string)$item['price'];
            $items[] = [
                'raw' => $item,
                'cid' => $cid,
                'releaseDate' => $releaseDate,
                'price' => $price,
                'priceValue' => sync_numeric_price($price),
            ];
            $cids[] = $cid;
        }
        if ($items === []) {
            if (count($page['items']) < 100 || (int)$page['resultCount'] < 100) break;
            continue;
        }

        $existingPrices = sync_existing_prices($pdo, $cids);
        $pdo->beginTransaction();
        try {
            foreach ($items as $prepared) {
                $item = $prepared['raw'];
                $cid = $prepared['cid'];
                $price = $prepared['price'];
                $priceValue = $prepared['priceValue'];
                $description = trim((string)($item['description'] ?? ''));

                $upsertWork->execute([
                    $cid,
                    (string)$item['title'],
                    (string)($item['productUrl'] ?? ''),
                    (string)$item['affiliateUrl'],
                    $description !== '' ? $description : null,
                    json_encode($item['images'], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE),
                    (int)$item['sampleCount'],
                    $item['fullPageCount'] ?? null,
                    (string)($item['volume'] ?? ''),
                    (int)$item['reviews'],
                    (float)$item['rating'],
                    $price,
                    $priceValue,
                    (string)$item['assetBucket'],
                    (string)$item['assetType'],
                    $prepared['releaseDate'],
                    (string)($item['maker'] ?? ''),
                ]);
                $saved++;

                if ($price !== '' || $priceValue !== null) {
                    $previous = $existingPrices[$cid] ?? null;
                    $changed = $previous === null
                        || (string)$previous['price'] !== $price
                        || $previous['price_value'] !== $priceValue;
                    if ($changed) {
                        $insertPriceHistory->execute([$cid, $price, $priceValue]);
                        $priceChanges++;
                    }
                }

                $deleteWorkGenres->execute([$cid]);
                foreach (($item['genreRows'] ?? []) as $genre) {
                    $genreId = trim((string)($genre['id'] ?? ''));
                    $genreName = trim((string)($genre['name'] ?? ''));
                    if ($genreId === '' || $genreName === '') continue;
                    $upsertGenre->execute([$genreId, $genreName, (string)($genre['ruby'] ?? '')]);
                    $insertWorkGenre->execute([$cid, $genreId]);
                    $genreSaved++;
                }

                $deleteWorkSeries->execute([$cid]);
                foreach (($item['seriesRows'] ?? []) as $series) {
                    $seriesId = trim((string)($series['id'] ?? ''));
                    $seriesName = trim((string)($series['name'] ?? ''));
                    if ($seriesId === '' || $seriesName === '') continue;
                    $upsertSeries->execute([$seriesId, $seriesName, (string)($series['ruby'] ?? '')]);
                    $insertWorkSeries->execute([$cid, $seriesId]);
                    $seriesSaved++;
                }
            }
            $pdo->commit();
        } catch (Throwable $error) {
            if ($pdo->inTransaction()) $pdo->rollBack();
            throw $error;
        }

        fwrite(STDOUT, sprintf(
            "range=%s page=%d offset=%d rows=%d total=%d works=%d price_changes=%d\n",
            $label,
            $pageIndex + 1,
            $offset,
            count($page['items']),
            (int)$page['total'],
            $saved,
            $priceChanges,
        ));
        if (count($page['items']) < 100 || (int)$page['resultCount'] < 100) break;
        usleep(150000);
    }
};

$since = sync_parse_date($sinceRaw, false);
$until = sync_parse_date($untilRaw, true);
if ($since !== null) {
    $until ??= new DateTimeImmutable('now', new DateTimeZone(date_default_timezone_get()));
    if ($until < $since) throw new RuntimeException('until は since 以降を指定してください。');

    // APIのoffset上限を踏みにくくするため、直近1年のバックフィルは14日単位に分割する。
    $cursor = $since;
    while ($cursor <= $until) {
        $rangeEnd = $cursor->modify('+14 days')->modify('-1 second');
        if ($rangeEnd > $until) $rangeEnd = $until;
        $syncRange($cursor->format('Y-m-d\TH:i:s'), $rangeEnd->format('Y-m-d\TH:i:s'));
        $cursor = $rangeEnd->modify('+1 second');
    }
} else {
    $syncRange('', '');
}

$eventRetention = max(7, min(365, (int)($config['app']['event_retention_days'] ?? 60)));
$profileRetention = max($eventRetention, min(730, max(30, (int)($config['app']['profile_retention_days'] ?? 180))));
$pdo->exec('DELETE FROM events WHERE created_at < DATE_SUB(NOW(), INTERVAL ' . $eventRetention . ' DAY)');
$pdo->exec('DELETE FROM anonymous_users WHERE last_seen_at < DATE_SUB(NOW(), INTERVAL ' . $profileRetention . ' DAY)');

fwrite(STDOUT, sprintf(
    "同期完了: ranges=%d / API走査=%d / works保存=%d / genre関連=%d / series関連=%d / price変更=%d / event保持=%d日 / profile保持=%d日\n",
    $ranges,
    $seen,
    $saved,
    $genreSaved,
    $seriesSaved,
    $priceChanges,
    $eventRetention,
    $profileRetention,
));
flock($lock, LOCK_UN);
fclose($lock);
