# FANZA同人 Swipe Preview

FANZA同人の**コミック作品のみ**を対象に、縦方向で作品を切り替え、横方向で漫画サンプルを読むモバイルファーストWeb/PWAです。

本番構成は **React 19 + Vite 7 + TypeScript / PHP 8.3 / MariaDB / シンレンタルサーバー** です。Node.jsは開発・CI・ビルド時だけ使用します。

公開先: `https://wp983575.wpx.jp/`

## Domain invariant

`works` に存在する作品はFANZA同人コミックに限定します。

- FANZA API取込前に `FanzaClient::isComicItem()` でコミック判定
- 新着同期・ライブフォールバック・直接CID指定のすべてで同じ判定を使用
- `works` に動画URLや作品種別用の列を持たない
- Feed、検索、保存、履歴、推薦も同じコミックカタログを参照

## 主要機能

- 上下スワイプによる推薦Feed
- 左右スワイプ / 画面端タップによるサンプルページ送り
- RTL / LTR切替
- 全体表示 / 横幅優先
- ダブルタップ / ピンチズーム
- 次ページ・次作品画像の先読み
- 作品詳細ダイアログ
- 保存、共有
- サンプル読了時のFANZAアフィリエイトCTA
- 保存済み作品と価格変化表示
- 閲覧履歴
- 作品名・サークル・シリーズ・ジャンル・価格等による詳細検索
- 匿名行動データによる推薦
- 18歳以上確認
- 匿名利用データ削除
- PWA
- メイン画面とサブページ間のReader位置復帰

## 画面

| Path | 内容 |
| --- | --- |
| `/` | 推薦コミックFeed |
| `/work/{cid}` | 共有用作品URL / 対象作品Reader |
| `/search` | 詳細検索 |
| `/saved` | 保存済み作品 |
| `/mypage` | マイページ |
| `/history` | 閲覧履歴 |
| `/privacy` | プライバシーポリシー |
| `/terms` | 利用規約 |

ルート定義は `src/routes.ts`、Reader復帰データは `src/readerResumeState.ts`、遷移処理は `src/navigationState.ts` に分離しています。

## 推薦Feed

DBが利用可能な場合、`feed_sessions / feed_items` にユーザー単位のFeed順序を保存します。有効期間は12時間です。

推薦versionは **`rules-v3.3-adaptive`** です。

推薦は30作品単位のadaptive windowで生成します。すでに提示した作品順は維持しつつ、次window生成時には直近の保存、FANZA遷移、読了、閲覧行動から更新されたジャンル嗜好を利用します。

候補生成とランキングの責務は次のように分離しています。

```text
CatalogService
  ├─ FeedRepository         Feed session / item永続化
  ├─ CandidateSource        Popular / Recent / Explore候補抽出
  └─ RecommendationRanker   嗜好・人気・新着・探索・既読をスコアリング
```

明示的な推薦シグナルは、FANZA遷移を最も強く、保存を次に強く扱います。サンプル読了と閲覧進行は補助シグナルです。

DBが利用できない場合はFANZA APIへライブフォールバックし、コミックだけを返します。

## 保存

保存はON/OFFのユーザー状態だけを保持します。他ユーザーを含む保存件数や「いいね」はDomainに持ちません。

- `user_work_states.saved`
- `GET /api/save-state`
- `POST /api/events` の `save_toggle`

保存済み画面では保存時価格と現在価格を比較し、値下げを表示します。

## FANZA同期・保守

1. 新着同期: `fanza-sync.php`
2. 旧作巡回: `refresh-catalog.php`
3. Retention: `retention.php`

旧作巡回では、保存作品と直近30日のFANZA遷移作品を優先し、その後に `next_refresh_at` 順でカタログ全体を巡回します。

CIでは `refresh-catalog.php --plan-only` を実MariaDBに対して実行し、巡回対象選定SQLが現在schemaで動作することを保証します。

## 公開API

```text
/api/catalog       推薦Feed
/api/search        詳細検索
/api/meta          ジャンルmetadata
/api/events        行動イベント・保存更新
/api/save-state    現在ユーザーの保存状態
/api/saved         保存済み一覧
/api/history       閲覧履歴
/api/me            マイページ / 匿名データ削除
/api/work-details  作品詳細
/api/health        稼働確認
```

`/api/debug` と `/api/diagnostics` は管理トークンが一致した場合だけ利用可能です。

## DB

主要テーブル:

- `works`
- `genres`, `work_genres`
- `series`, `work_series`
- `work_price_history`
- `anonymous_users`
- `events`
- `user_work_states`
- `user_genre_scores`
- `feed_sessions`, `feed_items`
- `sync_runs`
- `app_migrations`

アプリDBに実名・住所・メールアドレス・決済情報・IPアドレスは保存しません。

## UI構成

一覧系の作品カードは `components/WorkCardPrimitives.tsx` と `styles/work-cards.css` を共有します。Saved / Search / Historyでカードの枠、本文、metadata、CTA、追加読込・エラーUIを重複実装しません。

MyPageの統計は「保存済み」「見た作品」の2項目です。

## 開発

Node.jsは `>=20.19.0`、CIはNode.js 22、PHP 8.3を使用します。

```bash
npm ci
npm run dev
npm run dev:api
```

## ローカル検証

```bash
npm run typecheck
npm run check:php
npm run check:debt
npm run test:logic
npm run build:shin
```

## CI

Pull Request CIは静的検証と実行検証を分離しています。

### 静的検証

- TypeScript strict check
- 全PHP構文
- architecture / debt invariant
- Readerロジック

### 実行検証

MariaDB 11.4を起動して以下を実行します。

- schema migrationの冪等実行
- 廃止済み列の不存在確認
- `refresh-catalog.php --plan-only`
- 固定Feed / 保存 / 履歴 / 検索のDomain integration test
- 30件adaptive recommendation integration test
- PHP built-in server経由の公開HTTP API contract test
- production buildと公開境界検査

文字列grepだけでAPI・cronの整合性を保証せず、実DB・実HTTP経路も必ず通します。

## 本番デプロイ

`main`へのpushは、成功済みPR CIが確認できる場合だけデプロイします。

```text
PR CI成功確認
  ↓
production build
  ↓
候補releaseへ転送
  ↓
DB migration
  ↓
直前のapp / public_htmlをsnapshot
  ↓
新releaseへ切替
  ↓
production smoke test
  ├─ 成功 → 一時release / snapshotを整理
  └─ 失敗 → 直前snapshotへ自動rollback
```

production smokeではversion、PWA、セキュリティヘッダー、DB/FANZA health、推薦Feed継続性、検索、共有URL、保存・マイページ、公開境界を確認します。

## 公開状態

現時点では `noindex,nofollow` を維持しています。年齢確認、プライバシーポリシー、利用規約、匿名データ削除は実装済みです。
