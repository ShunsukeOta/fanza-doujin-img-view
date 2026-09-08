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
]) {
  if (!css.includes(required)) fail(`必須スタイル ${required} がありません。`);
}

const main = readFileSync("src/main.tsx", "utf8");
for (const removed of removedStyles) {
  const importPath = `@/${removed}`;
  if (main.includes(importPath)) fail(`削除済みCSS ${importPath} をimportしています。`);
}

const imagePreload = readFileSync("src/imagePreload.ts", "utf8");
if (!imagePreload.includes("MAX_DECODE_CACHE")) fail("画像decodeキャッシュの上限がありません。");

const reactions = readFileSync("src/reactions.ts", "utf8");
if (!reactions.includes("MAX_REACTION_QUERY_CIDS = 50")) fail("リアクションAPIとフロントの件数上限が不一致です。");

const navigation = readFileSync("src/navigationState.ts", "utf8");
if (!navigation.includes("scrollLeftForLogicalPage")) fail("復帰位置が読む方向を考慮していません。");

const fanza = readFileSync("server/app/src/FanzaClient.php", "utf8");
if (!fanza.includes("'makerId' =>")) fail("maker_idを正規化結果へ渡していません。");

const build = readFileSync("scripts/build-shin.mjs", "utf8");
if (!build.includes('path !== "tests"')) fail("本番成果物からserver/app/testsを除外していません。");

if (!process.exitCode) console.log("debt check: OK");
