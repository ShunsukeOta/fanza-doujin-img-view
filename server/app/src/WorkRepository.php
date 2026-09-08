<?php

declare(strict_types=1);

namespace SwipePreview;

use PDO;
use RuntimeException;
use Throwable;

final class WorkRepository
{
    public function __construct(
        private readonly Database $database,
        private readonly FanzaClient $fanza,
    ) {
    }

    public function upsertNormalized(array $item): array
    {
        $pdo = $this->requirePdo();
        $cid = trim((string)($item['cid'] ?? ''));
        if ($cid === '' || preg_match('/^[A-Za-z0-9_-]{1,128}$/', $cid) !== 1) {
            throw new RuntimeException('作品CIDが不正です。');
        }
        $floorKey = ($item['floorKey'] ?? 'comic') === 'amateur' ? 'amateur' : 'comic';
        $sampleMovieUrl = trim((string)($item['sampleMovieUrl'] ?? ''));
        if ($floorKey === 'amateur' && !preg_match('~^https?://~i', $sampleMovieUrl)) {
            throw new RuntimeException('素人動画のサンプルURLが不正です。');
        }

        $price = trim((string)($item['price'] ?? ''));
        $priceValue = PriceParser::singleValue($price);
        $randomKey = (int)sprintf('%u', crc32($floorKey . '|' . $cid));
        $releaseDate = $this->dateValue((string)($item['releaseDate'] ?? ''));
        $detailsStatus = $floorKey === 'comic' && isset($item['fullPageCount']) && is_int($item['fullPageCount'])
            ? 'known'
            : ($floorKey === 'amateur' ? 'known' : 'unknown');

        $pdo->beginTransaction();
        try {
            $existing = $pdo->prepare('SELECT floor_key, price, price_value FROM works WHERE cid = ? FOR UPDATE');
            $existing->execute([$cid]);
            $previous = $existing->fetch();
            if (is_array($previous) && (string)($previous['floor_key'] ?? 'comic') !== $floorKey) {
                throw new RuntimeException('同一CIDが別フロアですでに登録されています。');
            }

            $stmt = $pdo->prepare(
                'INSERT INTO works '
                . '(cid, floor_key, title, product_url, affiliate_url, description, sample_images_json, sample_movie_url, sample_count, full_page_count, volume, review_count, rating, price, price_value, release_date, maker, maker_id, random_key, is_active, availability_status, first_seen_at, last_seen_at, metadata_checked_at, price_checked_at, availability_checked_at, details_checked_at, details_status, next_refresh_at, refresh_fail_count) '
                . 'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, \'active\', NOW(), NOW(), NOW(), NOW(), NOW(), NOW(), ?, DATE_ADD(NOW(), INTERVAL 7 DAY), 0) '
                . 'ON DUPLICATE KEY UPDATE '
                . 'floor_key=VALUES(floor_key), title=VALUES(title), product_url=COALESCE(NULLIF(VALUES(product_url), \'\'), product_url), affiliate_url=COALESCE(NULLIF(VALUES(affiliate_url), \'\'), affiliate_url), '
                . 'description=CASE WHEN VALUES(description) IS NULL OR VALUES(description)=\'\' THEN description ELSE VALUES(description) END, '
                . 'sample_images_json=VALUES(sample_images_json), sample_movie_url=VALUES(sample_movie_url), sample_count=VALUES(sample_count), '
                . 'full_page_count=COALESCE(VALUES(full_page_count), full_page_count), volume=CASE WHEN VALUES(volume)<>\'\' THEN VALUES(volume) ELSE volume END, '
                . 'review_count=VALUES(review_count), rating=VALUES(rating), '
                . 'price=CASE WHEN VALUES(price)<>\'\' THEN VALUES(price) ELSE price END, price_value=CASE WHEN VALUES(price)<>\'\' THEN VALUES(price_value) ELSE price_value END, '
                . 'release_date=COALESCE(VALUES(release_date), release_date), '
                . 'maker=VALUES(maker), maker_id=VALUES(maker_id), random_key=VALUES(random_key), is_active=1, availability_status=\'active\', '
                . 'last_seen_at=NOW(), metadata_checked_at=NOW(), price_checked_at=NOW(), availability_checked_at=NOW(), '
                . 'details_checked_at=NOW(), details_status=CASE WHEN VALUES(details_status)=\'known\' THEN \'known\' ELSE details_status END, '
                . 'next_refresh_at=DATE_ADD(NOW(), INTERVAL 7 DAY), refresh_fail_count=0'
            );
            $stmt->execute([
                $cid,
                $floorKey,
                (string)($item['title'] ?? ''),
                (string)($item['productUrl'] ?? ''),
                (string)($item['affiliateUrl'] ?? ''),
                trim((string)($item['description'] ?? '')) ?: null,
                json_encode(array_values(array_filter((array)($item['images'] ?? []), 'is_string')), JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE),
                $sampleMovieUrl !== '' ? $sampleMovieUrl : null,
                max(0, (int)($item['sampleCount'] ?? 0)),
                isset($item['fullPageCount']) && is_int($item['fullPageCount']) ? $item['fullPageCount'] : null,
                (string)($item['volume'] ?? ''),
                max(0, (int)($item['reviews'] ?? 0)),
                max(0.0, min(5.0, (float)($item['rating'] ?? 0))),
                $price,
                $priceValue,
                $releaseDate,
                (string)($item['maker'] ?? ''),
                (string)($item['makerId'] ?? ''),
                $randomKey,
                $detailsStatus,
            ]);

            if ($price !== '') {
                $changed = !is_array($previous)
                    || (string)($previous['price'] ?? '') !== $price
                    || ($previous['price_value'] === null ? null : (int)$previous['price_value']) !== $priceValue;
                if ($changed) {
                    $history = $pdo->prepare('INSERT INTO work_price_history (work_cid, price, price_value, observed_at) VALUES (?, ?, ?, NOW())');
                    $history->execute([$cid, $price, $priceValue]);
                }
            }

            $this->replaceGenres($pdo, $cid, (array)($item['genreRows'] ?? []));
            $this->replaceSeries($pdo, $cid, (array)($item['seriesRows'] ?? []));
            $pdo->commit();
        } catch (Throwable $error) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            throw $error;
        }

        $saved = $this->feedItemByCid($cid);
        if ($saved === null) {
            throw new RuntimeException('保存した作品を再取得できませんでした。');
        }
        return $saved;
    }

    public function fetchAndUpsert(string $cid, string $floorKey = 'comic'): array
    {
        $floorKey = $this->fanza->normalizeFloorKey($floorKey);
        $normalized = $this->fanza->normalizeCid($cid);
        $raw = $this->fanza->fetchItem($normalized, $this->fanza->resolveFloor($floorKey));
        return $this->upsertNormalized($this->fanza->feedItem($raw, $floorKey));
    }

    public function refreshCid(string $cid): array
    {
        $pdo = $this->requirePdo();
        $floorStmt = $pdo->prepare('SELECT floor_key FROM works WHERE cid = ? LIMIT 1');
        $floorStmt->execute([$cid]);
        $floorKey = (string)($floorStmt->fetchColumn() ?: 'comic');
        try {
            $item = $this->fetchAndUpsert($cid, $floorKey);
            return ['status' => 'updated', 'item' => $item];
        } catch (Throwable $error) {
            $message = $error->getMessage();
            $notDisplayable = str_contains($message, '現在のFANZA APIでは取得できません')
                || str_contains($message, 'コミック作品ではありません')
                || str_contains($message, '表示可能な動画サンプルがありません');
            $pdo->beginTransaction();
            try {
                $stmt = $pdo->prepare('SELECT refresh_fail_count FROM works WHERE cid = ? FOR UPDATE');
                $stmt->execute([$cid]);
                $row = $stmt->fetch();
                if (is_array($row)) {
                    $fails = min(255, (int)$row['refresh_fail_count'] + 1);
                    if ($notDisplayable && $fails >= 2) {
                        $update = $pdo->prepare("UPDATE works SET refresh_fail_count=?, is_active=0, availability_status='unavailable', availability_checked_at=NOW(), next_refresh_at=DATE_ADD(NOW(), INTERVAL 30 DAY) WHERE cid=?");
                        $update->execute([$fails, $cid]);
                    } else {
                        $minutes = $notDisplayable ? 360 : min(1440, 15 * (2 ** min(6, $fails)));
                        $update = $pdo->prepare("UPDATE works SET refresh_fail_count=?, availability_status=?, next_refresh_at=DATE_ADD(NOW(), INTERVAL {$minutes} MINUTE) WHERE cid=?");
                        $update->execute([$fails, $notDisplayable ? 'checking' : 'unknown', $cid]);
                    }
                }
                $pdo->commit();
            } catch (Throwable $dbError) {
                if ($pdo->inTransaction()) $pdo->rollBack();
                error_log('refresh state update failed: ' . $dbError->getMessage());
            }
            throw $error;
        }
    }

    public function feedItemByCid(string $cid): ?array
    {
        $items = $this->feedItemsByCids([$cid]);
        return $items[$cid] ?? null;
    }

    /** @return array<string,array> */
    public function feedItemsByCids(array $cids): array
    {
        $normalized = [];
        foreach ($cids as $cid) {
            $value = trim((string)$cid);
            if ($value !== '' && preg_match('/^[A-Za-z0-9_-]{1,128}$/', $value) === 1) $normalized[$value] = true;
        }
        $cids = array_keys($normalized);
        if ($cids === []) return [];

        $pdo = $this->requirePdo();
        $placeholders = implode(',', array_fill(0, count($cids), '?'));
        $stmt = $pdo->prepare(
            'SELECT cid,floor_key,title,affiliate_url,sample_images_json,sample_movie_url,sample_count,full_page_count,review_count,rating,price,price_value,maker,maker_id,is_active,availability_status '
            . 'FROM works WHERE cid IN (' . $placeholders . ')'
        );
        $stmt->execute($cids);
        $rows = [];
        foreach ($stmt->fetchAll() as $row) $rows[(string)$row['cid']] = $row;

        $genreMap = $this->loadNames($pdo, $cids, 'work_genres', 'genre_id', 'genres');
        $seriesMap = $this->loadNames($pdo, $cids, 'work_series', 'series_id', 'series');
        $result = [];
        foreach ($cids as $cid) {
            $row = $rows[$cid] ?? null;
            if (!is_array($row)) continue;
            $images = json_decode((string)$row['sample_images_json'], true);
            $images = is_array($images) ? array_values(array_filter($images, 'is_string')) : [];
            $floorKey = (string)($row['floor_key'] ?? 'comic') === 'amateur' ? 'amateur' : 'comic';
            $result[$cid] = [
                'cid' => $cid,
                'floorKey' => $floorKey,
                'mediaType' => $floorKey === 'amateur' ? 'video' : 'comic',
                'title' => (string)$row['title'],
                'affiliateUrl' => (string)$row['affiliate_url'],
                'images' => $images,
                'sampleMovieUrl' => (string)($row['sample_movie_url'] ?? ''),
                'sampleCount' => (int)$row['sample_count'],
                'fullPageCount' => $row['full_page_count'] === null ? null : (int)$row['full_page_count'],
                'reviews' => (int)$row['review_count'],
                'rating' => (float)$row['rating'],
                'genres' => $genreMap[$cid] ?? [],
                'series' => $seriesMap[$cid] ?? [],
                'price' => (string)$row['price'],
                'priceValue' => $row['price_value'] === null ? null : (int)$row['price_value'],
                'maker' => (string)$row['maker'],
                'makerId' => (string)$row['maker_id'],
                'available' => (bool)$row['is_active'],
                'availabilityStatus' => (string)$row['availability_status'],
            ];
        }
        return $result;
    }

    private function replaceGenres(PDO $pdo, string $cid, array $rows): void
    {
        $pdo->prepare('DELETE FROM work_genres WHERE work_cid = ?')->execute([$cid]);
        $upsert = $pdo->prepare('INSERT INTO genres (id,name,ruby) VALUES (?,?,?) ON DUPLICATE KEY UPDATE name=VALUES(name),ruby=VALUES(ruby)');
        $link = $pdo->prepare('INSERT IGNORE INTO work_genres (work_cid,genre_id) VALUES (?,?)');
        foreach ($rows as $row) {
            $id = trim((string)($row['id'] ?? '')); $name = trim((string)($row['name'] ?? ''));
            if ($id === '' || $name === '') continue;
            $upsert->execute([$id, $name, (string)($row['ruby'] ?? '')]);
            $link->execute([$cid, $id]);
        }
    }

    private function replaceSeries(PDO $pdo, string $cid, array $rows): void
    {
        $pdo->prepare('DELETE FROM work_series WHERE work_cid = ?')->execute([$cid]);
        $upsert = $pdo->prepare('INSERT INTO series (id,name,ruby) VALUES (?,?,?) ON DUPLICATE KEY UPDATE name=VALUES(name),ruby=VALUES(ruby)');
        $link = $pdo->prepare('INSERT IGNORE INTO work_series (work_cid,series_id) VALUES (?,?)');
        foreach ($rows as $row) {
            $id = trim((string)($row['id'] ?? '')); $name = trim((string)($row['name'] ?? ''));
            if ($id === '' || $name === '') continue;
            $upsert->execute([$id, $name, (string)($row['ruby'] ?? '')]);
            $link->execute([$cid, $id]);
        }
    }

    private function loadNames(PDO $pdo, array $cids, string $linkTable, string $foreignColumn, string $table): array
    {
        if ($cids === []) return [];
        $placeholders = implode(',', array_fill(0, count($cids), '?'));
        $stmt = $pdo->prepare(
            "SELECT l.work_cid,t.name FROM {$linkTable} l JOIN {$table} t ON t.id=l.{$foreignColumn} WHERE l.work_cid IN ({$placeholders}) ORDER BY t.name"
        );
        $stmt->execute($cids);
        $map = [];
        foreach ($stmt->fetchAll() as $row) $map[(string)$row['work_cid']][] = (string)$row['name'];
        return $map;
    }

    private function dateValue(string $raw): ?string
    {
        $raw = trim($raw);
        if ($raw === '') return null;
        $timestamp = strtotime($raw);
        return $timestamp === false ? null : date('Y-m-d H:i:s', $timestamp);
    }

    private function requirePdo(): PDO
    {
        $pdo = $this->database->connection();
        if (!$pdo) throw new RuntimeException('作品DBが利用できません。');
        return $pdo;
    }
}
