<?php

declare(strict_types=1);

require dirname(__DIR__, 2) . '/app/bootstrap.php';

header('X-Robots-Tag: noindex, nofollow, noarchive');

$fetchSite = (string)($_SERVER['HTTP_SEC_FETCH_SITE'] ?? '');
if ($fetchSite !== '' && !in_array($fetchSite, ['same-origin', 'same-site', 'none'], true)) {
    json_response(['error' => 'Cross-site request is not allowed.'], 403, ['Cache-Control' => 'no-store']);
}

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'GET') {
    header('Allow: GET');
    json_response(['error' => 'GETのみ対応しています。'], 405, ['Cache-Control' => 'no-store']);
}

$counts = [
    'works' => 0,
    'activeWorks' => 0,
    'worksWithSamples' => 0,
    'defaultEligibleWorks' => 0,
    'genres' => 0,
    'workGenres' => 0,
    'anonymousUsers' => 0,
    'events' => 0,
    'userWorkStates' => 0,
    'userGenreScores' => 0,
];
$latest = [
    'workUpdatedAt' => null,
    'eventAt' => null,
    'userSeenAt' => null,
];
$assetCounts = [];
$eventCounts24h = [];
$serverVersion = null;
$sizeBytes = null;
$driver = null;
$pdo = $database->connection();

if ($pdo) {
    try {
        $driver = (string)$pdo->getAttribute(PDO::ATTR_DRIVER_NAME);
        $serverVersion = (string)$pdo->query('SELECT VERSION()')->fetchColumn();
        $sizeValue = $pdo->query(
            'SELECT COALESCE(SUM(data_length + index_length), 0) FROM information_schema.tables WHERE table_schema = DATABASE()',
        )->fetchColumn();
        $sizeBytes = is_numeric($sizeValue) ? (int)$sizeValue : null;

        $scalarQueries = [
            'works' => 'SELECT COUNT(*) FROM works',
            'activeWorks' => 'SELECT COUNT(*) FROM works WHERE is_active = 1',
            'worksWithSamples' => 'SELECT COUNT(*) FROM works WHERE is_active = 1 AND sample_count > 0',
            'defaultEligibleWorks' => 'SELECT COUNT(*) FROM works WHERE is_active = 1 AND sample_count >= 10 AND review_count >= 10 AND rating >= 4.5',
            'genres' => 'SELECT COUNT(*) FROM genres',
            'workGenres' => 'SELECT COUNT(*) FROM work_genres',
            'anonymousUsers' => 'SELECT COUNT(*) FROM anonymous_users',
            'events' => 'SELECT COUNT(*) FROM events',
            'userWorkStates' => 'SELECT COUNT(*) FROM user_work_states',
            'userGenreScores' => 'SELECT COUNT(*) FROM user_genre_scores',
        ];
        foreach ($scalarQueries as $key => $sql) {
            $counts[$key] = (int)$pdo->query($sql)->fetchColumn();
        }

        $latest['workUpdatedAt'] = $pdo->query('SELECT MAX(updated_at) FROM works')->fetchColumn() ?: null;
        $latest['eventAt'] = $pdo->query('SELECT MAX(created_at) FROM events')->fetchColumn() ?: null;
        $latest['userSeenAt'] = $pdo->query('SELECT MAX(last_seen_at) FROM anonymous_users')->fetchColumn() ?: null;

        $assetStmt = $pdo->query('SELECT asset_type, COUNT(*) AS total FROM works WHERE is_active = 1 GROUP BY asset_type ORDER BY total DESC');
        foreach ($assetStmt->fetchAll() as $row) {
            $assetCounts[(string)$row['asset_type']] = (int)$row['total'];
        }

        $eventStmt = $pdo->query(
            'SELECT event_type, COUNT(*) AS total FROM events WHERE created_at >= DATE_SUB(NOW(), INTERVAL 1 DAY) GROUP BY event_type ORDER BY total DESC',
        );
        foreach ($eventStmt->fetchAll() as $row) {
            $eventCounts24h[(string)$row['event_type']] = (int)$row['total'];
        }
    } catch (Throwable $error) {
        error_log('debug database query failed: ' . $error->getMessage());
    }
}

$diagnostics = null;
$diagnosticsError = null;
try {
    $diagnostics = $catalogService->diagnostics(trim((string)($_GET['genre_id'] ?? '')));
} catch (Throwable $error) {
    $diagnosticsError = public_error_message($error, 'sample_l診断を取得できませんでした。');
}

json_response([
    'ok' => $pdo !== null && $database->hasUsableCatalog(),
    'generatedAt' => date(DATE_ATOM),
    'runtime' => [
        'php' => PHP_VERSION,
        'sapi' => PHP_SAPI,
    ],
    'database' => [
        'configured' => $database->isConfigured(),
        'connected' => $pdo !== null,
        'catalogReady' => $database->hasUsableCatalog(),
        'driver' => $driver,
        'serverVersion' => $serverVersion,
        'sizeBytes' => $sizeBytes,
        'counts' => $counts,
        'latest' => $latest,
        'assetCounts' => $assetCounts,
        'eventCounts24h' => $eventCounts24h,
    ],
    'dmm' => [
        'configured' => $fanza->configured(),
    ],
    'retention' => [
        'eventDays' => max(1, (int)($config['app']['event_retention_days'] ?? 60)),
        'profileDays' => max(1, (int)($config['app']['profile_retention_days'] ?? 180)),
        'syncPages' => max(1, (int)($config['app']['sync_pages'] ?? 5)),
    ],
    'diagnostics' => $diagnostics,
    'diagnosticsError' => $diagnosticsError,
], 200, ['Cache-Control' => 'private, no-store']);
