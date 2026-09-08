# FANZA同人 Swipe Preview

FANZA同人作品のサンプルを、TikTok / Shortsのような縦フィードと漫画向け横ページ送りで閲覧するモバイルファーストWebアプリです。

現在の本番構成は **React 19 + Vite 7 + TypeScript / PHP 8.3 / MariaDB / シンレンタルサーバー** です。Node.jsは開発・CI・ビルド時だけ使用し、本番Webサーバーには常駐させません。

> このREADMEは2026-09-08時点の`main`実装に合わせています。

## 現在のステータス

- 本番環境へ継続デプロイ中
- `index.html` は現在 `noindex,nofollow`
- PWA `display: standalone` 対応
- DBベースの固定推薦フィードを本番利用
- DBが利用できない場合はFANZA APIへフォールバック
- オンボーディングは現在、メイン画面を新規表示するたびに表示する一時仕様
- 本公開前に年齢確認、SEO公開方針、プライバシー説明を確定する必要あり

公開先: `https://wp983575.wpx.jp/`

## 主要機能

- 上下スワイプで作品を切り替える固定フィード
- 左右スワイプ / 画面端タップでサンプルページ送り
- RTL / LTR切替
- `contain` / 横幅優先の画像表示切替
- ダブルタップ / ピンチによる1〜4倍ズーム
- 次作品画像の先読み + `HTMLImageElement.decode()`による事前decode
- いいね、保存、共有
- サンプル読了後のFANZAアフィリエイトCTA
- 保存済み作品一覧と価格変化表示
- 作品名・サークル・シリーズのキーワード検索
- 作品タイプ、ジャンル、価格、サンプル枚数、レビュー件数、評価で絞り込み
- 匿名行動データからジャンル嗜好を更新するルールベース推薦
- PWA / Service Worker
- 3ステップのオンボーディング
- メイン ↔ 保存済み / マイページ間の閲覧位置復帰

## 画面

| Path | 内容 |
| --- | --- |
| `/` | メインの縦スワイプ作品フィード |
| `/saved` | 保存済み作品 |
| `/mypage` | 匿名ユーザーのマイページ |
| `/favorites` | 旧URL。`/saved`へリダイレクト |

React Routerは使用せず、現在は`src/main.tsx`でpathnameを判定して画面を出し分けています。

## オンボーディングの一時仕様

現在は検証中のため、メイン画面を新規表示するたびにオンボーディングを表示します。

閲覧済みフラグは`localStorage` / `sessionStorage` / Cookieへ保存していません。オンボーディング完了後にメインフィードを表示し、そこから閲覧位置の復帰処理を開始します。

詳細は `docs/onboarding-implementation.md` を参照してください。

## システム構成

```text
ブラウザ
  ↓
React / Vite 静的ファイル
  ↓
/api/catalog       作品フィード
/api/meta          ジャンル・作品タイプ
/api/events        行動イベント
/api/reactions     いいね・保存状態
/api/saved         保存済み作品
/api/me            匿名マイページ
/api/work-details  読了時の作品詳細・価格再確認
/api/health        稼働確認
  ↓
PHP 8.3
  ├─ MariaDB
  │   ├─ 作品 / ジャンル / シリーズ
  │   ├─ 価格履歴
  │   ├─ 行動イベント / 嗜好
  │   └─ 固定推薦フィード
  │
  └─ DMM Web Service API v3
      ├─ 新着同期
      ├─ 個別作品更新
      ├─ DB障害時のライブフォールバック
      └─ 旧作品巡回更新
```

`/api/debug` と `/api/diagnostics` は、管理トークンが設定され正しい`X-Admin-Token`が送信された場合だけ利用できます。通常の本番アクセスでは404を返します。

## カタログ取得

### 通常時: MariaDB固定フィード

DBに表示可能な作品が1件以上存在する場合、`/api/catalog`はMariaDBを使用します。

初回取得時に`feed_sessions / feed_items`へユーザー単位の推薦順序を固定し、以降は`feed_id + cursor`で同じフィードの続きを返します。リクエストごとに全順位を作り直してoffsetで切る方式ではありません。

固定フィードの有効期間は現在12時間です。

### DB利用不可時: FANZA APIフォールバック

DBへ接続できない、または表示可能なDB作品がない場合はFANZA APIからライブ取得します。

フォールバック時のレスポンスは`feedId: null`となり、`nextCursor`だけで次ページへ進みます。フロント側も`feedId`なしの追加取得へ対応しているため、1ページ目だけで停止しません。

追加取得に失敗した場合はユーザーへ「再試行」を表示し、現在は明示的な手動再試行へ一本化しています。機能していない自動retry / 指数バックオフ用stateは残していません。

## レコメンド

現在のrecommenderは **`rules-v3.1`** です。リアルタイムLLMは使用していません。

候補は主に次の3系統から作ります。

- Popular: レビュー件数・評価を重視
- Recent: 新着度を重視
- Explore: ユーザーごとの安定した探索枠

スコアには以下を反映します。

- 時間減衰したジャンル嗜好
- 評価
- レビュー人気度
- 新着度
- フィード単位の探索スコア
- 最近表示済み作品へのペナルティ

現在の生成比率は概ね **Popular 50% / Recent 25% / Explore 25%** です。候補を120件単位で追加生成し、必要な位置まで固定フィードを伸ばします。

行動学習では単純な読了率だけでなく、画像が実際に表示されたか、進んだページ数、滞在時間も使用します。短いサンプルを即スキップしただけで強い好意として加点しない設計です。

## 行動イベント

現在の主なイベントは以下です。

```text
session_start
work_impression
first_sample_loaded
sample_page_view
sample_complete
cta_view
view_end
like_toggle
save_toggle
share
affiliate_click
```

イベントは匿名ユーザーID / セッションIDと紐付けます。ページ進捗、最大到達ページ、読了率、滞在時間、feed内順位などを必要に応じて保存し、推薦と分析へ利用します。

## DB

主要テーブル:

- `works`: FANZA作品情報、サンプルURL、価格、maker / maker_id、販売状態、更新時刻
- `genres`, `work_genres`: ジャンルと作品紐付け
- `series`, `work_series`: シリーズと作品紐付け
- `work_price_history`: 価格変更履歴
- `anonymous_users`: ランダムUUIDのみの匿名ユーザー
- `events`: 閲覧・ページ進捗・読了・CTA・like/save/share・affiliate click
- `user_work_states`: いいね・保存の現在状態と各日時
- `user_genre_scores`: 行動から更新するジャンル嗜好スコア
- `feed_sessions`, `feed_items`: ユーザーごとの固定推薦フィードとcursor
- `sync_runs`: 同期・巡回更新の実行履歴
- `app_migrations`: 一度だけ行うデータ移行の管理

IPアドレスや実名情報はアプリDBへ保存しません。

初期設定ではイベント生ログを60日、匿名ユーザーと派生データを最終行動から180日で整理します。匿名ユーザーCookieは継続利用中に期限を延長します。

## FANZA作品同期

作品保守は3系統です。

1. **新着同期**: 6時間ごとに `fanza-sync.php --pages=5 --sort=date`
2. **旧作巡回**: `refresh-catalog.php` で保存・Like・アフィリエイトクリック作品を優先しつつ、`next_refresh_at`順でDB全体を巡回
3. **Retention**: `retention.php` で期限切れイベント、匿名データ、固定フィードを分割削除

作品がFANZA APIから1回取得できなかっただけでは販売終了にしません。取得不能が連続した場合に販売状態を更新し、一時API障害による誤停止を抑えます。

価格が変化した場合は`work_price_history`へ履歴を追加します。シリーズは`iteminfo.series`、メーカーIDは`iteminfo.maker`のIDを保存します。

期間バックフィルで`--since / --until`を指定した場合は14日単位へ分割し、ItemListのoffset上限による黙った取りこぼしを防ぎます。

## ディレクトリ構成

```text
components/            React UI
lib/                   フロント共通型
src/                   analytics / API / reader / navigation等
styles/                責務別CSS
public/                manifest / service worker / icons
server/public/         公開PHP APIと.htaccess
server/app/src/        PHPドメインロジック
server/app/cron/       DB構築・同期・保守cron
server/app/tests/      CI用統合テスト
scripts/               build / debt check / logic test
docs/                  実装メモ
.github/workflows/     CI / deploy / catalog maintenance
```

CSSは現在、次の6ファイルへ責務分離しています。

```text
styles/globals.css
styles/navigation.css
styles/pages.css
styles/reader.css
styles/onboarding.css
styles/accessibility.css
```

過去に分散していた`page-scroll.css` / `pwa-layout.css` / `saved-enhancements.css`は統合済みです。

## 開発

Node.jsは`>=20.19.0`です。CIではNode.js 22を使用します。

```bash
npm ci
npm run dev
```

PHP APIもローカルで動かす場合は別ターミナルで:

```bash
npm run dev:api
```

Viteは`/api`を`127.0.0.1:8787`へプロキシします。

## ローカルチェック

```bash
npm run typecheck
npm run check:php
npm run test:logic
npm run check:debt
npm run build:shin
```

`check:debt`では現在、以下のような回帰を静的検査しています。

- 削除済みCSS / UIの復活
- 必須Reader / Savedスタイルの欠落
- 画像decodeキャッシュ上限の欠落
- リアクションAPIとフロントのCID件数上限不一致
- RTL / LTR復帰処理の欠落
- FANZA `maker_id`正規化欠落
- 本番成果物への`server/app/tests`混入
- APIフォールバック時に`feedId`を必須にしてしまう回帰
- 機能しない追加取得retryコードの再混入
- `WorkRepository::upsertNormalized()`への未使用`source`引数の再混入

`build:shin`は以下を生成します。

```text
deploy/
├─ public_html/   # Vite成果物 + 公開PHP API
└─ app/           # 非公開PHPアプリ / schema / cron / src
```

`server/app/tests`と`config.local.php`は本番成果物へ含めません。

## CI

Pull RequestのCIでは以下をまとめて確認します。

- `npm ci`
- TypeScript
- 全PHP構文
- debt check
- Reader / 価格ロジック回帰
- FANZA maker ID正規化
- MariaDB migrationの再実行安全性
- 検索
- 固定feed
- 保存cursor
- 値下げ差額
- クリティカルな実装回帰
- 本番成果物build
- 秘密情報 / testコードの成果物混入

MariaDB 11.4をCI service containerとして起動し、実DBを使った統合テストも実行します。

## 本番デプロイ

`main`へのpush時は、そのコミットが**成功済みPR CIを経由していること**を確認できた場合だけ本番デプロイへ進みます。mainへの直接pushは本番デプロイ対象にしません。

デプロイ順序:

```text
PR CI成功確認
  ↓
本番成果物build
  ↓
リリース領域へ転送
  ↓
config.local.php生成
  ↓
DB migration
  ↓
app / public_html切替
  ↓
本番HTTP検証
```

本番切替後は、commit SHA、PWA manifest、CSP / HSTS / X-Frame-Options、DB/FANZA health、固定feedページング、`/saved`、`/mypage`、debug/diagnostics非公開境界まで検証します。

## GitHub Actions Secrets

```text
SHIN_SSH_PRIVATE_KEY
SHIN_DB_NAME
SHIN_DB_USER
SHIN_DB_PASSWORD
DMM_API_ID
DMM_AFFILIATE_ID
SHIN_ADMIN_TOKEN       # 管理debug/diagnosticsを利用する場合のみ
```

本番設定は`/home/wp983575/wp983575.wpx.jp/app/config.local.php`のみに生成し、Gitやビルド成果物へ含めません。

## 本公開前に残っている事項

現在は開発・検証段階のため、`noindex,nofollow`を維持しています。

検索エンジンへ公開する前に、少なくとも以下を確定・実装してください。

- 年齢確認
- プライバシー説明
- 匿名行動データの利用目的・保存期間・削除方針
- SEO公開対象ページとURL設計
- `robots` / index制御の解除条件

成人向け作品の閲覧行動を匿名IDで保存するため、データ利用方針は本公開前に利用者へ明示する前提です。
