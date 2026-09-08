import { existsSync, readFileSync } from "node:fs";

const fail = (message) => {
  console.error(`debt check: ${message}`);
  process.exitCode = 1;
};
const read = (path) => readFileSync(path, "utf8");
const mustContain = (text, values, label) => {
  for (const value of values) {
    if (!text.includes(value)) fail(`${label} に ${value} がありません。`);
  }
};
const mustNotContain = (text, values, label) => {
  for (const value of values) {
    if (text.includes(value)) fail(`${label} に廃止済み要素 ${value} が残っています。`);
  }
};

for (const path of [
  "styles/page-scroll.css",
  "styles/pwa-layout.css",
  "styles/saved-enhancements.css",
  "styles/video.css",
  "components/VideoWorkCard.tsx",
  "components/FloorSwitcher.tsx",
  "components/FloorTabs.tsx",
  "components/ComingSoonFloorPage.tsx",
  "src/floors.ts",
]) {
  if (existsSync(path)) fail(`廃止済みファイル ${path} が残っています。`);
}

const styleFiles = [
  "styles/globals.css",
  "styles/navigation.css",
  "styles/pages.css",
  "styles/reader.css",
  "styles/onboarding.css",
  "styles/discovery.css",
  "styles/accessibility.css",
];
for (const path of styleFiles) {
  if (!existsSync(path)) fail(`必須CSS ${path} がありません。`);
}
const css = styleFiles.map(read).join("\n");
mustNotContain(css, [
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
  ".floor-switcher",
  ".floor-coming",
  ".video-feed-item",
  ".video-embed-player",
  ".video-swipe-zone",
], "CSS");
mustContain(css, [
  ".feed-load-error",
  ".favorite-buy",
  ".reader-fit-width",
  ".reader-cta-link",
  ".age-gate",
  ".legal-shell",
  ".settings-list",
  ".history-list",
  ".profile-danger-zone",
  ".rating-filter",
  ".detail-search-form",
  ".search-result-grid",
], "CSS");
if (!css.includes('font-family: "Noto Sans JP", sans-serif')) {
  fail("全体フォントがNoto Sans JPへ固定されていません。");
}

const main = read("src/main.tsx");
mustContain(main, [
  "hasAgeVerification",
  "<AgeGate",
  'pathname === "/privacy"',
  'pathname === "/terms"',
  'pathname === "/history"',
  'pathname === "/search"',
  "<SearchPage",
  "workCidFromPath",
  'skipOnboarding={pathWorkCid !== ""}',
  "hasCompletedOnboarding",
  "markOnboardingComplete",
  '<Onboarding mode="first-run"',
], "Main");
mustNotContain(main, [
  "FloorSwitcher",
  "FloorTabs",
  "ComingSoonFloorPage",
  'pathname === "/amateur"',
  'pathname === "/actress"',
  'styles/video.css',
  "新規表示するたびに案内",
], "Main");

if (!existsSync("src/onboardingState.ts")) fail("オンボーディング完了状態の永続化がありません。");
const onboardingState = read("src/onboardingState.ts");
mustContain(onboardingState, [
  'swipe-preview:onboarding-v2',
  "hasCompletedOnboarding",
  "markOnboardingComplete",
  "localStorage",
  "sessionStorage",
], "オンボーディング状態");

const onboarding = read("components/Onboarding.tsx");
mustContain(onboarding, [
  "FeedPractice",
  "ReaderPractice",
  "setPointerCapture",
  "deltaY <= -42",
  "Math.abs(deltaX) >= 42",
  'aria-modal="true"',
], "オンボーディング");
mustNotContain(onboarding, [
  "key={stepIndex}",
  "handlePointerDown",
  "handlePointerUp",
  "onboarding-floating-reaction",
], "オンボーディング");

const onboardingCss = read("styles/onboarding.css");
mustContain(onboardingCss, [
  ".onboarding-practice--feed",
  ".onboarding-practice--reader",
  "touch-action: none",
  "contain: layout paint",
  "@media (prefers-reduced-motion: reduce)",
], "オンボーディングCSS");
mustNotContain(onboardingCss, [
  "perspective:",
  "backdrop-filter",
  "onboarding-floating-reaction",
  "onboarding-enter",
  "onboarding-float",
  "transform: scale(.88)",
], "オンボーディングCSS");

const myPage = read("components/MyPage.tsx");
mustContain(myPage, ['<Onboarding mode="guide"', "上下スワイプ・ページ送り・保存方法を確認"], "マイページ操作ガイド");

const app = read("components/SwipePreviewApp.tsx");
mustContain(app, ["WorkCard", "subscribeReaderSettings", "draftMinSamples", "RATING_OPTIONS", "ビューアー設定"], "Feed");
mustNotContain(app, ["VideoWorkCard", "FeedFloorKey", "sampleMovieUrl", 'floor === "amateur"'], "Feed");
if (/nextCursor === null\s*\|\|\s*!feedId/.test(app)) {
  fail("FANZA APIフォールバック時にfeedIdなしで追加取得できません。");
}
if (!app.includes('catalog.source === "database" ? catalog.apiTotal : 0')) {
  fail("FANZA APIフォールバック件数をDB総件数として表示する回帰があります。");
}

const searchPage = read("components/SearchPage.tsx");
mustContain(searchPage, ["maker", "series", "genreId", "minRating", "price_asc", "/api/search", "openWorkInMain(item.cid)"], "詳細検索");
mustNotContain(searchPage, ["FloorTabs", "floorFromLocation", "floorLabel", "COMING SOON", "amateur", "actress"], "詳細検索");

const savedPage = read("components/SavedPage.tsx");
mustContain(savedPage, ["/api/saved", "openWorkInMain(item.cid)", "favorite-buy"], "保存済み");
mustNotContain(savedPage, ["FloorTabs", "floorFromLocation", "floorLabel", "COMING SOON", "amateur", "actress"], "保存済み");

const globalNav = read("components/GlobalNav.tsx");
mustContain(globalNav, ["SearchIcon", ">検索<", ">読む<", 'navigateToSubpage("/mypage", origin)'], "グローバルメニュー");
mustNotContain(globalNav, ["floorFromLocation", "floorContextPath", "floorFeedPath", "amateur", "actress"], "グローバルメニュー");
const navigationCss = read("styles/navigation.css");
if (!navigationCss.includes("backdrop-filter: blur(22px)") || !navigationCss.includes("grid-template-columns: repeat(4")) {
  fail("4項目フローティング型グローバルメニューCSSがありません。");
}

const navigation = read("src/navigationState.ts");
mustContain(navigation, ["scrollLeftForLogicalPage", '"/history"', '"/search"', 'window.location.assign(`/work/${encodeURIComponent(normalized)}`)'], "復帰ナビゲーション");
mustNotContain(navigation, ["MainFloor", "/amateur?cid=", 'floor: "amateur"'], "復帰ナビゲーション");

const readerSettings = read("src/readerSettings.ts");
mustContain(readerSettings, ["subscribeReaderSettings", "readerSettingsEqual", "SETTINGS_EVENT", '"pageshow"', '"focus"'], "Reader設定同期");
const imagePreload = read("src/imagePreload.ts");
if (!imagePreload.includes("MAX_DECODE_CACHE")) fail("画像decodeキャッシュの上限がありません。");
const reactions = read("src/reactions.ts");
if (!reactions.includes("MAX_REACTION_QUERY_CIDS = 50")) fail("リアクションAPIとフロントの件数上限が不一致です。");

const types = read("lib/types.ts");
mustNotContain(types, ["FloorKey", "mediaType", "sampleMovieUrl", "AssetType", "assetType", "assetBucket", "assetLabel", "assetTypes"], "フロント型");

const fanza = read("server/app/src/FanzaClient.php");
mustContain(fanza, ["resolveDoujinFloor", "function isComicItem", "'makerId' =>"], "FANZAクライアント");
mustNotContain(fanza, ["videoc", "sampleMovieURL", "sampleMovieUrl", "FLOOR_DEFINITIONS", "normalizeFloorKey", "resolveFloor(", "amateur", "assetDefinitions", "assetLabel", "detectAssetBucket", "'assetType' =>", "'assetBucket' =>"], "FANZAクライアント");

const catalog = read("server/app/src/CatalogService.php");
mustContain(catalog, ["LIVE_MAX_PAGES", "stoppedInsidePage", "isComicItem", "rules-v3.2-comic"], "CatalogService");
mustNotContain(catalog, ["floor_key", "sample_movie_url", "FeedFloorKey", "rules-v3.3-amateur", "amateur", "assetType", "assetTypes", "asset_type", "assetLabel", "assetBucket"], "CatalogService");
if (/candidateTarget = min\(1500/.test(catalog)) fail("1,500件固定候補上限が残っています。");
if (catalog.includes("CRC32(CONCAT")) fail("全件式CRC32 ORDER BYが残っています。");

const workRepository = read("server/app/src/WorkRepository.php");
mustNotContain(workRepository, ["floor_key", "sample_movie_url", "sampleMovieUrl", "resolveFloor", "asset_type", "asset_bucket", "assetType", "assetBucket", "assetLabel"], "WorkRepository");
if (/upsertNormalized\(array \$item,\s*string \$source/.test(workRepository)) {
  fail("WorkRepository::upsertNormalized に未使用のsource引数が残っています。");
}

const schema = read("server/app/schema.sql");
mustContain(schema, ["idx_works_feed", "feed_sessions", "feed_items"], "DB schema");
mustNotContain(schema, ["floor_key", "sample_movie_url", "idx_works_floor_feed", "asset_type", "asset_bucket", "idx_works_asset"], "DB schema");

const database = read("server/app/src/Database.php");
mustNotContain(database, ["floorKey", "floor_key", "sample_movie_url", "amateur"], "Database");

const sync = read("server/app/cron/fanza-sync.php");
mustContain(sync, ["resolveDoujinFloor", "isComicItem", "skippedNonComic"], "FANZA同期");
mustNotContain(sync, ["floor::", "--floor", "resolveFloor", "amateur", "videoc"], "FANZA同期");
if (sync.includes("fetchGenres")) {
  fail("同期処理が同人フロア全体のジャンルを事前投入しています。作品実データ由来に限定してください。");
}

const setupDb = read("server/app/cron/setup-db.php");
mustContain(setupDb, ["ComicOnlyCleanup::run", "idx_works_feed", "recommendation-v3-rebuild-20260907"], "DB setup");
mustNotContain(setupDb, ["multi-floor-amateur-video-20260908", "floor_key", "sample_movie_url", "idx_works_floor_feed"], "DB setup本体");
if (!existsSync("server/app/src/ComicOnlyCleanup.php")) fail("本番DB縮退用の一時cleanupがありません。");
const cleanup = read("server/app/src/ComicOnlyCleanup.php");
mustContain(cleanup, ["floor_key", "sample_movie_url", "asset_type", "asset_bucket", "idx_works_feed", "multi-floor-amateur-video-20260908"], "DB cleanup");

const searchApi = read("server/public/api/search.php");
mustContain(searchApi, ["searchService->search"], "詳細検索API");
mustNotContain(searchApi, ["floorKey", "amateur"], "詳細検索API");
const savedApi = read("server/public/api/saved.php");
mustContain(savedApi, ["userLibraryService->saved"], "保存API");
mustNotContain(savedApi, ["floorKey", "amateur"], "保存API");

const searchService = read("server/app/src/SearchService.php");
mustContain(searchService, ["maker_query", "series_query", "genre_id", "price_asc", "feedItemsByCids"], "SearchService");
mustNotContain(searchService, ["floor_key", "amateur"], "SearchService");

const workPage = read("server/public/work.php");
mustContain(workPage, ['og:title', 'og:description', 'og:image', 'rel="canonical"', 'twitter:card'], "作品OGPページ");
const htaccess = read("server/public/.htaccess");
mustContain(htaccess, ["Content-Security-Policy", "work.php?cid=", "R=301", "QSD", "fonts.googleapis.com", "fonts.gstatic.com"], "本番ルーティング/CSP");
mustNotContain(htaccess, ["litevideo", "frame-src https://*.dmm", "media-src 'self' https:"], "本番CSP");

const build = read("scripts/build-shin.mjs");
mustContain(build, ['path !== "tests"', "server/public/work.php"], "本番ビルド");
const indexHtml = read("index.html");
if (!indexHtml.includes("fonts.googleapis.com") || !indexHtml.includes("Noto+Sans+JP")) {
  fail("Noto Sans JPのWeb Font読込がありません。");
}

const meApi = read("server/public/api/me.php");
mustContain(meApi, ["'DELETE'", "deleteProfile", "clear_anonymous_identity"], "匿名データ削除API");
const historyApi = read("server/public/api/history.php");
if (!historyApi.includes("userLibraryService->history")) fail("閲覧履歴APIがUserLibraryServiceへ接続されていません。");
const api = read("src/api.ts");
mustNotContain(api, ["retryDelay", "retryAfterMs", "ApiError"], "API補助実装");

if (!process.exitCode) console.log("debt check: OK");
