# FANZA同人 Swipe Preview

FANZA同人作品のサンプルを、TikTok/Shortsのような縦フィードと漫画向け横ページ送りで閲覧するモバイルファーストWebアプリです。

本番構成は **React 19 + Vite / PHP 8.3 / MariaDB / シンレンタルサーバー**。Node.jsはビルド時だけ使用し、本番Webサーバーには常駐させません。

## 現在の主要機能

- 上下スワイプで作品を切り替える固定フィード
- 左右スワイプ / 画面端タップでサンプルページ送り
- RTL/LTR切替、contain/横幅優先、ダブルタップ/ピンチズーム
- 画像の先読み + `HTMLImageElement.decode()`による事前decode
- いいね、保存、共有、読了CTAからFANZAへ送客
- 保存済み作品の値下げ表示
- 作品名・サークル・シリーズ・ジャンル・価格等の絞り込み
- 匿名行動からジャンル嗜好を更新するルールベース推薦
- PWA standalone対応
- 3ステップのオンボーディング

### オンボーディングの一時仕様

検証中のため、現在はメインページを新規表示するたびにオンボーディングを表示します。閲覧済みフラグはlocalStorage/sessionStorage/Cookieへ保存していません。詳細は `docs/onboarding-implementation.md` を参照してください。

## 本番構成

```text
ブラウザ
  ↓
React / Vite 静的ファイル
  ↓
/api/catalog       固定feed_id + cursorのおすすめフィード
/api/meta          ジャンル・素材タイプ
/api/events        行動イベント / いいね / 保存
/api/reactions     リアクション現在状態
/api/saved         保存済み作品
/api/me            匿名マイページ
/api/work-details  読了時の作品詳細・価格再確認
/api/health        稼働確認
  ↓
PHP 8.3
  ├─ MariaDB: 作品 / ジャンル / シリーズ / 価格履歴 / 行動 / 嗜好 / 固定フィード
  └─ DMM Web Service API v3: 新着同期 / 個別更新 / 旧作巡回
```

`/api/debug` と `/api/diagnostics` は管理トークンが設定され、正しい `X-Admin-Token` が送られた場合だけ使用できます。通常の本番アクセスでは404です。

公開先: `https://wp983575.wpx.jp/`

## 開発

依存関係はlockfileから再現します。

```bash
npm ci
npm run dev
```

PHP APIもローカルで動かす場合は別ターミナルで:

```bash
npm run dev:api
```

Viteは `/api` を `127.0.0.1:8787` にプロキシします。

## ローカルチェック

```bash
npm run typecheck
npm run check:php
npm run test:logic
npm run check:debt
npm run build:shin
```

`check:debt` は、削除済みUIのCSS復活、分割CSSの再発、画像decodeキャッシュ上限、リアクションAPI上限、LTR/RTL復帰処理など、改修で再発しやすい負債を静的に検査します。

`build:shin` は以下を生成します。

```text
deploy/
├─ public_html/   # Vite成果物 + 公開PHP API
└─ app/           # 非公開PHPアプリ / schema / cron / src
```

`server/app/tests` と `config.local.php` は本番成果物へ含めません。

## DB

主要テーブル:

- `works`: FANZA作品情報、サンプルURL、価格、maker/maker_id、販売状態、更新時刻
- `genres`, `work_genres`: ジャンルと作品紐付け
- `series`, `work_series`: シリーズと作品紐付け
- `work_price_history`: 価格変更履歴
- `anonymous_users`: ランダムUUIDのみの匿名ユーザー
- `events`: impression、ページ進捗、読了、CTA、like/save/share、affiliate click
- `user_work_states`: いいね・保存の現在状態と各日時
- `user_genre_scores`: 行動から更新するジャンル嗜好スコア
- `feed_sessions`, `feed_items`: ユーザーごとの固定推薦フィードとcursor
- `sync_runs`: 同期・巡回更新の実行履歴
- `app_migrations`: 一度だけ行うデータ移行の管理

IPアドレスや実名情報はアプリDBへ保存しません。イベント生ログは初期値60日、匿名ユーザーと派生データは最終行動から初期値180日で整理します。匿名ID Cookieは継続利用中に期限を延長します。

## レコメンド

DBに作品が1件以上入ると `/api/catalog` はDBフィードを利用します。リクエストごとに順位を作り直してoffsetで切る方式ではなく、`feed_sessions / feed_items` に順序を固定し、`feed_id + cursor`で続きへ進みます。

候補は人気・新着・探索を混ぜ、以下をスコアへ反映します。

- 時間減衰したジャンル嗜好
- 評価・レビュー人気度
- 新着度
- ユーザー/フィード単位の探索スコア
- 最近表示済み作品へのペナルティ

行動学習では、単純な読了率だけでなく `sampleLoaded`、実際に進んだページ数、滞在時間を使用します。1〜4枚程度の短いサンプルを即スキップしただけで好意として強く加点しない設計です。

## FANZA作品同期

作品保守は3系統です。

1. **新着同期**: 6時間ごとに `fanza-sync.php --pages=5 --sort=date` で最新側を取得・UPSERT
2. **旧作巡回**: `refresh-catalog.php` で保存/Like/アフィクリック作品を優先しつつ、`next_refresh_at`順でDB全体を長期巡回
3. **retention**: `retention.php` で期限切れイベント、匿名データ、固定フィードを分割削除

作品がFANZA APIから一度取得できなかっただけでは販売終了にしません。取得不能が連続した場合に販売状態を更新し、一時API障害による誤停止を抑えます。

価格が変化した場合は `work_price_history` へ履歴を追加します。シリーズは `iteminfo.series`、メーカーIDは `iteminfo.maker` のIDを保存します。

期間バックフィルでは `--since / --until` を指定すると14日単位へ分割し、ItemListのoffset上限による黙った取りこぼしを防ぎます。

## CI / デプロイ

Pull RequestのCIで以下をまとめて確認します。

- `npm ci`
- TypeScript
- 全PHP構文
- Reader/価格ロジック回帰
- MariaDB migrationの再実行安全性
- 検索 / 固定フィード / 保存cursor / 値下げ差額
- 負債再発チェック
- 本番成果物build

`main`へのpushは、成功済みPR CIが確認できた場合だけ本番デプロイへ進みます。デプロイ順序は、リリース領域転送 → 設定生成 → DB migration → app/public切替 → 本番HTTP検証です。

## 公開前の確認

`index.html` は現在 `noindex,nofollow` です。検索エンジンへ公開する段階でSEOページ・プライバシー説明・年齢確認を含めた公開方針を確定してから解除してください。

成人向け作品の閲覧行動を匿名IDで保存するため、本公開前に利用目的・保存期間・削除方針を利用者へ明記する必要があります。

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

本番設定は `/home/wp983575/wp983575.wpx.jp/app/config.local.php` のみに生成し、Gitやビルド成果物へ含めません。
