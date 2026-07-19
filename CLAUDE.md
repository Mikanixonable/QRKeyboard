# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 概要

QRKeyboard: 依存ライブラリなしのブラウザ完結型コードジェネレーター (`index.html` を開くだけで動作する静的サイト、ビルド不要)。詳細な機能仕様は `SPEC.md` を参照。

## 開発コマンド

ビルドツール・パッケージマネージャ・テストフレームワークは一切導入されていない。開発は `index.html` をブラウザで直接開くだけ。

エンコード/デコードロジックの回帰テストは `node test/encode-decode.test.js` で実行できる (Node のみで動作、フレームワーク不要)。UI (app.js) はテスト対象外のため、UI 変更後の動作確認はブラウザで手動確認する。ライブラリ (`qrcode.js` 等) を変更したら必ずこのテストを実行し、対応するケースを追記する。

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
| `decode-finder.js` | `FinderLib` | MicroQR/rMQR 用の自前ファインダパターン探索 + グリッドサンプリング (`tryDecodeMicroRmqr`) |
| `decode-1d.js` | `Bar1DLib` | Industrial 2 of 5 / Pharmacode 用の自前ラン走査デコーダ (`tryDecodeBarcode1D`。ZXing 非対応のため) |
| `app.js` | — | UI 構築・描画・保存・デコード呼び出しなど全ロジック (2700行超、単一 IIFE) |

各エンコード関数は `{ standard, versionName, modules (2次元配列), width, height, quietZone, ... }` の形の結果オブジェクトを返す共通インターフェースを持つ。バーコード (1次元) は `modules` が1行の配列になる。

### デコードの仕組み

- **QR/MicroQR/rMQR**: `QRLib.decode` による自前デコーダで、モジュール配列から直接リアルタイム復号(誤り訂正の復元状況も表示)。
- **カメラ入力/画像選択**: まず `@zxing/library` (CDN 経由、`index.html` で読み込み) に委譲。失敗時は MicroQR/rMQR を `FinderLib`、Industrial 2 of 5 / Pharmacode を `Bar1DLib` の自前デコーダで再試行する。GS1 DataBar-14 は ZXing 側の非互換により生成のみ。
- UPC-E・Codabar はエンコード実装済みだが ZXing での読み取り検証が取れておらず、UI には反映されていない(コードのみ存在)。

### UI 構造 (3ゾーンレイアウト)

`site-body` を左メニューゾーン(規格切り替えタブ、固定幅)・中央コンテンツゾーン(データ入力・コード表示・詳細情報・各種設定)・右メニューゾーン(予備)の3分割。モバイル(760px以下)では左メニューゾーンが上部の横並びバーになり、右メニューゾーンは非表示。レイアウトの詳細な挙動(色設定、複雑度UI、マスクパターン、保存メニューなど)は `SPEC.md` に仕様として記載されているので、UI 変更時は必ず参照し、変更後は追記・更新する。

### 状態の永続化

現在選択中のコード規格・エンコード内容・色・複雑度・誤り訂正強度・マスクパターン・分割方式などは「リンクをシェア」ボタンで URL クエリパラメータに変換され(`app.js` の `buildUrlParams`)、そのリンクを開くと復元される(同 `loadFromUrl`。復元後はパラメータを URL から除去する)。通常時は URL に状態を書き込まない。UI に共有可能な新しい状態を追加する場合は、この2関数を対応させる必要がある。テーマ(ライト/ダーク)のみ localStorage に保存される。

### PWA / オフライン対応

`sw.js` がサービスワーカーとしてアプリ本体一式と外部ライブラリ (ZXing CDN・Web フォント) をキャッシュする (stale-while-revalidate 方式)。**依存ファイルを追加・変更したら `sw.js` の `APP_SHELL` リストと `CACHE_VERSION` を更新する**こと。`manifest.json` と `icons/` は PWA インストール用。

## 開発ノート

`dev.md` は人間のみが編集するファイルで、実施済み・未実施のチケット(要望・バグ・調査結果)が時系列で記録されている。次に着手すべきタスクの参考にする場合はこのファイルの `### todo` セクションを確認する。`codes.md` は他規格(Han Xin Code, JAB Code, MaxiCode 等)の実装可能性調査ログ。
