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

const readerCss = read("styles/reader.css");
requireText(readerCss, [
  "content-visibility: auto",
  "content-visibility: hidden",
  "will-change: auto",
  ".is-reader-zoomed .reader-image-stage > img",
], "Reader CSS");

const detailsAction = read("components/WorkDetailsAction.tsx");
requireText(detailsAction, [
  'onWheel={(event) => event.stopPropagation()}',
  'onTouchMove={(event) => event.stopPropagation()}',
], "作品詳細スクロール遮断");

const detailsCss = read("styles/work-details.css");
requireText(detailsCss, [
  "overscroll-behavior-y: contain",
  "touch-action: pan-y",
  "grid-template-columns: 72px minmax(0, 1fr)",
  "align-items: center",
], "作品詳細CSS");

const workCards = read("styles/work-cards.css");
requireText(workCards, [
  ".work-card",
  ".work-card-media",
  ".work-card-actions",
  ".work-list-more",
], "共通作品カードCSS");

const pagesCss = read("styles/pages.css");
requireText(pagesCss, [
  ".saved-card.is-price-drop",
  ".saved-card-deal-badge",
  ".saved-card-deal-prices",
  ".profile-stats--two",
], "保存済み/MyPage CSS");

const discoveryCss = read("styles/discovery.css");
requireText(discoveryCss, [
  ".search-result-saved",
  ".work-card-primary",
  ".work-card-secondary",
], "検索CSS");

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
  "saved-card-deal-badge",
  "保存時より",
  "値下げ中にFANZAで見る",
  'placement: "saved"',
  "priceDropValue",
  "savedPriceValue",
  "WorkCardFrame",
], "保存済みCV導線");

const search = read("components/SearchPage.tsx");
requireText(search, [
  "search-result-buy",
  "FANZAで見る",
  'placement: "search"',
  "viewerSaved",
  "WorkCardFrame",
], "検索CV導線");

const events = read("server/app/src/EventService.php");
requireText(events, [
  "AFFILIATE_CLICK_WEIGHT = 10.0",
  "SAMPLE_COMPLETE_WEIGHT = 1.0",
  "firstEventWeight(",
  "'affiliate_click',\n                7,",
  "'sample_complete',\n                1,",
], "推薦イベントシグナル");

const catalog = read("server/app/src/CatalogService.php");
requireText(catalog, [
  "ADAPTIVE_WINDOW_SIZE = 30",
  "rules-v3.3-adaptive",
  "candidateSource->collect",
  "ranker->rank",
], "adaptive推薦");

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
