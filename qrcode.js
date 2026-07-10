/*
 * qrcode.js — QRコード / MicroQRコード / rMQRコード エンコーダ(依存なし)
 *
 * 準拠規格:
 *   - QRコード / MicroQRコード: ISO/IEC 18004
 *   - rMQRコード:                 ISO/IEC 23941:2022
 *
 * 数値テーブル(容量・RSブロック・フォーマット情報ビット列・配置座標)は
 * 規格書記載の値。zint (BSD-3-Clause) backend/qr.h および
 * rmqrcode-python (MIT) の実装とクロスチェック済み。
 */
(function (global) {
  "use strict";

  /* ========================================================================
   * GF(256) 演算 (原始多項式 x^8+x^4+x^3+x^2+1 = 0x11D)
   * ====================================================================== */
  const GF_EXP = new Uint8Array(510);
  const GF_LOG = new Int16Array(256);
  {
    let x = 1;
    for (let i = 0; i < 255; i++) {
      GF_EXP[i] = x;
      GF_LOG[x] = i;
      x <<= 1;
      if (x & 0x100) x ^= 0x11d;
    }
    for (let i = 255; i < 510; i++) GF_EXP[i] = GF_EXP[i - 255];
  }

  /* 生成多項式 Π(x - α^i), i=0..degree-1。係数は最高次から。 */
  const rsPolyCache = new Map();
  function rsGeneratorPoly(degree) {
    let g = rsPolyCache.get(degree);
    if (g) return g;
    g = [1];
    for (let i = 0; i < degree; i++) {
      const ng = new Array(g.length + 1).fill(0);
      for (let j = 0; j < g.length; j++) {
        ng[j] ^= g[j];
        if (g[j] !== 0) ng[j + 1] ^= GF_EXP[(GF_LOG[g[j]] + i) % 255];
      }
      g = ng;
    }
    rsPolyCache.set(degree, g);
    return g;
  }

  /* データ多項式を生成多項式で割った剰余 = 誤り訂正コード語 */
  function rsRemainder(data, degree) {
    const gen = rsGeneratorPoly(degree);
    const rem = new Uint8Array(degree);
    for (let k = 0; k < data.length; k++) {
      const factor = data[k] ^ rem[0];
      rem.copyWithin(0, 1);
      rem[degree - 1] = 0;
      if (factor !== 0) {
        const lf = GF_LOG[factor];
        for (let i = 0; i < degree; i++) {
          const c = gen[i + 1];
          if (c !== 0) rem[i] ^= GF_EXP[(GF_LOG[c] + lf) % 255];
        }
      }
    }
    return rem;
  }

  /* ========================================================================
   * ビット列バッファ
   * ====================================================================== */
  class BitBuffer {
    constructor() {
      this.bits = [];
    }
    get length() {
      return this.bits.length;
    }
    put(value, count) {
      for (let i = count - 1; i >= 0; i--) this.bits.push((value >>> i) & 1);
    }
  }

  /* ========================================================================
   * エラー
   * ====================================================================== */
  class QREncodeError extends Error {
    constructor(code, message) {
      super(message);
      this.name = "QREncodeError";
      this.code = code; // 'TOO_LONG' | 'INVALID_CHARS' | 'EMPTY' | 'BAD_OPTION'
    }
  }

  /* ========================================================================
   * データ符号化モード (ISO/IEC 18004 §7.4, ISO/IEC 23941 §7.4)
   * ====================================================================== */
  const ALNUM_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:";

  function detectMode(text) {
    if (/^[0-9]+$/.test(text)) return "numeric";
    let alnum = true;
    for (const ch of text) {
      if (ALNUM_CHARS.indexOf(ch) < 0) {
        alnum = false;
        break;
      }
    }
    return alnum ? "alphanumeric" : "byte";
  }

  function utf8Bytes(text) {
    return new TextEncoder().encode(text);
  }

  /* モード別データ部ビット長 */
  function dataBitLength(mode, charCount) {
    switch (mode) {
      case "numeric":
        return 10 * Math.floor(charCount / 3) + [0, 4, 7][charCount % 3];
      case "alphanumeric":
        return 11 * Math.floor(charCount / 2) + 6 * (charCount % 2);
      case "byte":
        return 8 * charCount;
    }
    throw new QREncodeError("BAD_OPTION", "unknown mode: " + mode);
  }

  function appendDataBits(bb, mode, text, bytes) {
    if (mode === "numeric") {
      for (let i = 0; i < text.length; i += 3) {
        const chunk = text.substr(i, 3);
        bb.put(parseInt(chunk, 10), [0, 4, 7, 10][chunk.length]);
      }
    } else if (mode === "alphanumeric") {
      for (let i = 0; i + 1 < text.length; i += 2) {
        bb.put(
          ALNUM_CHARS.indexOf(text[i]) * 45 + ALNUM_CHARS.indexOf(text[i + 1]),
          11
        );
      }
      if (text.length % 2 === 1) {
        bb.put(ALNUM_CHARS.indexOf(text[text.length - 1]), 6);
      }
    } else {
      for (const b of bytes) bb.put(b, 8);
    }
  }

  /* ========================================================================
   * 共通テーブル (ISO/IEC 18004)
   * ====================================================================== */

  /* Table 7: データコード語数 [L, M, Q, H][version-1] */
  const QR_DATA_CW = [
    [19, 34, 55, 80, 108, 136, 156, 194, 232, 274, 324, 370, 428, 461, 523,
      589, 647, 721, 795, 861, 932, 1006, 1094, 1174, 1276, 1370, 1468, 1531,
      1631, 1735, 1843, 1955, 2071, 2191, 2306, 2434, 2566, 2702, 2812, 2956],
    [16, 28, 44, 64, 86, 108, 124, 154, 182, 216, 254, 290, 334, 365, 415,
      453, 507, 563, 627, 669, 714, 782, 860, 914, 1000, 1062, 1128, 1193,
      1267, 1373, 1455, 1541, 1631, 1725, 1812, 1914, 1992, 2102, 2216, 2334],
    [13, 22, 34, 48, 62, 76, 88, 110, 132, 154, 180, 206, 244, 261, 295,
      325, 367, 397, 445, 485, 512, 568, 614, 664, 718, 754, 808, 871, 911,
      985, 1033, 1115, 1171, 1231, 1286, 1354, 1426, 1502, 1582, 1666],
    [9, 16, 26, 36, 46, 60, 66, 86, 100, 122, 140, 158, 180, 197, 223, 253,
      283, 313, 341, 385, 406, 442, 464, 514, 538, 596, 628, 661, 701, 745,
      793, 845, 901, 961, 986, 1054, 1096, 1142, 1222, 1276],
  ];

  /* Table 1: 総コード語数 [version-1] */
  const QR_TOTAL_CW = [
    26, 44, 70, 100, 134, 172, 196, 242, 292, 346, 404, 466, 532, 581, 655,
    733, 815, 901, 991, 1085, 1156, 1258, 1364, 1474, 1588, 1706, 1828, 1921,
    2051, 2185, 2323, 2465, 2611, 2761, 2876, 3034, 3196, 3362, 3532, 3706,
  ];

  /* Table 9: 誤り訂正ブロック数 [L, M, Q, H][version-1] */
  const QR_BLOCKS = [
    [1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9,
      10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
    [1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17,
      17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
    [1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20,
      23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
    [1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25,
      25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81],
  ];

  /* Table E.1: 位置合わせパターン中心座標 [version-2] (v1 はなし) */
  const QR_ALIGN = [
    [6, 18], [6, 22], [6, 26], [6, 30], [6, 34],
    [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50], [6, 30, 54],
    [6, 32, 58], [6, 34, 62], [6, 26, 46, 66], [6, 26, 48, 70],
    [6, 26, 50, 74], [6, 30, 54, 78], [6, 30, 56, 82], [6, 30, 58, 86],
    [6, 34, 62, 90], [6, 28, 50, 72, 94], [6, 26, 50, 74, 98],
    [6, 30, 54, 78, 102], [6, 28, 54, 80, 106], [6, 32, 58, 84, 110],
    [6, 30, 58, 86, 114], [6, 34, 62, 90, 118], [6, 26, 50, 74, 98, 122],
    [6, 30, 54, 78, 102, 126], [6, 26, 52, 78, 104, 130],
    [6, 30, 56, 82, 108, 134], [6, 34, 60, 86, 112, 138],
    [6, 30, 58, 86, 114, 142], [6, 34, 62, 90, 118, 146],
    [6, 30, 54, 78, 102, 126, 150], [6, 24, 50, 76, 102, 128, 154],
    [6, 28, 54, 80, 106, 132, 158], [6, 32, 58, 84, 110, 136, 162],
    [6, 26, 54, 82, 110, 138, 166], [6, 30, 58, 86, 114, 142, 170],
  ];

  /* Annex C: フォーマット情報ビット列 (BCH(15,5) + XOR 済み)
   * index = (誤り訂正指示ビット << 3) | マスク番号  (L=01, M=00, Q=11, H=10) */
  const QR_FORMAT_SEQ = [
    0x5412, 0x5125, 0x5e7c, 0x5b4b, 0x45f9, 0x40ce, 0x4f97, 0x4aa0,
    0x77c4, 0x72f3, 0x7daa, 0x789d, 0x662f, 0x6318, 0x6c41, 0x6976,
    0x1689, 0x13be, 0x1ce7, 0x19d0, 0x0762, 0x0255, 0x0d0c, 0x083b,
    0x355f, 0x3068, 0x3f31, 0x3a06, 0x24b4, 0x2183, 0x2eda, 0x2bed,
  ];

  /* Annex D: 型番情報ビット列 (BCH(18,6)) [version-7] */
  const QR_VERSION_SEQ = [
    0x07c94, 0x085bc, 0x09a99, 0x0a4d3, 0x0bbf6, 0x0c762, 0x0d847, 0x0e60d,
    0x0f928, 0x10b78, 0x1145d, 0x12a17, 0x13532, 0x149a6, 0x15683, 0x168c9,
    0x177ec, 0x18ec4, 0x191e1, 0x1afab, 0x1b08e, 0x1cc1a, 0x1d33f, 0x1ed75,
    0x1f250, 0x209d5, 0x216f0, 0x228ba, 0x2379f, 0x24b0b, 0x2542e, 0x26a64,
    0x27541, 0x28c69,
  ];

  /* Annex C: MicroQR用フォーマット情報ビット列
   * index = (シンボル番号 << 2) | マスク番号 */
  const MICRO_FORMAT_SEQ = [
    0x4445, 0x4172, 0x4e2b, 0x4b1c, 0x55ae, 0x5099, 0x5fc0, 0x5af7,
    0x6793, 0x62a4, 0x6dfd, 0x68ca, 0x7678, 0x734f, 0x7c16, 0x7921,
    0x06de, 0x03e9, 0x0cb0, 0x0987, 0x1735, 0x1202, 0x1d5b, 0x186c,
    0x2508, 0x203f, 0x2f66, 0x2a51, 0x34e3, 0x31d4, 0x3e8d, 0x3bba,
  ];

  /* MicroQR: [ecIdx L/M/Q][version-1] = [データビット数, データCW数, 誤り訂正CW数] */
  const MICRO_DATA = [
    [[20, 3, 2], [40, 5, 5], [84, 11, 6], [128, 16, 8]],   // L (M1 は誤り検出のみ)
    [[0, 0, 0], [32, 4, 6], [68, 9, 8], [112, 14, 10]],     // M
    [[0, 0, 0], [0, 0, 0], [0, 0, 0], [80, 10, 14]],        // Q
  ];
  const MICRO_SIZES = [11, 13, 15, 17];
  /* 文字数指示子ビット数 [mode][version-1] (0 = そのモード使用不可) */
  const MICRO_CCI = {
    numeric: [3, 4, 5, 6],
    alphanumeric: [0, 3, 4, 5],
    byte: [0, 0, 4, 5],
  };
  const MICRO_MODE_VALUE = { numeric: 0, alphanumeric: 1, byte: 2 };
  /* MicroQRのマスク 0-3 は QR のマスク 1,4,6,7 と同じ式 */
  const MICRO_MASK_MAP = [1, 4, 6, 7];

  /* ========================================================================
   * rMQR テーブル (ISO/IEC 23941:2022)
   * ====================================================================== */
  const RMQR_H = [
    7, 7, 7, 7, 7, 9, 9, 9, 9, 9, 11, 11, 11, 11, 11, 11,
    13, 13, 13, 13, 13, 13, 15, 15, 15, 15, 15, 17, 17, 17, 17, 17,
  ];
  const RMQR_W = [
    43, 59, 77, 99, 139, 43, 59, 77, 99, 139, 27, 43, 59, 77, 99, 139,
    27, 43, 59, 77, 99, 139, 43, 59, 77, 99, 139, 43, 59, 77, 99, 139,
  ];
  const RMQR_TOTAL_CW = [
    13, 21, 32, 44, 68, 21, 33, 49, 66, 99, 15, 31, 47, 67, 89, 132,
    21, 41, 60, 85, 113, 166, 51, 74, 103, 136, 199, 61, 88, 122, 160, 232,
  ];
  /* Table 6: データコード語数 [M, H] */
  const RMQR_DATA_CW = [
    [6, 12, 20, 28, 44, 12, 21, 31, 42, 63, 7, 19, 31, 43, 57, 84,
      12, 27, 38, 53, 73, 106, 33, 48, 67, 88, 127, 39, 56, 78, 100, 152],
    [3, 7, 10, 14, 24, 7, 11, 17, 22, 33, 5, 11, 15, 23, 29, 42,
      7, 13, 20, 29, 35, 54, 15, 26, 31, 48, 69, 21, 28, 38, 56, 76],
  ];
  /* Table 8: 誤り訂正ブロック数 [M, H] */
  const RMQR_BLOCKS = [
    [1, 1, 1, 1, 1, 1, 1, 1, 1, 2, 1, 1, 1, 1, 2, 2,
      1, 1, 1, 2, 2, 3, 1, 1, 2, 2, 3, 1, 2, 2, 3, 4],
    [1, 1, 1, 1, 2, 1, 1, 2, 2, 3, 1, 1, 2, 2, 2, 3,
      1, 1, 2, 2, 3, 4, 2, 2, 3, 4, 5, 2, 2, 3, 4, 6],
  ];
  /* Table 3: 文字数指示子ビット数 [mode][versionIdx] */
  const RMQR_CCI = {
    numeric: [4, 5, 6, 7, 7, 5, 6, 7, 7, 8, 4, 6, 7, 7, 8, 8,
      5, 6, 7, 7, 8, 8, 7, 7, 8, 8, 9, 7, 8, 8, 8, 9],
    alphanumeric: [3, 5, 5, 6, 6, 5, 5, 6, 6, 7, 4, 5, 6, 6, 7, 7,
      5, 6, 6, 7, 7, 8, 6, 7, 7, 7, 8, 6, 7, 7, 8, 8],
    byte: [3, 4, 5, 5, 6, 4, 5, 5, 6, 6, 3, 5, 5, 6, 6, 7,
      4, 5, 6, 6, 7, 7, 6, 6, 7, 7, 7, 6, 6, 7, 7, 8],
  };
  const RMQR_MODE_VALUE = { numeric: 1, alphanumeric: 2, byte: 3 };
  /* Table D.1: 位置合わせパターン中心の列座標 (幅ごと) */
  const RMQR_ALIGN = {
    27: [], 43: [21], 59: [19, 39], 77: [25, 51],
    99: [23, 49, 75], 139: [27, 55, 83, 111],
  };
  /* フォーマット情報ビット列 (BCH(18,6) + XOR 済み)。
   * index = versionIdx + (H レベルなら 32) */
  const RMQR_FORMAT_LEFT = [
    0x1FAB2, 0x1E597, 0x1DBDD, 0x1C4F8, 0x1B86C, 0x1A749, 0x19903, 0x18626,
    0x17F0E, 0x1602B, 0x15E61, 0x14144, 0x13DD0, 0x122F5, 0x11CBF, 0x1039A,
    0x0F1CA, 0x0EEEF, 0x0D0A5, 0x0CF80, 0x0B314, 0x0AC31, 0x0927B, 0x08D5E,
    0x07476, 0x06B53, 0x05519, 0x04A3C, 0x036A8, 0x0298D, 0x017C7, 0x008E2,
    0x3F367, 0x3EC42, 0x3D208, 0x3CD2D, 0x3B1B9, 0x3AE9C, 0x390D6, 0x38FF3,
    0x376DB, 0x369FE, 0x357B4, 0x34891, 0x33405, 0x32B20, 0x3156A, 0x30A4F,
    0x2F81F, 0x2E73A, 0x2D970, 0x2C655, 0x2BAC1, 0x2A5E4, 0x29BAE, 0x2848B,
    0x27DA3, 0x26286, 0x25CCC, 0x243E9, 0x23F7D, 0x22058, 0x21E12, 0x20137,
  ];
  const RMQR_FORMAT_RIGHT = [
    0x20A7B, 0x2155E, 0x22B14, 0x23431, 0x248A5, 0x25780, 0x269CA, 0x276EF,
    0x28FC7, 0x290E2, 0x2AEA8, 0x2B18D, 0x2CD19, 0x2D23C, 0x2EC76, 0x2F353,
    0x30103, 0x31E26, 0x3206C, 0x33F49, 0x343DD, 0x35CF8, 0x362B2, 0x37D97,
    0x384BF, 0x39B9A, 0x3A5D0, 0x3BAF5, 0x3C661, 0x3D944, 0x3E70E, 0x3F82B,
    0x003AE, 0x01C8B, 0x022C1, 0x03DE4, 0x04170, 0x05E55, 0x0601F, 0x07F3A,
    0x08612, 0x09937, 0x0A77D, 0x0B858, 0x0C4CC, 0x0DBE9, 0x0E5A3, 0x0FA86,
    0x108D6, 0x117F3, 0x129B9, 0x1369C, 0x14A08, 0x1552D, 0x16B67, 0x17442,
    0x18D6A, 0x1924F, 0x1AC05, 0x1B320, 0x1CFB4, 0x1D091, 0x1EEDB, 0x1F1FE,
  ];
  const RMQR_VERSION_NAMES = RMQR_H.map((h, i) => "R" + h + "x" + RMQR_W[i]);

  /* ========================================================================
   * 行列 (0,0)=左上, x=列, y=行
   * ====================================================================== */
  class Matrix {
    constructor(width, height) {
      this.width = width;
      this.height = height;
      this.dark = new Uint8Array(width * height);
      this.func = new Uint8Array(width * height); // 機能パターン/予約領域
    }
    set(x, y, dark, isFunc) {
      const i = y * this.width + x;
      this.dark[i] = dark ? 1 : 0;
      if (isFunc) this.func[i] = 1;
    }
    get(x, y) {
      return this.dark[y * this.width + x];
    }
    isFunc(x, y) {
      return this.func[y * this.width + x];
    }
    toRows() {
      const rows = [];
      for (let y = 0; y < this.height; y++) {
        rows.push(Array.from(this.dark.subarray(y * this.width, (y + 1) * this.width)));
      }
      return rows;
    }
  }

  /* QR のマスク条件 (ISO/IEC 18004 Table 10)。y=行(i), x=列(j) */
  function maskPredicate(pattern, y, x) {
    switch (pattern) {
      case 0: return (y + x) % 2 === 0;
      case 1: return y % 2 === 0;
      case 2: return x % 3 === 0;
      case 3: return (y + x) % 3 === 0;
      case 4: return (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0;
      case 5: return ((y * x) % 2) + ((y * x) % 3) === 0;
      case 6: return (((y * x) % 2) + ((y * x) % 3)) % 2 === 0;
      case 7: return (((y + x) % 2) + ((y * x) % 3)) % 2 === 0;
    }
  }

  function applyMask(M, pattern) {
    for (let y = 0; y < M.height; y++) {
      for (let x = 0; x < M.width; x++) {
        if (!M.isFunc(x, y) && maskPredicate(pattern, y, x)) {
          M.dark[y * M.width + x] ^= 1;
        }
      }
    }
  }

  /* 7x7 位置検出パターン(ファインダ)を (px,py) 起点で描画 */
  function drawFinder(M, px, py) {
    for (let dy = 0; dy < 7; dy++) {
      for (let dx = 0; dx < 7; dx++) {
        const ring = dy === 0 || dy === 6 || dx === 0 || dx === 6;
        const core = dy >= 2 && dy <= 4 && dx >= 2 && dx <= 4;
        M.set(px + dx, py + dy, ring || core, true);
      }
    }
  }

  /* ペア列(右→左)にビット列をつづら折りで配置。機能セルはスキップ。
   * skipCol6=true で QR の縦タイミング列(6)を除外。
   * startRight は最初のペアの右列 (rMQR は右端が縦タイミングのため w-2)。 */
  function placeData(M, bits, skipCol6, startRight) {
    let bitIdx = 0;
    let pairIdx = 0;
    for (let right = startRight; right >= 1; right -= 2) {
      if (skipCol6 && right === 6) right = 5;
      const upward = pairIdx % 2 === 0;
      for (let v = 0; v < M.height; v++) {
        const y = upward ? M.height - 1 - v : v;
        for (let dx = 0; dx < 2; dx++) {
          const x = right - dx;
          if (!M.isFunc(x, y)) {
            // ビット列を使い切ったら剰余ビットとして 0 (明) のまま
            if (bitIdx < bits.length) {
              M.dark[y * M.width + x] = bits[bitIdx];
              bitIdx++;
            }
          }
        }
      }
      pairIdx++;
    }
  }

  /* ビット列 → 8bit コード語配列 (端数は 0 詰め) */
  function bitsToBytes(bits) {
    const bytes = new Uint8Array(Math.ceil(bits.length / 8));
    for (let i = 0; i < bits.length; i++) {
      bytes[i >> 3] |= bits[i] << (7 - (i & 7));
    }
    return bytes;
  }

  /* データコード語をブロック分割し RS 符号を付加、規格どおり交互配置して返す。
   * ブロック構成は (総CW, データCW, ブロック数) から規格の規則
   * (前方に短いブロック) で導出。 */
  function buildFinalCodewords(dataCodewords, totalCw, numBlocks) {
    const dataCw = dataCodewords.length;
    const eccPerBlock = (totalCw - dataCw) / numBlocks;
    const shortLen = Math.floor(dataCw / numBlocks);
    const longBlocks = dataCw % numBlocks;
    const shortBlocks = numBlocks - longBlocks;

    const dataBlocks = [];
    const eccBlocks = [];
    let pos = 0;
    for (let b = 0; b < numBlocks; b++) {
      const len = b < shortBlocks ? shortLen : shortLen + 1;
      const block = dataCodewords.slice(pos, pos + len);
      pos += len;
      dataBlocks.push(block);
      eccBlocks.push(rsRemainder(block, eccPerBlock));
    }

    const out = new Uint8Array(totalCw);
    let o = 0;
    const maxDataLen = shortLen + (longBlocks > 0 ? 1 : 0);
    for (let i = 0; i < maxDataLen; i++) {
      for (let b = 0; b < numBlocks; b++) {
        if (i < dataBlocks[b].length) out[o++] = dataBlocks[b][i];
      }
    }
    for (let i = 0; i < eccPerBlock; i++) {
      for (let b = 0; b < numBlocks; b++) out[o++] = eccBlocks[b][i];
    }
    return out;
  }

  function bytesToBits(bytes) {
    const bits = new Uint8Array(bytes.length * 8);
    for (let i = 0; i < bytes.length; i++) {
      for (let j = 0; j < 8; j++) bits[i * 8 + j] = (bytes[i] >> (7 - j)) & 1;
    }
    return bits;
  }

  /* 終端パターンと埋め草コード語 (11101100 / 00010001) で容量まで充填 */
  function padToCapacity(bb, capacityBits, terminatorBits) {
    let left = capacityBits - bb.length;
    bb.put(0, Math.min(terminatorBits, left));
    const toByte = (8 - (bb.length % 8)) % 8;
    bb.put(0, Math.min(toByte, capacityBits - bb.length));
    let padByte = 0xec;
    while (bb.length < capacityBits) {
      bb.put(padByte, 8);
      padByte ^= 0xec ^ 0x11;
    }
  }

  /* ========================================================================
   * QRコード
   * ====================================================================== */
  const QR_EC_BITS = { L: 1, M: 0, Q: 3, H: 2 };
  const QR_EC_IDX = { L: 0, M: 1, Q: 2, H: 3 };

  function qrCapacityBits(version, ecLevel) {
    return QR_DATA_CW[QR_EC_IDX[ecLevel]][version - 1] * 8;
  }

  function qrCciBits(version, mode) {
    const group = version <= 9 ? 0 : version <= 26 ? 1 : 2;
    return { numeric: [10, 12, 14], alphanumeric: [9, 11, 13], byte: [8, 16, 16] }[mode][group];
  }

  function qrNeededBits(version, mode, charCount, dataBits) {
    return 4 + qrCciBits(version, mode) + dataBits;
  }

  function buildQRFunctionPatterns(M, version) {
    const size = M.width;
    // タイミングパターン (行6・列6)
    for (let i = 0; i < size; i++) {
      M.set(i, 6, i % 2 === 0, true);
      M.set(6, i, i % 2 === 0, true);
    }
    // 位置検出パターン + 分離パターン
    drawFinder(M, 0, 0);
    drawFinder(M, size - 7, 0);
    drawFinder(M, 0, size - 7);
    for (let i = 0; i < 8; i++) {
      M.set(7, i, 0, true); M.set(i, 7, 0, true);                    // 左上
      M.set(size - 8, i, 0, true); M.set(size - 1 - i, 7, 0, true);  // 右上
      M.set(7, size - 1 - i, 0, true); M.set(i, size - 8, 0, true);  // 左下
    }
    // 位置合わせパターン (3隅のファインダと重なる3箇所のみ省略。
    // タイミングパターンと重なるものは規格どおり描画する)
    if (version >= 2) {
      const coords = QR_ALIGN[version - 2];
      const last = coords[coords.length - 1];
      for (const cy of coords) {
        for (const cx of coords) {
          if ((cx === 6 && cy === 6) || (cx === last && cy === 6) || (cx === 6 && cy === last)) continue;
          for (let dy = -2; dy <= 2; dy++) {
            for (let dx = -2; dx <= 2; dx++) {
              const ring = Math.max(Math.abs(dx), Math.abs(dy)) !== 1;
              M.set(cx + dx, cy + dy, ring, true);
            }
          }
        }
      }
    }
    // フォーマット情報領域の予約 + 固定暗モジュール
    for (let i = 0; i <= 8; i++) {
      if (!M.isFunc(i, 8)) M.set(i, 8, 0, true);
      if (!M.isFunc(8, i)) M.set(8, i, 0, true);
    }
    for (let i = 0; i < 8; i++) {
      M.set(size - 1 - i, 8, 0, true);
      M.set(8, size - 1 - i, 0, true);
    }
    M.set(8, size - 8, 1, true); // 固定暗モジュール
    // 型番情報 (バージョン7以上)
    if (version >= 7) {
      const seq = QR_VERSION_SEQ[version - 7];
      for (let i = 0; i < 6; i++) {
        for (let j = 0; j < 3; j++) {
          const bit = (seq >> (i * 3 + j)) & 1;
          M.set(i, size - 11 + j, bit, true);
          M.set(size - 11 + j, i, bit, true);
        }
      }
    }
  }

  function drawQRFormatInfo(M, ecLevel, mask) {
    const size = M.width;
    const seq = QR_FORMAT_SEQ[(QR_EC_BITS[ecLevel] << 3) | mask];
    const bit = (n) => (seq >> n) & 1;
    // 第1コピー (左上)
    for (let i = 0; i < 6; i++) M.set(8, i, bit(i), true);
    M.set(8, 7, bit(6), true);
    M.set(8, 8, bit(7), true);
    M.set(7, 8, bit(8), true);
    for (let i = 0; i < 6; i++) M.set(5 - i, 8, bit(9 + i), true);
    // 第2コピー (右上 + 左下)
    for (let i = 0; i < 8; i++) M.set(size - 1 - i, 8, bit(i), true);
    for (let i = 0; i < 7; i++) M.set(8, size - 7 + i, bit(8 + i), true);
  }

  /* マスク評価 (ISO/IEC 18004 §7.8.3) — 小さいほど良い */
  function qrPenalty(M) {
    const size = M.width;
    const get = (x, y) => M.get(x, y);
    let score = 0;

    // 条件1: 同色の連続 (行・列)
    for (let axis = 0; axis < 2; axis++) {
      for (let a = 0; a < size; a++) {
        let run = 1;
        let prev = axis === 0 ? get(0, a) : get(a, 0);
        for (let b = 1; b < size; b++) {
          const c = axis === 0 ? get(b, a) : get(a, b);
          if (c === prev) {
            run++;
            if (b === size - 1 && run >= 5) score += 3 + (run - 5);
          } else {
            if (run >= 5) score += 3 + (run - 5);
            prev = c;
            run = 1;
          }
        }
      }
    }
    // 条件2: 2x2 同色ブロック
    for (let y = 0; y < size - 1; y++) {
      for (let x = 0; x < size - 1; x++) {
        const c = get(x, y);
        if (c === get(x + 1, y) && c === get(x, y + 1) && c === get(x + 1, y + 1)) score += 3;
      }
    }
    // 条件3: 1:1:3:1:1 パターンの前後に幅4の明パターン
    const CORE = [1, 0, 1, 1, 1, 0, 1];
    for (let axis = 0; axis < 2; axis++) {
      for (let a = 0; a < size; a++) {
        for (let b = 0; b + 7 <= size; b++) {
          let match = true;
          for (let k = 0; k < 7; k++) {
            const c = axis === 0 ? get(b + k, a) : get(a, b + k);
            if (c !== CORE[k]) { match = false; break; }
          }
          if (!match) continue;
          let lightBefore = b >= 4;
          for (let k = 1; lightBefore && k <= 4; k++) {
            if (axis === 0 ? get(b - k, a) : get(a, b - k)) lightBefore = false;
          }
          let lightAfter = b + 11 <= size;
          for (let k = 7; lightAfter && k < 11; k++) {
            if (axis === 0 ? get(b + k, a) : get(a, b + k)) lightAfter = false;
          }
          if (lightBefore) score += 40;
          if (lightAfter) score += 40;
        }
      }
    }
    // 条件4: 暗モジュール比率の 50% からの乖離
    let dark = 0;
    for (let i = 0; i < M.dark.length; i++) dark += M.dark[i];
    score += 10 * Math.floor(Math.abs((dark * 100) / (size * size) - 50) / 5);
    return score;
  }

  /* Structured Append (ISO/IEC 18004 §8) のヘッダ長: モード(4) + 記号位置(4) + 記号数-1(4) + パリティ(8) */
  const STRUCTURED_APPEND_BITS = 20;

  function encodeQR(text, opts) {
    const ecLevel = opts.ecLevel || "M";
    if (!(ecLevel in QR_EC_IDX)) throw new QREncodeError("BAD_OPTION", "誤り訂正レベルが不正です");
    const mode = detectMode(text);
    const bytes = mode === "byte" ? utf8Bytes(text) : null;
    const charCount = mode === "byte" ? bytes.length : text.length;
    const dataBits = dataBitLength(mode, charCount);
    const sa = opts.structured || null;
    const headerBits = sa ? STRUCTURED_APPEND_BITS : 0;

    // バージョン選択
    let version = 0;
    if (opts.version) {
      version = opts.version;
      if (headerBits + qrNeededBits(version, mode, charCount, dataBits) > qrCapacityBits(version, ecLevel) ||
          charCount >= 1 << qrCciBits(version, mode)) {
        throw new QREncodeError("TOO_LONG", "データがバージョン " + version + " (" + ecLevel + ") の容量を超えています");
      }
    } else {
      for (let v = 1; v <= 40; v++) {
        if (headerBits + qrNeededBits(v, mode, charCount, dataBits) <= qrCapacityBits(v, ecLevel) &&
            charCount < 1 << qrCciBits(v, mode)) {
          version = v;
          break;
        }
      }
      if (!version) throw new QREncodeError("TOO_LONG", "データが QR コードの最大容量を超えています");
    }

    // ビット列構築
    const capacityBits = qrCapacityBits(version, ecLevel);
    const bb = new BitBuffer();
    if (sa) {
      bb.put(3, 4); // Structured Append モード指示子 0011
      bb.put(sa.index, 4); // 記号位置 (0 起点)
      bb.put(sa.count - 1, 4); // 総記号数 - 1
      bb.put(sa.parity, 8); // パリティデータ
    }
    bb.put({ numeric: 1, alphanumeric: 2, byte: 4 }[mode], 4);
    bb.put(charCount, qrCciBits(version, mode));
    appendDataBits(bb, mode, text, bytes);
    const usedBits = bb.length;
    padToCapacity(bb, capacityBits, 4);

    const ecIdx = QR_EC_IDX[ecLevel];
    const finalCw = buildFinalCodewords(
      bitsToBytes(bb.bits), QR_TOTAL_CW[version - 1], QR_BLOCKS[ecIdx][version - 1]);

    // 行列構築
    const size = version * 4 + 17;
    const M = new Matrix(size, size);
    buildQRFunctionPatterns(M, version);
    placeData(M, bytesToBits(finalCw), true, size - 1);

    // マスク選択・適用
    let mask = opts.mask != null && opts.mask >= 0 ? opts.mask : -1;
    if (mask < 0) {
      let best = 0, bestScore = Infinity;
      for (let m = 0; m < 8; m++) {
        applyMask(M, m);
        drawQRFormatInfo(M, ecLevel, m);
        const s = qrPenalty(M);
        applyMask(M, m); // 元に戻す
        if (s < bestScore) { bestScore = s; best = m; }
      }
      mask = best;
    }
    applyMask(M, mask);
    drawQRFormatInfo(M, ecLevel, mask);

    return {
      standard: "qr",
      versionName: String(version),
      version, ecLevel, mask, mode,
      modules: M.toRows(),
      width: size, height: size,
      quietZone: 4,
      usedBits, capacityBits,
      totalCodewords: QR_TOTAL_CW[version - 1],
      dataCodewords: QR_DATA_CW[ecIdx][version - 1],
      structured: sa ? { index: sa.index, count: sa.count } : null,
    };
  }

  /* Structured Append 用: 元データ全体のバイト単位 XOR パリティ */
  function computeParity(text) {
    const bytes = utf8Bytes(text);
    let p = 0;
    for (const b of bytes) p ^= b;
    return p;
  }

  /* ========================================================================
   * MicroQRコード
   * ====================================================================== */
  const MICRO_EC_IDX = { L: 0, M: 1, Q: 2 };

  function microModeAllowed(version, mode) {
    if (version === 1) return mode === "numeric";
    if (version === 2) return mode === "numeric" || mode === "alphanumeric";
    return true;
  }

  function microNeededBits(version, mode, charCount, dataBits) {
    return (version - 1) + MICRO_CCI[mode][version - 1] + dataBits;
  }

  function buildMicroFunctionPatterns(M) {
    const size = M.width;
    for (let i = 0; i < size; i++) {
      M.set(i, 0, i % 2 === 0, true); // タイミング (上端)
      M.set(0, i, i % 2 === 0, true); // タイミング (左端)
    }
    drawFinder(M, 0, 0);
    for (let i = 0; i <= 7; i++) {
      M.set(7, i, 0, true);
      M.set(i, 7, 0, true);
    }
    // フォーマット情報領域の予約
    for (let i = 1; i <= 8; i++) {
      M.set(i, 8, 0, true);
      M.set(8, i, 0, true);
    }
  }

  function drawMicroFormatInfo(M, symbolNumber, mask) {
    const seq = MICRO_FORMAT_SEQ[(symbolNumber << 2) | mask];
    for (let i = 1; i <= 8; i++) M.set(i, 8, (seq >> (15 - i)) & 1, true);
    for (let i = 1; i <= 7; i++) M.set(8, i, (seq >> (i - 1)) & 1, true);
  }

  /* MicroQRのマスク評価 (ISO/IEC 18004 §7.8.3.2) — 大きいほど良い */
  function microScore(M) {
    const size = M.width;
    let sum1 = 0, sum2 = 0;
    for (let i = 1; i < size; i++) {
      sum1 += M.get(size - 1, i); // 右端の列
      sum2 += M.get(i, size - 1); // 下端の行
    }
    return sum1 <= sum2 ? sum1 * 16 + sum2 : sum2 * 16 + sum1;
  }

  function encodeMicroQR(text, opts) {
    const ecLevel = opts.ecLevel || "L";
    if (!(ecLevel in MICRO_EC_IDX)) throw new QREncodeError("BAD_OPTION", "誤り訂正レベルが不正です");
    const ecIdx = MICRO_EC_IDX[ecLevel];
    const mode = detectMode(text);
    const bytes = mode === "byte" ? utf8Bytes(text) : null;
    const charCount = mode === "byte" ? bytes.length : text.length;
    const dataBits = dataBitLength(mode, charCount);

    const fits = (v) => {
      if (!microModeAllowed(v, mode)) return false;
      const cap = MICRO_DATA[ecIdx][v - 1][0];
      if (cap === 0) return false;
      const cci = MICRO_CCI[mode][v - 1];
      return microNeededBits(v, mode, charCount, dataBits) <= cap && charCount < 1 << cci;
    };

    let version = 0;
    if (opts.version) {
      version = opts.version;
      if (MICRO_DATA[ecIdx][version - 1][0] === 0) {
        throw new QREncodeError("BAD_OPTION", "M" + version + " では誤り訂正レベル " + ecLevel + " は使用できません");
      }
      if (!microModeAllowed(version, mode)) {
        throw new QREncodeError("INVALID_CHARS",
          version === 1 ? "M1 は数字のみ使用できます" : "M2 は数字と英数字 (0-9 A-Z %*+-./:$ 空白) のみ使用できます");
      }
      if (!fits(version)) {
        throw new QREncodeError("TOO_LONG", "データが M" + version + " (" + ecLevel + ") の容量を超えています");
      }
    } else {
      for (let v = 1; v <= 4; v++) {
        if (fits(v)) { version = v; break; }
      }
      if (!version) {
        throw new QREncodeError("TOO_LONG", "データがMicroQR (" + ecLevel + ") の最大容量を超えています");
      }
    }

    const [capacityBits, dataCw, eccCw] = MICRO_DATA[ecIdx][version - 1];
    const halfLast = version === 1 || version === 3; // 最終データコード語が 4 ビット

    // ビット列構築
    const bb = new BitBuffer();
    if (version > 1) bb.put(MICRO_MODE_VALUE[mode], version - 1);
    bb.put(charCount, MICRO_CCI[mode][version - 1]);
    appendDataBits(bb, mode, text, bytes);
    const usedBits = bb.length;

    // 終端パターン + 充填 (M1/M3 は最終 4 ビットコード語を 0 詰め)
    const terminatorBits = 3 + (version - 1) * 2;
    let left = capacityBits - bb.length;
    bb.put(0, Math.min(terminatorBits, left));
    left = capacityBits - bb.length;
    if (left > 0) {
      if (halfLast && left <= 4) {
        bb.put(0, left);
      } else {
        const toByte = (8 - (bb.length % 8)) % 8;
        bb.put(0, Math.min(toByte, left));
        let padByte = 0xec;
        while (capacityBits - bb.length >= 8) {
          bb.put(padByte, 8);
          padByte ^= 0xec ^ 0x11;
        }
        bb.put(0, capacityBits - bb.length); // M1/M3 の最終 4 ビット
      }
    }

    // RS 符号 (M1/M3 の最終コード語は上位 4 ビットに詰めて計算)
    const dataBytes = new Uint8Array(dataCw);
    for (let i = 0; i < capacityBits; i++) {
      dataBytes[i >> 3] |= bb.bits[i] << (7 - (i & 7));
    }
    const ecc = rsRemainder(dataBytes, eccCw);
    const allBits = new Uint8Array(capacityBits + eccCw * 8);
    allBits.set(bb.bits.slice(0, capacityBits));
    for (let i = 0; i < eccCw; i++) {
      for (let j = 0; j < 8; j++) allBits[capacityBits + i * 8 + j] = (ecc[i] >> (7 - j)) & 1;
    }

    // 行列構築
    const size = MICRO_SIZES[version - 1];
    const M = new Matrix(size, size);
    buildMicroFunctionPatterns(M);
    placeData(M, allBits, false, size - 1);

    const symbolNumber = version === 1 ? 0 : (version - 2) * 2 + ecIdx + 1;
    let mask = opts.mask != null && opts.mask >= 0 ? opts.mask : -1;
    if (mask < 0) {
      let best = 0, bestScore = -1;
      for (let m = 0; m < 4; m++) {
        applyMask(M, MICRO_MASK_MAP[m]);
        const s = microScore(M);
        applyMask(M, MICRO_MASK_MAP[m]);
        if (s > bestScore) { bestScore = s; best = m; }
      }
      mask = best;
    }
    applyMask(M, MICRO_MASK_MAP[mask]);
    drawMicroFormatInfo(M, symbolNumber, mask);

    return {
      standard: "micro",
      versionName: "M" + version,
      version, ecLevel, mask, mode,
      modules: M.toRows(),
      width: size, height: size,
      quietZone: 2,
      usedBits, capacityBits,
      totalCodewords: dataCw + eccCw,
      dataCodewords: dataCw,
    };
  }

  /* ========================================================================
   * rMQRコード
   * ====================================================================== */
  const RMQR_EC_IDX = { M: 0, H: 1 };

  function rmqrNeededBits(vi, mode, charCount, dataBits) {
    return 3 + RMQR_CCI[mode][vi] + dataBits;
  }

  function buildRMQRFunctionPatterns(M, vi) {
    const w = M.width, h = M.height;
    // タイミングパターン (上下端・左右端)
    for (let x = 0; x < w; x++) {
      M.set(x, 0, x % 2 === 0, true);
      M.set(x, h - 1, x % 2 === 0, true);
    }
    for (let y = 0; y < h; y++) {
      M.set(0, y, y % 2 === 0, true);
      M.set(w - 1, y, y % 2 === 0, true);
    }
    // 位置検出パターン (左上)
    drawFinder(M, 0, 0);
    // 位置検出サブパターン (右下 5x5, 中心 1 モジュール暗)
    for (let dy = 0; dy < 5; dy++) {
      for (let dx = 0; dx < 5; dx++) {
        const ring = dy === 0 || dy === 4 || dx === 0 || dx === 4;
        const core = dy === 2 && dx === 2;
        M.set(w - 5 + dx, h - 5 + dy, ring || core, true);
      }
    }
    // コーナーファインダパターン (左下・右上)
    M.set(0, h - 2, 1, true);
    M.set(1, h - 2, 0, true);
    M.set(1, h - 1, 1, true);
    M.set(w - 2, 0, 1, true);
    M.set(w - 2, 1, 0, true);
    M.set(w - 1, 1, 1, true);
    // 分離パターン (コーナーファインダより後に描画: h=9 では行7と重なり上書き)
    for (let y = 0; y < 7 && y < h; y++) M.set(7, y, 0, true);
    if (h > 7) {
      for (let x = 0; x <= 7; x++) M.set(x, 7, 0, true);
    }
    // 位置合わせパターン: 縦タイミング列 + 上下端の 3x3 (中心明)
    for (const cx of RMQR_ALIGN[w]) {
      for (let y = 0; y < h; y++) M.set(cx, y, y % 2 === 0, true);
      for (const dx of [-1, 1]) {
        M.set(cx + dx, 1, 1, true);
        M.set(cx + dx, 2, 1, true);
        M.set(cx + dx, h - 3, 1, true);
        M.set(cx + dx, h - 2, 1, true);
      }
    }
    // フォーマット情報領域の予約
    for (let i = 0; i < 5; i++) {
      for (let j = 0; j < 3; j++) {
        M.set(8 + j, 1 + i, 0, true);
        M.set(w - 8 + j, h - 6 + i, 0, true);
      }
    }
    M.set(11, 1, 0, true); M.set(11, 2, 0, true); M.set(11, 3, 0, true);
    M.set(w - 5, h - 6, 0, true); M.set(w - 4, h - 6, 0, true); M.set(w - 3, h - 6, 0, true);
  }

  function drawRMQRFormatInfo(M, vi, ecIdx) {
    const w = M.width, h = M.height;
    const left = RMQR_FORMAT_LEFT[vi + ecIdx * 32];
    const right = RMQR_FORMAT_RIGHT[vi + ecIdx * 32];
    for (let i = 0; i < 5; i++) {
      for (let j = 0; j < 3; j++) {
        M.set(8 + j, 1 + i, (left >> (j * 5 + i)) & 1, true);
        M.set(w - 8 + j, h - 6 + i, (right >> (j * 5 + i)) & 1, true);
      }
    }
    M.set(11, 1, (left >> 15) & 1, true);
    M.set(11, 2, (left >> 16) & 1, true);
    M.set(11, 3, (left >> 17) & 1, true);
    M.set(w - 5, h - 6, (right >> 15) & 1, true);
    M.set(w - 4, h - 6, (right >> 16) & 1, true);
    M.set(w - 3, h - 6, (right >> 17) & 1, true);
  }

  function encodeRMQR(text, opts) {
    const ecLevel = opts.ecLevel || "M";
    if (!(ecLevel in RMQR_EC_IDX)) throw new QREncodeError("BAD_OPTION", "rMQR の誤り訂正レベルは M / H のみです");
    const ecIdx = RMQR_EC_IDX[ecLevel];
    const mode = detectMode(text);
    const bytes = mode === "byte" ? utf8Bytes(text) : null;
    const charCount = mode === "byte" ? bytes.length : text.length;
    const dataBits = dataBitLength(mode, charCount);

    const fits = (vi) =>
      rmqrNeededBits(vi, mode, charCount, dataBits) <= RMQR_DATA_CW[ecIdx][vi] * 8 &&
      charCount < 1 << RMQR_CCI[mode][vi];

    let vi = -1;
    if (opts.version) {
      vi = opts.version - 1;
      if (vi < 0 || vi > 31) throw new QREncodeError("BAD_OPTION", "rMQR のバージョンが不正です");
      if (!fits(vi)) {
        throw new QREncodeError("TOO_LONG",
          "データが " + RMQR_VERSION_NAMES[vi] + " (" + ecLevel + ") の容量を超えています");
      }
    } else {
      // 自動選択: 収まるうち面積最小 (同面積なら高さが低い方)
      const order = RMQR_W.map((_, i) => i).sort((a, b) =>
        RMQR_W[a] * RMQR_H[a] - RMQR_W[b] * RMQR_H[b] || RMQR_H[a] - RMQR_H[b]);
      for (const i of order) {
        if (fits(i)) { vi = i; break; }
      }
      if (vi < 0) throw new QREncodeError("TOO_LONG", "データが rMQR (" + ecLevel + ") の最大容量を超えています");
    }

    const capacityBits = RMQR_DATA_CW[ecIdx][vi] * 8;
    const bb = new BitBuffer();
    bb.put(RMQR_MODE_VALUE[mode], 3);
    bb.put(charCount, RMQR_CCI[mode][vi]);
    appendDataBits(bb, mode, text, bytes);
    const usedBits = bb.length;
    padToCapacity(bb, capacityBits, 3);

    const finalCw = buildFinalCodewords(
      bitsToBytes(bb.bits), RMQR_TOTAL_CW[vi], RMQR_BLOCKS[ecIdx][vi]);

    const w = RMQR_W[vi], h = RMQR_H[vi];
    const M = new Matrix(w, h);
    buildRMQRFunctionPatterns(M, vi);
    placeData(M, bytesToBits(finalCw), false, w - 2);
    applyMask(M, 4); // rMQR のデータマスクは (⌊y/2⌋+⌊x/3⌋) mod 2 = 0 で固定 (§7.8.2)
    drawRMQRFormatInfo(M, vi, ecIdx);

    return {
      standard: "rmqr",
      versionName: RMQR_VERSION_NAMES[vi],
      version: vi + 1, ecLevel, mask: null, mode,
      modules: M.toRows(),
      width: w, height: h,
      quietZone: 2,
      usedBits, capacityBits,
      totalCodewords: RMQR_TOTAL_CW[vi],
      dataCodewords: RMQR_DATA_CW[ecIdx][vi],
    };
  }

  /* ========================================================================
   * 復号 (編集プレビュー用)
   * RS 誤り訂正復号は Berlekamp-Massey + Chien 探索 + Forney 法。
   * フォーマット情報は有効ビット列との最小ハミング距離で復元する。
   * ====================================================================== */

  function hamming15(a, b) {
    let x = (a ^ b) & 0x7fff, n = 0;
    while (x) { n += x & 1; x >>= 1; }
    return n;
  }

  /* GF(256, 0x11D) 上の RS 復号。cw を訂正し訂正シンボル数を返す。不能なら -1。
   * 生成多項式の根は α^0 .. α^(eccLen-1) (QR 系の規約)。 */
  function rsCorrect(cw, eccLen) {
    const n = cw.length;
    // シンドローム S_i = C(α^i)
    const synd = new Array(eccLen).fill(0);
    let hasError = false;
    for (let i = 0; i < eccLen; i++) {
      let s = 0;
      for (let j = 0; j < n; j++) {
        // s = s*α^i + cw[j]
        s = cw[j] ^ (s === 0 ? 0 : GF_EXP[(GF_LOG[s] + i) % 255]);
      }
      synd[i] = s;
      if (s !== 0) hasError = true;
    }
    if (!hasError) return 0;

    // Berlekamp-Massey で誤り位置多項式 sigma を求める (係数は低次から)
    let sigma = [1];
    let prev = [1];
    let L = 0, m = 1, b = 1;
    for (let i = 0; i < eccLen; i++) {
      let delta = synd[i];
      for (let j = 1; j <= L; j++) {
        if (sigma[j] !== 0 && synd[i - j] !== 0) {
          delta ^= GF_EXP[(GF_LOG[sigma[j]] + GF_LOG[synd[i - j]]) % 255];
        }
      }
      if (delta === 0) {
        m++;
      } else if (2 * L <= i) {
        const tmp = sigma.slice();
        const coef = GF_EXP[(GF_LOG[delta] - GF_LOG[b] + 255) % 255];
        const shifted = new Array(prev.length + m).fill(0);
        for (let j = 0; j < prev.length; j++) {
          if (prev[j] !== 0) shifted[j + m] = GF_EXP[(GF_LOG[prev[j]] + GF_LOG[coef]) % 255];
        }
        while (sigma.length < shifted.length) sigma.push(0);
        for (let j = 0; j < shifted.length; j++) sigma[j] ^= shifted[j];
        L = i + 1 - L;
        prev = tmp;
        b = delta;
        m = 1;
      } else {
        const coef = GF_EXP[(GF_LOG[delta] - GF_LOG[b] + 255) % 255];
        const shifted = new Array(prev.length + m).fill(0);
        for (let j = 0; j < prev.length; j++) {
          if (prev[j] !== 0) shifted[j + m] = GF_EXP[(GF_LOG[prev[j]] + GF_LOG[coef]) % 255];
        }
        while (sigma.length < shifted.length) sigma.push(0);
        for (let j = 0; j < shifted.length; j++) sigma[j] ^= shifted[j];
        m++;
      }
    }
    while (sigma.length > 1 && sigma[sigma.length - 1] === 0) sigma.pop();
    const numErrors = sigma.length - 1;
    if (numErrors === 0 || numErrors > Math.floor(eccLen / 2)) return -1;

    // Chien 探索: sigma(α^-pos)=0 となる誤り位置を探す
    const errPos = []; // codeword index (0 = 先頭)
    for (let j = 0; j < n; j++) {
      const xinvLog = (255 - ((n - 1 - j) % 255)) % 255; // α^-(n-1-j)
      let v = 0;
      for (let k = 0; k < sigma.length; k++) {
        if (sigma[k] !== 0) v ^= GF_EXP[(GF_LOG[sigma[k]] + k * xinvLog) % 255];
      }
      if (v === 0) errPos.push(j);
    }
    if (errPos.length !== numErrors) return -1;

    // Forney 法: omega = (synd(x) * sigma(x)) mod x^eccLen
    const omega = new Array(eccLen).fill(0);
    for (let i = 0; i < eccLen; i++) {
      for (let k = 0; k <= Math.min(i, sigma.length - 1); k++) {
        if (sigma[k] !== 0 && synd[i - k] !== 0) {
          omega[i] ^= GF_EXP[(GF_LOG[sigma[k]] + GF_LOG[synd[i - k]]) % 255];
        }
      }
    }
    for (const j of errPos) {
      const xLog = (n - 1 - j) % 255;         // X = α^(n-1-j)
      const xinvLog = (255 - xLog) % 255;
      let om = 0;
      for (let k = 0; k < eccLen; k++) {
        if (omega[k] !== 0) om ^= GF_EXP[(GF_LOG[omega[k]] + k * xinvLog) % 255];
      }
      let sp = 0; // sigma の形式的微分を X^-1 で評価 (奇数次のみ)
      for (let k = 1; k < sigma.length; k += 2) {
        if (sigma[k] !== 0) sp ^= GF_EXP[(GF_LOG[sigma[k]] + (k - 1) * xinvLog) % 255];
      }
      if (sp === 0) return -1;
      if (om !== 0) {
        // b=0 のため e = X * omega(X^-1) / sigma'(X^-1)
        const mag = GF_EXP[(GF_LOG[om] - GF_LOG[sp] + xLog + 255 * 2) % 255];
        cw[j] ^= mag;
      }
    }
    // 訂正後シンドローム確認
    for (let i = 0; i < eccLen; i++) {
      let s = 0;
      for (let j = 0; j < n; j++) {
        s = cw[j] ^ (s === 0 ? 0 : GF_EXP[(GF_LOG[s] + i) % 255]);
      }
      if (s !== 0) return -1;
    }
    return numErrors;
  }

  class QRDecodeError extends Error {
    constructor(message) {
      super(message);
      this.name = "QRDecodeError";
    }
  }

  /* 配置順にデータ領域のビットを読み出す (placeData と同一の走査) */
  function readPlacedBits(M, skipCol6, startRight) {
    const bits = [];
    let pairIdx = 0;
    for (let right = startRight; right >= 1; right -= 2) {
      if (skipCol6 && right === 6) right = 5;
      const upward = pairIdx % 2 === 0;
      for (let v = 0; v < M.height; v++) {
        const y = upward ? M.height - 1 - v : v;
        for (let dx = 0; dx < 2; dx++) {
          const x = right - dx;
          if (!M.isFunc(x, y)) bits.push(M.get(x, y));
        }
      }
      pairIdx++;
    }
    return bits;
  }

  /* ブロック分割の逆変換: 交互配置されたコード語 → ブロックごとの配列 */
  function deinterleave(allCw, totalCw, dataCw, numBlocks) {
    const eccPerBlock = (totalCw - dataCw) / numBlocks;
    const shortLen = Math.floor(dataCw / numBlocks);
    const longBlocks = dataCw % numBlocks;
    const shortBlocks = numBlocks - longBlocks;
    const lens = [];
    for (let b = 0; b < numBlocks; b++) lens.push(b < shortBlocks ? shortLen : shortLen + 1);
    const maxLen = shortLen + (longBlocks > 0 ? 1 : 0);

    const blocks = lens.map((len) => new Uint8Array(len + eccPerBlock));
    let idx = 0;
    for (let i = 0; i < maxLen; i++) {
      for (let b = 0; b < numBlocks; b++) {
        if (i < lens[b]) blocks[b][i] = allCw[idx++];
      }
    }
    for (let i = 0; i < eccPerBlock; i++) {
      for (let b = 0; b < numBlocks; b++) {
        blocks[b][lens[b] + i] = allCw[idx++];
      }
    }
    return { blocks, lens, eccPerBlock };
  }

  /* ビット配列から数値を読む */
  function takeBits(bits, pos, count) {
    let v = 0;
    for (let i = 0; i < count; i++) v = (v << 1) | bits[pos + i];
    return v;
  }

  /* データビット列 → テキスト (QR/MicroQR/rMQR 共通) */
  function parseBitStream(bits, standard, version) {
    let pos = 0;
    let out = "";
    let structured = null;
    const bytes = [];
    const flushBytes = () => {
      if (bytes.length) {
        out += new TextDecoder("utf-8", { fatal: false }).decode(new Uint8Array(bytes));
        bytes.length = 0;
      }
    };
    const modeBitsLen = standard === "qr" ? 4 : standard === "rmqr" ? 3 : version - 1;

    while (pos + modeBitsLen <= bits.length) {
      let mode;
      if (standard === "micro" && version === 1) {
        mode = "numeric";
      } else {
        const mv = takeBits(bits, pos, modeBitsLen);
        pos += modeBitsLen;
        if (mv === 0 && standard !== "micro") break; // 終端パターン
        if (standard === "qr" && mv === 3) {
          // Structured Append ヘッダ: 記号位置(4) + 総記号数-1(4) + パリティ(8)
          if (pos + 16 > bits.length) break;
          const index = takeBits(bits, pos, 4);
          const count = takeBits(bits, pos + 4, 4) + 1;
          const parity = takeBits(bits, pos + 8, 8);
          pos += 16;
          structured = { index, count, parity };
          continue;
        }
        if (standard === "qr") {
          mode = { 1: "numeric", 2: "alphanumeric", 4: "byte", 8: "kanji" }[mv];
        } else if (standard === "rmqr") {
          mode = { 1: "numeric", 2: "alphanumeric", 3: "byte", 4: "kanji" }[mv];
        } else {
          mode = ["numeric", "alphanumeric", "byte", "kanji"][mv];
        }
        if (!mode) throw new QRDecodeError("未対応のモード指示子です");
      }

      if (mode === "kanji") throw new QRDecodeError("漢字モードは未対応です");
      let cci;
      if (standard === "qr") cci = qrCciBits(version, mode);
      else if (standard === "rmqr") cci = RMQR_CCI[mode][version - 1];
      else cci = MICRO_CCI[mode][version - 1];
      if (!cci || pos + cci > bits.length) break;
      const count = takeBits(bits, pos, cci);
      pos += cci;
      if (count === 0) break; // 終端 (0 詰め)

      if (mode === "numeric") {
        flushBytes();
        let left = count;
        while (left >= 3) {
          out += String(takeBits(bits, pos, 10)).padStart(3, "0");
          pos += 10; left -= 3;
        }
        if (left === 2) { out += String(takeBits(bits, pos, 7)).padStart(2, "0"); pos += 7; }
        else if (left === 1) { out += String(takeBits(bits, pos, 4)); pos += 4; }
      } else if (mode === "alphanumeric") {
        flushBytes();
        let left = count;
        while (left >= 2) {
          const v = takeBits(bits, pos, 11);
          out += ALNUM_CHARS[Math.floor(v / 45)] + ALNUM_CHARS[v % 45];
          pos += 11; left -= 2;
        }
        if (left === 1) { out += ALNUM_CHARS[takeBits(bits, pos, 6)]; pos += 6; }
      } else if (mode === "byte") {
        for (let i = 0; i < count; i++) {
          bytes.push(takeBits(bits, pos, 8));
          pos += 8;
        }
      } else {
        throw new QRDecodeError("漢字モードは未対応です");
      }
      if (pos > bits.length) throw new QRDecodeError("ビット列が不足しています");
    }
    flushBytes();
    return { text: out, structured };
  }

  /* フォーマット情報の読み出し座標 (描画関数と鏡写し) */
  function readQRFormatCopies(modules, size) {
    const g = (x, y) => modules[y][x];
    let c1 = 0, c2 = 0;
    for (let i = 0; i < 6; i++) c1 |= g(8, i) << i;
    c1 |= g(8, 7) << 6;
    c1 |= g(8, 8) << 7;
    c1 |= g(7, 8) << 8;
    for (let i = 0; i < 6; i++) c1 |= g(5 - i, 8) << (9 + i);
    for (let i = 0; i < 8; i++) c2 |= g(size - 1 - i, 8) << i;
    for (let i = 0; i < 7; i++) c2 |= g(8, size - 7 + i) << (8 + i);
    return [c1, c2];
  }

  function decodeQRMatrix(modules) {
    const size = modules.length;
    const version = (size - 17) / 4;
    if (!Number.isInteger(version) || version < 1 || version > 40) {
      throw new QRDecodeError("サイズが不正です");
    }
    // フォーマット情報: 2 コピー合計の最小ハミング距離
    const [c1, c2] = readQRFormatCopies(modules, size);
    let best = -1, bestDist = Infinity;
    for (let i = 0; i < 32; i++) {
      const d = hamming15(c1, QR_FORMAT_SEQ[i]) + hamming15(c2, QR_FORMAT_SEQ[i]);
      if (d < bestDist) { bestDist = d; best = i; }
    }
    if (bestDist > 6) throw new QRDecodeError("フォーマット情報を復元できません");
    const mask = best & 7;
    const ecLevel = { 1: "L", 0: "M", 3: "Q", 2: "H" }[best >> 3];
    const ecIdx = QR_EC_IDX[ecLevel];

    // 機能パターンを再構築し、マスク解除しつつデータビットを読む
    const M = new Matrix(size, size);
    buildQRFunctionPatterns(M, version);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (!M.isFunc(x, y)) {
          M.dark[y * size + x] = modules[y][x] ^ (maskPredicate(mask, y, x) ? 1 : 0);
        }
      }
    }
    const bits = readPlacedBits(M, true, size - 1);
    const totalCw = QR_TOTAL_CW[version - 1];
    const allCw = new Uint8Array(totalCw);
    for (let i = 0; i < totalCw * 8; i++) allCw[i >> 3] |= bits[i] << (7 - (i & 7));

    const dataCw = QR_DATA_CW[ecIdx][version - 1];
    const { blocks, lens, eccPerBlock } = deinterleave(allCw, totalCw, dataCw, QR_BLOCKS[ecIdx][version - 1]);
    let corrected = 0;
    const dataBits = [];
    for (let b = 0; b < blocks.length; b++) {
      const nErr = rsCorrect(blocks[b], eccPerBlock);
      if (nErr < 0) throw new QRDecodeError("誤り訂正能力を超えています (読み取り不能)");
      corrected += nErr;
    }
    for (let b = 0; b < blocks.length; b++) {
      for (let i = 0; i < lens[b]; i++) {
        for (let j = 7; j >= 0; j--) dataBits.push((blocks[b][i] >> j) & 1);
      }
    }
    const { text, structured } = parseBitStream(dataBits, "qr", version);
    return { text, corrected, ecLevel, mask, versionName: String(version), formatDistance: bestDist, structured };
  }

  function decodeMicroMatrix(modules) {
    const size = modules.length;
    const version = MICRO_SIZES.indexOf(size) + 1;
    if (version === 0) throw new QRDecodeError("サイズが不正です");
    let fmt = 0;
    for (let i = 1; i <= 8; i++) fmt |= modules[8][i] << (15 - i);
    for (let i = 1; i <= 7; i++) fmt |= modules[i][8] << (i - 1);
    // この型番で有効なシンボル番号のみ候補にする
    const validSn = { 1: [0], 2: [1, 2], 3: [3, 4], 4: [5, 6, 7] }[version];
    let best = -1, bestDist = Infinity;
    for (const sn of validSn) {
      for (let m = 0; m < 4; m++) {
        const d = hamming15(fmt, MICRO_FORMAT_SEQ[(sn << 2) | m]);
        if (d < bestDist) { bestDist = d; best = (sn << 2) | m; }
      }
    }
    if (bestDist > 3) throw new QRDecodeError("フォーマット情報を復元できません");
    const sn = best >> 2, mask = best & 3;
    // シンボル番号 → EC レベル: 0=M1(L) / 1,3,5=L / 2,4,6=M / 7=Q
    const ecLevel = sn === 0 ? "L" : sn === 7 ? "Q" : sn % 2 === 1 ? "L" : "M";
    const ecIdx = MICRO_EC_IDX[ecLevel];

    const M = new Matrix(size, size);
    buildMicroFunctionPatterns(M);
    const mp = MICRO_MASK_MAP[mask];
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (!M.isFunc(x, y)) {
          M.dark[y * size + x] = modules[y][x] ^ (maskPredicate(mp, y, x) ? 1 : 0);
        }
      }
    }
    const bits = readPlacedBits(M, false, size - 1);
    const [capacityBits, dataCw, eccCw] = MICRO_DATA[ecIdx][version - 1];
    const cw = new Uint8Array(dataCw + eccCw);
    for (let i = 0; i < capacityBits; i++) cw[i >> 3] |= bits[i] << (7 - (i & 7));
    for (let i = 0; i < eccCw * 8; i++) {
      cw[dataCw + (i >> 3)] |= bits[capacityBits + i] << (7 - (i & 7));
    }
    const corrected = rsCorrect(cw, eccCw);
    if (corrected < 0) throw new QRDecodeError("誤り訂正能力を超えています (読み取り不能)");
    const dataBits = [];
    for (let i = 0; i < capacityBits; i++) dataBits.push((cw[i >> 3] >> (7 - (i & 7))) & 1);
    const { text } = parseBitStream(dataBits, "micro", version);
    return { text, corrected, ecLevel, mask, versionName: "M" + version, formatDistance: bestDist };
  }

  function decodeRMQRMatrix(modules) {
    const h = modules.length, w = modules[0].length;
    let vi = -1;
    for (let i = 0; i < 32; i++) {
      if (RMQR_H[i] === h && RMQR_W[i] === w) { vi = i; break; }
    }
    if (vi < 0) throw new QRDecodeError("サイズが不正です");
    let left = 0, right = 0;
    for (let i = 0; i < 5; i++) {
      for (let j = 0; j < 3; j++) {
        left |= modules[1 + i][8 + j] << (j * 5 + i);
        right |= modules[h - 6 + i][w - 8 + j] << (j * 5 + i);
      }
    }
    left |= modules[1][11] << 15; left |= modules[2][11] << 16; left |= modules[3][11] << 17;
    right |= modules[h - 6][w - 5] << 15; right |= modules[h - 6][w - 4] << 16; right |= modules[h - 6][w - 3] << 17;

    const ham18 = (a, b) => {
      let x = (a ^ b) & 0x3ffff, n = 0;
      while (x) { n += x & 1; x >>= 1; }
      return n;
    };
    let bestEc = -1, bestDist = Infinity;
    for (let e = 0; e < 2; e++) {
      const d = ham18(left, RMQR_FORMAT_LEFT[vi + e * 32]) + ham18(right, RMQR_FORMAT_RIGHT[vi + e * 32]);
      if (d < bestDist) { bestDist = d; bestEc = e; }
    }
    if (bestDist > 8) throw new QRDecodeError("フォーマット情報を復元できません");

    const M = new Matrix(w, h);
    buildRMQRFunctionPatterns(M, vi);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (!M.isFunc(x, y)) {
          M.dark[y * w + x] = modules[y][x] ^ (maskPredicate(4, y, x) ? 1 : 0);
        }
      }
    }
    const bits = readPlacedBits(M, false, w - 2);
    const totalCw = RMQR_TOTAL_CW[vi];
    const allCw = new Uint8Array(totalCw);
    for (let i = 0; i < totalCw * 8; i++) allCw[i >> 3] |= bits[i] << (7 - (i & 7));
    const dataCw = RMQR_DATA_CW[bestEc][vi];
    const { blocks, lens, eccPerBlock } = deinterleave(allCw, totalCw, dataCw, RMQR_BLOCKS[bestEc][vi]);
    let corrected = 0;
    for (const block of blocks) {
      const nErr = rsCorrect(block, eccPerBlock);
      if (nErr < 0) throw new QRDecodeError("誤り訂正能力を超えています (読み取り不能)");
      corrected += nErr;
    }
    const dataBits = [];
    for (let b = 0; b < blocks.length; b++) {
      for (let i = 0; i < lens[b]; i++) {
        for (let j = 7; j >= 0; j--) dataBits.push((blocks[b][i] >> j) & 1);
      }
    }
    const { text } = parseBitStream(dataBits, "rmqr", vi + 1);
    return {
      text, corrected, ecLevel: bestEc === 0 ? "M" : "H", mask: null,
      versionName: RMQR_VERSION_NAMES[vi], formatDistance: bestDist,
    };
  }

  /* 行列 (0/1 の二次元配列) を復号する。編集後のリアルタイム表示用。 */
  function decode(modules, standard) {
    switch (standard) {
      case "qr": return decodeQRMatrix(modules);
      case "micro": return decodeMicroMatrix(modules);
      case "rmqr": return decodeRMQRMatrix(modules);
    }
    throw new QRDecodeError("unknown standard: " + standard);
  }

  /* ========================================================================
   * 公開 API
   * ====================================================================== */
  function encode(options) {
    const { standard, text } = options;
    if (typeof text !== "string" || text.length === 0) {
      throw new QREncodeError("EMPTY", "データを入力してください");
    }
    switch (standard) {
      case "qr": return encodeQR(text, options);
      case "micro": return encodeMicroQR(text, options);
      case "rmqr": return encodeRMQR(text, options);
    }
    throw new QREncodeError("BAD_OPTION", "unknown standard: " + standard);
  }

  const QRLib = {
    encode,
    decode,
    computeParity,
    QREncodeError,
    QRDecodeError,
    RMQR_VERSION_NAMES,
    RMQR_HEIGHTS: RMQR_H.slice(),
    RMQR_WIDTHS: RMQR_W.slice(),
    MICRO_SIZES,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = QRLib;
  } else {
    global.QRLib = QRLib;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
