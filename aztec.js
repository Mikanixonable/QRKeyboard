/*
 * aztec.js — Aztec Code エンコーダ(依存なし)
 *
 * 準拠規格: ISO/IEC 24778:2008
 *   - コンパクト型 1-4 層 / フル型 1-32 層
 *   - 誤り訂正率は推奨値 23% を含む 10/23/36/50% から選択
 *   - データはバイナリシフト (B/S) で符号化 (任意のバイト列を符号化可能)
 * テーブル・配置マップは規格書記載のもの (zint BSD-3-Clause 実装と
 * クロスチェック済み)。
 */
(function (global) {
  "use strict";

  /* パラメータ化 GF(2^m)。生成多項式の根は α^1 .. α^n (ISO 24778 §7.2.3) */
  class GF {
    constructor(poly, size) {
      this.size = size; // 2^m - 1
      this.exp = new Int32Array(size * 2);
      this.log = new Int32Array(size + 1);
      let x = 1;
      for (let i = 0; i < size; i++) {
        this.exp[i] = x;
        this.log[x] = i;
        x <<= 1;
        if (x > size) x ^= poly;
      }
      for (let i = size; i < size * 2; i++) this.exp[i] = this.exp[i - size];
    }
    mul(a, b) {
      if (a === 0 || b === 0) return 0;
      return this.exp[this.log[a] + this.log[b]];
    }
  }

  const GF16 = new GF(0x13, 15);
  const GF64 = new GF(0x43, 63);
  const GF256 = new GF(0x12d, 255);
  const GF1024 = new GF(0x409, 1023);
  const GF4096 = new GF(0x1069, 4095);

  function gfForCodewordSize(b) {
    return { 6: GF64, 8: GF256, 10: GF1024, 12: GF4096 }[b];
  }

  function generatorPoly(gf, degree) {
    let g = [1];
    for (let i = 1; i <= degree; i++) {
      const ng = new Array(g.length + 1).fill(0);
      for (let j = 0; j < g.length; j++) {
        ng[j] ^= g[j];
        if (g[j] !== 0) ng[j + 1] ^= gf.exp[(gf.log[g[j]] + i) % gf.size];
      }
      g = ng;
    }
    return g;
  }

  function rsRemainder(gf, data, degree) {
    const gen = generatorPoly(gf, degree);
    const rem = new Int32Array(degree);
    for (let k = 0; k < data.length; k++) {
      const factor = data[k] ^ rem[0];
      rem.copyWithin(0, 1);
      rem[degree - 1] = 0;
      if (factor !== 0) {
        const lf = gf.log[factor];
        for (let i = 0; i < degree; i++) {
          if (gen[i + 1] !== 0) rem[i] ^= gf.exp[(gf.log[gen[i + 1]] + lf) % gf.size];
        }
      }
    }
    return rem;
  }

  class AZEncodeError extends Error {
    constructor(code, message) {
      super(message);
      this.name = "AZEncodeError";
      this.code = code;
    }
  }

  /* ISO/IEC 24778 Table 1: 層数ごとの総コード語数 */
  const FULL_SIZES = [
    21, 48, 60, 88, 120, 156, 196, 240, 230, 272, 316, 364, 416, 470, 528, 588,
    652, 720, 790, 864, 940, 1020, 920, 992, 1066, 1144, 1224, 1306, 1392, 1480, 1570, 1664,
  ];
  /* コンパクト 4 層はモードメッセージの制約でデータ最大 64 語 (物理は 76 語) */
  const COMPACT_SIZES = [17, 40, 51, 64];

  /* 誤り訂正率 (10/23/36/50% + 3語) を確保できる最大データビット数 */
  const FULL_DATA_BITS = [
    [95, 241, 408, 609, 840, 1099, 1387, 1704, 2040, 2418, 2814, 3246, 3714, 4200, 4722, 5262,
      5838, 6450, 7080, 7746, 8430, 9150, 9900, 10677, 11476, 12319, 13183, 14068, 14997, 15948, 16920, 17935],
    [79, 203, 345, 518, 715, 936, 1183, 1454, 1741, 2064, 2403, 2772, 3173, 3589, 4035, 4497,
      4990, 5514, 6053, 6622, 7208, 7824, 8464, 9130, 9813, 10534, 11273, 12031, 12826, 13639, 14470, 15339],
    [62, 166, 283, 426, 590, 774, 979, 1204, 1442, 1710, 1992, 2299, 2632, 2978, 3349, 3733,
      4142, 4578, 5026, 5499, 5986, 6498, 7029, 7582, 8150, 8749, 9364, 9994, 10654, 11330, 12021, 12743],
    [45, 126, 216, 328, 456, 600, 760, 936, 1120, 1330, 1550, 1790, 2050, 2320, 2610, 2910,
      3230, 3570, 3920, 4290, 4670, 5070, 5484, 5916, 6360, 6828, 7308, 7800, 8316, 8844, 9384, 9948],
  ];
  const COMPACT_DATA_BITS = [
    [73, 198, 343, 512],
    [60, 166, 290, 444],
    [47, 135, 237, 365],
    [33, 102, 180, 280],
  ];

  /* 参照グリッドを考慮したフルシンボルのオフセット */
  const FULL_OFFSET = [
    66, 64, 62, 60, 57, 55, 53, 51, 49, 47, 45, 42, 40, 38, 36, 34,
    32, 30, 28, 25, 23, 21, 19, 17, 15, 13, 10, 8, 6, 4, 2, 0,
  ];
  const COMPACT_OFFSET = [6, 4, 2, 0];
  const GRID_Y_OFFSETS = [27, 43, 59, 75, 91, 107, 123, 139];

  /* 27×27 コンパクトマップ (規格書 Figure 5 相当)。
   * 0/1 = 固定明/暗, 2000+ = モードメッセージ, その他 = データビット位置+2 */
  const AZTEC_COMPACT_MAP = [
    609, 608, 411, 413, 415, 417, 419, 421, 423, 425, 427, 429, 431, 433, 435, 437, 439, 441, 443, 445, 447, 449, 451, 453, 455, 457, 459,
    607, 606, 410, 412, 414, 416, 418, 420, 422, 424, 426, 428, 430, 432, 434, 436, 438, 440, 442, 444, 446, 448, 450, 452, 454, 456, 458,
    605, 604, 409, 408, 243, 245, 247, 249, 251, 253, 255, 257, 259, 261, 263, 265, 267, 269, 271, 273, 275, 277, 279, 281, 283, 460, 461,
    603, 602, 407, 406, 242, 244, 246, 248, 250, 252, 254, 256, 258, 260, 262, 264, 266, 268, 270, 272, 274, 276, 278, 280, 282, 462, 463,
    601, 600, 405, 404, 241, 240, 107, 109, 111, 113, 115, 117, 119, 121, 123, 125, 127, 129, 131, 133, 135, 137, 139, 284, 285, 464, 465,
    599, 598, 403, 402, 239, 238, 106, 108, 110, 112, 114, 116, 118, 120, 122, 124, 126, 128, 130, 132, 134, 136, 138, 286, 287, 466, 467,
    597, 596, 401, 400, 237, 236, 105, 104, 3, 5, 7, 9, 11, 13, 15, 17, 19, 21, 23, 25, 27, 140, 141, 288, 289, 468, 469,
    595, 594, 399, 398, 235, 234, 103, 102, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 142, 143, 290, 291, 470, 471,
    593, 592, 397, 396, 233, 232, 101, 100, 1, 1, 2000, 2001, 2002, 2003, 2004, 2005, 2006, 0, 1, 28, 29, 144, 145, 292, 293, 472, 473,
    591, 590, 395, 394, 231, 230, 99, 98, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 30, 31, 146, 147, 294, 295, 474, 475,
    589, 588, 393, 392, 229, 228, 97, 96, 2027, 1, 0, 0, 0, 0, 0, 0, 0, 1, 2007, 32, 33, 148, 149, 296, 297, 476, 477,
    587, 586, 391, 390, 227, 226, 95, 94, 2026, 1, 0, 1, 1, 1, 1, 1, 0, 1, 2008, 34, 35, 150, 151, 298, 299, 478, 479,
    585, 584, 389, 388, 225, 224, 93, 92, 2025, 1, 0, 1, 0, 0, 0, 1, 0, 1, 2009, 36, 37, 152, 153, 300, 301, 480, 481,
    583, 582, 387, 386, 223, 222, 91, 90, 2024, 1, 0, 1, 0, 1, 0, 1, 0, 1, 2010, 38, 39, 154, 155, 302, 303, 482, 483,
    581, 580, 385, 384, 221, 220, 89, 88, 2023, 1, 0, 1, 0, 0, 0, 1, 0, 1, 2011, 40, 41, 156, 157, 304, 305, 484, 485,
    579, 578, 383, 382, 219, 218, 87, 86, 2022, 1, 0, 1, 1, 1, 1, 1, 0, 1, 2012, 42, 43, 158, 159, 306, 307, 486, 487,
    577, 576, 381, 380, 217, 216, 85, 84, 2021, 1, 0, 0, 0, 0, 0, 0, 0, 1, 2013, 44, 45, 160, 161, 308, 309, 488, 489,
    575, 574, 379, 378, 215, 214, 83, 82, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 46, 47, 162, 163, 310, 311, 490, 491,
    573, 572, 377, 376, 213, 212, 81, 80, 0, 0, 2020, 2019, 2018, 2017, 2016, 2015, 2014, 0, 0, 48, 49, 164, 165, 312, 313, 492, 493,
    571, 570, 375, 374, 211, 210, 78, 76, 74, 72, 70, 68, 66, 64, 62, 60, 58, 56, 54, 50, 51, 166, 167, 314, 315, 494, 495,
    569, 568, 373, 372, 209, 208, 79, 77, 75, 73, 71, 69, 67, 65, 63, 61, 59, 57, 55, 52, 53, 168, 169, 316, 317, 496, 497,
    567, 566, 371, 370, 206, 204, 202, 200, 198, 196, 194, 192, 190, 188, 186, 184, 182, 180, 178, 176, 174, 170, 171, 318, 319, 498, 499,
    565, 564, 369, 368, 207, 205, 203, 201, 199, 197, 195, 193, 191, 189, 187, 185, 183, 181, 179, 177, 175, 172, 173, 320, 321, 500, 501,
    563, 562, 366, 364, 362, 360, 358, 356, 354, 352, 350, 348, 346, 344, 342, 340, 338, 336, 334, 332, 330, 328, 326, 322, 323, 502, 503,
    561, 560, 367, 365, 363, 361, 359, 357, 355, 353, 351, 349, 347, 345, 343, 341, 339, 337, 335, 333, 331, 329, 327, 324, 325, 504, 505,
    558, 556, 554, 552, 550, 548, 546, 544, 542, 540, 538, 536, 534, 532, 530, 528, 526, 524, 522, 520, 518, 516, 514, 512, 510, 506, 507,
    559, 557, 555, 553, 551, 549, 547, 545, 543, 541, 539, 537, 535, 533, 531, 529, 527, 525, 523, 521, 519, 517, 515, 513, 511, 508, 509,
  ];

  /* フルシンボル中心 15×15 (ファインダ + モードメッセージ位置 20000+) */
  const AZTEC_MAP_CORE = [
    1, 1, 20000, 20001, 20002, 20003, 20004, 0, 20005, 20006, 20007, 20008, 20009, 0, 1,
    1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
    20039, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 20010,
    20038, 1, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1, 20011,
    20037, 1, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 1, 20012,
    20036, 1, 0, 1, 0, 1, 1, 1, 1, 1, 0, 1, 0, 1, 20013,
    20035, 1, 0, 1, 0, 1, 0, 0, 0, 1, 0, 1, 0, 1, 20014,
    0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0,
    20034, 1, 0, 1, 0, 1, 0, 0, 0, 1, 0, 1, 0, 1, 20015,
    20033, 1, 0, 1, 0, 1, 1, 1, 1, 1, 0, 1, 0, 1, 20016,
    20032, 1, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 1, 20017,
    20031, 1, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1, 20018,
    20030, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 20019,
    0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
    0, 0, 20029, 20028, 20027, 20026, 20025, 0, 20024, 20023, 20022, 20021, 20020, 0, 0,
  ];

  function codewordSize(layers) {
    if (layers <= 2) return 6;
    if (layers <= 8) return 8;
    if (layers <= 22) return 10;
    return 12;
  }

  /* データ → ビット列。バイナリシフト (B/S) で全バイトを符号化 (§7.2) */
  function buildBitStream(text) {
    const bytes = new TextEncoder().encode(text);
    const bits = [];
    const put = (v, n) => {
      for (let i = n - 1; i >= 0; i--) bits.push((v >> i) & 1);
    };
    let i = 0;
    while (i < bytes.length) {
      const run = Math.min(bytes.length - i, 2078); // 31 + 2047 が 1 回の上限
      put(31, 5); // 上位モードからの B/S
      if (run < 32) {
        put(run, 5);
      } else {
        put(0, 5);
        put(run - 31, 11);
      }
      for (let j = 0; j < run; j++) put(bytes[i + j], 8);
      i += run;
    }
    return bits;
  }

  /* ビットスタッフィング (§7.3.1.2): 先頭 b-1 ビットが全 0/全 1 の語にダミー挿入 */
  function bitStuff(bits, b) {
    const out = [];
    let count = 0;
    for (let i = 0; i < bits.length; i++) {
      if ((out.length + 1) % b === 0) {
        if (count === 0 || count === b - 1) {
          out.push(count === 0 ? 1 : 0);
          count = bits[i] === 1 ? 1 : 0;
        } else {
          count = 0;
        }
      } else if (bits[i] === 1) {
        count++;
      }
      out.push(bits[i]);
    }
    return out;
  }

  /* 最終コード語を 1 で充填 (全 1 になる場合は最終ビットを 0 に) */
  function addPadding(bits, b) {
    const rem = bits.length % b;
    if (rem) {
      for (let i = 0; i < b - rem; i++) bits.push(1);
      let ones = 0;
      for (let i = bits.length - b; i < bits.length; i++) ones += bits[i];
      if (ones === b) bits[bits.length - 1] = 0;
    }
    return bits;
  }

  function avoidReferenceGrid(v) {
    if (v > 10) v += Math.floor((v - 11) / 15) + 1;
    return v;
  }

  /* フルシンボルの 151×151 マップを構築 (§14 / zint az_populate_map と同一) */
  function populateFullMap(layers) {
    const map = new Int32Array(151 * 151);
    const offset = FULL_OFFSET[layers - 1];
    const endoffset = 151 - offset;

    for (let layer = 0; layer < layers; layer++) {
      const start = 112 * layer + 16 * layer * layer + 2;
      const length = 28 + layer * 4 + (layer + 1) * 4;
      let n = start, end;
      // 上辺
      let x = 64 - layer * 2;
      let y = 63 - layer * 2;
      let av0 = avoidReferenceGrid(y) * 151;
      let av1 = avoidReferenceGrid(y - 1) * 151;
      end = start + length;
      while (n < end) {
        const avxi = avoidReferenceGrid(x++);
        map[av0 + avxi] = n++;
        map[av1 + avxi] = n++;
      }
      // 右辺
      x = 78 + layer * 2;
      y = 64 - layer * 2;
      av0 = avoidReferenceGrid(x);
      av1 = avoidReferenceGrid(x + 1);
      end += length;
      while (n < end) {
        const avyi = avoidReferenceGrid(y++) * 151;
        map[avyi + av0] = n++;
        map[avyi + av1] = n++;
      }
      // 下辺
      x = 77 + layer * 2;
      y = 78 + layer * 2;
      av0 = avoidReferenceGrid(y) * 151;
      av1 = avoidReferenceGrid(y + 1) * 151;
      end += length;
      while (n < end) {
        const avxi = avoidReferenceGrid(x--);
        map[av0 + avxi] = n++;
        map[av1 + avxi] = n++;
      }
      // 左辺
      x = 63 - layer * 2;
      y = 77 + layer * 2;
      av0 = avoidReferenceGrid(x);
      av1 = avoidReferenceGrid(x - 1);
      end += length;
      while (n < end) {
        const avyi = avoidReferenceGrid(y--) * 151;
        map[avyi + av0] = n++;
        map[avyi + av1] = n++;
      }
    }

    // 中心コア (ファインダ + モードメッセージ + 方向マーク)
    for (let y = 0; y < 15; y++) {
      for (let x = 0; x < 15; x++) {
        map[(y + 68) * 151 + (x + 68)] = AZTEC_MAP_CORE[y * 15 + x];
      }
    }

    // 参照グリッド
    const startY = offset <= 11 ? 11 : GRID_Y_OFFSETS[Math.floor((offset - 11) / 16)];
    for (let y = startY; y < endoffset; y += 16) {
      for (let x = offset; x < endoffset; x++) {
        map[x * 151 + y] = x & 1;
        map[y * 151 + x] = x & 1;
      }
    }
    return map;
  }

  function encode(options) {
    const text = options.text;
    if (typeof text !== "string" || text.length === 0) {
      throw new AZEncodeError("EMPTY", "データを入力してください");
    }
    const ecIdx = options.ecIndex != null ? options.ecIndex : 1; // 0:10% 1:23% 2:36% 3:50%
    if (ecIdx < 0 || ecIdx > 3) throw new AZEncodeError("BAD_OPTION", "誤り訂正率が不正です");

    const dataBits = buildBitStream(text);

    // サイズ選択 (version: 0=自動, 1-4=コンパクト, 5-36=フル 1-32 層)
    let compact = false, layers = 0, b = 0, stuffed = null;
    const tryFit = (isCompact, L) => {
      const cw = codewordSize(L);
      const maxBits = options.version
        ? cw * ((isCompact ? COMPACT_SIZES[L - 1] : FULL_SIZES[L - 1]) - 3)
        : (isCompact ? COMPACT_DATA_BITS[ecIdx][L - 1] : FULL_DATA_BITS[ecIdx][L - 1]);
      const adj = addPadding(bitStuff(dataBits, cw), cw);
      if (adj.length <= maxBits) {
        compact = isCompact;
        layers = L;
        b = cw;
        stuffed = adj;
        return true;
      }
      return false;
    };

    if (options.version) {
      const v = options.version;
      if (v < 1 || v > 36) throw new AZEncodeError("BAD_OPTION", "サイズ指定が不正です");
      const isCompact = v <= 4;
      const L = isCompact ? v : v - 4;
      if (!tryFit(isCompact, L)) {
        throw new AZEncodeError("TOO_LONG",
          "データが " + (isCompact ? "コンパクト" + L + "層" : "フル" + L + "層") + " の容量を超えています");
      }
    } else {
      let found = false;
      for (let L = 1; L <= 4 && !found; L++) found = tryFit(true, L);
      for (let L = 1; L <= 32 && !found; L++) found = tryFit(false, L);
      if (!found) {
        throw new AZEncodeError("TOO_LONG", "データが Aztec コードの最大容量を超えています");
      }
    }

    const numDataCw = stuffed.length / b;
    let numEccCw = (compact ? COMPACT_SIZES[layers - 1] : FULL_SIZES[layers - 1]) - numDataCw;
    if (compact && layers === 4) numEccCw += 12; // 物理 76 語の残りも ECC に使う
    const totalCw = numDataCw + numEccCw;

    // データコード語 + RS 誤り訂正
    const gf = gfForCodewordSize(b);
    const dataCw = [];
    for (let i = 0; i < numDataCw; i++) {
      let v = 0;
      for (let j = 0; j < b; j++) v = (v << 1) | stuffed[i * b + j];
      dataCw.push(v);
    }
    const ecc = rsRemainder(gf, dataCw, numEccCw);

    // 全ビット列 (逆順に格納: データが外周、RS が内側)
    const totalBits = totalCw * b;
    const seq = new Uint8Array(totalBits);
    let sp = 0;
    for (const v of dataCw) for (let j = b - 1; j >= 0; j--) seq[sp++] = (v >> j) & 1;
    for (const v of ecc) for (let j = b - 1; j >= 0; j--) seq[sp++] = (v >> j) & 1;
    // bitPattern[i] = seq[totalBits - 1 - i]
    const bitAt = (idx) => (idx < totalBits ? seq[totalBits - 1 - idx] : 0);

    // モードメッセージ (§7.2.3)
    const desc = [];
    if (compact) {
      for (let i = 1; i >= 0; i--) desc.push(((layers - 1) >> i) & 1);
      for (let i = 5; i >= 0; i--) desc.push(((numDataCw - 1) >> i) & 1);
    } else {
      for (let i = 4; i >= 0; i--) desc.push(((layers - 1) >> i) & 1);
      for (let i = 10; i >= 0; i--) desc.push(((numDataCw - 1) >> i) & 1);
    }
    const descWords = [];
    for (let i = 0; i < desc.length / 4; i++) {
      descWords.push((desc[i * 4] << 3) | (desc[i * 4 + 1] << 2) | (desc[i * 4 + 2] << 1) | desc[i * 4 + 3]);
    }
    const descEcc = rsRemainder(GF16, descWords, compact ? 5 : 6);
    for (const v of descEcc) {
      for (let i = 3; i >= 0; i--) desc.push((v >> i) & 1);
    }
    const descAt = (idx) => (idx < desc.length ? desc[idx] : 0);

    // マップからシンボルを構築
    let modules, dim;
    if (compact) {
      const offset = COMPACT_OFFSET[layers - 1];
      dim = 27 - 2 * offset;
      modules = [];
      for (let y = 0; y < dim; y++) {
        const row = new Array(dim).fill(0);
        for (let x = 0; x < dim; x++) {
          const v = AZTEC_COMPACT_MAP[(y + offset) * 27 + (x + offset)];
          if (v === 1) row[x] = 1;
          else if (v >= 2000) row[x] = descAt(v - 2000);
          else if (v >= 2) row[x] = bitAt(v - 2);
        }
        modules.push(row);
      }
    } else {
      const map = populateFullMap(layers);
      const offset = FULL_OFFSET[layers - 1];
      dim = 151 - 2 * offset;
      modules = [];
      for (let y = 0; y < dim; y++) {
        const row = new Array(dim).fill(0);
        for (let x = 0; x < dim; x++) {
          const v = map[(y + offset) * 151 + (x + offset)];
          if (v === 1) row[x] = 1;
          else if (v >= 20000) row[x] = descAt(v - 20000);
          else if (v >= 2) row[x] = bitAt(v - 2);
        }
        modules.push(row);
      }
    }

    return {
      standard: "aztec",
      versionName: (compact ? "コンパクト " : "フル ") + layers + "層 (" + dim + "×" + dim + ")",
      compact, layers,
      version: compact ? layers : layers + 4,
      modules,
      width: dim,
      height: dim,
      quietZone: 0, // Aztec はクワイエットゾーン不要
      usedBits: dataBits.length,
      capacityBits: b * ((compact ? COMPACT_SIZES[layers - 1] : FULL_SIZES[layers - 1]) - 3),
      dataCodewords: numDataCw,
      eccCodewords: numEccCw,
      totalCodewords: totalCw,
      codewordBits: b,
      eccPercent: Math.round(((numEccCw - 3) / totalCw) * 100),
    };
  }

  /* ===== Aztec Rune (ISO/IEC 24778 Annex A) =====
   * 0〜255 の整数値のみを符号化する簡易版。コンパクト Aztec のファインダー
   * 中心 11×11 (固定リングパターン + モードメッセージ位置28ビット分) を
   * そのまま流用し、モードメッセージと同じ GF(16) RS 符号 (次数5) で
   * 8ビット値を2ニブルとして保護する。 */
  const RUNE_MAP = [
    [1, 1, 2000, 2001, 2002, 2003, 2004, 2005, 2006, 0, 1],
    [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
    [2027, 1, 0, 0, 0, 0, 0, 0, 0, 1, 2007],
    [2026, 1, 0, 1, 1, 1, 1, 1, 0, 1, 2008],
    [2025, 1, 0, 1, 0, 0, 0, 1, 0, 1, 2009],
    [2024, 1, 0, 1, 0, 1, 0, 1, 0, 1, 2010],
    [2023, 1, 0, 1, 0, 0, 0, 1, 0, 1, 2011],
    [2022, 1, 0, 1, 1, 1, 1, 1, 0, 1, 2012],
    [2021, 1, 0, 0, 0, 0, 0, 0, 0, 1, 2013],
    [0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
    [0, 0, 2020, 2019, 2018, 2017, 2016, 2015, 2014, 0, 0],
  ];

  function encodeRune(value) {
    if (!Number.isInteger(value) || value < 0 || value > 255) {
      throw new AZEncodeError("BAD_OPTION", "Aztec Rune は 0〜255 の整数で入力してください");
    }
    const desc = [];
    for (let i = 3; i >= 0; i--) desc.push((value >> (i + 4)) & 1);
    for (let i = 3; i >= 0; i--) desc.push((value >> i) & 1);
    const descWords = [
      (desc[0] << 3) | (desc[1] << 2) | (desc[2] << 1) | desc[3],
      (desc[4] << 3) | (desc[5] << 2) | (desc[6] << 1) | desc[7],
    ];
    const descEcc = rsRemainder(GF16, descWords, 5);
    for (const v of descEcc) for (let i = 3; i >= 0; i--) desc.push((v >> i) & 1);
    const descAt = (idx) => (idx < desc.length ? desc[idx] : 0);

    const dim = 11;
    const modules = [];
    for (let y = 0; y < dim; y++) {
      const row = new Array(dim).fill(0);
      for (let x = 0; x < dim; x++) {
        const v = RUNE_MAP[y][x];
        if (v === 1) row[x] = 1;
        else if (v >= 2000) row[x] = descAt(v - 2000);
      }
      modules.push(row);
    }
    return {
      standard: "aztecrune",
      versionName: "Aztec Rune",
      value,
      modules,
      width: dim,
      height: dim,
      quietZone: 2,
    };
  }

  /* 汎用 GF(2^m) RS 復号 (Berlekamp-Massey + Chien 探索 + Forney 法)。
   * qrcode.js の rsCorrect と同一アルゴリズムを、フィールドサイズ (gf.size)
   * をパラメータ化して汎用化したもの。ただし本ファイルの rsRemainder / generatorPoly
   * は根を α^1..α^degree で構成する (root base b0=1、qrcode.js の α^0..α^(degree-1)
   * とは1つずれる) ため、シンドローム指数を i+1 にずらし、Forney 振幅式も
   * b0=1 用 (X^0 = 1、X^(1-b0) 項なし) に合わせてある。 */
  function gfRsCorrect(gf, cw, eccLen) {
    const n = cw.length;
    const synd = new Array(eccLen).fill(0);
    let hasError = false;
    for (let i = 0; i < eccLen; i++) {
      let s = 0;
      for (let j = 0; j < n; j++) s = cw[j] ^ (s === 0 ? 0 : gf.exp[(gf.log[s] + i + 1) % gf.size]);
      synd[i] = s;
      if (s !== 0) hasError = true;
    }
    if (!hasError) return 0;

    let sigma = [1], prev = [1], L = 0, m = 1, b = 1;
    for (let i = 0; i < eccLen; i++) {
      let delta = synd[i];
      for (let j = 1; j <= L; j++) {
        if (sigma[j] !== 0 && synd[i - j] !== 0) delta ^= gf.exp[(gf.log[sigma[j]] + gf.log[synd[i - j]]) % gf.size];
      }
      if (delta === 0) {
        m++;
      } else if (2 * L <= i) {
        const tmp = sigma.slice();
        const coef = gf.exp[(gf.log[delta] - gf.log[b] + gf.size) % gf.size];
        const shifted = new Array(prev.length + m).fill(0);
        for (let j = 0; j < prev.length; j++) {
          if (prev[j] !== 0) shifted[j + m] = gf.exp[(gf.log[prev[j]] + gf.log[coef]) % gf.size];
        }
        while (sigma.length < shifted.length) sigma.push(0);
        for (let j = 0; j < shifted.length; j++) sigma[j] ^= shifted[j];
        L = i + 1 - L; prev = tmp; b = delta; m = 1;
      } else {
        const coef = gf.exp[(gf.log[delta] - gf.log[b] + gf.size) % gf.size];
        const shifted = new Array(prev.length + m).fill(0);
        for (let j = 0; j < prev.length; j++) {
          if (prev[j] !== 0) shifted[j + m] = gf.exp[(gf.log[prev[j]] + gf.log[coef]) % gf.size];
        }
        while (sigma.length < shifted.length) sigma.push(0);
        for (let j = 0; j < shifted.length; j++) sigma[j] ^= shifted[j];
        m++;
      }
    }
    while (sigma.length > 1 && sigma[sigma.length - 1] === 0) sigma.pop();
    const numErrors = sigma.length - 1;
    if (numErrors === 0 || numErrors > Math.floor(eccLen / 2)) return -1;

    const errPos = [];
    for (let j = 0; j < n; j++) {
      const xinvLog = (gf.size - ((n - 1 - j) % gf.size)) % gf.size;
      let v = 0;
      for (let k = 0; k < sigma.length; k++) {
        if (sigma[k] !== 0) v ^= gf.exp[(gf.log[sigma[k]] + k * xinvLog) % gf.size];
      }
      if (v === 0) errPos.push(j);
    }
    if (errPos.length !== numErrors) return -1;

    const omega = new Array(eccLen).fill(0);
    for (let i = 0; i < eccLen; i++) {
      for (let k = 0; k <= Math.min(i, sigma.length - 1); k++) {
        if (sigma[k] !== 0 && synd[i - k] !== 0) omega[i] ^= gf.exp[(gf.log[sigma[k]] + gf.log[synd[i - k]]) % gf.size];
      }
    }
    for (const j of errPos) {
      const xLog = (n - 1 - j) % gf.size;
      const xinvLog = (gf.size - xLog) % gf.size;
      let om = 0;
      for (let k = 0; k < eccLen; k++) {
        if (omega[k] !== 0) om ^= gf.exp[(gf.log[omega[k]] + k * xinvLog) % gf.size];
      }
      let sp = 0;
      for (let k = 1; k < sigma.length; k += 2) {
        if (sigma[k] !== 0) sp ^= gf.exp[(gf.log[sigma[k]] + (k - 1) * xinvLog) % gf.size];
      }
      if (sp === 0) return -1;
      if (om !== 0) {
        const mag = gf.exp[(gf.log[om] - gf.log[sp] + gf.size) % gf.size];
        cw[j] ^= mag;
      }
    }
    for (let i = 0; i < eccLen; i++) {
      let s = 0;
      for (let j = 0; j < n; j++) s = cw[j] ^ (s === 0 ? 0 : gf.exp[(gf.log[s] + i + 1) % gf.size]);
      if (s !== 0) return -1;
    }
    return numErrors;
  }

  function decodeRune(modules) {
    if (modules.length !== 11 || modules[0].length !== 11) {
      throw new AZEncodeError("BAD_OPTION", "サイズが不正です (Aztec Rune は 11×11)");
    }
    const desc = [];
    for (let y = 0; y < 11; y++) {
      for (let x = 0; x < 11; x++) {
        const v = RUNE_MAP[y][x];
        if (v >= 2000) desc[v - 2000] = modules[y][x];
      }
    }
    const words = [];
    for (let i = 0; i < 7; i++) {
      words.push((desc[i * 4] << 3) | (desc[i * 4 + 1] << 2) | (desc[i * 4 + 2] << 1) | desc[i * 4 + 3]);
    }
    const corrected = gfRsCorrect(GF16, words, 5);
    if (corrected < 0) throw new AZEncodeError("BAD_OPTION", "誤り訂正能力を超えています (読み取り不能)");
    return { value: (words[0] << 4) | words[1], corrected };
  }

  const AZLib = { encode, encodeRune, decodeRune, AZEncodeError, FULL_SIZES, COMPACT_SIZES };
  if (typeof module !== "undefined" && module.exports) module.exports = AZLib;
  else global.AZLib = AZLib;
})(typeof globalThis !== "undefined" ? globalThis : this);
