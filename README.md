# FANZA同人 Swipe Preview

DMM/FANZA Webサービス v3 の公式APIレスポンスだけを使って、FANZA同人作品を「縦スワイプで次作品 / 横スワイプで `sample_l` を読む」SP向けフィードとして検証するツールです。

## 現在の仕様

- `FloorList` から `FANZA / doujin / digital_doujin` と `floor_id` を動的解決
- `ItemList` で同人作品を最大100件/リクエストで取得
- `GenreSearch` で同人フロアのジャンル一覧を取得
- ジャンル指定時は `article=genre` / `article_id=<genre_id>` をItemListへ渡す
- サンプル画像は `sampleImageURL.sample_l.image` のみ使用
- 最大800件を走査し、API素材タイプ別に `sample_l` の枚数分布を診断
- サンプル枚数・レビュー件数・平均評価でフィードを絞り込み
- CID / FANZA商品URLを直接指定して単品テスト可能
- 各作品で `API NP / 読込 X/N / 失敗 Y` をリアルタイム表示
- API ID / Affiliate IDはPHP側だけで使用し、ブラウザへ露出しない

## 「コミック / CG / ゲーム / ボイス」の扱いについて

ここは重要です。

FANZA同人の `ItemList` では、`iteminfo.genre` は「制服」「巨乳」「中出し」「男性向け」などの**ジャンルタグ**です。`iteminfo.genre` を使って「コミック作品かどうか」を判定する実装は誤りです。

一方、APIが返す `imageURL` / `sampleImageURL` には、同人作品で次のようなアセットパスが実際に現れます。

```text
/digital/comic/
/digital/cg/
/digital/game/
/digital/voice/
```

このツールでは、この**API自身が返した画像URLのパス**を「API素材タイプ」として判定します。

これはFANZA画面上の正式な「作品形式」フィールドをAPIから取得しているわけではないため、UIでは「コミック系」「CG・イラスト系」などと表記しています。画像URLを推測・生成して判定することはしていません。

公開されている実API形式のテストデータでは、`/digital/comic/` の同人作品で `sample_l` が10枚返る例も確認できます。したがって「同人コミックはAPIから複数サンプルを取得できない」という仕様ではありません。作品ごとに0枚・少数・10枚以上など差があります。

## API診断

右上の「絞り込み」を開くと、現在のジャンル条件で最大800件を走査した結果を表示します。

```text
API素材       総数   0P   1–4P   5–9P   10P+
すべて
コミック系
CG・イラスト系
ゲーム系
ボイス・音声系
その他・不明
```

この集計は、レビュー・評価・最低sample_l枚数のフィルタを掛ける**前**に行います。

そのため、「コミック系800件のうち10枚以上が何件あるか」のような実データをその場で確認できます。

`最低sample_l枚数 = 0` にしても、画像0枚の作品はフィードそのものには表示できません。ただし0P作品として診断集計には含まれます。

## 必要環境

- PHP 7.4以上
- PHP cURL拡張
- DMM Webサービス API ID
- DMMアフィリエイト Affiliate ID

## セットアップ

```bash
git clone https://github.com/ShunsukeOta/fanza-doujin-img-view.git
cd fanza-doujin-img-view
```

Windows:

```bat
copy config.example.php config.php
```

macOS / Linux:

```bash
cp config.example.php config.php
```

`config.php`:

```php
<?php

return [
    'api_id' => 'YOUR_API_ID',
    'affiliate_id' => 'YOUR_AFFILIATE_ID',
];
```

`config.php` は `.gitignore` 済みです。API IDをGitHubへコミットしないでください。

起動:

```bash
php -S localhost:8000
```

ブラウザ:

```text
http://localhost:8000
```

## 操作

- 上下スワイプ: 前後の作品
- 左右スワイプ: 同一作品の `sample_l`
- 右上「絞り込み」: API素材タイプ / ジャンル / サンプル枚数 / レビュー / 評価 / API診断
- いいね・保存: 現在は `localStorage`
- 共有: Web Share API、未対応環境ではURLコピー

## 使用するAPI

```text
https://api.dmm.com/affiliate/v3/FloorList
https://api.dmm.com/affiliate/v3/GenreSearch
https://api.dmm.com/affiliate/v3/ItemList
```

ItemListの対象は、FloorListで解決した以下です。

```text
site=FANZA
service=doujin
floor=digital_doujin
```

サンプル画像として使用するのは以下のみです。

```text
sampleImageURL.sample_l.image
```

FANZAの試し読みビューアーをスクレイピングしたり、存在しない画像URLを規則から推測して取得したりはしません。

## ファイル構成

```text
index.php        UI / controller
lib.php          FANZA API・Floor/Genre解決・フィルタ・診断集計
assets/app.css   SPファーストUI
assets/app.js    縦横スワイプ・画像ロード診断・いいね/保存/共有
config.php       API認証情報（Git管理外）
```
