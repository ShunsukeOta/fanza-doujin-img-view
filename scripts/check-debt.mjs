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
  "components/ComingSoonFloorPage.tsx",
  "components/Onboarding.tsx",
  "styles/onboarding.css",
  "src/onboardingState.ts",
  "docs/onboarding-implementation.md",
  "server/app/src/ComicOnlyCleanup.php",
  "server/app/tests/comic-only-cleanup-integration.php",
]) {
  if (existsSync(path)) fail(`廃止済みファイル ${path} が残っています。`);
}

for (const path of ["components/FloorTabs.tsx", "src/floors.ts"]) {
  if (!existsSync(path)) fail(`UIフロア切替に必要な ${path} がありません。`);
}

const styleFiles = [
  "styles/globals.css",
  "styles/navigation.css",
  "styles/pages.css",
  "styles/reader.css",
  "styles/discovery.css",
  "styles/accessibility.css",
  "styles/viewport.css",
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
  ".floor-switcher",
  ".video-feed-item",
  ".video-embed-player",
  ".video-swipe-zone",
  ".onboarding",
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
  ".floor-tabs",
  ".floor-tab",
  ".floor-coming-card",
  "--app-height",
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
  "installMainResumeLifecycle",
  "installViewportSizing",
  "<SwipePreviewApp",
  "<FloorTabs",
  "floorFromLocation",
], "Main");
mustNotContain(main, [
  "FloorSwitcher",
  "ComingSoonFloorPage",
  'pathname === "/amateur"',
  'pathname === "/actress"',
  'styles/video.css',
  "Onboarding",
  "onboardingState",
  "onboarding.css",
  "hasCompletedOnboarding",
  "markOnboardingComplete",
  "skipOnboarding",
], "Main");

const floorUi = read("src/floors.ts");
mustContain(floorUi, [
  '"comic" | "actress" | "amateur"',
  'label: "同人漫画"',
  'label: "女優動画"',
  'label: "素人動画"',
  'available: false',
  'floorContextPath',
], "UIフロア定義");
mustNotContain(floorUi, ["floor_key", "sample_movie_url", "/api/"], "UIフロア定義");

const floorTabs = read("components/FloorTabs.tsx");
mustContain(floorTabs, ["FLOORS.map", "floorContextPath", "準備中", "FloorComingSoon"], "フロア切替UI");
mustNotContain(floorTabs, ["fetch(", "fetchJson", "/api/", "VideoWorkCard"], "フロア切替UI");

const myPage = read("components/MyPage.tsx");
mustContain(myPage, ["subscribeReaderSettings", "readerSettingsEqual"], "マイページ");
mustNotContain(myPage, ["Onboarding", "guideOpen", "setGuideOpen", "操作ガイド"], "マイページ");

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
mustContain(searchPage, [
  "maker",
  "series",
  "genreId",
  "minRating",
  "price_asc",
  "/api/search",
  "openWorkInMain(item.cid)",
  "FloorTabs",
  "floorFromLocation",
  "FloorComingSoon",
], "詳細検索");
mustNotContain(searchPage, ["VideoWorkCard", "sampleMovieUrl", "floor_key"], "詳細検索");

const savedPage = read("components/SavedPage.tsx");
mustContain(savedPage, [
  "/api/saved",
  "openWorkInMain(item.cid)",
  "favorite-buy",
  "FloorTabs",
  "floorFromLocation",
  "FloorComingSoon",
], "保存済み");
mustNotContain(savedPage, ["VideoWorkCard", "sampleMovieUrl", "floor_key"], "保存済み");

const globalNav = read("components/GlobalNav.tsx");
mustContain(globalNav, [
  "SearchIcon",
  ">検索<",
  ">読む<",
  'navigateToSubpage("/mypage", origin)',
  "floorFromLocation",
  "floorContextPath",
], "グローバルメニュー");
mustNotContain(globalNav, ["VideoWorkCard", "sampleMovieUrl", "floor_key"], "グローバルメニュー");
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
mustNotContain(types, ["FloorKey", "mediaType", "sampleMovieUrl", "AssetType", "assetType", "assetBucket", "assetLabel", "assetTypes"], "フロントDomain型");

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
mustContain(setupDb, ["idx_works_feed", "recommendation-v3-rebuild-20260907"], "DB setup");
mustNotContain(setupDb, [
  "ComicOnlyCleanup",
  "multi-floor-amateur-video-20260908",
  "floor_key",
  "sample_movie_url",
  "asset_type",
  "asset_bucket",
  "amateur",
], "DB setup");

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

const packageJson = read("package.json");
mustNotContain(packageJson, ["comic-only-cleanup-integration.php", "ComicOnlyCleanup"], "package scripts");

const meApi = read("server/public/api/me.php");
mustContain(meApi, ["'DELETE'", "deleteProfile", "clear_anonymous_identity"], "匿名データ削除API");
const historyApi = read("server/public/api/history.php");
if (!historyApi.includes("userLibraryService->history")) fail("閲覧履歴APIがUserLibraryServiceへ接続されていません。");
const api = read("src/api.ts");
mustNotContain(api, ["retryDelay", "retryAfterMs", "ApiError"], "API補助実装");

const readme = read("README.md");
const shareDesign = read("docs/share-search-design.md");
mustNotContain(readme, ["オンボーディング", "操作ガイド", "onboarding"], "README");
mustNotContain(shareDesign, ["オンボーディング", "onboarding"], "共有・検索設計書");

if (!process.exitCode) console.log("debt check: OK");
