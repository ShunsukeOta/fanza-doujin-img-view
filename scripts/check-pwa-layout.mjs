import { readFileSync } from "node:fs";

const index = readFileSync("index.html", "utf8");
const globals = readFileSync("styles/globals.css", "utf8");
const navigation = readFileSync("styles/navigation.css", "utf8");

const fail = (message) => {
  console.error(`PWA layout check: ${message}`);
  process.exitCode = 1;
};

if (!index.includes('name="apple-mobile-web-app-status-bar-style" content="black"')) {
  fail("iOS standaloneのstatus barがblackへ固定されていません。");
}
if (index.includes("black-translucent")) {
  fail("iOS standaloneでbottom chinを起こすblack-translucentが残っています。");
}
if (!index.includes("viewport-fit=cover")) {
  fail("safe-area取得に必要なviewport-fit=coverがありません。");
}

if (!/html,\s*\nbody\s*\{[^}]*height:\s*100vh;/s.test(globals)) {
  fail("html/bodyの高さが100vhで確定されていません。");
}
if (!/#root\s*\{[^}]*height:\s*100%;/s.test(globals)) {
  fail("#rootが確定済みroot viewport高を継承していません。");
}
if (/html,\s*\nbody,\s*\n#root\s*\{[^}]*height:\s*100%;/s.test(globals)) {
  fail("iOS PWA bottom chinの原因となるhtml/body/#root height:100%が再混入しています。");
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
