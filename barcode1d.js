/*
 * barcode1d.js — 1次元バーコード エンコーダ(依存なし)
 *
 * 準拠規格:
 *   - JAN / EAN-13: ISO/IEC 15420 (JIS X 0501)
 *   - Code 128:     ISO/IEC 15417
 *   - Code 39:      ISO/IEC 16388
 * パターンテーブルは規格書記載のもの (zint BSD-3-Clause 実装と
 * クロスチェック済み)。
 */
(function (global) {
  "use strict";

  class BAREncodeError extends Error {
    constructor(code, message) {
      super(message);
      this.name = "BAREncodeError";
      this.code = code;
    }
  }

  /* ===== JAN / EAN-13 ===== */

  /* 左側 A (L) パターン。B (G) は R の鏡像、R は A の反転 */
  const EAN_L = ["0001101", "0011001", "0010011", "0111101", "0100011",
    "0110001", "0101111", "0111011", "0110111", "0001011"];
  /* 先頭数字ごとの左側 6 桁のパリティ (0=A, 1=B) */
  const EAN_PARITY = ["000000", "001011", "001101", "001110", "010011",
    "011001", "011100", "010101", "010110", "011010"];

  function eanCheckDigit(d12) {
    let sum = 0;
    for (let i = 0; i < 12; i++) sum += (d12.charCodeAt(i) - 48) * (i % 2 === 0 ? 1 : 3);
    return String((10 - (sum % 10)) % 10);
  }

  function encodeEAN13(text) {
    if (!/^\d{12,13}$/.test(text)) {
      throw new BAREncodeError("INVALID_CHARS", "JAN/EAN-13 は数字 12 桁 (または検査数字込み 13 桁) で入力してください");
    }
    const body = text.slice(0, 12);
    const check = eanCheckDigit(body);
    if (text.length === 13 && text[12] !== check) {
      throw new BAREncodeError("INVALID_CHARS", "検査数字が不正です (正: " + check + ")");
    }
    const digits = body + check;
    const parity = EAN_PARITY[digits.charCodeAt(0) - 48];
    let bits = "101";
    for (let i = 1; i <= 6; i++) {
      const L = EAN_L[digits.charCodeAt(i) - 48];
      if (parity[i - 1] === "0") {
        bits += L; // A パターン
      } else {
        // B (G) パターン = R の鏡像 = A の反転の鏡像
        bits += L.split("").reverse().map((c) => (c === "0" ? "1" : "0")).join("");
      }
    }
    bits += "01010";
    for (let i = 7; i <= 12; i++) {
      const L = EAN_L[digits.charCodeAt(i) - 48];
      bits += L.split("").map((c) => (c === "0" ? "1" : "0")).join(""); // R パターン
    }
    bits += "101";
    return { bits, display: digits, name: "JAN / EAN-13", quietLeft: 11, quietRight: 7 };
  }

  /* ===== Code 128 ===== */

  /* ISO/IEC 15417 Table 1: 値 0-105 のエレメント幅 (バー/スペース交互) */
  const C128 = [
    "212222", "222122", "222221", "121223", "121322", "131222", "122213", "122312",
    "132212", "221213", "221312", "231212", "112232", "122132", "122231", "113222",
    "123122", "123221", "223211", "221132", "221231", "213212", "223112", "312131",
    "311222", "321122", "321221", "312212", "322112", "322211", "212123", "212321",
    "232121", "111323", "131123", "131321", "112313", "132113", "132311", "211313",
    "231113", "231311", "112133", "112331", "132131", "113123", "113321", "133121",
    "313121", "211331", "231131", "213113", "213311", "213131", "311123", "311321",
    "331121", "312113", "312311", "332111", "314111", "221411", "431111", "111224",
    "111422", "121124", "121421", "141122", "141221", "112214", "112412", "122114",
    "122411", "142112", "142211", "241211", "221114", "413111", "241112", "134111",
    "111242", "121142", "121241", "114212", "124112", "124211", "411212", "421112",
    "421211", "212141", "214121", "412121", "111143", "111341", "131141", "114113",
    "114311", "411113", "411311", "113141", "114131", "311141", "411131", "211412",
    "211214", "211232",
  ];
  const C128_STOP = "2331112";
  const CODE_C = 99, CODE_B = 100, CODE_A = 101, START_A = 103, START_B = 104, START_C = 105;

  function encodeCode128(text) {
    for (const ch of text) {
      if (ch.charCodeAt(0) > 127) {
        throw new BAREncodeError("INVALID_CHARS", "Code 128 は ASCII 文字 (0-127) のみ使用できます");
      }
    }
    if (text.length === 0) throw new BAREncodeError("EMPTY", "データを入力してください");

    // 値列の構築: 数字 6 桁以上 (全体が数字なら 4 桁以上・偶数) の連続はセット C
    const values = [];
    let set = null; // 'A' | 'B' | 'C'
    const digitRun = (i) => {
      let n = 0;
      while (i + n < text.length && text[i + n] >= "0" && text[i + n] <= "9") n++;
      return n;
    };
    let i = 0;
    while (i < text.length) {
      const run = digitRun(i);
      const useC = run >= 6 || (run >= 4 && run === text.length);
      if (useC) {
        const pairs = Math.floor(run / 2);
        if (set === null) { values.push(START_C); set = "C"; }
        else if (set !== "C") { values.push(CODE_C); set = "C"; }
        for (let p = 0; p < pairs; p++) {
          values.push((text.charCodeAt(i) - 48) * 10 + (text.charCodeAt(i + 1) - 48));
          i += 2;
        }
        continue; // 奇数余りの 1 桁は A/B で符号化
      }
      const c = text.charCodeAt(i);
      const needed = c < 32 ? "A" : c > 95 ? "B" : set === "A" ? "A" : "B";
      if (set === null) { values.push(needed === "A" ? START_A : START_B); set = needed; }
      else if (set === "C" || (set === "A" && needed === "B") || (set === "B" && needed === "A")) {
        values.push(needed === "A" ? CODE_A : CODE_B);
        set = needed;
      }
      values.push(set === "A" ? (c < 32 ? c + 64 : c - 32) : c - 32);
      i++;
    }

    // チェックシンボル (モジュラス 103)
    let sum = values[0];
    for (let k = 1; k < values.length; k++) sum += values[k] * k;
    values.push(sum % 103);

    let bits = "";
    const widthsToBits = (widths) => {
      let s = "", bar = true;
      for (const wch of widths) {
        s += (bar ? "1" : "0").repeat(Number(wch));
        bar = !bar;
      }
      return s;
    };
    for (const v of values) bits += widthsToBits(C128[v]);
    bits += widthsToBits(C128_STOP);
    return { bits, display: text, name: "Code 128", quietLeft: 10, quietRight: 10 };
  }

  /* ===== Code 39 ===== */

  const C39_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ-. $/+%";
  /* ISO/IEC 16388 Table 1: 9 エレメント幅 + キャラクタ間ギャップ */
  const C39 = [
    "1112212111", "2112111121", "1122111121", "2122111111", "1112211121",
    "2112211111", "1122211111", "1112112121", "2112112111", "1122112111",
    "2111121121", "1121121121", "2121121111", "1111221121", "2111221111",
    "1121221111", "1111122121", "2111122111", "1121122111", "1111222111",
    "2111111221", "1121111221", "2121111211", "1111211221", "2111211211",
    "1121211211", "1111112221", "2111112211", "1121112211", "1111212211",
    "2211111121", "1221111121", "2221111111", "1211211121", "2211211111",
    "1221211111", "1211112121", "2211112111", "1221112111", "1212121111",
    "1212111211", "1211121211", "1112121211",
  ];
  const C39_STARTSTOP = "1211212111"; // '*' (末尾はギャップ)

  function encodeCode39(text) {
    let bits = "";
    const widthsToBits = (widths, dropGap) => {
      let s = "", bar = true;
      const end = dropGap ? widths.length - 1 : widths.length;
      for (let k = 0; k < end; k++) {
        s += (bar ? "1" : "0").repeat(Number(widths[k]));
        bar = !bar;
      }
      return s;
    };
    bits += widthsToBits(C39_STARTSTOP, false);
    for (const ch of text) {
      const idx = C39_CHARS.indexOf(ch);
      if (idx < 0) {
        throw new BAREncodeError("INVALID_CHARS",
          "Code 39 で使用できない文字です (使用可能: 数字・大文字 A-Z・ - . 空白 $ / + %)");
      }
      bits += widthsToBits(C39[idx], false);
    }
    bits += widthsToBits(C39_STARTSTOP, true); // 終了キャラクタはギャップなし
    return { bits, display: "*" + text + "*", name: "Code 39", quietLeft: 10, quietRight: 10 };
  }

  function encode(options) {
    const text = options.text;
    if (typeof text !== "string" || text.length === 0) {
      throw new BAREncodeError("EMPTY", "データを入力してください");
    }
    let r;
    switch (options.symbology) {
      case "ean13": r = encodeEAN13(text); break;
      case "code128": r = encodeCode128(text); break;
      case "code39": r = encodeCode39(text); break;
      default: throw new BAREncodeError("BAD_OPTION", "unknown symbology: " + options.symbology);
    }
    const pattern = Uint8Array.from(r.bits, (c) => (c === "1" ? 1 : 0));
    return {
      standard: "barcode",
      symbology: options.symbology,
      versionName: r.name,
      modules: [Array.from(pattern)], // 1 行として扱う
      pattern,
      width: pattern.length,
      height: 1,
      quietLeft: r.quietLeft,
      quietRight: r.quietRight,
      display: r.display,
      type: "linear",
    };
  }

  const BARLib = { encode, BAREncodeError };
  if (typeof module !== "undefined" && module.exports) module.exports = BARLib;
  else global.BARLib = BARLib;
})(typeof globalThis !== "undefined" ? globalThis : this);
