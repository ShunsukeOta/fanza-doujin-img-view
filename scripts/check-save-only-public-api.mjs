import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const fail = (message) => {
  console.error(`save-only public API check: ${message}`);
  process.exitCode = 1;
};
const read = (path) => readFileSync(path, "utf8");

const catalog = read("server/public/api/catalog.php");
for (const required of ["saveStates(", "viewerSaved"]) {
  if (!catalog.includes(required)) fail(`catalog.php に ${required} がありません。`);
}

const publicFiles = [];
const collect = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) collect(path);
    else if (/\.(?:php|htaccess)$/.test(entry.name) || entry.name === ".htaccess") publicFiles.push(path);
  }
};
collect("server/public");

const obsolete = [
  "reactionSummaries",
  "likeCount",
  "saveCount",
  "viewerLiked",
  "reactions.php",
  "|reactions|",
];
for (const path of publicFiles) {
  const text = read(path);
  for (const value of obsolete) {
    if (text.includes(value)) fail(`${path} に廃止済み要素 ${value} が残っています。`);
  }
}

for (const path of ["server/public/router.php", "server/public/.htaccess"]) {
  const text = read(path);
  if (!text.includes("save-state")) fail(`${path} に save-state ルートがありません。`);
}

if (!process.exitCode) console.log("save-only public API check: OK");
