# FANZA同人 Swipe Preview — Next.js / Vercel

FANZA同人の公式 DMM Webサービス v3 レスポンスだけを使い、スマートフォンで「上下スワイプ = 次作品 / 左右スワイプ = `sample_l` プレビュー」を検証するNext.jsアプリです。

旧PHP版のUI・フィルタ・API診断・縦横スワイプ仕様を維持しつつ、Vercelでそのまま公開できる構成へ移行しています。

## Stack

- Next.js 16.3.3 / App Router
- React 19.2.x
- TypeScript
- Vercel Functions (Node.js runtime)
- DMM/FANZA Webサービス v3

## 仕様

- SPファースト、1作品 = `100dvh`
- 上下スワイプで前後作品
- 左右スワイプで同一作品の `sampleImageURL.sample_l.image`
- 横操作は方向ロック付きで縦フィードと競合しにくい実装
- 作品ごとに `API NP · 読込 X/N · 失敗 Y` を表示
- いいね / 保存は `localStorage`
- 共有は Web Share API、未対応環境はClipboard
- FANZAアフィリエイトリンクへ遷移
- API素材タイプ / ジャンル / 最低sample_l枚数 / レビュー件数 / 平均評価で絞り込み
- 現在のジャンル条件で最大800件を走査し、sample_l枚数分布を表示
- CIDまたはFANZA商品URLの直接テスト
- API ID / Affiliate IDはサーバー側だけで参照し、クライアントbundleへ入れない

## APIの扱い

### Floor

`/api/meta` と `/api/catalog` は `FloorList` から以下を動的に解決します。

```text
site=FANZA
service=doujin
floor=digital_doujin
```

`floor_id` はハードコードしません。

### Genre

`GenreSearch` で取得したジャンルを使用します。ジャンル指定時はItemListへ以下を渡します。

```text
article=genre
article_id=<genre_id>
```

`iteminfo.genre` は「制服」「巨乳」「中出し」「男性向け」などのジャンルタグとして扱い、「コミック / CG / ゲーム / ボイス」の判定には使用しません。

### API素材タイプ

ItemListに正式な作品形式フィールドがないため、API自身が返した `imageURL` / `sampleImageURL` のパスを診断用の「API素材タイプ」として扱います。

```text
/digital/comic/ -> コミック系
/digital/cg/    -> CG・イラスト系
/digital/game/  -> ゲーム系
/digital/voice/ -> ボイス・音声系
```

画像URLを推測して生成することはありません。

### Sample images

表示するサンプル画像は以下のみです。

```text
sampleImageURL.sample_l.image
```

試し読みビューアーのスクレイピングは行いません。

## Environment Variables

必要なのは2つだけです。

```text
DMM_API_ID
DMM_AFFILIATE_ID
```

`.env.example` を用意しています。

```bash
cp .env.example .env.local
```

Windows CMD:

```bat
copy .env.example .env.local
```

`.env.local`:

```env
DMM_API_ID=実際のAPI_ID
DMM_AFFILIATE_ID=実際のAffiliate_ID
```

`NEXT_PUBLIC_` は絶対に付けません。`NEXT_PUBLIC_*` はクライアントbundleへ埋め込まれるためです。

## Local development

Node.js 20.9以上を使用してください。

```bash
npm install
npm run dev
```

ブラウザ:

```text
http://localhost:3000
```

本番ビルド確認:

```bash
npm run typecheck
npm run build
npm start
```

## Health check

環境変数とFANZA API疎通だけを安全に確認できるエンドポイントがあります。

```text
http://localhost:3000/api/health
```

正常例:

```json
{
  "ok": true,
  "env": {
    "DMM_API_ID": true,
    "DMM_AFFILIATE_ID": true
  },
  "upstream": "reachable",
  "floor": {
    "site": "FANZA",
    "service": "doujin",
    "floor": "digital_doujin",
    "floorId": "..."
  }
}
```

このAPIは環境変数の**値そのものを返しません**。

## Deploy to Vercel

### 1. GitHub repositoryをVercelへImport

Vercel Dashboardから `ShunsukeOta/fanza-doujin-img-view` をImportします。

設定は基本的に自動検出のままで構いません。

```text
Framework Preset: Next.js
Root Directory: ./
Build Command: next build (default)
Output Directory: default
Install Command: npm install (default)
```

独自の `vercel.json` は不要です。

### 2. Environment Variablesを登録

Vercelの対象Projectで:

```text
Settings
  -> Environment Variables
```

以下を登録します。

```text
DMM_API_ID=<API ID>
DMM_AFFILIATE_ID=<Affiliate ID>
```

少なくとも `Production` に設定してください。

Preview Deploymentでも確認する場合は `Preview` にも設定してください。

Vercel上の値をローカルへ持ってくる場合はCLIで:

```bash
npm i -g vercel
vercel login
vercel link
vercel env pull .env.local
```

### 3. Deploy / Redeploy

環境変数を追加・変更した後はRedeployしてください。

GitHub連携済みなら `main` へのpushでProduction Deploymentが更新されます。

CLIなら:

```bash
vercel --prod
```

## Vercel上での表示確認手順

### A. Health check

Deployment URLが例えば:

```text
https://fanza-doujin-img-view.vercel.app
```

なら最初に:

```text
https://fanza-doujin-img-view.vercel.app/api/health
```

を開きます。

以下を確認します。

```text
ok = true
DMM_API_ID = true
DMM_AFFILIATE_ID = true
upstream = reachable
floor = digital_doujin
```

### B. Top page

次にルートを開きます。

```text
https://fanza-doujin-img-view.vercel.app/
```

初期条件:

```text
API素材タイプ: すべて
ジャンル: すべて
最低sample_l: 10
最低レビュー: 10
最低評価: 4.5
```

作品が読み込まれればAPI接続とフィード生成は成功です。

### C. API診断

右上 `絞り込み` から:

```text
API素材タイプ: コミック系
ジャンル: すべて
最低sample_l: 0
最低レビュー: 0
最低評価: 0.0
```

で実行します。

`sample_l 枚数分布` の `コミック系 / 10P+` に数値が出れば、コミック系の複数サンプル取得をVercel環境から実測できています。

### D. 横スワイプ

各作品上部の表示を確認します。

```text
API 10P · 読込 10/10
```

この状態で左右スワイプできれば正常です。

```text
API 10P · 読込 8/10 · 失敗 2
```

ならAPIは10URL返しているが、ブラウザ画像ロードで2枚失敗しています。

### E. Secretsがクライアントへ出ていないことを確認

ブラウザDevToolsのSources / Networkで `DMM_API_ID` の実値を検索しても出ないことを確認できます。

ブラウザが直接アクセスするのは同一オリジンの:

```text
/api/meta
/api/catalog
/api/health
```

で、DMM APIへの認証付きリクエストはVercel Function内だけで実行されます。

## API routes

```text
GET /api/health
GET /api/meta
GET /api/catalog
```

`/api/catalog` query example:

```text
/api/catalog?asset_type=comic&genre_id=&min_samples=10&min_reviews=10&min_rating=4.5
```

CID直接指定:

```text
/api/catalog?asset_type=all&genre_id=&min_samples=10&min_reviews=10&min_rating=4.5&cid=d_xxxxxx
```

## Vercel / rate limit considerations

DMM/FANZA Webサービスは1リクエスト最大100件で、一定時間内のリクエスト回数にも上限があります。

このアプリは:

- 1ページ100件
- 最大8ページ = 800件
- ItemListのページ間に短い間隔を入れる
- `/api/catalog` の同一URLをVercel CDNで短時間キャッシュ
- Floor / Genre系は長めにキャッシュ

として、アクセスごとに無制限にDMM APIへリクエストしないようにしています。

## Directory

```text
app/
  api/
    catalog/route.ts  ItemList + 最大800件診断
    health/route.ts   env/API疎通確認
    meta/route.ts     FloorList + GenreSearch
  globals.css         現行SP UI
  layout.tsx
  page.tsx
components/
  SwipePreviewApp.tsx 縦横フィード・フィルタ・診断・actions
lib/
  fanza.ts            server-only FANZA API層
  types.ts            shared types
.env.example
next.config.ts
package.json
tsconfig.json
```
