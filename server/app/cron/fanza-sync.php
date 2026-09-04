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

$options = getopt('', ['pages::', 'sort::']);
$pages = max(1, min(100, (int)($options['pages'] ?? ($config['app']['sync_pages'] ?? 5))));
$sort = trim((string)($options['sort'] ?? 'date')) ?: 'date';

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

$floor = $fanza->resolveDoujinFloor();
$seen = 0;
$saved = 0;
$genreSaved = 0;

$upsertWork = $pdo->prepare(
    'INSERT INTO works '
    . '(cid, title, affiliate_url, sample_images_json, sample_count, full_page_count, volume, review_count, rating, price, price_value, asset_bucket, asset_type, release_date, maker, is_active, first_seen_at, last_seen_at) '
    . 'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, NOW(), NOW()) '
    . 'ON DUPLICATE KEY UPDATE title=VALUES(title), affiliate_url=VALUES(affiliate_url), sample_images_json=VALUES(sample_images_json), '
    . 'sample_count=VALUES(sample_count), full_page_count=VALUES(full_page_count), volume=VALUES(volume), review_count=VALUES(review_count), rating=VALUES(rating), price=VALUES(price), price_value=VALUES(price_value), '
    . 'asset_bucket=VALUES(asset_bucket), asset_type=VALUES(asset_type), release_date=VALUES(release_date), maker=VALUES(maker), '
    . 'is_active=1, last_seen_at=NOW()'
);
$upsertGenre = $pdo->prepare(
    'INSERT INTO genres (id, name, ruby) VALUES (?, ?, ?) '
    . 'ON DUPLICATE KEY UPDATE name=VALUES(name), ruby=VALUES(ruby)'
);

foreach ($fanza->fetchGenres((string)$floor['floorId']) as $genre) {
    $upsertGenre->execute([(string)$genre['id'], (string)$genre['name'], (string)($genre['ruby'] ?? '')]);
    $genreSaved++;
}
$deleteWorkGenres = $pdo->prepare('DELETE FROM work_genres WHERE work_cid = ?');
$insertWorkGenre = $pdo->prepare('INSERT IGNORE INTO work_genres (work_cid, genre_id) VALUES (?, ?)');

for ($pageIndex = 0; $pageIndex < $pages; $pageIndex++) {
    $offset = 1 + $pageIndex * 100;
    $page = $fanza->fetchItemPage($floor, $offset, '', $sort, 100);
    if ($page['items'] === []) {
        break;
    }

    $pdo->beginTransaction();
    try {
        foreach ($page['items'] as $rawItem) {
            $seen++;
            $item = $fanza->feedItem($rawItem);
            $cid = (string)$item['cid'];
            if ($cid === '') {
                continue;
            }
            $releaseDate = null;
            if (($item['releaseDate'] ?? '') !== '') {
                $timestamp = strtotime((string)$item['releaseDate']);
                if ($timestamp !== false) {
                    $releaseDate = date('Y-m-d H:i:s', $timestamp);
                }
            }
            $price = (string)$item['price'];
            $upsertWork->execute([
                $cid,
                (string)$item['title'],
                (string)$item['affiliateUrl'],
                json_encode($item['images'], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE),
                (int)$item['sampleCount'],
                $item['fullPageCount'] ?? null,
                (string)($item['volume'] ?? ''),
                (int)$item['reviews'],
                (float)$item['rating'],
                $price,
                sync_numeric_price($price),
                (string)$item['assetBucket'],
                (string)$item['assetType'],
                $releaseDate,
                (string)($item['maker'] ?? ''),
            ]);
            $saved++;

            $deleteWorkGenres->execute([$cid]);
            foreach (($item['genreRows'] ?? []) as $genre) {
                $genreId = trim((string)($genre['id'] ?? ''));
                $genreName = trim((string)($genre['name'] ?? ''));
                if ($genreId === '' || $genreName === '') {
                    continue;
                }
                $upsertGenre->execute([$genreId, $genreName, (string)($genre['ruby'] ?? '')]);
                $insertWorkGenre->execute([$cid, $genreId]);
                $genreSaved++;
            }
        }
        $pdo->commit();
    } catch (Throwable $error) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        throw $error;
    }

    fwrite(STDOUT, sprintf("page=%d offset=%d rows=%d saved=%d\n", $pageIndex + 1, $offset, count($page['items']), $saved));
    if (count($page['items']) < 100 || (int)$page['resultCount'] < 100) {
        break;
    }
    usleep(150000);
}

$eventRetention = max(7, min(365, (int)($config['app']['event_retention_days'] ?? 60)));
$profileRetention = max($eventRetention, min(730, max(30, (int)($config['app']['profile_retention_days'] ?? 180))));
$pdo->exec('DELETE FROM events WHERE created_at < DATE_SUB(NOW(), INTERVAL ' . $eventRetention . ' DAY)');
$pdo->exec('DELETE FROM anonymous_users WHERE last_seen_at < DATE_SUB(NOW(), INTERVAL ' . $profileRetention . ' DAY)');

fwrite(STDOUT, sprintf(
    "同期完了: API走査=%d / works保存=%d / genre関連=%d / event保持=%d日 / profile保持=%d日\n",
    $seen,
    $saved,
    $genreSaved,
    $eventRetention,
    $profileRetention,
));
flock($lock, LOCK_UN);
fclose($lock);
