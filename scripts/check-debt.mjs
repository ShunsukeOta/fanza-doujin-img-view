import { existsSync, readFileSync } from "node:fs";

const fail = (message) => {
  console.error(`debt check: ${message}`);
  process.exitCode = 1;
};
const read = (path) => readFileSync(path, "utf8");
const requireFile = (path) => {
  if (!existsSync(path)) fail(`必須ファイル ${path} がありません。`);
  return existsSync(path) ? read(path) : "";
};
const mustContain = (text, values, label) => values.forEach((value) => {
  if (!text.includes(value)) fail(`${label} に ${value} がありません。`);
});
const mustNotContain = (text, values, label) => values.forEach((value) => {
  if (text.includes(value)) fail(`${label} に廃止済み要素 ${value} が残っています。`);
});

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
  "src/floors.ts",
  "src/reactions.ts",
  "server/public/api/reactions.php",
  "server/app/src/ComicOnlyCleanup.php",
]) {
  if (existsSync(path)) fail(`廃止済みファイル ${path} が残っています。`);
}

const architectureFiles = [
  "server/app/src/FeedRepository.php",
  "server/app/src/CandidateSource.php",
  "server/app/src/RecommendationRanker.php",
  "src/routes.ts",
  "src/readerResumeState.ts",
  "components/WorkCardPrimitives.tsx",
  "styles/work-cards.css",
  "scripts/test-http-contract.sh",
];
architectureFiles.forEach(requireFile);

const catalog = requireFile("server/app/src/CatalogService.php");
mustContain(catalog, [
  "ADAPTIVE_WINDOW_SIZE = 30",
  "rules-v3.3-adaptive",
  "FeedRepository",
  "CandidateSource",
  "RecommendationRanker",
  "candidateSource->collect",
  "ranker->rank",
], "CatalogService");
mustNotContain(catalog, [
  "BLOCK_SIZE = 120",
  "rules-v3.2-comic",
  "loadUserGenreScores(",
  "loadRecentlySeen(",
  "insertFeedRows(",
  "loadSession(PDO",
], "CatalogService");

const feedRepository = requireFile("server/app/src/FeedRepository.php");
mustContain(feedRepository, ["recommender_version = ?", "insertRows", "lockSession", "fetchRows"], "FeedRepository");
const candidateSource = requireFile("server/app/src/CandidateSource.php");
mustContain(candidateSource, ["popular", "recent", "explore"], "CandidateSource");
const ranker = requireFile("server/app/src/RecommendationRanker.php");
mustContain(ranker, ["boundedAffinity", "seenPenalty", "popularQuota", "recentQuota"], "RecommendationRanker");

const bootstrap = requireFile("server/app/bootstrap.php");
mustContain(bootstrap, ["FeedRepository.php", "CandidateSource.php", "RecommendationRanker.php", "new CatalogService("], "bootstrap");

const refresh = requireFile("server/app/cron/refresh-catalog.php");
mustContain(refresh, ["s.saved = 1", "plan-only", "affiliate_click"], "巡回更新");
mustNotContain(refresh, ["s.liked", "liked_at", "Like作品"], "巡回更新");

const schema = requireFile("server/app/schema.sql");
mustContain(schema, ["user_work_states", "saved_at", "feed_sessions", "recommender_version"], "DB schema");
mustNotContain(schema, [" liked ", "liked_at", "sample_movie_url", "floor_key"], "DB schema");

const navigation = requireFile("src/navigationState.ts");
mustContain(navigation, ["readActiveReader", "readMainReturnState", "scrollLeftForLogicalPage"], "navigationState");
mustNotContain(navigation, ["activeWorkSnapshot", "document.getElementById(\"feed\")"], "サブページ遷移状態");
const routes = requireFile("src/routes.ts");
mustContain(routes, ["PROTECTED_SUBPAGES", "workCidFromPath", "normalizePathname"], "routes");
const resume = requireFile("src/readerResumeState.ts");
mustContain(resume, ["rememberActiveReader", "readActiveReader", "readMainReturnState"], "readerResumeState");

const app = requireFile("components/SwipePreviewApp.tsx");
mustContain(app, ["rememberActiveReader", "buildCatalogQuery", "WorkCard"], "Feed");
mustNotContain(app, ["絞り込み", "min_rating", "genre_id", "draftFilters"], "Feed");

const main = requireFile("src/main.tsx");
mustContain(main, ["styles/work-cards.css", "normalizePathname", "workCidFromPath", "isKnownStandalonePage"], "Main");

const myPage = requireFile("components/MyPage.tsx");
mustContain(myPage, ["profile-stats--two", "保存済み", "見た作品"], "MyPage");
mustNotContain(myPage, ["いいね", "liked"], "MyPage");
const pagesCss = requireFile("styles/pages.css");
mustContain(pagesCss, [".profile-stats--two", "repeat(2, minmax(0, 1fr))", ".saved-card-save-toggle"], "pages.css");
mustNotContain(pagesCss, [".favorite-card", ".favorite-grid", ".saved-load-more", ".saved-inline-error"], "pages.css");

const primitives = requireFile("components/WorkCardPrimitives.tsx");
mustContain(primitives, ["WorkCardFrame", "WorkCardMedia", "WorkCardBody", "WorkListFeedback"], "WorkCard primitive");
for (const page of ["components/SavedPage.tsx", "components/SearchPage.tsx", "components/HistoryPage.tsx"]) {
  const source = requireFile(page);
  mustContain(source, ["WorkCardFrame", "WorkCardBody", "WorkListFeedback"], page);
  mustNotContain(source, ["saved-load-more", "saved-inline-error", "favorite-card"], page);
}

const searchPage = requireFile("components/SearchPage.tsx");
const metaFetchCount = (searchPage.match(/fetchJson<MetaResponse>/g) ?? []).length;
if (metaFetchCount !== 1) fail("検索meta取得はmount時1回に限定してください。");

const allUserCode = [
  requireFile("components/WorkCard.tsx"),
  requireFile("components/SavedPage.tsx"),
  requireFile("components/SearchPage.tsx"),
  requireFile("components/HistoryPage.tsx"),
  myPage,
  requireFile("lib/types.ts"),
  requireFile("src/saveState.ts"),
].join("\n");
mustNotContain(allUserCode, ["HeartIcon", "likeCount", "saveCount", "viewerLiked", "like_toggle", "loadReactions"], "保存専用Domain");

const publicApi = [
  "server/public/api/catalog.php",
  "server/public/api/search.php",
  "server/public/api/events.php",
  "server/public/api/save-state.php",
  "server/public/api/saved.php",
  "server/public/api/history.php",
  "server/public/api/me.php",
  "server/public/api/work-details.php",
].map(requireFile).join("\n");
mustNotContain(publicApi, ["reactionSummaries", "viewerLiked", "likeCount", "saveCount"], "公開API");

if (!process.exitCode) console.log("debt check: OK");
