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
  ".reader-settings-note",
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
  ".rating-filter",
]) {
  if (!css.includes(required)) fail(`必須スタイル ${required} がありません。`);
}

if (!css.includes('font-family: "Noto Sans JP", sans-serif')) {
  fail("全体フォントがNoto Sans JPへ固定されていません。");
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

const readerSettings = readFileSync("src/readerSettings.ts", "utf8");
for (const required of ["subscribeReaderSettings", "readerSettingsEqual", "SETTINGS_EVENT", '"pageshow"', '"focus"']) {
  if (!readerSettings.includes(required)) fail(`Reader設定同期に必要な ${required} がありません。`);
}

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
for (const required of ["subscribeReaderSettings", "draftMinSamples", "draftMinReviews", "RATING_OPTIONS", "ビューアー設定"]) {
  if (!app.includes(required)) fail(`絞り込み/Reader改善に必要な ${required} がありません。`);
}
if (app.includes("ダブルタップで拡大・解除、2本指ピンチで1〜4倍に拡大できます。設定はこの端末に保存されます。")) {
  fail("削除対象のReader補足テキストが再混入しています。");
}
if (/id="min_rating"\s+type="number"/.test(app)) {
  fail("最低評価が数値入力へ戻っています。5段階の星UIを使用してください。");
}
for (const deadRetry of ["retryAttempt", "retryAt", "retryDelay", "ApiError"]) {
  if (app.includes(deadRetry)) fail(`実際に機能しない追加取得retryコード ${deadRetry} が残っています。`);
}
for (const removed of ["AssetType", "asset_type", "assetType", "作品タイプ", "CG・イラスト系", "ボイス・音声系"]) {
  if (app.includes(removed)) fail(`コミック専用UIに旧作品タイプ要素 ${removed} が残っています。`);
}

const myPage = readFileSync("components/MyPage.tsx", "utf8");
if (!myPage.includes("subscribeReaderSettings") || !myPage.includes("readerSettingsEqual")) {
  fail("マイページのReader設定が絞り込み画面と同期されていません。");
}

const globalNav = readFileSync("components/GlobalNav.tsx", "utf8");
const navigationCss = readFileSync("styles/navigation.css", "utf8");
if (!globalNav.includes("global-nav-main") || !globalNav.includes(">読む<")) {
  fail("刷新後のグローバルメニュー構造がありません。");
}
if (!navigationCss.includes("backdrop-filter: blur(22px)") || !navigationCss.includes("grid-template-columns: repeat(3")) {
  fail("刷新後のフローティング型グローバルメニューCSSがありません。");
}

const readerCss = readFileSync("styles/reader.css", "utf8");
if (!readerCss.includes("white-space: nowrap") || !readerCss.includes("gap: 12px")) {
  fail("スワイプ案内またはReaderアクション余白の改善が欠落しています。");
}

const indexHtml = readFileSync("index.html", "utf8");
if (!indexHtml.includes("fonts.googleapis.com") || !indexHtml.includes("Noto+Sans+JP")) {
  fail("Noto Sans JPのWeb Font読込がありません。");
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
if (!htaccess.includes("fonts.googleapis.com") || !htaccess.includes("fonts.gstatic.com")) {
  fail("Noto Sans JP配信元がCSPで許可されていません。");
}

if (!process.exitCode) console.log("debt check: OK");
