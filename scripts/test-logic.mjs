import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  logicalPageFromDirectionalScroll,
  logicalPageFromScroll,
  progressedSamplePages,
  sampleReadRatio,
  scrollLeftForLogicalPage,
  tapNavigationDelta,
} from "../.tmp-test/readerMath.js";
import { formatPrice } from "../.tmp-test/price.js";

assert.equal(logicalPageFromScroll(1000, 1000, 100, 10), 0, "右端の1ページ目は論理ページ0");
assert.equal(logicalPageFromScroll(1000, 900, 100, 10), 1, "左へ1ページ進むと論理ページ1");
assert.equal(logicalPageFromScroll(1000, 0, 100, 10), 10, "左端はCTAページ");
assert.equal(logicalPageFromDirectionalScroll(1000, 0, 100, 10, "ltr"), 0, "LTRでは左端が1ページ目");
assert.equal(logicalPageFromDirectionalScroll(1000, 100, 100, 10, "ltr"), 1, "LTRでは右へ1ページ進む");
assert.equal(scrollLeftForLogicalPage(1000, 100, 3, 10, "rtl"), 700, "RTLページ3のscrollLeft");
assert.equal(scrollLeftForLogicalPage(1000, 100, 3, 10, "ltr"), 300, "LTRページ3のscrollLeft");

const overlayMax = 902;
assert.equal(logicalPageFromDirectionalScroll(overlayMax, 2, 100, 10, "rtl"), 9, "RTL最終画像はCTA化しない");
assert.equal(logicalPageFromDirectionalScroll(overlayMax, 0, 100, 10, "rtl"), 10, "RTL最終画像の次だけCTA状態になる");
assert.equal(logicalPageFromDirectionalScroll(overlayMax, 900, 100, 10, "ltr"), 9, "LTR最終画像はCTA化しない");
assert.equal(logicalPageFromDirectionalScroll(overlayMax, 902, 100, 10, "ltr"), 10, "LTR最終画像の次だけCTA状態になる");
assert.equal(scrollLeftForLogicalPage(overlayMax, 100, 9, 10, "rtl"), 2, "RTL最終画像とCTA間は2pxだけ移動する");
assert.equal(scrollLeftForLogicalPage(overlayMax, 100, 10, 10, "rtl"), 0, "RTL CTAは仮想ページ端へ移動する");
assert.equal(scrollLeftForLogicalPage(overlayMax, 100, 9, 10, "ltr"), 900, "LTR最終画像とCTA間は2pxだけ移動する");
assert.equal(scrollLeftForLogicalPage(overlayMax, 100, 10, 10, "ltr"), 902, "LTR CTAは仮想ページ端へ移動する");
assert.equal(logicalPageFromDirectionalScroll(2, 2, 100, 1, "rtl"), 0, "RTL 1枚作品の画像状態を維持する");
assert.equal(logicalPageFromDirectionalScroll(2, 0, 100, 1, "rtl"), 1, "RTL 1枚作品でもCTAへ進める");
assert.equal(logicalPageFromDirectionalScroll(2, 0, 100, 1, "ltr"), 0, "LTR 1枚作品の画像状態を維持する");
assert.equal(logicalPageFromDirectionalScroll(2, 2, 100, 1, "ltr"), 1, "LTR 1枚作品でもCTAへ進める");

assert.equal(tapNavigationDelta(0.1, "rtl"), 1, "RTLでは左30%タップで次ページ");
assert.equal(tapNavigationDelta(0.9, "rtl"), -1, "RTLでは右30%タップで前ページ");
assert.equal(tapNavigationDelta(0.5, "rtl"), 0, "中央40%はUI切替");
assert.equal(tapNavigationDelta(0.1, "ltr"), -1, "LTRでは左タップで前ページ");
assert.equal(tapNavigationDelta(0.9, "ltr"), 1, "LTRでは右タップで次ページ");
assert.equal(sampleReadRatio(10, 0), 0.1, "10枚中1枚目を100%として扱わない");
assert.equal(sampleReadRatio(1, 0), 1, "1枚作品の絶対読了率は1でも進行枚数は別判定する");
assert.equal(progressedSamplePages(0, 0), 0, "初期ページだけでは進行扱いにしない");
assert.equal(progressedSamplePages(0, 3), 3, "ページ進行数を論理ページで算出する");
assert.equal(formatPrice("500〜1,000円"), "500〜1,000円", "価格帯表現を誤って5001000円にしない");
assert.equal(formatPrice("1,000円"), "¥1,000", "単一価格だけ数値整形する");
assert.equal(formatPrice("", 1250), "¥1,250", "DB数値価格を優先する");

const endCtaCss = readFileSync("styles/reader-end-cta.css", "utf8");
assert.match(endCtaCss, /\.preview-cta-page\s*\{[\s\S]*flex:\s*0 0 2px/, "CTA仮想ページが2pxに縮退していない");
assert.match(endCtaCss, /backdrop-filter:\s*blur\(16px\)/, "最終画像のブラー表示がない");
assert.match(endCtaCss, /data-reader-cta="1"/, "CTA状態だけオーバーレイを表示するCSSがない");

const navigationCss = readFileSync("styles/navigation.css", "utf8");
assert.doesNotMatch(navigationCss, /global-nav-main\.is-active/, "読むタブだけ特別なアクティブ色が残っている");
assert.match(navigationCss, /\.global-nav-indicator\s*\{[\s\S]*transition:\s*transform 140ms/, "背景ピルの高速移動アニメーションがない");
assert.doesNotMatch(navigationCss, /transform 280ms/, "背景ピルの280ms遅延が戻っている");
assert.match(navigationCss, /global-nav\[data-active="search"\] \.global-nav-indicator/, "背景ピルのタブ追従がない");
const globalNav = readFileSync("components/GlobalNav.tsx", "utf8");
assert.doesNotMatch(globalNav, /global-nav-main/, "読むタブだけ専用classが残っている");
assert.doesNotMatch(globalNav, /NAVIGATION_SETTLE_MS|320/, "グローバルメニューの320ms待機が戻っている");
assert.match(globalNav, /className="global-nav-indicator"/, "背景ピル自体が消えている");
assert.match(globalNav, /transitionend/, "背景ピルの移動完了と画面遷移が同期していない");
assert.match(globalNav, /NAVIGATION_FALLBACK_MS = 180/, "背景ピル遷移失敗時の短いfallbackがない");

console.log("logic regression tests: OK");
