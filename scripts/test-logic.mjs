import assert from "node:assert/strict";
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
console.log("logic regression tests: OK");
