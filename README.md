# FANZA同人 サンプル画像ビューアー

DMM Webサービスの商品情報APIを使い、FANZA同人作品の `sampleImageURL.sample_l.image` を取得して横スクロールで確認するための簡易ビューアーです。

作品ID（CID）だけでなく、FANZAの商品URLをそのまま入力してもCIDを抽出します。

## できること

- FANZA同人のCIDを指定して商品情報を取得
- `sample_l` のサンプル画像をすべて表示
- 1画像ずつ横スワイプ / 横スクロール
- PCの左右キー、前へ・次へボタンに対応
- マウスホイールをビューアー上で横スクロールとして利用可能
- スマートフォンの横スワイプに対応
- サンプル画像枚数を表示
- 各画像の実解像度（naturalWidth × naturalHeight）を表示
- FANZAの商品ページへのアフィリエイトリンクを表示
- API ID / Affiliate IDはブラウザ側へ露出しない

## 必要環境

- PHP 7.4 以上
- PHP cURL拡張
- DMM Webサービス API ID
- DMMアフィリエイト Affiliate ID

## セットアップ

### 1. リポジトリを取得

```bash
git clone https://github.com/ShunsukeOta/fanza-doujin-img-view.git
cd fanza-doujin-img-view
```

### 2. API設定ファイルを作成

Windows:

```bat
copy config.example.php config.php
```

macOS / Linux:

```bash
cp config.example.php config.php
```

作成した `config.php` を開いて、自分のAPI IDとAffiliate IDを設定します。

```php
<?php

return [
    'api_id' => 'ここにAPI ID',
    'affiliate_id' => 'ここにAffiliate ID',
];
```

`config.php` は `.gitignore` 済みなので、API IDをGitHubへコミットしないでください。

環境変数 `DMM_API_ID` / `DMM_AFFILIATE_ID` を使うこともできます。

### 3. ローカルサーバーを起動

```bash
php -S localhost:8000
```

ブラウザで以下を開きます。

```text
http://localhost:8000
```

### 4. 作品を表示

入力欄へ以下のどちらかを入れて `OK` を押します。

- FANZA同人の作品ID（CID）
- FANZA同人の商品URL

取得に成功すると、APIが返した `sample_l` の画像が横向きビューアーに表示されます。

## 操作方法

- スマートフォン: 左右にスワイプ
- PC: 横スクロール / マウスホイール / 左右矢印キー
- ボタン: `← 前へ` / `次へ →`

画像右下に以下が表示されます。

```text
3 / 10 · 1200×1697px
```

これで、何枚のサンプル画像が取得できるか、APIから返る `sample_l` が実際に何pxあるかを作品ごとに確認できます。

## API取得条件

このツールは商品情報APIを以下の条件で呼び出します。

```text
site=FANZA
service=doujin
floor=digital_doujin
cid=<入力したCID>
hits=1
output=json
```

利用する画像は以下だけです。

```text
sampleImageURL.sample_l.image
```

試し読みビューアー内部の画像をスクレイピングしたり、画像URLを推測して別サイズを取得したりはしません。

## サンプルが表示されない場合

次を確認してください。

1. CIDがFANZA同人作品のものか
2. `config.php` のAPI ID / Affiliate IDが正しいか
3. PHPのcURL拡張が有効か
4. 対象作品に `sampleImageURL.sample_l.image` が存在するか

商品自体が取得できても `sample_l` が0枚の場合は、その旨を画面に表示します。表紙画像をサンプルとして代用はしません。

## セキュリティ

API IDとAffiliate IDはPHP側からDMM Webサービスへ送信します。HTMLやJavaScriptには埋め込んでいません。

公開サーバーへ設置する場合も、`config.php` をGit管理しないでください。
