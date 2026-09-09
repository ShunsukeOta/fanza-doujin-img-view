# Reader / CTA / 推薦 / 高意図画面の収益最適化

## 目的

コミックFeedの操作性能を維持しながら、サンプル閲覧からFANZA遷移までの導線を改善し、行動データを推薦へ安全に反映する。

## Reader性能

- Feed全件分のWorkCard/placeholder DOMを保持しない。
- active作品の前後2件だけ完全なWorkCardとして描画し、それ以外は上下spacerでスクロール位置だけ保持する。
- 作品移動はDOM検索ではなく `index * feed.clientHeight` を基準にする。
- 画像はactive作品の現在ページ周辺だけ実体化し、既存のdecode/preload範囲を維持する。
- Readerページ位置はCID単位で保持し、WorkCardがwindow外へ出て再mountされても復元する。

## CTA

- Reader overlay CTAとサンプル読了CTAを別placementとして計測する。
- overlay CTAは実表示後に `cta_view` を1viewにつき1回だけ記録する。
- FANZAクリックにはReader進捗・価格・評価など、個人情報を含まない文脈だけをmetadataとして付与する。
- サンプル後半ではCTA文言を「FANZAで続きを読む」へ切り替え、前半では「FANZAで作品を見る」とする。
- 読了CTAでは作品名・評価・レビュー・価格・残りページをまとめ、購入判断情報を1画面に集約する。

## 推薦

- 個人ジャンル嗜好は、いいね/保存/閲覧だけでなくFANZAクリックを最も強い正シグナルとして扱う。
- 同一ユーザー・同一作品のFANZAクリック連打は7日間で1回だけ嗜好加点し、過学習を防ぐ。
- 過去30日の作品単位行動から、impression・sample_complete・reader affiliate click・平均read ratioを集計する。
- 少数サンプルを過大評価しないBayesian smoothing + confidenceを使い、既存rating/popularity/freshness/affinityへ行動品質scoreを加える。
- 行動品質は候補集合内の再順位付けに使い、Explore枠を残して未知作品の露出を維持する。

## 保存・検索

- 保存済みカードでは保存時価格→現在価格と値下げ額を明示し、値下げ作品のFANZA CTAを強調する。
- 検索結果にもサンプル導線とFANZA直リンクを併設し、検索意図が購入意図へ変わったユーザーを余計なReader遷移なしで送客できるようにする。
- `affiliate_click` placementは `reader_overlay` / `reader_end` / `saved` / `search` を分ける。

## 不変条件

- DB/API DomainはFANZA同人コミック専用。
- 動画Reader・動画URL・動画DB列は追加しない。
- Explore枠を廃止しない。
- CTAはReader操作や画像閲覧を覆わない。
