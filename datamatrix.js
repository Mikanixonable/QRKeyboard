/*
 * datamatrix.js — DataMatrix (ECC 200) エンコーダ(依存なし)
 *
 * 準拠規格: ISO/IEC 16022 (正方形 24 種 + 長方形 6 種)
 * 符号化は ASCII エンコデーション(数字ペア圧縮 + 上位シフト)を使用。
 * 非 ASCII 文字は ECI 000026 (UTF-8) を前置してバイト列を符号化する。
 * テーブル・配置アルゴリズムは規格書 Annex F 記載のもの
 * (zint BSD-3-Clause 実装とクロスチェック済み)。
 */
(function (global) {
  "use strict";

  /* GF(256), 原始多項式 0x12D。生成多項式の根は α^1 .. α^n (ISO 16022 の規約) */
  const GF_EXP = new Uint8Array(510);
  const GF_LOG = new Int16Array(256);
  {
    let x = 1;
    for (let i = 0; i < 255; i++) {
      GF_EXP[i] = x;
      GF_LOG[x] = i;
      x <<= 1;
      if (x & 0x100) x ^= 0x12d;
    }
    for (let i = 255; i < 510; i++) GF_EXP[i] = GF_EXP[i - 255];
  }

  const genCache = new Map();
  function generatorPoly(degree) {
    let g = genCache.get(degree);
    if (g) return g;
    g = [1];
    for (let i = 1; i <= degree; i++) {
      const ng = new Array(g.length + 1).fill(0);
      for (let j = 0; j < g.length; j++) {
        ng[j] ^= g[j];
        if (g[j] !== 0) ng[j + 1] ^= GF_EXP[(GF_LOG[g[j]] + i) % 255];
      }
      g = ng;
    }
    genCache.set(degree, g);
    return g;
  }

  function rsRemainder(data, degree) {
    const gen = generatorPoly(degree);
    const rem = new Uint8Array(degree);
    for (let k = 0; k < data.length; k++) {
      const factor = data[k] ^ rem[0];
      rem.copyWithin(0, 1);
      rem[degree - 1] = 0;
      if (factor !== 0) {
        const lf = GF_LOG[factor];
        for (let i = 0; i < degree; i++) {
          if (gen[i + 1] !== 0) rem[i] ^= GF_EXP[(GF_LOG[gen[i + 1]] + lf) % 255];
        }
      }
    }
    return rem;
  }

  class DMEncodeError extends Error {
    constructor(code, message) {
      super(message);
      this.name = "DMEncodeError";
      this.code = code;
    }
  }

  /* ISO/IEC 16022 Table 7 (正方形→長方形の順)。
   * h,w: シンボルサイズ / fh,fw: データ領域+ファインダの区画サイズ
   * data: データコード語総数 / eccPB: ブロックあたり誤り訂正コード語
   * dataPB: ブロックあたりデータコード語 */
  const SIZES = [
    { h: 10, w: 10, fh: 10, fw: 10, data: 3, dataPB: 3, eccPB: 5 },
    { h: 12, w: 12, fh: 12, fw: 12, data: 5, dataPB: 5, eccPB: 7 },
    { h: 14, w: 14, fh: 14, fw: 14, data: 8, dataPB: 8, eccPB: 10 },
    { h: 16, w: 16, fh: 16, fw: 16, data: 12, dataPB: 12, eccPB: 12 },
    { h: 18, w: 18, fh: 18, fw: 18, data: 18, dataPB: 18, eccPB: 14 },
    { h: 20, w: 20, fh: 20, fw: 20, data: 22, dataPB: 22, eccPB: 18 },
    { h: 22, w: 22, fh: 22, fw: 22, data: 30, dataPB: 30, eccPB: 20 },
    { h: 24, w: 24, fh: 24, fw: 24, data: 36, dataPB: 36, eccPB: 24 },
    { h: 26, w: 26, fh: 26, fw: 26, data: 44, dataPB: 44, eccPB: 28 },
    { h: 32, w: 32, fh: 16, fw: 16, data: 62, dataPB: 62, eccPB: 36 },
    { h: 36, w: 36, fh: 18, fw: 18, data: 86, dataPB: 86, eccPB: 42 },
    { h: 40, w: 40, fh: 20, fw: 20, data: 114, dataPB: 114, eccPB: 48 },
    { h: 44, w: 44, fh: 22, fw: 22, data: 144, dataPB: 144, eccPB: 56 },
    { h: 48, w: 48, fh: 24, fw: 24, data: 174, dataPB: 174, eccPB: 68 },
    { h: 52, w: 52, fh: 26, fw: 26, data: 204, dataPB: 102, eccPB: 42 },
    { h: 64, w: 64, fh: 16, fw: 16, data: 280, dataPB: 140, eccPB: 56 },
    { h: 72, w: 72, fh: 18, fw: 18, data: 368, dataPB: 92, eccPB: 36 },
    { h: 80, w: 80, fh: 20, fw: 20, data: 456, dataPB: 114, eccPB: 48 },
    { h: 88, w: 88, fh: 22, fw: 22, data: 576, dataPB: 144, eccPB: 56 },
    { h: 96, w: 96, fh: 24, fw: 24, data: 696, dataPB: 174, eccPB: 68 },
    { h: 104, w: 104, fh: 26, fw: 26, data: 816, dataPB: 136, eccPB: 56 },
    { h: 120, w: 120, fh: 20, fw: 20, data: 1050, dataPB: 175, eccPB: 68 },
    { h: 132, w: 132, fh: 22, fw: 22, data: 1304, dataPB: 163, eccPB: 62 },
    { h: 144, w: 144, fh: 24, fw: 24, data: 1558, dataPB: 156, eccPB: 62, skew: true },
    { h: 8, w: 18, fh: 8, fw: 18, data: 5, dataPB: 5, eccPB: 7, rect: true },
    { h: 8, w: 32, fh: 8, fw: 16, data: 10, dataPB: 10, eccPB: 11, rect: true },
    { h: 12, w: 26, fh: 12, fw: 26, data: 16, dataPB: 16, eccPB: 14, rect: true },
    { h: 12, w: 36, fh: 12, fw: 18, data: 22, dataPB: 22, eccPB: 18, rect: true },
    { h: 16, w: 36, fh: 16, fw: 18, data: 32, dataPB: 32, eccPB: 24, rect: true },
    { h: 16, w: 48, fh: 16, fw: 24, data: 49, dataPB: 49, eccPB: 28, rect: true },
  ];
  const SIZE_NAMES = SIZES.map((s) => s.h + "×" + s.w);

  /* ASCII エンコデーション (§5.2.3)。非 ASCII は ECI 000026 + UTF-8 */
  function encodeData(text) {
    const hasNonAscii = /[^\x00-\x7F]/.test(text);
    const bytes = hasNonAscii
      ? new TextEncoder().encode(text)
      : Uint8Array.from(text, (c) => c.charCodeAt(0));
    const cw = [];
    if (hasNonAscii) {
      cw.push(241, 26 + 1); // ECI 指示子 + ECI 000026 (UTF-8)
    }
    let i = 0;
    while (i < bytes.length) {
      const b = bytes[i];
      if (b >= 48 && b <= 57 && i + 1 < bytes.length && bytes[i + 1] >= 48 && bytes[i + 1] <= 57) {
        cw.push(130 + (b - 48) * 10 + (bytes[i + 1] - 48)); // 数字ペア
        i += 2;
      } else if (b >= 128) {
        cw.push(235, b - 128 + 1); // 上位シフト
        i++;
      } else {
        cw.push(b + 1);
        i++;
      }
    }
    return cw;
  }

  /* 埋め草 (§5.2.4.4): 129 の後は 253 状態乱数化 */
  function addPadding(cw, capacity) {
    if (cw.length >= capacity) return;
    cw.push(129);
    while (cw.length < capacity) {
      const prn = ((149 * (cw.length + 1)) % 253) + 1;
      let v = 129 + prn;
      if (v > 254) v -= 254;
      cw.push(v);
    }
  }

  /* 誤り訂正コード語の付加 (ブロック分割・交互配置、144×144 は特殊配置) */
  function addEcc(cw, size) {
    const blocks = Math.floor((cw.length + 2) / size.dataPB);
    const rsTotal = size.eccPB * blocks;
    const out = new Uint8Array(cw.length + rsTotal);
    out.set(cw);
    for (let b = 0; b < blocks; b++) {
      const buf = [];
      for (let n = b; n < cw.length; n += blocks) buf.push(cw[n]);
      const ecc = rsRemainder(buf, size.eccPB);
      if (size.skew) {
        // 144×144: ISO の規定に合わせ後方 2 ブロックの ECC 位置をずらす
        for (let p = 0, n = b; n < rsTotal; n += blocks, p++) {
          if (b < 8) out[cw.length + n + 2] = ecc[p];
          else out[cw.length + n - 8] = ecc[p];
        }
      } else {
        for (let p = 0, n = b; n < rsTotal; n += blocks, p++) {
          out[cw.length + n] = ecc[p];
        }
      }
    }
    return out;
  }

  /* ===== Annex F 配置アルゴリズム ===== */
  function placementBit(arr, NR, NC, r, c, p, b) {
    if (r < 0) {
      r += NR;
      c += 4 - ((NR + 4) % 8);
    }
    if (c < 0) {
      c += NC;
      r += 4 - ((NC + 4) % 8);
    }
    arr[r * NC + c] = (p << 3) + b;
  }

  function placementBlock(arr, NR, NC, r, c, p) {
    placementBit(arr, NR, NC, r - 2, c - 2, p, 7);
    placementBit(arr, NR, NC, r - 2, c - 1, p, 6);
    placementBit(arr, NR, NC, r - 1, c - 2, p, 5);
    placementBit(arr, NR, NC, r - 1, c - 1, p, 4);
    placementBit(arr, NR, NC, r - 1, c, p, 3);
    placementBit(arr, NR, NC, r, c - 2, p, 2);
    placementBit(arr, NR, NC, r, c - 1, p, 1);
    placementBit(arr, NR, NC, r, c, p, 0);
  }

  function placement(NR, NC) {
    const arr = new Int32Array(NR * NC);
    let p = 1;
    let r = 4, c = 0;
    const corner = [
      [[NR - 1, 0, 7], [NR - 1, 1, 6], [NR - 1, 2, 5], [0, NC - 2, 4], [0, NC - 1, 3], [1, NC - 1, 2], [2, NC - 1, 1], [3, NC - 1, 0]],
      [[NR - 3, 0, 7], [NR - 2, 0, 6], [NR - 1, 0, 5], [0, NC - 4, 4], [0, NC - 3, 3], [0, NC - 2, 2], [0, NC - 1, 1], [1, NC - 1, 0]],
      [[NR - 3, 0, 7], [NR - 2, 0, 6], [NR - 1, 0, 5], [0, NC - 2, 4], [0, NC - 1, 3], [1, NC - 1, 2], [2, NC - 1, 1], [3, NC - 1, 0]],
      [[NR - 1, 0, 7], [NR - 1, NC - 1, 6], [0, NC - 3, 5], [0, NC - 2, 4], [0, NC - 1, 3], [1, NC - 3, 2], [1, NC - 2, 1], [1, NC - 1, 0]],
    ];
    const placeCorner = (idx) => {
      for (const [cr, cc, b] of corner[idx]) placementBit(arr, NR, NC, cr, cc, p, b);
      p++;
    };
    do {
      if (r === NR && c === 0) placeCorner(0);
      if (r === NR - 2 && c === 0 && NC % 4) placeCorner(1);
      if (r === NR - 2 && c === 0 && NC % 8 === 4) placeCorner(2);
      if (r === NR + 4 && c === 2 && NC % 8 === 0) placeCorner(3);
      do {
        if (r < NR && c >= 0 && !arr[r * NC + c]) placementBlock(arr, NR, NC, r, c, p++);
        r -= 2;
        c += 2;
      } while (r >= 0 && c < NC);
      r++;
      c += 3;
      do {
        if (r >= 0 && c < NC && !arr[r * NC + c]) placementBlock(arr, NR, NC, r, c, p++);
        r += 2;
        c -= 2;
      } while (r < NR && c >= 0);
      r += 3;
      c++;
    } while (r < NR || c < NC);
    // 右下の固定パターン
    if (!arr[NR * NC - 1]) {
      arr[NR * NC - 1] = 1;
      arr[NR * NC - NC - 2] = 1;
    }
    return arr;
  }

  function encode(options) {
    const text = options.text;
    if (typeof text !== "string" || text.length === 0) {
      throw new DMEncodeError("EMPTY", "データを入力してください");
    }
    const cw = encodeData(text);

    let sizeIdx = -1;
    if (options.size) {
      sizeIdx = options.size - 1;
      if (sizeIdx < 0 || sizeIdx >= SIZES.length) {
        throw new DMEncodeError("BAD_OPTION", "サイズ指定が不正です");
      }
      if (cw.length > SIZES[sizeIdx].data) {
        throw new DMEncodeError("TOO_LONG",
          "データが " + SIZE_NAMES[sizeIdx] + " の容量 (" + SIZES[sizeIdx].data + " コード語) を超えています");
      }
    } else {
      // 自動: 収まる最小の正方形
      for (let i = 0; i < SIZES.length; i++) {
        if (!SIZES[i].rect && cw.length <= SIZES[i].data) {
          sizeIdx = i;
          break;
        }
      }
      if (sizeIdx < 0) throw new DMEncodeError("TOO_LONG", "データが DataMatrix の最大容量を超えています");
    }
    const size = SIZES[sizeIdx];
    const usedCw = cw.length;
    addPadding(cw, size.data);
    const stream = addEcc(cw, size);

    const H = size.h, W = size.w, FH = size.fh, FW = size.fw;
    const NR = H - 2 * Math.floor(H / FH);
    const NC = W - 2 * Math.floor(W / FW);
    const modules = [];
    for (let y = 0; y < H; y++) modules.push(new Array(W).fill(0));

    // ファインダパターン (各データ領域の L 字 + 破線)
    for (let y = 0; y < H; y += FH) {
      for (let x = 0; x < W; x++) modules[H - y - 1][x] = 1;      // 実線 (下辺)
      for (let x = 0; x < W; x += 2) modules[y][x] = 1;           // 破線 (上辺)
    }
    for (let x = 0; x < W; x += FW) {
      for (let y = 0; y < H; y++) modules[H - y - 1][x] = 1;      // 実線 (左辺)
      for (let y = 0; y < H; y += 2) modules[H - y - 1][x + FW - 1] = 1; // 破線 (右辺)
    }

    // データ配置
    const places = placement(NR, NC);
    for (let y = 0; y < NR; y++) {
      for (let x = 0; x < NC; x++) {
        const v = places[(NR - y - 1) * NC + x];
        let dark = false;
        if (v === 1) dark = true;
        else if (v > 7) dark = (stream[(v >> 3) - 1] & (1 << (v & 7))) !== 0;
        if (dark) {
          const row = H - (1 + y + 2 * Math.floor(y / (FH - 2))) - 1;
          const col = 1 + x + 2 * Math.floor(x / (FW - 2));
          modules[row][col] = 1;
        }
      }
    }

    return {
      standard: "datamatrix",
      versionName: SIZE_NAMES[sizeIdx],
      sizeIndex: sizeIdx + 1,
      modules,
      width: W,
      height: H,
      quietZone: 1,
      usedCodewords: usedCw,
      dataCodewords: size.data,
      eccCodewords: stream.length - size.data,
      totalCodewords: stream.length,
    };
  }

  const DMLib = { encode, DMEncodeError, SIZES, SIZE_NAMES };
  if (typeof module !== "undefined" && module.exports) module.exports = DMLib;
  else global.DMLib = DMLib;
})(typeof globalThis !== "undefined" ? globalThis : this);
