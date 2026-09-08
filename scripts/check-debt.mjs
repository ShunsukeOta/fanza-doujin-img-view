import { existsSync, readFileSync } from "node:fs";

const fail = (message) => {
  console.error(`debt check: ${message}`);
  process.exitCode = 1;
};

const removedStyles = [
  "styles/page-scroll.css",
  "styles/pwa-layout.css",
  "styles/saved-enhancements.css",
];
for (const path of removedStyles) {
  if (existsSync(path)) fail(`${path} が再作成されています。pages/globalsへ統合してください。`);
}

const styleFiles = [
  "styles/globals.css",
  "styles/navigation.css",
  "styles/pages.css",
  "styles/reader.css",
  "styles/onboarding.css",
  "styles/accessibility.css",
];
const css = styleFiles.map((path) => readFileSync(path, "utf8")).join("\n");

for (const selector of [
  ".debug-action",
  ".debug-sheet",
  ".diag-table",
  ".cid-test",
  ".brand-title",
  ".genre-line",
  ".next-hint",
]) {
  if (css.includes(selector)) fail(`削除済みUIのCSS ${selector} が残っています。`);
}

for (const required of [
  ".feed-load-error",
  ".favorite-buy",
  ".favorite-actions :is(button, a)",
  ".reader-fit-width",
  ".reader-cta-link",
  ".age-gate",
  ".legal-shell",
  ".settings-list",
  ".history-list",
  ".profile-danger-zone",
]) {
  if (!css.includes(required)) fail(`必須スタイル ${required} がありません。`);
}

const main = readFileSync("src/main.tsx", "utf8");
for (const removed of removedStyles) {
  const importPath = `@/${removed}`;
  if (main.includes(importPath)) fail(`削除済みCSS ${importPath} をimportしています。`);
}
if (!main.includes("hasAgeVerification") || !main.includes("<AgeGate")) {
  fail("成人向け画面の年齢確認ゲートがありません。");
}
if (!main.includes('pathname === "/privacy"') || !main.includes('pathname === "/terms"')) {
  fail("プライバシーポリシーまたは利用規約ルートがありません。");
}
if (!main.includes('pathname === "/history"')) {
  fail("閲覧履歴ページのルートがありません。");
}

const imagePreload = readFileSync("src/imagePreload.ts", "utf8");
if (!imagePreload.includes("MAX_DECODE_CACHE")) fail("画像decodeキャッシュの上限がありません。");

const reactions = readFileSync("src/reactions.ts", "utf8");
if (!reactions.includes("MAX_REACTION_QUERY_CIDS = 50")) fail("リアクションAPIとフロントの件数上限が不一致です。");

const navigation = readFileSync("src/navigationState.ts", "utf8");
if (!navigation.includes("scrollLeftForLogicalPage")) fail("復帰位置が読む方向を考慮していません。");
if (!navigation.includes('"/history"')) fail("閲覧履歴が画面復帰ナビゲーションへ統合されていません。");

const fanza = readFileSync("server/app/src/FanzaClient.php", "utf8");
if (!fanza.includes("'makerId' =>")) fail("maker_idを正規化結果へ渡していません。");
if (!fanza.includes("function isComicItem")) fail("FANZA取得時のコミック判定がありません。");
for (const removed of ["assetDefinitions", "assetLabel", "detectAssetBucket", "'assetType' =>", "'assetBucket' =>"]) {
  if (fanza.includes(removed)) fail(`削除済み作品タイプ分類 ${removed} がFanzaClientへ残っています。`);
}

const build = readFileSync("scripts/build-shin.mjs", "utf8");
if (!build.includes('path !== "tests"')) fail("本番成果物からserver/app/testsを除外していません。");

const app = readFileSync("components/SwipePreviewApp.tsx", "utf8");
if (/nextCursor === null\s*\|\|\s*!feedId/.test(app)) {
  fail("FANZA APIフォールバック時にfeedIdなしで追加取得できません。");
}
if (!app.includes('catalog.source === "database" ? catalog.apiTotal : 0')) {
  fail("FANZA fallbackの同人フロア全件数をコミック総数として表示する回帰があります。");
}
for (const deadRetry of ["retryAttempt", "retryAt", "retryDelay", "ApiError"]) {
  if (app.includes(deadRetry)) fail(`実際に機能しない追加取得retryコード ${deadRetry} が残っています。`);
}
for (const removed of ["AssetType", "asset_type", "assetType", "作品タイプ", "CG・イラスト系", "ボイス・音声系"]) {
  if (app.includes(removed)) fail(`コミック専用UIに旧作品タイプ要素 ${removed} が残っています。`);
}

const types = readFileSync("lib/types.ts", "utf8");
for (const removed of ["AssetType", "AssetTypeDefinition", "assetType", "assetBucket", "assetLabel", "assetTypes"]) {
  if (types.includes(removed)) fail(`フロント型に旧作品タイプ要素 ${removed} が残っています。`);
}

const catalog = readFileSync("server/app/src/CatalogService.php", "utf8");
for (const removed of ["assetType", "assetTypes", "asset_type", "assetLabel", "assetBucket"]) {
  if (catalog.includes(removed)) fail(`CatalogServiceに旧作品タイプ分岐 ${removed} が残っています。`);
}
if (!catalog.includes("LIVE_MAX_PAGES") || !catalog.includes("isComicItem")) {
  fail("FANZA fallbackがコミックだけを複数ページ走査する実装になっていません。");
}
if (!catalog.includes("stoppedInsidePage")) {
  fail("FANZA fallbackが部分ページでlimit到達した際のcursor継続を保護していません。");
}

const workRepository = readFileSync("server/app/src/WorkRepository.php", "utf8");
if (/upsertNormalized\(array \$item,\s*string \$source/.test(workRepository)) {
  fail("WorkRepository::upsertNormalized に未使用のsource引数が残っています。");
}
for (const removed of ["asset_type", "asset_bucket", "assetType", "assetBucket", "assetLabel"]) {
  if (workRepository.includes(removed)) fail(`WorkRepositoryに旧作品タイプ列 ${removed} への依存が残っています。`);
}

const schema = readFileSync("server/app/schema.sql", "utf8");
for (const removed of ["asset_type", "asset_bucket", "idx_works_asset"]) {
  if (schema.includes(removed)) fail(`新規DB schemaに旧作品タイプ定義 ${removed} が残っています。`);
}

const sync = readFileSync("server/app/cron/fanza-sync.php", "utf8");
if (!sync.includes("isComicItem") || !sync.includes("skippedNonComic")) {
  fail("同期処理がコミック以外を除外していません。");
}
if (sync.includes("fetchGenres")) {
  fail("同期処理が同人フロア全体のジャンルを事前投入しています。コミック実データ由来に限定してください。");
}

const setupDb = readFileSync("server/app/cron/setup-db.php", "utf8");
if (!setupDb.includes("comic-only-catalog-20260908") || !setupDb.includes("removed_non_comic")) {
  fail("既存DBの非コミック作品を整理するmigrationがありません。");
}
if (!setupDb.includes("LEFT JOIN work_genres") || !setupDb.includes("LEFT JOIN work_series")) {
  fail("コミック専用化migrationで孤立ジャンル・シリーズを整理していません。");
}
const comicMark = setupDb.indexOf("mark_migration($pdo, $comicOnlyMigration);");
const comicDdl = setupDb.indexOf("ALTER TABLE works MODIFY asset_type");
if (comicDdl >= 0 && (comicMark < 0 || comicMark < comicDdl)) {
  fail("コミック専用化migrationが互換DDL完了前に適用済みmarkされています。");
}

const api = readFileSync("src/api.ts", "utf8");
for (const deadApi of ["retryDelay", "retryAfterMs", "ApiError"]) {
  if (api.includes(deadApi)) fail(`未使用のAPI補助実装 ${deadApi} が残っています。`);
}

const meApi = readFileSync("server/public/api/me.php", "utf8");
if (!meApi.includes("'DELETE'") || !meApi.includes("deleteProfile") || !meApi.includes("clear_anonymous_identity")) {
  fail("匿名データ削除APIが完全に接続されていません。");
}

const historyApi = readFileSync("server/public/api/history.php", "utf8");
if (!historyApi.includes("userLibraryService->history")) fail("閲覧履歴APIがUserLibraryServiceへ接続されていません。");

const htaccess = readFileSync("server/public/.htaccess", "utf8");
const router = readFileSync("server/public/router.php", "utf8");
if (!htaccess.includes("history") || !router.includes("history")) fail("閲覧履歴APIのルーティングが不足しています。");

if (!process.exitCode) console.log("debt check: OK");