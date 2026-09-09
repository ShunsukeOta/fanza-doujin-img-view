import { readFileSync } from "node:fs";

const read = (path) => readFileSync(path, "utf8");
const fail = (message) => {
  console.error(`commerce check: ${message}`);
  process.exitCode = 1;
};
const requireText = (text, values, label) => {
  for (const value of values) {
    if (!text.includes(value)) fail(`${label} に ${value} がありません。`);
  }
};

const app = read("components/SwipePreviewApp.tsx");
requireText(app, [
  "const WINDOW_RADIUS = 2;",
  "Math.abs(index - activeWork) <= WINDOW_RADIUS",
  "feed-item feed-item-virtual",
  "preloadAndDecodeImage(nextImage",
], "Reader windowing");

const commerceCss = read("styles/commerce.css");
requireText(commerceCss, [
  "content-visibility: auto",
  "content-visibility: hidden",
  "will-change: auto",
  ".is-reader-zoomed .reader-image-stage > img",
  ".favorite-deal-badge",
  ".search-result-buy",
], "commerce.css");

const tracking = read("src/commerceTracking.ts");
requireText(tracking, [
  'const CTA_SELECTOR = ".open-link"',
  'eventType: "cta_view"',
  'placement: "overlay"',
  "intersectionRatio < 0.8",
  "}, 650)",
], "CTA表示計測");

const saved = read("components/SavedPage.tsx");
requireText(saved, [
  "favorite-deal-badge",
  "保存時より",
  "値下げ中にFANZAで見る",
  'placement: "saved"',
  "priceDropValue",
  "savedPriceValue",
], "保存済みCV導線");

const search = read("components/SearchPage.tsx");
requireText(search, [
  "search-result-buy",
  "FANZAで見る",
  'placement: "search"',
  "viewerSaved",
], "検索CV導線");

const events = read("server/app/src/EventService.php");
requireText(events, [
  "AFFILIATE_CLICK_WEIGHT = 10.0",
  "SAMPLE_COMPLETE_WEIGHT = 1.0",
  "firstEventWeight(",
  "'affiliate_click',\n                7,",
  "'sample_complete',\n                1,",
], "推薦イベントシグナル");

const setup = read("server/app/cron/setup-db.php");
requireText(setup, [
  "recommendation-commerce-signals-20260909",
  "affiliate_click",
  "sample_complete",
  "view_end",
  "DELETE FROM feed_sessions",
], "推薦データ再構築");

const integration = read("server/app/tests/integration.php");
requireText(integration, [
  "初回FANZAクリックが最強シグナルとして10点加算されていない",
  "同一作品への7日以内FANZAクリック連打",
], "推薦統合テスト");

if (!process.exitCode) console.log("commerce check: OK");
