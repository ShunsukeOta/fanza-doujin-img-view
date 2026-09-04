# FANZA同人 Swipe Preview

FANZA同人作品の `sampleImageURL.sample_l.image` を縦フィード + 横ページ送りで閲覧するモバイル向けWebアプリです。

本番構成は **React + Vite / PHP 8.3 / MariaDB / シンレンタルサーバー** です。Node.jsはビルド時にだけ使用し、本番Webサーバー上では常駐させません。

## 本番構成

```text
ブラウザ
  ↓
React / Vite 静的ファイル
  ↓
/api/catalog       おすすめフィード
/api/meta          ジャンル・素材タイプ
/api/events        行動イベント
/api/diagnostics   sample_l診断
/api/health        稼働確認
  ↓
PHP 8.3
  ├─ MariaDB: 作品 / ジャンル / 行動 / 嗜好スコア
  └─ DMM Web Service API v3: DB未同期時のフォールバック / 定期同期
```

公開先は `https://wp983575.wpx.jp/`。

GitHub `main` へのpushで `.github/workflows/deploy-shin.yml` が実行され、SSH + rsyncで自動デプロイします。

## 開発

```bash
npm install
npm run dev
```

PHP APIもローカルで動かす場合は別ターミナルで:

```bash
npm run dev:api
```

Viteは `/api` を `127.0.0.1:8787` にプロキシします。

## チェック

```bash
npm run typecheck
npm run check:php
npm run build:shin
```

`build:shin` は以下を生成します。

```text
deploy/
├─ public_html/   # Vite成果物 + 公開PHP API
└─ app/           # 非公開PHPアプリ / schema / cron
```

CIでは旧Next.js由来の `app/`, `next.config.ts`, `next-env.d.ts`, `server-only`, `NextRequest`, `NextResponse`, `"use client"` も残っていないか確認します。

## 初回本番セットアップ

人手でサーバーへSSHして設定ファイルを編集したり、SQLを手動importする必要はありません。

シンレンタルサーバーでMariaDBを1個作成し、GitHub Repository Secretsへ以下を登録すると、次回のデプロイで自動的に:

1. `config.local.php` をサーバーへ安全に生成
2. `schema.sql` を適用
3. 必要なDBインデックスを補完
4. DBが空ならFANZA作品を初回2,000件程度同期
5. `/api/health` でDB / FANZA API / カタログ稼働を検証

まで実行します。

```text
SHIN_DB_NAME
SHIN_DB_USER
SHIN_DB_PASSWORD
DMM_API_ID
DMM_AFFILIATE_ID
```

デプロイ用の `SHIN_SSH_PRIVATE_KEY` は別途必要です。

本番設定ファイルは以下にだけ保存されます。

```text
/home/wp983575/wp983575.wpx.jp/app/config.local.php
```

`config.local.php` は通常の `rsync --delete` から除外し、DB/API用Secretsが揃ったデプロイ時だけ専用ステップで更新します。

## DB

主要テーブル:

- `works`: FANZA作品情報・sample_l画像URL
- `genres`: ジャンル
- `work_genres`: 作品とジャンル
- `anonymous_users`: ランダムUUIDだけの匿名ユーザー
- `events`: impression / 滞在時間 / ページ進捗 / like / save / share / affiliate click
- `user_work_states`: いいね・保存の現在状態
- `user_genre_scores`: 行動から更新するジャンル嗜好スコア

アプリDBにはIPアドレスや実名情報を保存しません。イベント生ログは初期値60日、匿名ユーザーと派生嗜好データは最終行動から初期値180日で削除します。匿名ID Cookieも同じ保持日数を上限にします。

## FANZA同期

初回はDBが空ならデプロイが `--pages=20 --sort=date` を自動実行します。

通常の定期同期はGitHub Actionsの `FANZA作品DBを同期` が6時間ごとに新着側5ページ（最大500件）を更新します。SSH接続は一時的なネットワーク失敗を考慮して再試行します。

同期処理は:

1. FloorListで `FANZA / doujin / digital_doujin` を解決
2. GenreSearchを同期
3. ItemListを100件単位で取得
4. `works / genres / work_genres` をUPSERT
5. 保持期間を超えたイベント生ログと匿名プロファイルを削除

現在の6時間同期は「新着・更新の取り込み」が目的です。販売終了作品を全件照合して自動的に `is_active=0` にする完全同期はまだ実装していません。

## レコメンド

DBに作品が1件以上入ると `/api/catalog` は自動的にDBフィードへ切り替わります。

候補生成は「人気」「新着」「探索」の複数プールを混ぜ、その後に以下を加点・減点して並べ替えます。

- ジャンル嗜好スコア
- 評価
- レビュー人気度
- 新着度
- ユーザーごとの決定的探索スコア
- 過去に表示済みの作品へのペナルティ

嗜好スコアは `view_end` の滞在時間・読了率、いいね、保存、共有、FANZAクリックから更新します。1.5秒未満かつ読了率20%未満は強めのネガティブ、3秒未満かつ読了率20%未満は弱いネガティブとして扱います。共有キャンセルやローカル保存失敗はポジティブ行動として記録しません。いいね・保存は現在状態を別テーブルで管理し、重複送信や通信欠落で同じ操作を二重加点しないようにします。

DB未設定・未同期の間は、DMM API設定があればItemListから直接取得します。

## 公開前の確認

`index.html` は現在 `noindex,nofollow` です。検索エンジンへ公開する段階でのみ外してください。

成人向け作品の閲覧行動を匿名IDで保存するため、本公開前にプライバシー説明へ利用目的・保存期間・削除方針を明記してください。

## GitHub Actions Secrets

現時点では以下を使用します。

```text
SHIN_SSH_PRIVATE_KEY   # 登録済み
SHIN_DB_NAME           # 初回DB作成後に登録
SHIN_DB_USER           # 初回DB作成後に登録
SHIN_DB_PASSWORD       # 初回DB作成後に登録
DMM_API_ID             # DMM Web Service API
DMM_AFFILIATE_ID       # FANZAアフィリエイトID
```

ホスト・ユーザー・SSHポートは秘密情報ではないためworkflow内に固定しています。
