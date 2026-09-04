import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const dist = resolve(root, "dist");
const deploy = resolve(root, "deploy");
const publicOut = resolve(deploy, "public_html");
const appOut = resolve(deploy, "app");

if (!existsSync(dist)) throw new Error("dist/ がありません。先に Vite build を実行してください。");

await rm(deploy, { recursive: true, force: true });
await mkdir(publicOut, { recursive: true });
await mkdir(appOut, { recursive: true });

await cp(dist, publicOut, { recursive: true });
await cp(resolve(root, "server/public/.htaccess"), resolve(publicOut, ".htaccess"));
await cp(resolve(root, "server/public/api"), resolve(publicOut, "api"), { recursive: true });
await cp(resolve(root, "server/app"), appOut, { recursive: true });

const version = {
  commit: process.env.GITHUB_SHA || "local",
  builtAt: new Date().toISOString(),
};
await writeFile(resolve(publicOut, "version.json"), JSON.stringify(version));

console.log("シンレンタルサーバー用成果物を deploy/public_html と deploy/app に生成しました。");
