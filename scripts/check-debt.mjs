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
  "styles/commerce.css",
  "styles/video.css",
  "components/VideoWorkCard.tsx",
  "components/FloorSwitcher.tsx",
  "components/FloorTabs.tsx",
  "components/ComingSoonFloorPage.tsx",
  "components/Onboarding.tsx",
  "styles/onboarding.css",
  "src/floors.ts",
  "src/onboardingState.ts",
  "src/reactions.ts",
  "docs/onboarding-implementation.md",
  "server/public/api/reactions.php",
  "server/app/src/ComicOnlyCleanup.php",
  "server/app/tests/comic-only-cleanup-integration.php",
]) {
  if (existsSync(path)) fail(`廃止済みファイル ${path} が残っています。`);
}

const styleFiles = [
  "styles/globals.css",
  "styles/navigation.css",
  "styles/pages.css",
  "styles/reader.css",
  "styles/reader-zoom.css",
  "styles/reader-end-cta.css",
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
  ".floor-tabs",
  ".floor-tab",
  ".floor-coming",
  ".floor-switcher",
  ".search-kicker",
  ".video-feed-item",
  ".video-embed-player",
  ".video-swipe-zone",
  ".onboarding",
  ".favorite-price-drop",
  ".profile-status",
  ".confirm-kicker",
  ".age-gate-kicker",
  ".global-nav-main.is-active",
], "CSS");
mustContain(css, [
  ".feed-load-error",
  ".favorite-buy",
  ".favorite-deal-badge",
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
  ".search-result-buy",
  ".preview-cta-page",
  'data-reader-cta="1"',
  "backdrop-filter: blur(16px)",
  "content-visibility: auto",
  "will-change: auto",
  "--app-height",
  "--page-gutter: 16px",
  "--font-caption: 10px",
  "--font-page-title: 24px",
], "CSS");
if (!css.includes('font-family: "Noto Sans JP", sans-serif')) {
  fail("全体フォントがNoto Sans JPへ固定されていません。");
}
if (/font-size:\s*[0-9](?:\.[0-9]+)?px/.test(css)) {
  fail("ユーザー向け文字に10px未満の固定font-sizeが残っています。");
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
  'styles/reader-end-cta.css',
], "Main");
mustNotContain(main, [
  "FloorTabs",
  "FloorSwitcher",
  "FloorComingSoon",
  "floorFromLocation",
  "asset_type",
  "category",
  'pathname === "/favorites"',
  'styles/commerce.css',
  'styles/video.css',
  "Onboarding",
  "onboardingState",
  "FilterValues",
], "Main");

const components = [
  "components/AgeGate.tsx",
  "components/GlobalNav.tsx",
  "components/HistoryPage.tsx",
  "components/LegalPages.tsx",
  "components/MyPage.tsx",
  "components/SavedPage.tsx",
  "components/SearchPage.tsx",
  "components/SwipePreviewApp.tsx",
  "components/WorkCard.tsx",
].map(read).join("\n");
mustNotContain(components, [
  "AGE RESTRICTED",
  "AGE VERIFICATION",
  "DISCOVER",
  "COMING SOON",
  "ANONYMOUS",
  "DATA DELETE",
  "NO IMAGE",
  "初回リリース",
  "Video Viewer",
  "固定フィード",
  "イベント保存期間",
  "Reader UI",
  "匿名ID",
  "floorFromLocation",
  "FloorTabs",
  "FloorComingSoon",
], "ユーザー画面");

const icons = read("components/icons.tsx");
mustNotContain(icons, ["DebugIcon", "HeartIcon"], "アイコン");
mustContain(icons, ["SettingsIcon", "BookmarkIcon"], "アイコン");

const myPage = read("components/MyPage.tsx");
mustContain(myPage, ["subscribeReaderSettings", "readerSettingsEqual", "ビューアー設定", "利用データを削除"], "マイページ");
mustNotContain(myPage, ["いいね", "liked"], "マイページ");
const ageGate = read("components/AgeGate.tsx");
mustContain(ageGate, ["18歳以上ですか？", 'window.location.replace("about:blank")'], "年齢確認");
const legal = read("components/LegalPages.tsx");
mustContain(legal, ["プライバシーポリシー", "利用規約", "閲覧・操作履歴"], "法務ページ");
mustNotContain(legal, ["いいね"], "法務ページ");

const app = read("components/SwipePreviewApp.tsx");
mustContain(app, [
  "WorkCard",
  "subscribeReaderSettings",
  "SettingsIcon",
  "buildCatalogQuery",
  'params.set("feed_id"',
  'params.set("cid"',
  "ビューアー設定",
], "Feed");
mustNotContain(app, [
  "VideoWorkCard",
  "FeedFloorKey",
  "sampleMovieUrl",
  'floor === "amateur"',
  "draftFilters",
  "draftMinSamples",
  "RATING_OPTIONS",
  "applyFilters",
  "resetDraftFilters",
  "MetaResponse",
  'genre_id',
  'min_samples',
  'min_reviews',
  'min_rating',
  'min_price',
  'max_price',
  "絞り込み",
], "Feed");
if (/nextCursor === null\s*\|\|\s*!feedId/.test(app)) {
  fail("FANZA APIフォールバック時にfeedIdなしで追加取得できません。");
}
if (!app.includes('catalog.source === "database" ? catalog.apiTotal : 0')) {
  fail("FANZA APIフォールバック件数をDB総件数として表示する回帰があります。");
}

const workCard = read("components/WorkCard.tsx");
mustContain(workCard, ["loadSaveStates", "updateSaveState", "viewerSaved", "savePending", "保存"], "Reader保存");
mustNotContain(workCard, [
  "HeartIcon",
  "liked",
  "likeCount",
  "saveCount",
  "loadReactions",
  "updateReaction",
  'toggleReaction("like")',
  "action-count",
], "Reader保存");

const endCtaCss = read("styles/reader-end-cta.css");
mustContain(endCtaCss, [
  "flex: 0 0 2px",
  "width: 2px",
  "backdrop-filter: blur(16px)",
  '.feed-item[data-reader-cta="1"]',
  "pointer-events: none",
], "Reader終端CTA");
const readerMath = read("src/readerMath.ts");
mustContain(readerMath, ["CTA_OVERLAY_STRIP_PX = 2", "usesOverlayCtaStrip", "distanceFromCtaEdge"], "Reader終端CTA計算");

const searchPage = read("components/SearchPage.tsx");
mustContain(searchPage, [
  "maker",
  "series",
  "genreId",
  "minRating",
  "price_asc",
  "/api/search",
  "openWorkInMain(item.cid)",
  "search-result-buy",
  'placement: "search"',
], "詳細検索");
mustNotContain(searchPage, ["floor", "Floor", "NO IMAGE", "likeCount", "saveCount", "viewerLiked"], "詳細検索");

const savedPage = read("components/SavedPage.tsx");
mustContain(savedPage, [
  "/api/saved",
  "openWorkInMain(item.cid)",
  "favorite-buy",
  "favorite-deal-badge",
  'placement: "saved"',
], "保存済み");
mustNotContain(savedPage, ["floor", "Floor", "NO IMAGE", "likeCount", "saveCount", "viewerLiked"], "保存済み");

const globalNav = read("components/GlobalNav.tsx");
mustContain(globalNav, [
  "SearchIcon",
  ">検索<",
  ">読む<",
  'navigateToSubpage("/mypage", origin)',
], "グローバルメニュー");
mustNotContain(globalNav, ["floor", "Floor", "/favorites", "global-nav-main"], "グローバルメニュー");
const navigationCss = read("styles/navigation.css");
if (!navigationCss.includes("backdrop-filter: blur(22px)") || !navigationCss.includes("grid-template-columns: repeat(4")) {
  fail("4項目フローティング型グローバルメニューCSSがありません。");
}
if ((navigationCss.match(/\.global-nav-item\.is-active/g) ?? []).length !== 1) {
  fail("グローバルメニューの選択スタイルが共通化されていません。");
}

const workUtils = read("src/workUtils.ts");
mustContain(workUtils, ["isHttpUrl", "mergeUniqueByCid"], "作品共通処理");

const navigation = read("src/navigationState.ts");
mustContain(navigation, ["scrollLeftForLogicalPage", '"/history"', '"/search"', 'window.location.assign(`/work/${encodeURIComponent(normalized)}`)'], "復帰ナビゲーション");
mustNotContain(navigation, ["MainFloor", "/amateur?cid=", 'floor: "amateur"'], "復帰ナビゲーション");

const readerSettings = read("src/readerSettings.ts");
mustContain(readerSettings, ["subscribeReaderSettings", "readerSettingsEqual", "SETTINGS_EVENT", '"pageshow"', '"focus"'], "Reader設定同期");
const imagePreload = read("src/imagePreload.ts");
if (!imagePreload.includes("MAX_DECODE_CACHE")) fail("画像decodeキャッシュの上限がありません。");

const saveState = read("src/saveState.ts");
mustContain(saveState, ["MAX_SAVE_STATE_CIDS = 50", "/api/save-state", 'eventType: "save_toggle"', "viewerSaved"], "保存状態API");
mustNotContain(saveState, ["like", "saveCount", "reaction"], "保存状態API");
const saveStateApi = read("server/public/api/save-state.php");
mustContain(saveStateApi, ["saveStates", "saveStates"], "保存状態API");
mustNotContain(saveStateApi, ["reaction", "likeCount", "saveCount", "viewerLiked"], "保存状態API");

const types = read("lib/types.ts");
mustContain(types, ["SaveState", "viewerSaved"], "フロントDomain型");
mustNotContain(types, [
  "FloorKey",
  "mediaType",
  "sampleMovieUrl",
  "AssetType",
  "assetType",
  "assetBucket",
  "assetLabel",
  "assetTypes",
  "FilterValues",
  "ReactionSummary",
  "likeCount",
  "saveCount",
  "viewerLiked",
], "フロントDomain型");

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
mustContain(schema, ["idx_works_feed", "feed_sessions", "feed_items", "user_work_states", "saved_at"], "DB schema");
mustNotContain(schema, [
  "floor_key",
  "sample_movie_url",
  "idx_works_floor_feed",
  "asset_type",
  "asset_bucket",
  "idx_works_asset",
  "liked",
  "liked_at",
  "idx_user_work_states_work_reactions",
], "DB schema");

const eventService = read("server/app/src/EventService.php");
mustContain(eventService, [
  "SAVE_WEIGHT = 7.0",
  "AFFILIATE_CLICK_WEIGHT = 10.0",
  "saveStates(",
  "saveStatesWithPdo",
  "saveDelta",
  "'save_toggle'",
], "推薦イベント");
mustNotContain(eventService, [
  "like_toggle",
  "reactionSummaries",
  "likeCount",
  "saveCount",
  "viewerLiked",
  "SUM(saved)",
], "推薦イベント");

const userLibrary = read("server/app/src/UserLibraryService.php");
mustNotContain(userLibrary, ["liked", "viewerLiked", "likeCount", "saveCount"], "保存・履歴サービス");

const database = read("server/app/src/Database.php");
mustNotContain(database, ["floorKey", "floor_key", "sample_movie_url", "amateur"], "Database");

const sync = read("server/app/cron/fanza-sync.php");
mustContain(sync, ["resolveDoujinFloor", "isComicItem", "skippedNonComic"], "FANZA同期");
mustNotContain(sync, ["floor::", "--floor", "resolveFloor", "amateur", "videoc"], "FANZA同期");
if (sync.includes("fetchGenres")) {
  fail("同期処理が同人フロア全体のジャンルを事前投入しています。作品実データ由来に限定してください。");
}

const setupDb = read("server/app/cron/setup-db.php");
mustContain(setupDb, [
  "idx_works_feed",
  "recommendation-v3-rebuild-20260907",
  "recommendation-commerce-signals-20260909",
  "recommendation-save-only-20260909",
  "drop_column_if_exists",
  "7.0 AS signal_score",
  "DELETE FROM feed_sessions",
], "DB setup");
mustNotContain(setupDb, [
  "ComicOnlyCleanup",
  "multi-floor-amateur-video-20260908",
  "floor_key",
  "sample_movie_url",
  "asset_type",
  "asset_bucket",
  "amateur",
  "s.liked *",
], "DB setup");

const searchService = read("server/app/src/SearchService.php");
mustContain(searchService, ["maker_query", "series_query", "genre_id", "price_asc", "feedItemsByCids", "saveStates"], "SearchService");
mustNotContain(searchService, ["floor_key", "amateur", "reactionSummaries", "likeCount", "saveCount", "viewerLiked"], "SearchService");

const workPage = read("server/public/work.php");
mustContain(workPage, ['og:title', 'og:description', 'og:image', 'rel="canonical"', 'twitter:card'], "作品OGPページ");
const htaccess = read("server/public/.htaccess");
mustContain(htaccess, ["Content-Security-Policy", "work.php?cid=", "R=301", "QSD", "fonts.googleapis.com", "fonts.gstatic.com"], "本番ルーティング/CSP");
mustNotContain(htaccess, ["litevideo", "frame-src https://*.dmm", "media-src 'self' https:"], "本番CSP");

const health = read("server/public/api/health.php");
mustNotContain(health, ["PHP_VERSION", "lastError", "runtime"], "公開ヘルスチェック");
const bootstrap = read("server/app/bootstrap.php");
if (!bootstrap.includes("error_log(get_class($error)")) fail("内部エラーがサーバーログへ退避されていません。");
if (/return \$message/.test(bootstrap)) fail("RuntimeExceptionの内部文言を公開APIへ返しています。");

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

const readme = read("README.md");
const shareDesign = read("docs/share-search-design.md");
mustNotContain(readme, ["オンボーディング", "操作ガイド", "onboarding", "女優動画", "素人動画", "FloorTabs"], "README");
mustNotContain(shareDesign, ["オンボーディング", "onboarding", "女優動画", "素人動画", "FloorTabs", "COMING SOON"], "共有・検索設計書");

if (!process.exitCode) console.log("debt check: OK");
