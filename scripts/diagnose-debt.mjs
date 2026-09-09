import { existsSync, readFileSync } from "node:fs";

const group = process.env.DEBT_GROUP ?? "";
const read = (path) => readFileSync(path, "utf8");
const fail = (message) => {
  console.error(message);
  process.exitCode = 1;
};
const has = (text, values, label) => values.forEach((value) => {
  if (!text.includes(value)) fail(`${label}: missing ${value}`);
});
const not = (text, values, label) => values.forEach((value) => {
  if (text.includes(value)) fail(`${label}: obsolete ${value}`);
});

if (group === "paths-css") {
  for (const path of [
    "styles/page-scroll.css", "styles/pwa-layout.css", "styles/saved-enhancements.css", "styles/commerce.css",
    "styles/video.css", "components/VideoWorkCard.tsx", "components/FloorSwitcher.tsx", "components/FloorTabs.tsx",
    "components/ComingSoonFloorPage.tsx", "components/Onboarding.tsx", "styles/onboarding.css", "src/floors.ts",
    "src/onboardingState.ts", "src/reactions.ts", "docs/onboarding-implementation.md", "server/public/api/reactions.php",
    "server/app/src/ComicOnlyCleanup.php", "server/app/tests/comic-only-cleanup-integration.php",
  ]) if (existsSync(path)) fail(`obsolete path ${path}`);
  const styleFiles = [
    "styles/globals.css", "styles/navigation.css", "styles/pages.css", "styles/reader.css", "styles/reader-zoom.css",
    "styles/reader-end-cta.css", "styles/discovery.css", "styles/accessibility.css", "styles/viewport.css",
  ];
  styleFiles.forEach((path) => { if (!existsSync(path)) fail(`missing CSS ${path}`); });
  const css = styleFiles.map(read).join("\n");
  not(css, [".debug-action", ".debug-sheet", ".diag-table", ".cid-test", ".brand-title", ".genre-line", ".next-hint",
    ".reader-settings-note", ".floor-tabs", ".floor-tab", ".floor-coming", ".floor-switcher", ".search-kicker",
    ".video-feed-item", ".video-embed-player", ".video-swipe-zone", ".onboarding", ".favorite-price-drop",
    ".profile-status", ".confirm-kicker", ".age-gate-kicker", ".global-nav-main.is-active"], "CSS");
  has(css, [".feed-load-error", ".favorite-buy", ".favorite-deal-badge", ".reader-fit-width", ".reader-cta-link",
    ".age-gate", ".legal-shell", ".settings-list", ".history-list", ".profile-danger-zone", ".rating-filter",
    ".detail-search-form", ".search-result-grid", ".search-result-buy", ".preview-cta-page", 'data-reader-cta="1"',
    "backdrop-filter: blur(16px)", "content-visibility: auto", "will-change: auto", "--app-height",
    "--page-gutter: 16px", "--font-caption: 10px", "--font-page-title: 24px"], "CSS");
  if (!css.includes('font-family: "Noto Sans JP", sans-serif')) fail("font family");
  if (/font-size:\s*[0-9](?:\.[0-9]+)?px/.test(css)) fail("font-size under 10px");
}

if (group === "client-core") {
  const main = read("src/main.tsx");
  has(main, ["hasAgeVerification", "<AgeGate", 'pathname === "/privacy"', 'pathname === "/terms"', 'pathname === "/history"',
    'pathname === "/search"', "<SearchPage", "workCidFromPath", "installMainResumeLifecycle", "installViewportSizing",
    "<SwipePreviewApp", 'styles/reader-end-cta.css'], "Main");
  not(main, ["FloorTabs", "FloorSwitcher", "FloorComingSoon", "floorFromLocation", "asset_type", "category",
    'pathname === "/favorites"', 'styles/commerce.css', 'styles/video.css', "Onboarding", "onboardingState", "FilterValues"], "Main");
  const icons = read("components/icons.tsx");
  not(icons, ["DebugIcon", "HeartIcon"], "icons");
  has(icons, ["SettingsIcon", "BookmarkIcon"], "icons");
  const app = read("components/SwipePreviewApp.tsx");
  has(app, ["WorkCard", "subscribeReaderSettings", "SettingsIcon", "buildCatalogQuery", 'params.set("feed_id"',
    'params.set("cid"', "ビューアー設定"], "Feed");
  not(app, ["VideoWorkCard", "FeedFloorKey", "sampleMovieUrl", 'floor === "amateur"', "draftFilters", "draftMinSamples",
    "RATING_OPTIONS", "applyFilters", "resetDraftFilters", "MetaResponse", "genre_id", "min_samples", "min_reviews",
    "min_rating", "min_price", "max_price", "絞り込み"], "Feed");
  const work = read("components/WorkCard.tsx");
  has(work, ["loadSaveStates", "updateSaveState", "viewerSaved", "savePending", "保存"], "WorkCard");
  not(work, ["HeartIcon", "liked", "likeCount", "saveCount", "loadReactions", "updateReaction", 'toggleReaction("like")', "action-count"], "WorkCard");
  const cta = read("styles/reader-end-cta.css");
  has(cta, ["flex: 0 0 2px", "width: 2px", "backdrop-filter: blur(16px)", '.feed-item[data-reader-cta="1"]', "pointer-events: none"], "CTA");
  const math = read("src/readerMath.ts");
  has(math, ["CTA_OVERLAY_STRIP_PX = 2", "usesOverlayCtaStrip", "distanceFromCtaEdge"], "ReaderMath");
}

if (group === "client-pages") {
  const my = read("components/MyPage.tsx");
  has(my, ["subscribeReaderSettings", "readerSettingsEqual", "ビューアー設定", "利用データを削除"], "MyPage");
  not(my, ["いいね", "liked"], "MyPage");
  const legal = read("components/LegalPages.tsx");
  has(legal, ["プライバシーポリシー", "利用規約", "閲覧・操作履歴"], "Legal");
  not(legal, ["いいね"], "Legal");
  const search = read("components/SearchPage.tsx");
  has(search, ["maker", "series", "genreId", "minRating", "price_asc", "/api/search", "openWorkInMain(item.cid)",
    "search-result-buy", 'placement: "search"'], "Search");
  not(search, ["floor", "Floor", "NO IMAGE", "likeCount", "saveCount", "viewerLiked"], "Search");
  const saved = read("components/SavedPage.tsx");
  has(saved, ["/api/saved", "openWorkInMain(item.cid)", "favorite-buy", "favorite-deal-badge", 'placement: "saved"], "Saved");
  not(saved, ["floor", "Floor", "NO IMAGE", "likeCount", "saveCount", "viewerLiked"], "Saved");
  const nav = read("components/GlobalNav.tsx");
  has(nav, ["SearchIcon", ">検索<", ">読む<", 'navigateToSubpage("/mypage", origin)'], "Nav");
  not(nav, ["floor", "Floor", "/favorites", "global-nav-main"], "Nav");
  const navCss = read("styles/navigation.css");
  if ((navCss.match(/\.global-nav-item\.is-active/g) ?? []).length !== 1) fail("nav active style count");
  const save = read("src/saveState.ts");
  has(save, ["MAX_SAVE_STATE_CIDS = 50", "/api/save-state", 'eventType: "save_toggle"', "viewerSaved"], "saveState");
  not(save, ["like", "saveCount", "reaction"], "saveState");
  const types = read("lib/types.ts");
  has(types, ["SaveState", "viewerSaved"], "types");
  not(types, ["FloorKey", "mediaType", "sampleMovieUrl", "AssetType", "assetType", "assetBucket", "assetLabel", "assetTypes",
    "FilterValues", "ReactionSummary", "likeCount", "saveCount", "viewerLiked"], "types");
}

if (group === "server-db") {
  const schema = read("server/app/schema.sql");
  has(schema, ["idx_works_feed", "feed_sessions", "feed_items", "user_work_states", "saved_at"], "schema");
  not(schema, ["floor_key", "sample_movie_url", "idx_works_floor_feed", "asset_type", "asset_bucket", "idx_works_asset",
    "liked", "liked_at", "idx_user_work_states_work_reactions"], "schema");
  const events = read("server/app/src/EventService.php");
  has(events, ["SAVE_WEIGHT = 7.0", "AFFILIATE_CLICK_WEIGHT = 10.0", "saveStates(", "saveStatesWithPdo", "saveDelta", "'save_toggle'"], "events");
  not(events, ["like_toggle", "reactionSummaries", "likeCount", "saveCount", "viewerLiked", "SUM(saved)"], "events");
  const library = read("server/app/src/UserLibraryService.php");
  not(library, ["liked", "viewerLiked", "likeCount", "saveCount"], "library");
  const setup = read("server/app/cron/setup-db.php");
  has(setup, ["idx_works_feed", "recommendation-v3-rebuild-20260907", "recommendation-commerce-signals-20260909",
    "recommendation-save-only-20260909", "drop_column_if_exists", "7.0 AS signal_score", "DELETE FROM feed_sessions"], "setup");
  not(setup, ["ComicOnlyCleanup", "multi-floor-amateur-video-20260908", "floor_key", "sample_movie_url", "asset_type",
    "asset_bucket", "amateur", "s.liked *"], "setup");
  const search = read("server/app/src/SearchService.php");
  has(search, ["maker_query", "series_query", "genre_id", "price_asc", "feedItemsByCids", "saveStates"], "SearchService");
  not(search, ["floor_key", "amateur", "reactionSummaries", "likeCount", "saveCount", "viewerLiked"], "SearchService");
}

if (group === "legacy-infra") {
  const fanza = read("server/app/src/FanzaClient.php");
  has(fanza, ["resolveDoujinFloor", "function isComicItem", "'makerId' =>"], "Fanza");
  not(fanza, ["videoc", "sampleMovieURL", "sampleMovieUrl", "FLOOR_DEFINITIONS", "normalizeFloorKey", "resolveFloor(",
    "amateur", "assetDefinitions", "assetLabel", "detectAssetBucket", "'assetType' =>", "'assetBucket' =>"], "Fanza");
  const catalog = read("server/app/src/CatalogService.php");
  has(catalog, ["LIVE_MAX_PAGES", "stoppedInsidePage", "isComicItem", "rules-v3.2-comic"], "Catalog");
  not(catalog, ["floor_key", "sample_movie_url", "FeedFloorKey", "rules-v3.3-amateur", "amateur", "assetType", "assetTypes",
    "asset_type", "assetLabel", "assetBucket", "CRC32(CONCAT"], "Catalog");
  const repo = read("server/app/src/WorkRepository.php");
  not(repo, ["floor_key", "sample_movie_url", "sampleMovieUrl", "resolveFloor", "asset_type", "asset_bucket", "assetType",
    "assetBucket", "assetLabel"], "WorkRepository");
  const db = read("server/app/src/Database.php");
  not(db, ["floorKey", "floor_key", "sample_movie_url", "amateur"], "Database");
  const sync = read("server/app/cron/fanza-sync.php");
  has(sync, ["resolveDoujinFloor", "isComicItem", "skippedNonComic"], "sync");
  not(sync, ["floor::", "--floor", "resolveFloor", "amateur", "videoc"], "sync");
  const workPage = read("server/public/work.php");
  has(workPage, ['og:title', 'og:description', 'og:image', 'rel="canonical"', 'twitter:card'], "workPage");
  const ht = read("server/public/.htaccess");
  has(ht, ["Content-Security-Policy", "work.php?cid=", "R=301", "QSD", "fonts.googleapis.com", "fonts.gstatic.com"], "htaccess");
  not(ht, ["litevideo", "frame-src https://*.dmm", "media-src 'self' https:"], "htaccess");
  const readme = read("README.md");
  const design = read("docs/share-search-design.md");
  not(readme, ["オンボーディング", "操作ガイド", "onboarding", "女優動画", "素人動画", "FloorTabs"], "README");
  not(design, ["オンボーディング", "onboarding", "女優動画", "素人動画", "FloorTabs", "COMING SOON"], "design");
}

if (!process.exitCode) console.log(`diagnose debt ${group}: OK`);
