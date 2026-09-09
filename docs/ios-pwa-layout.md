# iOS Home Screen PWA layout

## 現在の方針

Home Screen PWAの画面高は、CSSの`vh / dvh / lvh`を単独の真実源にしません。

- 通常ブラウザ: `100dvh`（未対応環境は`100vh`）
- standalone / fullscreen: `window.innerHeight`を実測し、`--app-height`へ設定
- `html / body / #root`は同じ`--app-height`を共有
- Feedとsubpageはroot高を`100%`で継承
- 下部ナビのHome Indicator回避は`env(safe-area-inset-bottom)`を利用
- standaloneだけsafe-areaを0へ潰す分岐は置かない

`src/viewport.ts`は`resize / orientationchange / pageshow / visibilitychange`で実測値を更新します。

## WebKit側の既知制約

2026年時点のiOS 26系では、Home Screen standaloneで`screen.height`より`window.innerHeight / 100dvh / visualViewport.height`が約60px短くなり、その領域がWebレイヤー外に描画されるWebKit不具合が報告されています。この領域はDOM/CSSから物理的に埋められません。

そのため本実装の責務は、WebKitが描画可能と報告する領域を過不足なく使い、アプリ側の二重safe-areaやviewport unit差分による追加の余白を発生させないことです。

参考:
- WebKit Bug 301994: Home Screen standaloneで物理画面とWeb viewportに約62px差が発生する報告
- WebKit Bug 316008: iOS 26 standaloneで100vh/lvhの値がstatus bar設定に依存する報告
- WebKit Bug 254868: installed web app + viewport-fit=coverのviewport値に関する既知問題

## status bar

`apple-mobile-web-app-status-bar-style`は`black`を使用します。アプリはステータスバー背後へ重要UIを描画する必要がなく、`black-translucent`で過去に報告されているbottom positioning / safe-area競合を避けます。

このメタ情報はiOSのインストール時状態に依存するため、既存のHome Screen PWAで旧設定が残っている場合は削除・再追加しない限り完全には切り替わらない可能性があります。
