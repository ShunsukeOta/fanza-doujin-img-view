# FANZA同人 Swipe Preview

FANZA同人の**コミック作品だけ**を対象に、TikTok / Shortsのような縦フィードと漫画向け横ページ送りでサンプルを閲覧するモバイルファーストWeb/PWAです。

現在の本番構成は **React 19 + Vite 7 + TypeScript / PHP 8.3 / MariaDB / シンレンタルサーバー** です。Node.jsは開発・CI・ビルド時だけ使用し、本番Webサーバーには常駐させません。

> 2026-09-08時点。AV / 素人系動画を追加する前段として、旧「作品タイプ」機能を廃止し、現行カタログを同人コミック専用へ再設計しています。

## 現在のステータス

- 本番環境へ継続デプロイ中
- `index.html` は現在 `noindex,nofollow`
- PWA `display: standalone` 対応
- DBベースの固定推薦フィードを本番利用
- DBが利用できない場合はFANZA APIへライブフォールバック
- **取り込み・DB・Feed・検索・保存・履歴の対象はコミックのみ**
- 18歳以上確認を実装済み
- プライバシーポリシー / 利用規約を実装済み
- マイページから匿名データを自己削除可能
- オンボーディングは現在、メイン画面を新規表示するたびに表示する一時仕様

公開先: `https://wp983575.wpx.jp/`

## コミック専用化の方針

以前はFANZA同人フロア内の作品を `comic / cg / game / voice / other` に分類し、ユーザーが「作品タイプ」を選択できる設計でした。この分類・フィルターは廃止しました。

現在は次の境界でコミック専用を保証します。

1. FANZA APIレスポンスを取り込む前に `FanzaClient::isComicItem()` で `/digital/comic/` 系の作品だけを許可する
2. 新着同期では非コミック作品を保存しない
3. DB障害時のライブフォールバックでも非コミック作品をスキップする
4. 直接CID指定で非コミックを指定してもReaderへ混入させない
5. 既存DBのCG・ゲーム・音声・その他作品は一度だけmigrationで削除する
6. 非コミック削除で孤立したジャンル・シリーズを整理する
7. 古い固定Feedを破棄し、コミックだけで推薦Feedを再生成する
8. 作品タイプ用のフロント型・URLパラメータ・UI・APIフィルターを廃止する

既存本番DBに存在する旧 `asset_type / asset_bucket` 列は、旧リリースへ安全にロールバックできるよう**互換列として一時的に残します**。残存値とDEFAULTは`comic`へ固定し、新コードからは一切参照しません。新規DBの`schema.sql`には旧列を作成しません。これはexpand-contract migrationの互換期間です。

migrationは非コミック削除・孤立メタデータ整理・互換列DDLがすべて成功した後に適用済みとしてmarkします。途中失敗時は次回実行で安全に再試行できます。

旧URLの `asset_type` / `category` パラメータはフロントで削除し、カタログ条件として使用しません。

## 主要機能

- 上下スワイプでコミック作品を切り替える固定Feed
- 左右スワイプ / 画面端タップでサンプルページ送り
- RTL / LTR切替
- `contain` / 横幅優先の画像表示切替
- ダブルタップ / ピンチによる1〜4倍ズーム
- 次ページ・次作品画像の先読み + `HTMLImageElement.decode()`
- いいね、保存、共有
- サンプル読了後のFANZAアフィリエイトCTA
- 保存済み作品一覧と価格変化表示
- 閲覧履歴
- 作品名・サークル・シリーズのキーワード検索
- ジャンル、価格、サンプル枚数、レビュー件数、評価で絞り込み
- 匿名行動データからジャンル嗜好を更新するルールベース推薦
- Reader設定の端末保存
- 18歳以上確認
- 匿名データ削除
- PWA / Service Worker
- 3ステップのオンボーディング
- メイン ↔ 保存済み / マイページ / 閲覧履歴間の閲覧位置復帰

## 画面

| Path | 内容 |
| --- | --- |
| `/` | メインの縦スワイプ・コミックFeed |
| `/saved` | 保存済みコミック |
| `/mypage` | 匿名ユーザーのマイページ |
| `/history` | 閲覧履歴 |
| `/privacy` | プライバシーポリシー |
| `/terms` | 利用規約 |
| `/favorites` | 旧URL。`/saved`へリダイレクト |

React Routerは使用せず、`src/main.tsx`でpathnameを判定して画面を出し分けています。

## 年齢確認

成人向け作品を表示する画面は18歳以上確認を通過してからマウントします。

- 「この端末で確認を記憶する」がON: `localStorage`
- OFF: `sessionStorage`
- `/privacy` と `/terms` は年齢確認前でも閲覧可能
- 年齢確認前は作品画面をマウントせず、行動計測も開始しない
- 匿名データ削除時に年齢確認状態も削除

## オンボーディング

現在は検証中のため、メイン画面を新規表示するたびにオンボーディングを表示します。マイページの「操作ガイド」からも同じガイドを再表示できます。

詳細は `docs/onboarding-implementation.md` を参照してください。

## マイページ

`/mypage`では以下を利用できます。

- 保存済み件数 / 閲覧作品数 / いいね件数
- 最近見た作品
- 上位ジャンル嗜好
- Reader設定
  - 全体表示 / 横幅優先
  - 右→左 / 左→右
  - 画面端タップ送り
  - Reader UI最小化
- 操作ガイド
- 保存済み / 閲覧履歴への導線
- プライバシーポリシー / 利用規約
- 利用開始日
- 匿名データ削除

`DELETE /api/me`で現在の匿名ユーザーIDを削除します。関連する行動イベント、いいね・保存、ジャンル嗜好、固定Feedも削除し、`fp_uid / fp_sid` Cookieと`swipe-preview:`端末状態をリセットします。

## システム構成

```text
ブラウザ
  ↓
18歳以上確認
  ↓
React / Vite
  ↓
/api/catalog       コミックFeed
/api/meta          ジャンル
/api/events        行動イベント
/api/reactions     いいね・保存状態
/api/saved         保存済み
/api/history       閲覧履歴
/api/me            マイページ / 匿名データ削除
/api/work-details  読了時の作品詳細・価格再確認
/api/health        稼働確認
  ↓
PHP 8.3
  ├─ MariaDB
  │   ├─ コミック作品 / ジャンル / シリーズ
  │   ├─ 価格履歴
  │   ├─ 行動イベント / 嗜好
  │   └─ 固定推薦Feed
  │
  └─ DMM Web Service API v3
      ├─ コミック判定
      ├─ 新着同期
      ├─ 個別作品更新
      ├─ DB障害時のライブフォールバック
      └─ 旧作品巡回更新
```

`/api/debug` と `/api/diagnostics` は、管理トークンが設定され正しい`X-Admin-Token`が送信された場合だけ利用できます。通常の本番アクセスでは404を返します。

## カタログ取得

### 通常時: MariaDB固定Feed

DBに表示可能なコミックがある場合、`/api/catalog`はMariaDBを使用します。

初回取得時に`feed_sessions / feed_items`へユーザー単位の推薦順序を固定し、以降は`feed_id + cursor`で同じFeedの続きを返します。固定Feedの有効期間は12時間です。

recommender versionは **`rules-v3.2-comic`** です。

候補はPopular / Recent / Exploreを主軸にし、ジャンル嗜好、評価、レビュー人気度、新着度、探索スコア、最近表示済み作品へのペナルティを反映します。

### DB利用不可時: FANZA APIフォールバック

DBへ接続できない、または表示可能なDB作品がない場合はFANZA APIからライブ取得します。

同人フロアにはコミック以外も含まれるため、フォールバックでは最大複数APIページを走査し、`isComicItem()`を通過したコミックだけをFeedへ返します。`feedId`は`null`となり、`nextCursor`で続きを取得します。1回のAPIレスポンス途中で表示件数へ到達した場合も、未走査部分を飛ばさないcursor計算にしています。

FANZAの`total_count`は同人フロア全体の件数なので、フォールバック中はコミック総数として画面へ表示しません。画面上は現在読み込めているコミック件数を使用します。

## FANZA同期

新着同期はFANZA同人フロアのレスポンスをそのままDBへ入れません。

```text
FANZA ItemList
  ↓
isComicItem(raw)
  ├─ false → skip
  └─ true
       ↓
     feedItem()
       ↓
     WorkRepository
       ↓
     MariaDB
```

`genres / series`も同人フロア全体のマスターを事前投入せず、実際に取り込んだコミックの`iteminfo`から保存します。これによりCG・ゲーム・音声だけで使われるメタデータが再混入しません。

作品保守は3系統です。

1. **新着同期**: 6時間ごとに `fanza-sync.php --pages=5 --sort=date`
2. **旧作巡回**: `refresh-catalog.php`で保存・Like・アフィリエイトクリック作品を優先しつつDB全体を巡回
3. **Retention**: `retention.php`で期限切れイベント、匿名データ、固定Feedを整理

既存コミックが後から取得不能またはコミック判定外になった場合は即時販売終了にせず、複数回の確認後に`unavailable`へ移行します。

## DB

主要テーブル:

- `works`: コミック作品情報、サンプルURL、価格、maker / maker_id、販売状態、更新時刻
- `genres`, `work_genres`: ジャンル
- `series`, `work_series`: シリーズ
- `work_price_history`: 価格変更履歴
- `anonymous_users`: ランダムUUIDのみの匿名ユーザー
- `events`: 閲覧・ページ進捗・読了・CTA・like/save/share・affiliate click
- `user_work_states`: いいね・保存の現在状態
- `user_genre_scores`: 行動から更新するジャンル嗜好
- `feed_sessions`, `feed_items`: 固定推薦Feed
- `sync_runs`: 同期・巡回更新履歴
- `app_migrations`: 一度だけ行うmigration管理

新規DBの`works`には作品タイプ列を持ちません。現フェーズでは「worksに存在する作品 = 同人コミック」をDomain invariantとします。

IPアドレスや実名情報はアプリDBへ保存しません。イベント生ログは初期設定60日、匿名ユーザーと派生データは最終行動から180日で整理します。

## ディレクトリ構成

```text
components/            React UI
lib/                   フロント共通型
src/                   analytics / API / reader / navigation / age verification等
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

## 開発

Node.jsは`>=20.19.0`です。CIではNode.js 22を使用します。

```bash
npm ci
npm run dev
```

PHP APIをローカルで動かす場合:

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

`check:debt`では既存のReader・年齢確認・履歴・削除等の回帰に加え、以下も検査します。

- `AssetType` / `assetType` / 作品タイプUIの再混入
- CatalogServiceへの`asset_type`分岐の再混入
- WorkRepositoryへの旧作品タイプ列依存の再混入
- 新規schemaへの`asset_type / asset_bucket`復活
- FANZAコミック判定の欠落
- 同期時の非コミックスキップ欠落
- 同人フロア全体ジャンルの同期処理への再混入
- 既存DBコミック専用化migration / 孤立メタ整理の欠落
- migration完了markが互換DDLより先に立つ回帰
- FANZA fallbackの複数ページ・部分ページcursor処理の欠落

## CI

Pull RequestではTypeScript、全PHP構文、debt check、Readerロジック、MariaDB migration、検索、固定Feed、保存cursor、閲覧履歴cursor、匿名データ削除、価格差額、本番build、成果物への秘密情報混入をまとめて確認します。

MariaDB 11.4をCI service containerとして使用します。新規schemaの再実行安全性に加え、旧`asset_type / asset_bucket`列を持つDBをCI内で再現し、非コミック削除、孤立ジャンル・シリーズ削除、互換列の`comic`固定、migration再実行を検証します。

## 本番デプロイ

`main`へのpushは成功済みPR CIを経由したコミットだけをデプロイします。

```text
PR CI成功確認
  ↓
本番build
  ↓
リリース領域へ転送
  ↓
config.local.php生成
  ↓
DB migration
  ↓
app / public_html切替
  ↓
本番HTTP / PWA / fixed feed / public boundary検証
```

## 本公開前に残っている主な事項

現在は`noindex,nofollow`を維持しています。年齢確認、プライバシーポリシー、利用規約、匿名データ削除は実装済みです。

主な残作業:

- Reader実機QA
- 作品単位共有URL / 動的OGP
- PWA追加訴求の段階設計
- SEO公開ページ / URL / index設計
- X / 既存SEOサイトからの市場検証

AV / 素人系動画の追加は、同人コミック版の市場検証後に別カテゴリとして設計します。現時点では動画のための`category / media_kind`を先回りして既存Domainへ持ち込みません。
