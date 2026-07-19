/*
 * barcode1d.js — 1次元バーコード エンコーダ(依存なし)
 *
 * 準拠規格:
 *   - JAN / EAN-13:      ISO/IEC 15420 (JIS X 0501)
 *   - Code 128:          ISO/IEC 15417
 *   - Code 39:           ISO/IEC 16388
 *   - GS1 DataBar-14:    ISO/IEC 24724 (GS1 General Specifications)
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

  /* GTIN 系共通のモジュラス 10 検査数字 (末尾桁の重みが 3 になるよう桁数に応じて交互配置) */
  function gtinCheckDigit(bodyDigits) {
    const n = bodyDigits.length;
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const weight = (n - 1 - i) % 2 === 0 ? 3 : 1;
      sum += (bodyDigits.charCodeAt(i) - 48) * weight;
    }
    return String((10 - (sum % 10)) % 10);
  }

  /* ===== JAN / EAN-13 ===== */
  /* クワイエットゾーンは ISO/IEC 15420 規定の左11・右7モジュール */

  /* 左側 A (L) パターン。B (G) は R の鏡像、R は A の反転 */
  const EAN_L = ["0001101", "0011001", "0010011", "0111101", "0100011",
    "0110001", "0101111", "0111011", "0110111", "0001011"];
  /* 先頭数字ごとの左側 6 桁のパリティ (0=A, 1=B) */
  const EAN_PARITY = ["000000", "001011", "001101", "001110", "010011",
    "011001", "011100", "010101", "010110", "011010"];

  function eanCheckDigit(d12) {
    return gtinCheckDigit(d12);
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
  /* クワイエットゾーンは ISO/IEC 15417 規定の左右各10モジュール */

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
  /* クワイエットゾーンは ISO/IEC 16388 規定の左右各10モジュール */

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

  /* ===== GS1 DataBar-14 (RSS-14) ===== */
  /* クワイエットゾーンは GS1 一般仕様規定の左右各10モジュール */
  /* ISO/IEC 24724 Annex の組み合わせ幅アルゴリズム。テーブル・アルゴリズムは
     zint (BSD-3-Clause) の rss.c/rss.h の値と突き合わせて実装。 */

  const DBAR_COMBINS_TABLE = [
    [1, 1, 1, 1, 1, 1], [1, 1, 1, 1, 1, 1], [1, 2, 1, 1, 1, 1], [1, 3, 3, 1, 1, 1],
    [1, 4, 6, 4, 1, 1], [1, 5, 10, 10, 5, 1], [1, 6, 15, 20, 15, 6], [1, 7, 21, 35, 35, 21],
    [1, 8, 28, 56, 70, 56], [1, 9, 36, 84, 126, 126], [1, 10, 45, 120, 210, 252],
    [1, 11, 55, 165, 330, 462], [1, 12, 66, 220, 495, 792], [1, 13, 78, 286, 715, 1287],
    [1, 14, 91, 364, 1001, 2002], [1, 15, 105, 455, 1365, 3003], [1, 16, 120, 560, 1820, 4368],
    [1, 17, 136, 680, 2380, 6188],
  ];
  function dbarCombins(n, r) {
    if (n < 0 || r < 0 || r > n) return 0;
    if (n < DBAR_COMBINS_TABLE.length && r < DBAR_COMBINS_TABLE[0].length) return DBAR_COMBINS_TABLE[n][r];
    let result = 1;
    for (let i = 0; i < r; i++) result = (result * (n - i)) / (i + 1);
    return Math.round(result);
  }

  /* 値 val (幅の合計 n モジュール、elements 個の要素、最大幅 maxWidth) を
     エレメント幅の配列に変換する (組み合わせ数え上げ) */
  function dbarGetWidths(valIn, nIn, elements, maxWidth, noNarrow) {
    const widths = new Array(elements).fill(0);
    let val = valIn, n = nIn, narrowMask = 0, bar = 0;
    for (bar = 0; bar < elements - 1; bar++) {
      let elmWidth = 1;
      narrowMask |= (1 << bar);
      let subVal;
      for (;;) {
        subVal = dbarCombins(n - elmWidth - 1, elements - bar - 2);
        if (noNarrow && !narrowMask && (n - elmWidth - (elements - bar - 1)) >= (elements - bar - 1)) {
          subVal -= dbarCombins(n - elmWidth - (elements - bar), elements - bar - 2);
        }
        if (elements - bar - 1 > 1) {
          let lessVal = 0;
          for (let mxw = n - elmWidth - (elements - bar - 2); mxw > maxWidth; mxw--) {
            lessVal += dbarCombins(n - elmWidth - mxw - 1, elements - bar - 3);
          }
          subVal -= lessVal * (elements - 1 - bar);
        } else if (n - elmWidth > maxWidth) {
          subVal -= 1;
        }
        val -= subVal;
        if (val < 0) break;
        elmWidth++;
        narrowMask &= ~(1 << bar);
      }
      val += subVal;
      n -= elmWidth;
      widths[bar] = elmWidth;
    }
    widths[bar] = n;
    return widths;
  }

  function dbarWidths(vOdd, vEven, nOdd, nEven, elements, maxWidth, noNarrow) {
    const oddW = dbarGetWidths(vOdd, nOdd, elements, maxWidth, noNarrow);
    const evenW = dbarGetWidths(vEven, nEven, elements, 9 - maxWidth, !noNarrow);
    const out = new Array(elements * 2);
    for (let k = 0; k < elements; k++) {
      out[2 * k] = oddW[k];
      out[2 * k + 1] = evenW[k];
    }
    return out;
  }

  const DBAR_G_SUM = [0, 161, 961, 2015, 2715, 0, 336, 1036, 1516];
  const DBAR_T_EVEN_ODD = [1, 10, 34, 70, 126, 4, 20, 48, 81];
  const DBAR_MODULES_ODD = [12, 10, 8, 6, 4, 5, 7, 9, 11];
  const DBAR_MODULES_EVEN = [4, 6, 8, 10, 12, 10, 8, 6, 4];
  const DBAR_WIDEST = [8, 6, 4, 3, 1, 2, 4, 6, 8];
  const DBAR_FINDER_PATTERN = [
    [3, 8, 2, 1, 1], [3, 5, 5, 1, 1], [3, 3, 7, 1, 1], [3, 1, 9, 1, 1], [2, 7, 4, 1, 1],
    [2, 5, 6, 1, 1], [2, 3, 8, 1, 1], [1, 5, 7, 1, 1], [1, 3, 9, 1, 1],
  ];
  const DBAR_CHECKSUM_WEIGHT = [
    [1, 3, 9, 27, 2, 6, 18, 54], [4, 12, 36, 29, 8, 24, 72, 58],
    [16, 48, 65, 37, 32, 17, 51, 74], [64, 34, 23, 69, 49, 68, 46, 59],
  ];

  function dbarGroup(val, outside) {
    const end = outside ? 4 : 8;
    let i;
    for (i = outside ? 0 : 5; i < end; i++) {
      if (val < DBAR_G_SUM[i + 1]) return i;
    }
    return i;
  }

  function encodeGS1DataBar(text) {
    if (!/^\d{13,14}$/.test(text)) {
      throw new BAREncodeError("INVALID_CHARS",
        "GS1 DataBar-14 は数字 13 桁 (または検査数字込み 14 桁) で入力してください");
    }
    const digits = text.slice(0, 13);
    const check = gtinCheckDigit(digits);
    if (text.length === 14 && text[13] !== check) {
      throw new BAREncodeError("INVALID_CHARS", "検査数字が不正です (正: " + check + ")");
    }

    let val = 0;
    for (const ch of digits) val = val * 10 + (ch.charCodeAt(0) - 48);
    const leftPair = Math.floor(val / 4537077);
    const rightPair = val % 4537077;
    const dataChar = [
      Math.floor(leftPair / 1597), leftPair % 1597,
      Math.floor(rightPair / 1597), rightPair % 1597,
    ];

    const dataWidths = dataChar.map((v, i) => {
      const outside = i % 2 === 0;
      const group = dbarGroup(v, outside);
      const rem = v - DBAR_G_SUM[group];
      const vDiv = Math.floor(rem / DBAR_T_EVEN_ODD[group]);
      const vMod = rem % DBAR_T_EVEN_ODD[group];
      const oddVal = outside ? vDiv : vMod;
      const evenVal = outside ? vMod : vDiv;
      return dbarWidths(oddVal, evenVal, DBAR_MODULES_ODD[group], DBAR_MODULES_EVEN[group],
        4, DBAR_WIDEST[group], i % 2 === 1);
    });

    let checksum = 0;
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 8; j++) checksum += DBAR_CHECKSUM_WEIGHT[i][j] * dataWidths[i][j];
    }
    checksum %= 79;
    if (checksum >= 8) checksum++;
    if (checksum >= 72) checksum++;
    const cLeft = Math.floor(checksum / 9);
    const cRight = checksum % 9;

    const total = new Array(46).fill(0);
    total[0] = 1; total[1] = 1;
    total[44] = 1; total[45] = 1;
    for (let i = 0; i < 8; i++) total[i + 2] = dataWidths[0][i];
    for (let i = 0; i < 8; i++) total[i + 15] = dataWidths[1][7 - i];
    for (let i = 0; i < 8; i++) total[i + 23] = dataWidths[3][i];
    for (let i = 0; i < 8; i++) total[i + 36] = dataWidths[2][7 - i];
    for (let i = 0; i < 5; i++) total[i + 10] = DBAR_FINDER_PATTERN[cLeft][i];
    for (let i = 0; i < 5; i++) total[i + 31] = DBAR_FINDER_PATTERN[cRight][4 - i];

    let bits = "", bar = true;
    for (const w of total) {
      bits += (bar ? "1" : "0").repeat(w);
      bar = !bar;
    }
    return { bits, display: digits + check, name: "GS1 DataBar-14", quietLeft: 10, quietRight: 10 };
  }

  /* ===== UPC-A ===== */
  /* クワイエットゾーンは UPC 規格慣例の左右各9モジュール */
  /* UPC-A は EAN-13 の先頭桁を 0 に固定した特殊形と等価 (バーパターンは同一)。
     11桁 (システム番号+データ) または検査数字込み12桁で入力する。 */
  function encodeUPCA(text) {
    if (!/^\d{11,12}$/.test(text)) {
      throw new BAREncodeError("INVALID_CHARS", "UPC-A は数字 11 桁 (または検査数字込み 12 桁) で入力してください");
    }
    const inner = encodeEAN13("0" + text);
    return { bits: inner.bits, display: inner.display.slice(1), name: "UPC-A", quietLeft: 9, quietRight: 9 };
  }

  /* ===== UPC-E (ゼロサプレス) ===== */
  /* クワイエットゾーンは UPC 規格慣例の左右各9モジュール */
  /* 注: UPC-E と Codabar はエンコード実装済みだが、ZXing での読み取り検証が
     取れていないため UI (app.js) には接続していない (CLAUDE.md 参照)。
     テスト (test/encode-decode.test.js) では出力を固定している。 */
  /* GS1 General Specifications の UPC-E 展開規則。末尾桁により
     11桁の UPC-A ボディへ展開する。 */
  function upcEExpand(ns, d) {
    const last = d[5];
    let body;
    if (last <= 2) body = [ns, d[0], d[1], last, 0, 0, 0, 0, d[2], d[3], d[4]];
    else if (last === 3) body = [ns, d[0], d[1], d[2], 0, 0, 0, 0, 0, d[3], d[4]];
    else if (last === 4) body = [ns, d[0], d[1], d[2], d[3], 0, 0, 0, 0, 0, d[4]];
    else body = [ns, d[0], d[1], d[2], d[3], d[4], 0, 0, 0, 0, last];
    return body.join("");
  }
  const UPCE_PARITY = {
    0: ["BBBAAA", "BBABAA", "BBAABA", "BBAAAB", "BABBAA", "BAABBA", "BAAABB", "BABABA", "BABAAB", "BAABAB"],
    1: ["AAABBB", "AABABB", "AABBAB", "AABBBA", "ABAABB", "ABBAAB", "ABBBAA", "ABABAB", "ABABBA", "ABBABA"],
  };
  function encodeUPCE(text) {
    let ns, digits6, checkIn;
    if (/^\d{6}$/.test(text)) { ns = 0; digits6 = text; checkIn = null; }
    else if (/^\d{7}$/.test(text)) { ns = 0; digits6 = text.slice(0, 6); checkIn = text[6]; }
    else if (/^[01]\d{6}$/.test(text)) { ns = Number(text[0]); digits6 = text.slice(1); checkIn = null; }
    else if (/^[01]\d{7}$/.test(text)) { ns = Number(text[0]); digits6 = text.slice(1, 7); checkIn = text[7]; }
    else {
      throw new BAREncodeError("INVALID_CHARS",
        "UPC-E は数字6桁 (先頭にシステム番号0/1、末尾に検査数字を付加可) で入力してください");
    }
    const d = digits6.split("").map(Number);
    const body11 = upcEExpand(ns, d);
    const check = gtinCheckDigit(body11);
    if (checkIn != null && checkIn !== check) {
      throw new BAREncodeError("INVALID_CHARS", "検査数字が不正です (正: " + check + ")");
    }
    const parityPattern = UPCE_PARITY[ns][Number(check)];
    let bits = "101";
    for (let i = 0; i < 6; i++) {
      const L = EAN_L[d[i]];
      bits += parityPattern[i] === "A" ? L : L.split("").reverse().map((c) => (c === "0" ? "1" : "0")).join("");
    }
    bits += "010101";
    return { bits, display: String(ns) + digits6 + check, name: "UPC-E", quietLeft: 9, quietRight: 9 };
  }

  /* ===== Codabar ===== */
  /* クワイエットゾーンは慣例の左右各10モジュール */
  /* ANSI/AIM BC3-1995。数字と開始終了 A-D に対応 (記号 - $ : / . + は
     テーブルの信頼できる出典を確認できなかったため今回は非対応)。
     各文字は 4 バー + 3 スペース = 7 エレメント、うち2つが幅広。 */
  const CODABAR_CHARS = "0123456789ABCD";
  const CODABAR_WIDTHS = [
    "1111122", "1111221", "1112112", "2211111", "1121121",
    "2111121", "1211112", "1211211", "1221111", "2112111",
    "1212121", "1121112", "1122121", "1212112",
  ];
  function encodeCodabar(text) {
    const t = text.toUpperCase();
    if (t.length < 2 || !"ABCD".includes(t[0]) || !"ABCD".includes(t[t.length - 1])) {
      throw new BAREncodeError("INVALID_CHARS", "Codabar は開始/終了文字 (A-D) を含めて入力してください (例: A123B)");
    }
    let bits = "";
    for (let i = 0; i < t.length; i++) {
      const idx = CODABAR_CHARS.indexOf(t[i]);
      if (idx < 0) {
        throw new BAREncodeError("INVALID_CHARS",
          "Codabar で使用できない文字です (使用可能: 数字と開始終了 A-D)");
      }
      const widths = CODABAR_WIDTHS[idx];
      let bar = true;
      for (const wch of widths) {
        bits += (bar ? "1" : "0").repeat(Number(wch));
        bar = !bar;
      }
      if (i < t.length - 1) bits += "0"; // 文字間ギャップ (1 モジュール幅の明部)
    }
    return { bits, display: t, name: "Codabar", quietLeft: 10, quietRight: 10 };
  }

  /* ===== Code 93 ===== */
  /* クワイエットゾーンは Code 39 に準じた慣例の左右各10モジュール */
  const C93_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ-. $/+%";
  /* AIM USS-93。各文字9モジュール幅 (3バー+3スペース)。 */
  const C93 = [
    "131112", "111213", "111312", "111411", "121113", "121212", "121311", "111114",
    "131211", "141111", "211113", "211212", "211311", "221112", "221211", "231111",
    "112113", "112212", "112311", "122112", "132111", "111123", "111222", "111321",
    "121122", "131121", "212112", "212211", "211122", "211221", "221121", "222111",
    "112122", "112221", "122121", "123111", "121131", "311112", "311211", "321111",
    "112131", "113121", "211131", "121221", "312111", "311121", "122211",
  ];
  const C93_START = "111141", C93_STOP = "1111411";
  function code93Checksum(values, weightMax) {
    let sum = 0, weight = 1;
    for (let i = values.length - 1; i >= 0; i--) {
      sum += values[i] * weight;
      weight++;
      if (weight > weightMax) weight = 1;
    }
    return sum % 47;
  }
  function encodeCode93(text) {
    const values = [];
    for (const ch of text) {
      const idx = C93_CHARS.indexOf(ch);
      if (idx < 0) {
        throw new BAREncodeError("INVALID_CHARS",
          "Code 93 で使用できない文字です (使用可能: 数字・大文字 A-Z・ - . 空白 $ / + %)");
      }
      values.push(idx);
    }
    if (values.length === 0) throw new BAREncodeError("EMPTY", "データを入力してください");
    const c = code93Checksum(values, 20);
    const k = code93Checksum(values.concat([c]), 15);
    let bits = "";
    const widthsToBits = (widths) => {
      let s = "", bar = true;
      for (const wch of widths) { s += (bar ? "1" : "0").repeat(Number(wch)); bar = !bar; }
      return s;
    };
    bits += widthsToBits(C93_START);
    for (const v of values) bits += widthsToBits(C93[v]);
    bits += widthsToBits(C93[c]);
    bits += widthsToBits(C93[k]);
    bits += widthsToBits(C93_STOP);
    return { bits, display: text, name: "Code 93", quietLeft: 10, quietRight: 10 };
  }

  /* ===== 2 of 5 系 (Industrial 2 of 5 / Interleaved 2 of 5) ===== */
  /* クワイエットゾーンは慣例の左右各10モジュール */
  /* 各数字を5エレメント (幅広2・狭3) で表す標準パターン */
  const TOF5_DIGIT = [
    "NNWWN", "WNNNW", "NWNNW", "WWNNN", "NNWNW",
    "WNWNN", "NWWNN", "NNNWW", "WNNWN", "NWNWN",
  ];
  function tof5Widths(pattern, narrow, wide) {
    return pattern.split("").map((c) => (c === "W" ? wide : narrow));
  }

  function encodeIndustrial2of5(text) {
    if (!/^\d+$/.test(text)) throw new BAREncodeError("INVALID_CHARS", "Industrial 2 of 5 は数字のみ使用できます");
    /* バーのみが情報を持ち、スペース (キャラクタ間ギャップ含む) は全て狭幅。
       スタートは 太,太,狭、ストップは 太,狭,太 の3バー。 */
    const bars = [2, 2, 1];
    for (const ch of text) bars.push(...tof5Widths(TOF5_DIGIT[ch.charCodeAt(0) - 48], 1, 2));
    bars.push(2, 1, 2);
    const bits = bars.map((w) => "1".repeat(w)).join("0");
    return { bits, display: text, name: "Industrial 2 of 5", quietLeft: 10, quietRight: 10 };
  }

  function encodeInterleaved2of5(text) {
    if (!/^\d+$/.test(text)) throw new BAREncodeError("INVALID_CHARS", "Interleaved 2 of 5 は数字のみ使用できます");
    const digits = text.length % 2 === 1 ? "0" + text : text;
    let bits = "1010"; // start (狭バー,狭スペース,狭バー,狭スペース = NN NN 相当を簡易表現)
    for (let i = 0; i < digits.length; i += 2) {
      const barW = tof5Widths(TOF5_DIGIT[digits.charCodeAt(i) - 48], 1, 2);
      const spcW = tof5Widths(TOF5_DIGIT[digits.charCodeAt(i + 1) - 48], 1, 2);
      for (let k = 0; k < 5; k++) {
        bits += "1".repeat(barW[k]);
        bits += "0".repeat(spcW[k]);
      }
    }
    bits += "1101"; // stop: 太バー,狭スペース,狭バー (幅2,1,1)
    return { bits, display: digits, name: "Interleaved 2 of 5", quietLeft: 10, quietRight: 10 };
  }

  function encodeITF14(text) {
    if (!/^\d{13,14}$/.test(text)) {
      throw new BAREncodeError("INVALID_CHARS", "ITF-14 は数字13桁 (または検査数字込み14桁) で入力してください");
    }
    const body = text.slice(0, 13);
    const check = gtinCheckDigit(body);
    if (text.length === 14 && text[13] !== check) {
      throw new BAREncodeError("INVALID_CHARS", "検査数字が不正です (正: " + check + ")");
    }
    const inner = encodeInterleaved2of5(body + check);
    return { ...inner, name: "ITF-14", quietLeft: 10, quietRight: 10 };
  }

  /* ===== Pharmacode ===== */
  /* クワイエットゾーンは慣例の左右各10モジュール */
  /* 2進表現そのもの (値+1 の2進数を LSB 側から、0=狭バー・1=太バーとして
     バーのみを並べ、間は常に狭スペース)。3〜131070 の範囲。 */
  function encodePharmacode(text) {
    const n = Number(text);
    if (!/^\d+$/.test(text) || !Number.isInteger(n) || n < 3 || n > 131070) {
      throw new BAREncodeError("INVALID_CHARS", "Pharmacode は 3〜131070 の整数で入力してください");
    }
    const barsRev = [];
    let v = n;
    while (v > 0) {
      if (v % 2 === 1) { barsRev.push(1); v = (v - 1) / 2; } else { barsRev.push(2); v = (v - 2) / 2; }
    }
    const bars = barsRev.reverse();
    let bits = "";
    for (let i = 0; i < bars.length; i++) {
      bits += "1".repeat(bars[i]);
      if (i < bars.length - 1) bits += "0";
    }
    return { bits, display: text, name: "Pharmacode", quietLeft: 10, quietRight: 10 };
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
      case "gs1databar": r = encodeGS1DataBar(text); break;
      case "upca": r = encodeUPCA(text); break;
      case "upce": r = encodeUPCE(text); break;
      case "codabar": r = encodeCodabar(text); break;
      case "code93": r = encodeCode93(text); break;
      case "itf": r = encodeInterleaved2of5(text); break;
      case "itf14": r = encodeITF14(text); break;
      case "industrial2of5": r = encodeIndustrial2of5(text); break;
      case "pharmacode": r = encodePharmacode(text); break;
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
