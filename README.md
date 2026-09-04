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

## サーバー設定

秘密情報はGitHubへコミットしません。シンレンタルサーバー側の以下のファイルにだけ保存します。

```text
/home/wp983575/wp983575.wpx.jp/app/config.local.php
```

初回は `app/config.example.php` をコピーして値を設定します。

```php
<?php
return [
    'dmm' => [
        'api_id' => 'DMM API ID',
        'affiliate_id' => 'DMM affiliate ID',
    ],
    'db' => [
        'host' => 'MariaDBホスト',
        'port' => 3306,
        'name' => 'DB名',
        'user' => 'DBユーザー',
        'password' => 'DBパスワード',
        'charset' => 'utf8mb4',
    ],
    'app' => [
        'timezone' => 'Asia/Tokyo',
        'event_retention_days' => 60,
        'sync_pages' => 5,
    ],
];
```

`config.local.php` はデプロイ時の `rsync --delete` から明示的に除外しているため、main更新で消えません。

## DB初期化

MariaDB作成後、`app/schema.sql` を1回適用します。

主要テーブル:

- `works`: FANZA作品情報・sample_l画像URL
- `genres`: ジャンル
- `work_genres`: 作品とジャンル
- `anonymous_users`: ランダムUUIDだけの匿名ユーザー
- `events`: impression / 滞在時間 / ページ進捗 / like / save / share / affiliate click
- `user_genre_scores`: 行動から更新するジャンル嗜好スコア

IPアドレスや実名情報は保存しません。

## FANZA同期

サーバー上で手動実行:

```bash
php ~/wp983575.wpx.jp/app/cron/fanza-sync.php --pages=5 --sort=date
```

GitHub Actionsの `FANZA作品DBを同期` も6時間ごとに同じ処理を実行します。`config.local.php` がまだ無い場合は正常終了でスキップします。

同期処理は:

1. FloorListで `FANZA / doujin / digital_doujin` を解決
2. GenreSearchを同期
3. ItemListを100件単位で取得
4. `works / genres / work_genres` をUPSERT
5. 古いイベント生ログを設定日数より前で削除

を行います。

## レコメンド

DBに作品が1件以上入ると `/api/catalog` は自動的にDBフィードへ切り替わります。

候補生成は「人気」「新着」「探索」の複数プールを混ぜ、その後に以下を加点・減点して並べ替えます。

- ジャンル嗜好スコア
- 評価
- レビュー人気度
- 新着度
- ユーザーごとの決定的探索スコア
- 直近14日で表示済みの作品へのペナルティ

嗜好スコアは `view_end` の滞在時間・読了率、いいね、保存、共有、FANZAクリックから更新します。1.2秒未満かつ読了率20%未満の離脱は弱いネガティブとして扱います。

DB未設定・未同期の間は、DMM API設定があれば従来通りItemListから直接取得します。

## GitHub Actions Secret

自動デプロイに必要なRepository Secretは現在1つだけです。

```text
SHIN_SSH_PRIVATE_KEY
```

ホスト・ユーザー・ポートは秘密情報ではないためworkflow内に固定しています。
