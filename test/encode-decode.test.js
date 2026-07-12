/* エンコード/デコードロジックの回帰テスト。
 * 実行: node test/encode-decode.test.js
 * ブラウザ・テストフレームワーク不要 (各ライブラリの module.exports を直接叩く)。
 * UI (app.js) はカバーしない。 */
"use strict";
const path = require("path");
const ROOT = path.join(__dirname, "..");
const QRLib = require(path.join(ROOT, "qrcode.js"));
const DMLib = require(path.join(ROOT, "datamatrix.js"));
const AZLib = require(path.join(ROOT, "aztec.js"));
const BARLib = require(path.join(ROOT, "barcode1d.js"));
const PDF417Lib = require(path.join(ROOT, "pdf417.js"));
const Bar1DLib = require(path.join(ROOT, "decode-1d.js"));

let pass = 0, fail = 0;
function ok(cond, label) {
  if (cond) { pass++; }
  else { fail++; console.log("FAIL: " + label); }
}

/* ===== QR: 全型番×全マスク + 代表テキストのラウンドトリップ ===== */
const texts = [
  "1234567890",
  "HELLO WORLD 123:/",
  "https://example.com/path?q=日本語テスト",
  "a".repeat(200),
  "絵文字🎉🚀混在テキスト",
];
for (const t of texts) {
  for (const ec of ["L", "M", "Q", "H"]) {
    const r = QRLib.encode({ standard: "qr", text: t, ecLevel: ec, version: 0, mask: -1 });
    const d = QRLib.decode(r.modules, "qr");
    ok(d.text === t && d.ecLevel === ec, `QR roundtrip ec=${ec} "${t.slice(0, 20)}"`);
  }
}
for (let v = 1; v <= 40; v++) {
  for (let m = 0; m < 8; m++) {
    const r = QRLib.encode({ standard: "qr", text: "TEST123", ecLevel: "M", version: v, mask: m });
    const d = QRLib.decode(r.modules, "qr");
    ok(d.text === "TEST123" && d.mask === m, `QR v${v} mask${m}`);
  }
}
/* 誤り訂正: モジュールを数個壊しても復元できる */
{
  const r = QRLib.encode({ standard: "qr", text: "ERROR CORRECTION TEST", ecLevel: "H", version: 5, mask: 3 });
  const mods = r.modules.map((row) => row.slice());
  mods[20][20] ^= 1; mods[25][12] ^= 1; mods[30][30] ^= 1;
  const d = QRLib.decode(mods, "qr");
  ok(d.text === "ERROR CORRECTION TEST" && d.corrected > 0, "QR error recovery");
}
/* Structured Append ヘッダの往復 */
{
  const parity = QRLib.computeParity("HELLOWORLD");
  const r = QRLib.encode({ standard: "qr", text: "HELLO", ecLevel: "M", version: 0, mask: -1, structured: { index: 0, count: 2, parity } });
  const d = QRLib.decode(r.modules, "qr");
  ok(d.structured && d.structured.index === 0 && d.structured.count === 2 && d.text === "HELLO", "QR structured append");
}

/* ===== MicroQR / rMQR ===== */
const microCases = [
  ["12345", 1, "L"], ["12345678", 2, "L"], ["ABC12", 2, "M"],
  ["ABCDE12345", 3, "M"], ["テスト", 3, "L"], ["ABCDEFG123456", 4, "Q"],
];
for (const [t, v, ec] of microCases) {
  for (let m = 0; m < 4; m++) {
    const r = QRLib.encode({ standard: "micro", text: t, ecLevel: ec, version: v, mask: m });
    const d = QRLib.decode(r.modules, "micro");
    ok(d.text === t, `Micro M${v} ${ec} mask${m} "${t}"`);
  }
}
for (let v = 1; v <= 32; v++) {
  for (const ec of ["M", "H"]) {
    const r = QRLib.encode({ standard: "rmqr", text: "12", ecLevel: ec, version: v });
    const d = QRLib.decode(r.modules, "rmqr");
    ok(d.text === "12" && d.ecLevel === ec, `rMQR v${v} ${ec}`);
  }
}

/* ===== DataMatrix: 全サイズで寸法整合 ===== */
for (let i = 1; i <= DMLib.SIZES.length; i++) {
  const cap = DMLib.SIZES[i - 1].data;
  const r = DMLib.encode({ text: "A".repeat(Math.max(1, cap - 2)), size: i });
  ok(r.width === DMLib.SIZES[i - 1].w && r.height === DMLib.SIZES[i - 1].h, `DM size ${i}`);
}
ok(DMLib.encode({ text: "日本語", size: 0 }).standard === "datamatrix", "DM non-ascii");

/* ===== Aztec ===== */
for (let v = 1; v <= 36; v++) {
  const r = AZLib.encode({ text: "A".repeat(v <= 4 ? 5 : 10), ecIndex: 1, version: v });
  ok(r.width === r.height && r.modules.length === r.height, `Aztec v${v}`);
}
ok(AZLib.encode({ text: "x".repeat(1500), ecIndex: 1, version: 0 }).standard === "aztec", "Aztec long auto");

/* ===== Aztec Rune: 全値ラウンドトリップ + Annex A 交互ビット反転 ===== */
for (let v = 0; v <= 255; v++) {
  const d = AZLib.decodeRune(AZLib.encodeRune(v).modules);
  ok(d.value === v, `Rune roundtrip ${v}`);
}
{
  /* 交互ビット反転により、値0でもモードメッセージ位置に暗モジュールが現れる
     (反転が無いと全ビット0になり、コンパクトAztec本体と区別できない) */
  const r = AZLib.encodeRune(0);
  let dark = 0;
  for (let x = 2; x <= 8; x++) dark += r.modules[0][x];
  ok(dark > 0, "Rune(0) mode message not all-zero");
  const mods = r.modules.map((row) => row.slice());
  mods[0][3] ^= 1;
  ok(AZLib.decodeRune(mods).value === 0, "Rune 1-bit error recovery");
}

/* ===== 1次元バーコード ===== */
ok(BARLib.encode({ symbology: "ean13", text: "490123456789" }).display === "4901234567894", "EAN13 check digit");
ok(BARLib.encode({ symbology: "upca", text: "03600029145" }).display === "036000291452", "UPC-A check digit");
ok(BARLib.encode({ symbology: "itf14", text: "1540014128876" }).display.length === 14, "ITF-14");
ok(BARLib.encode({ symbology: "gs1databar", text: "0001234567890" }).width === 96, "GS1 DataBar width");
for (const sym of ["code128", "code39", "code93", "itf", "pharmacode"]) {
  const text = sym === "itf" || sym === "pharmacode" ? "1234" : "TEST 123";
  ok(BARLib.encode({ symbology: sym, text }).width > 0, sym);
}

/* ===== Industrial 2 of 5 / Pharmacode: エンコード→ラン列→自前デコーダの往復 ===== */
function runsFromBits(bits, quiet, scale) {
  const expand = (s) => s.split("").map((c) => c.repeat(scale)).join("");
  const padded = "0".repeat(quiet * scale) + expand(bits) + "0".repeat(quiet * scale);
  const runs = [];
  let cur = padded[0], start = 0;
  for (let i = 1; i <= padded.length; i++) {
    if (i === padded.length || padded[i] !== cur) {
      runs.push({ dark: cur === "1", start, len: i - start });
      if (i < padded.length) { cur = padded[i]; start = i; }
    }
  }
  return runs;
}
{
  /* バーの融合 (3モジュール以上のラン) や広いスペースが無い = 規格通りの構成 */
  const r = BARLib.encode({ symbology: "industrial2of5", text: "1188225599" });
  const bits = Array.from(r.pattern).join("");
  ok(!/1{3,}/.test(bits) && !/0{2,}/.test(bits), "I2of5 well-formed bars/spaces");
}
for (const t of ["0", "5", "11", "42", "1234567890", "0987654321", "99999", "00000"]) {
  const bits = Array.from(BARLib.encode({ symbology: "industrial2of5", text: t }).pattern).join("");
  for (const scale of [1, 2, 3, 5]) {
    const hit = Bar1DLib.decodeIndustrial2of5Row(runsFromBits(bits, 10, scale));
    ok(hit && hit.text === t, `I2of5 roundtrip "${t}" x${scale}`);
  }
}
{
  const bits = "10110100001" + "0".repeat(15) +
    Array.from(BARLib.encode({ symbology: "industrial2of5", text: "314159" }).pattern).join("") +
    "0".repeat(15) + "1101";
  const hit = Bar1DLib.decodeIndustrial2of5Row(runsFromBits(bits, 10, 2));
  ok(hit && hit.text === "314159", "I2of5 with surrounding noise");
  ok(Bar1DLib.decodeIndustrial2of5Row(runsFromBits("101010101010101010101010", 10, 2)) === null, "I2of5 rejects garbage");
}
for (const t of ["3", "7", "100", "12345", "131070"]) {
  const bits = Array.from(BARLib.encode({ symbology: "pharmacode", text: t }).pattern).join("");
  for (const scale of [2, 4]) {
    const hit = Bar1DLib.decodePharmacodeRow(runsFromBits(bits, 10, scale));
    ok(hit && hit.text === t, `Pharmacode roundtrip "${t}" x${scale}`);
  }
}

/* ===== PDF417 ===== */
for (const t of ["hello", "1234567890".repeat(10), "日本語データ"]) {
  const r = PDF417Lib.encode({ text: t, eccLevel: null, cols: null });
  ok(r.rows >= 3 && r.cols >= 1 && r.width === r.modules[0].length, `PDF417 auto "${t.slice(0, 10)}"`);
}
for (let c = 1; c <= 30; c++) {
  try {
    ok(PDF417Lib.encode({ text: "COLUMN TEST DATA", eccLevel: 2, cols: c }).cols === c, `PDF417 cols=${c}`);
  } catch (e) {
    ok(e.code === "TOO_LONG", `PDF417 cols=${c} rejects as TOO_LONG`);
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
