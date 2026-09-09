import { readFileSync } from "node:fs";

const source = readFileSync("components/GlobalNav.tsx", "utf8");
const required = [
  'addEventListener("pagehide"',
  'addEventListener("pageshow"',
  'addEventListener("popstate"',
  "syncSnapshotDom",
  "currentNav()",
];

for (const token of required) {
  if (!source.includes(token)) {
    console.error(`global nav check: ${token} がありません。`);
    process.exit(1);
  }
}

console.log("global nav state check: OK");
