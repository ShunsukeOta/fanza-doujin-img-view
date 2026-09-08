import { existsSync, readFileSync } from "node:fs";

const fail = (message) => {
  console.error(`debt check: ${message}`);
  process.exitCode = 1;
};
const mustContain = (text, values, label) => {
  for (const value of values) {
    if (!text.includes(value)) fail(`${label} に ${value} がありません。`);
  }
};

const removedStyles = [
  "styles/page-scroll.css",
  "styles/pwa-layout.css",
  "styles/saved-enhancements.css",
];
for (const path of removedStyles) {
  if (existsSync(path)) fail(`${path} が再作成されています。既存CSSへ統合してください。`);
}

const styleFiles = [
  "styles/globals.css",
  "styles/navigation.css",
  "styles/pages.css",
  "styles/reader.css",
  "styles/video.css",
  "styles/onboarding.css",
  "styles/discovery.css",
  "styles/accessibility.css",
];
for (const path of styleFiles) {
  if (!existsSync(path)) fail(`必須CSS ${path} がありません。`);
}
const css = styleFiles.map((path) => readFileSync(path, "utf8")).join("\n");
for (const selector of [
  ".debug-action",
  ".debug-sheet",
  ".diag-table",
  ".cid-test",
  ".brand-title",
  ".genre-line",
  ".next-hint",
  ".reader-settings-note",
  ".floor-tabs",
  ".floor-tab",
]) {
  if (css.includes(selector)) fail(`削除済みUIのCSS ${selector} が残っています。`);
}
mustContain(css, [
  ".feed-load-error",
  ".favorite-buy",
  ".reader-fit-width",
  ".reader-cta-link",
  ".age-gate",
  ".legal-shell",
  ".floor-switcher",
  ".floor-switcher-menu",
  ".detail-search-form",
  ".search-result-grid",
  ".video-feed-item",
  ".video-embed-player",
  ".video-swipe-zone",
], "CSS");
if (!css.includes('font-family: "Noto Sans JP", sans-serif')) {
  fail("全体フォントがNoto Sans JPへ固定されていません。");
}

const main = readFileSync("src/main.tsx", "utf8");
mustContain(main, [
  "hasAgeVerification",
  "<AgeGate",
  'pathname === "/privacy"',
  'pathname === "/terms"',
  'pathname === "/history"',
  'pathname === "/search"',
  "<SearchPage",
  "workCidFromPath",
  "<FloorSwitcher",
  'pathname === "/amateur"',
  "FeedFloorKey",
  'skipOnboarding={pathWorkCid !== ""}',
  'import "@/styles/video.css"',
], "Main");

const floors = readFileSync("src/floors.ts", "utf8");
mustContain(floors, [
  '{ key: "comic", label: "同人漫画", available: true }',
  '{ key: "actress", label: "女優動画", available: false }',
  '{ key: "amateur", label: "素人動画", available: true }',
  'return "/amateur"',
], "フロア定義");

const app = readFileSync("components/SwipePreviewApp.tsx", "utf8");
mustContain(app, [
  "VideoWorkCard",
  "WorkCard",
  "FeedFloorKey",
  'floor === "comic"',
  "subscribeReaderSettings",
  "draftMinSamples",
  "RATING_OPTIONS",
  "ビューアー設定",
], "Feed共通Shell");
if (/nextCursor === null\s*\|\|\s*!feedId/.test(app)) {
  fail("FANZA APIフォールバック時にfeedIdなしで追加取得できません。");
}
if (!app.includes('catalog.source === "database" ? catalog.apiTotal : 0')) {
  fail("FANZA APIフォールバック件数をDB総件数として表示する回帰があります。");
}

const videoCard = readFileSync("components/VideoWorkCard.tsx", "utf8");
mustContain(videoCard, [
  "sampleMovieUrl",
  "<iframe",
  "<video",
  'mode === "embed"',
  'mode === "direct"',
  "onVerticalSwipe",
  'eventType: "work_impression"',
  'eventType: "view_end"',
  'eventType: "affiliate_click"',
  "updateReaction",
], "素人動画カード");
if (videoCard.includes("readingDirection") || videoCard.includes("readerMath") || videoCard.includes("MAX_ZOOM")) {
  fail("素人動画カードへ漫画Reader専用処理が混入しています。");
}

const searchPage = readFileSync("components/SearchPage.tsx", "utf8");
mustContain(searchPage, [
  "maker",
  "series",
  "genreId",
  "minRating",
  "price_asc",
  "/api/search",
  'floor: "comic" | "amateur"',
  "openWorkInMain(item.cid, searchableFloor)",
], "詳細検索");
const savedPage = readFileSync("components/SavedPage.tsx", "utf8");
mustContain(savedPage, [
  "floorFromLocation",
  "/api/saved",
  "floor: availableFloor",
  "openWorkInMain(item.cid, availableFloor)",
], "保存済み");

const navigation = readFileSync("src/navigationState.ts", "utf8");
mustContain(navigation, [
  "scrollLeftForLogicalPage",
  'type MainFloor = "comic" | "amateur"',
  '`/amateur?cid=${encodeURIComponent(normalized)}`',
  '`/work/${encodeURIComponent(normalized)}`',
], "復帰ナビゲーション");

const readerSettings = readFileSync("src/readerSettings.ts", "utf8");
mustContain(readerSettings, ["subscribeReaderSettings", "readerSettingsEqual", "SETTINGS_EVENT", '"pageshow"', '"focus"'], "Reader設定同期");
const imagePreload = readFileSync("src/imagePreload.ts", "utf8");
if (!imagePreload.includes("MAX_DECODE_CACHE")) fail("画像decodeキャッシュの上限がありません。");
const reactions = readFileSync("src/reactions.ts", "utf8");
if (!reactions.includes("MAX_REACTION_QUERY_CIDS = 50")) fail("リアクションAPIとフロントの件数上限が不一致です。");

const fanza = readFileSync("server/app/src/FanzaClient.php", "utf8");
mustContain(fanza, [
  "function isComicItem",
  "function resolveFloor",
  "digital_doujin",
  "videoc",
  "sampleMovieURL",
  "'sampleMovieUrl' =>",
  "'floorKey' =>",
  "'makerId' =>",
], "FANZAクライアント");
for (const removed of ["assetDefinitions", "assetLabel", "detectAssetBucket", "'assetType' =>", "'assetBucket' =>"]) {
  if (fanza.includes(removed)) fail(`削除済み旧分類 ${removed} がFanzaClientへ残っています。`);
}

const catalog = readFileSync("server/app/src/CatalogService.php", "utf8");
mustContain(catalog, [
  "LIVE_MAX_PAGES",
  "stoppedInsidePage",
  "isComicItem",
  "floor_key",
  "sample_movie_url",
  "rules-v3.3-amateur",
  "rules-v3.3-comic",
], "CatalogService");
for (const removed of ["assetType", "assetTypes", "asset_type", "assetLabel", "assetBucket"]) {
  if (catalog.includes(removed)) fail(`CatalogServiceに旧分類 ${removed} が残っています。`);
}

const workRepository = readFileSync("server/app/src/WorkRepository.php", "utf8");
mustContain(workRepository, [
  "floor_key",
  "sample_movie_url",
  "fetchAndUpsert(string $cid, string $floorKey",
  "resolveFloor($floorKey)",
], "WorkRepository");
for (const removed of ["asset_type", "asset_bucket", "assetType", "assetBucket", "assetLabel"]) {
  if (workRepository.includes(removed)) fail(`WorkRepositoryに旧分類 ${removed} が残っています。`);
}

const schema = readFileSync("server/app/schema.sql", "utf8");
mustContain(schema, ["floor_key", "sample_movie_url", "idx_works_floor_feed"], "DB schema");
for (const removed of ["asset_type", "asset_bucket", "idx_works_asset"]) {
  if (schema.includes(removed)) fail(`新規DB schemaに旧分類 ${removed} が残っています。`);
}

const database = readFileSync("server/app/src/Database.php", "utf8");
if (!database.includes("hasUsableCatalog(string $floorKey")) fail("DB利用可否判定がフロア別ではありません。");

const sync = readFileSync("server/app/cron/fanza-sync.php", "utf8");
mustContain(sync, [
  "floor::",
  "['all', 'comic', 'amateur']",
  "['comic', 'amateur']",
  "resolveFloor($floorKey)",
  "isComicItem",
], "FANZA同期");
if (sync.includes("fetchGenres")) {
  fail("同期処理がフロア全体のジャンルを事前投入しています。作品実データ由来に限定してください。");
}

const setupDb = readFileSync("server/app/cron/setup-db.php", "utf8");
mustContain(setupDb, [
  "comic-only-catalog-20260908",
  "multi-floor-amateur-video-20260908",
  "removed_non_comic",
  "floor_key",
  "sample_movie_url",
  "DELETE FROM feed_sessions",
], "DB migration");

const htaccess = readFileSync("server/public/.htaccess", "utf8");
mustContain(htaccess, [
  "Content-Security-Policy",
  "frame-src https://*.dmm.co.jp",
  "media-src 'self' https:",
], "本番CSP");

const build = readFileSync("scripts/build-shin.mjs", "utf8");
mustContain(build, ['path !== "tests"', "server/public/work.php"], "本番ビルド");
const indexHtml = readFileSync("index.html", "utf8");
if (!indexHtml.includes("fonts.googleapis.com") || !indexHtml.includes("Noto+Sans+JP")) {
  fail("Noto Sans JPのWeb Font読込がありません。");
}

const globalNav = readFileSync("components/GlobalNav.tsx", "utf8");
mustContain(globalNav, ["SearchIcon", ">検索<", ">読む<", "floorContextPath", "floorFeedPath"], "グローバルメニュー");
const floorSwitcher = readFileSync("components/FloorSwitcher.tsx", "utf8");
mustContain(floorSwitcher, ["FLOORS", "floorContextPath", "表示するコンテンツ", 'aria-haspopup="menu"', "onFloorChange"], "表示切替UI");
const floorCompat = readFileSync("components/FloorTabs.tsx", "utf8");
if (!floorCompat.includes("<FloorSwitcher")) fail("既存画面のフロア切替がFloorSwitcherへ統一されていません。");

const meApi = readFileSync("server/public/api/me.php", "utf8");
mustContain(meApi, ["'DELETE'", "deleteProfile", "clear_anonymous_identity"], "匿名データ削除API");
const api = readFileSync("src/api.ts", "utf8");
for (const deadApi of ["retryDelay", "retryAfterMs", "ApiError"]) {
  if (api.includes(deadApi)) fail(`未使用のAPI補助実装 ${deadApi} が残っています。`);
}
