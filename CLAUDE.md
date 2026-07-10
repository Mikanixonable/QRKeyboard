# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 概要

QRKeyboard: 依存ライブラリなしのブラウザ完結型コードジェネレーター (`index.html` を開くだけで動作する静的サイト、ビルド不要)。詳細な機能仕様は `SPEC.md` を参照。

## 開発コマンド

ビルドツール・パッケージマネージャ・テストフレームワークは一切導入されていない。開発は `index.html` をブラウザで直接開くだけ。自動テストは存在しない(`dev.md` の todo にも記載あり)。変更後の動作確認はブラウザで手動確認する。

## アーキテクチャ

### モジュール構成

各コード規格のエンコード/デコードロジックは規格ごとに独立した IIFE ファイルに分離されており、`(typeof module !== "undefined" && module.exports) ? module.exports = XxxLib : global.XxxLib = XxxLib` の形でグローバルに `XxxLib` オブジェクトを公開する。`app.js` がこれらを呼び出して UI の構築・描画を行う。

| ファイル | 公開グローバル | 役割 |
|---|---|---|
| `qrcode.js` | `QRLib` | QR / MicroQR (M1〜M4) / rMQR のエンコード・デコード (`encode`, `decode`) |
| `datamatrix.js` | `DMLib` | DataMatrix (ECC200) のエンコードのみ |
| `aztec.js` | `AZLib` | Aztec (通常 + Aztec Rune) のエンコード・デコード |
| `barcode1d.js` | `BARLib` | 1次元バーコード群 (JAN/EAN-13, Code128, Code39, UPC-A, Code93, ITF/ITF-14, Industrial 2 of 5, Pharmacode, UPC-E, Codabar) のエンコード |
| `pdf417.js` | `PDF417Lib` | PDF417 のエンコード |
| `decode-finder.js` | `FinderLib` | MicroQR/rMQR 用の自前ファインダパターン探索補助 (`tryDecodeMicroRmqr`) |
| `app.js` | — | UI 構築・描画・保存・デコード呼び出しなど全ロジック (2500行超、単一 IIFE) |

各エンコード関数は `{ standard, versionName, modules (2次元配列), width, height, quietZone, ... }` の形の結果オブジェクトを返す共通インターフェースを持つ。バーコード (1次元) は `modules` が1行の配列になる。

### デコードの仕組み

- **QR/MicroQR/rMQR**: `QRLib.decode` による自前デコーダで、モジュール配列から直接リアルタイム復号(誤り訂正の復元状況も表示)。
- **その他の規格 (DataMatrix, Aztec, バーコード, PDF417)**: カメラ入力/画像選択時は `@zxing/library` (CDN 経由、`index.html` で読み込み) にデコードを委譲。ZXing が非対応の規格(MicroQR/rMQR)は生成のみ可能。
- UPC-E・Codabar はエンコード実装済みだが ZXing での読み取り検証が取れておらず、UI には反映されていない(コードのみ存在)。

### UI 構造 (3ゾーンレイアウト)

`site-body` を左メニューゾーン(規格切り替えタブ、固定幅)・中央コンテンツゾーン(データ入力・コード表示・詳細情報・各種設定)・右メニューゾーン(予備)の3分割。モバイル(760px以下)では左メニューゾーンが上部の横並びバーになり、右メニューゾーンは非表示。レイアウトの詳細な挙動(色設定、複雑度UI、マスクパターン、保存メニューなど)は `SPEC.md` に仕様として記載されているので、UI 変更時は必ず参照し、変更後は追記・更新する。

### 状態の永続化

現在選択中のコード規格・エンコード内容・色・複雑度・誤り訂正強度・マスクパターン・分割方式などは URL 変数(クエリパラメータ)にエンコードされ、リロード後も復元される(`app.js` の `syncUrl` / `loadFromUrl`)。UI に永続化すべき新しい状態を追加する場合は、この2関数を対応させる必要がある。

## 開発ノート

`dev.md` は人間のみが編集するファイルで、実施済み・未実施のチケット(要望・バグ・調査結果)が時系列で記録されている。次に着手すべきタスクの参考にする場合はこのファイルの `### todo` セクションを確認する。`codes.md` は他規格(Han Xin Code, JAB Code, MaxiCode 等)の実装可能性調査ログ。
