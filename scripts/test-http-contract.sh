#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:8787}"
COOKIE_JAR="$(mktemp)"
SERVER_LOG="$(mktemp)"
cleanup() {
  rm -f "$COOKIE_JAR" "$SERVER_LOG"
  if [ -n "${PHP_SERVER_PID:-}" ]; then kill "$PHP_SERVER_PID" 2>/dev/null || true; fi
}
trap cleanup EXIT

php -r '
$config = require "server/app/config.local.php";
$dsn = sprintf("mysql:host=%s;port=%d;dbname=%s;charset=%s", $config["db"]["host"], $config["db"]["port"], $config["db"]["name"], $config["db"]["charset"]);
$pdo = new PDO($dsn, $config["db"]["user"], $config["db"]["password"], [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
$stmt = $pdo->prepare("INSERT INTO works (cid,title,affiliate_url,sample_images_json,sample_count,review_count,rating,price,price_value,maker,random_key,is_active,availability_status,details_checked_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,NOW()) ON DUPLICATE KEY UPDATE title=VALUES(title), sample_count=VALUES(sample_count), is_active=1");
$stmt->execute(["ci-contract-001","CI Contract Work","https://example.invalid/affiliate",json_encode(["https://example.invalid/sample.jpg"]),1,12,4.8,"1,000円",1000,"CI Circle",12345,1,"active"]);
'

php -S 127.0.0.1:8787 server/public/router.php >"$SERVER_LOG" 2>&1 &
PHP_SERVER_PID=$!
READY=0
for _ in $(seq 1 30); do
  if curl --silent --fail "$BASE_URL/api/health" >/dev/null; then READY=1; break; fi
  sleep .2
done
if [ "$READY" -ne 1 ]; then
  cat "$SERVER_LOG" >&2
  exit 1
fi

curl_json() {
  curl --fail --silent --show-error -c "$COOKIE_JAR" -b "$COOKIE_JAR" -H 'Accept: application/json' "$@"
}

CATALOG="$(curl_json "$BASE_URL/api/catalog?limit=1")"
node -e 'const x=JSON.parse(process.argv[1]); if(!Array.isArray(x.items)||x.items.length===0||!x.feedId||x.recommenderVersion!=="rules-v3.3-adaptive") process.exit(1)' "$CATALOG"

SEARCH="$(curl_json "$BASE_URL/api/search?limit=1&q=CI%20Contract")"
node -e 'const x=JSON.parse(process.argv[1]); if(x.ok!==true||!Array.isArray(x.items)||!x.items.some(i=>i.cid==="ci-contract-001")) process.exit(1)' "$SEARCH"

SAVE="$(curl_json -H 'Content-Type: application/json' -X POST --data '{"eventType":"save_toggle","eventId":"11111111-1111-4111-8111-111111111111","eventVersion":3,"cid":"ci-contract-001","metadata":{"active":true}}' "$BASE_URL/api/events")"
node -e 'const x=JSON.parse(process.argv[1]); if(x.ok!==true||x.saveState?.viewerSaved!==true) process.exit(1)' "$SAVE"

STATE="$(curl_json "$BASE_URL/api/save-state?cids=ci-contract-001")"
node -e 'const x=JSON.parse(process.argv[1]); if(x.ok!==true||x.saveStates?.["ci-contract-001"]?.viewerSaved!==true) process.exit(1)' "$STATE"

curl_json -H 'Content-Type: application/json' -X POST --data '{"eventType":"work_impression","eventId":"22222222-2222-4222-8222-222222222222","eventVersion":3,"cid":"ci-contract-001"}' "$BASE_URL/api/events" >/dev/null
HISTORY="$(curl_json "$BASE_URL/api/history?limit=10")"
node -e 'const x=JSON.parse(process.argv[1]); if(x.ok!==true||!Array.isArray(x.items)||!x.items.some(i=>i.cid==="ci-contract-001")) process.exit(1)' "$HISTORY"

ME="$(curl_json "$BASE_URL/api/me")"
node -e 'const x=JSON.parse(process.argv[1]); if(x.ok!==true||!x.profile) process.exit(1)' "$ME"

DETAILS="$(curl_json "$BASE_URL/api/work-details?cid=ci-contract-001")"
node -e 'const x=JSON.parse(process.argv[1]); if(x.ok!==true||x.cid!=="ci-contract-001") process.exit(1)' "$DETAILS"

EVENTS_GET="$(curl --silent --output /dev/null --write-out '%{http_code}' "$BASE_URL/api/events")"
test "$EVENTS_GET" = "405"

echo "HTTP contract: OK"
