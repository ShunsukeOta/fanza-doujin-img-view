import { readFileSync } from "node:fs";

const index = readFileSync("index.html", "utf8");
const navigation = readFileSync("styles/navigation.css", "utf8");
const viewportCss = readFileSync("styles/viewport.css", "utf8");
const viewportTs = readFileSync("src/viewport.ts", "utf8");
const main = readFileSync("src/main.tsx", "utf8");

const fail = (message) => {
  console.error(`PWA layout check: ${message}`);
  process.exitCode = 1;
};

if (!index.includes('name="apple-mobile-web-app-status-bar-style" content="black"')) {
  fail("iOS standaloneのstatus barがblackへ固定されていません。");
}
if (index.includes("black-translucent")) {
  fail("既存WebKit不具合と競合するblack-translucentが残っています。");
}
if (!index.includes("viewport-fit=cover")) {
  fail("safe-area取得に必要なviewport-fit=coverがありません。");
}

if (!viewportCss.includes("--app-height: 100dvh")) {
  fail("通常ブラウザ向けのdynamic viewport基準がありません。");
}
if (!viewportCss.includes("--app-height: 100vh")) {
  fail("dynamic viewport未対応環境向けの100vh fallbackがありません。");
}
if (!/html,\s*\nbody,\s*\n#root\s*\{[^}]*height:\s*var\(--app-height\)/s.test(viewportCss)) {
  fail("root layoutが単一のapp-heightを共有していません。");
}
if (!/\.feed,\s*\n\.subpage-shell\s*\{[^}]*height:\s*100%/s.test(viewportCss)) {
  fail("Feedとsubpageがrootの実測高を継承していません。");
}

for (const required of [
  "installViewportSizing",
  "window.innerHeight",
  "display-mode: standalone",
  "navigatorWithStandalone.standalone",
  "APP_HEIGHT_PROPERTY",
  'window.addEventListener("resize"',
  'window.addEventListener("orientationchange"',
  'window.addEventListener("pageshow"',
]) {
  if (!viewportTs.includes(required)) fail(`viewport実測処理に ${required} がありません。`);
}
if (!main.includes('import "@/styles/viewport.css"')) {
  fail("viewport CSSがアプリの最後段へ読み込まれていません。");
}
if (!main.includes("installViewportSizing();")) {
  fail("PWA起動時にviewport実測処理が開始されていません。");
}

if (!navigation.includes("--nav-safe-bottom: env(safe-area-inset-bottom, 0px)")) {
  fail("Home Indicator safe-areaが下部ナビへ接続されていません。");
}
if (!navigation.includes("bottom: max(8px, var(--nav-safe-bottom))")) {
  fail("下部ナビが通常余白とsafe-areaをmax()で統合していません。");
}
if (navigation.includes("display-mode: standalone") || navigation.includes("--nav-safe-bottom: 0px")) {
  fail("standalone時だけbottom safe-areaを無効化する旧処理が残っています。");
}

if (!process.exitCode) console.log("PWA layout check: OK");
