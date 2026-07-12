/* Industrial 2 of 5 / Pharmacode 用の自前デコーダ (ZXing が非対応のため)。
 * ZXing と同じ二値化器で行列を作り、水平方向に複数の走査線を取って
 * バー/スペースのランレングス列に対しパターンマッチングする簡易実装。 */
(function (global) {
  "use strict";

  const TOF5_DIGIT = [
    "NNWWN", "WNNNW", "NWNNW", "WWNNN", "NNWNW",
    "WNWNN", "NWWNN", "NNNWW", "WNNWN", "NWNWN",
  ];
  const TOF5_LOOKUP = {};
  TOF5_DIGIT.forEach((pattern, i) => { TOF5_LOOKUP[pattern] = String(i); });

  function scanRuns(matrix, y) {
    const width = matrix.getWidth();
    const runs = [];
    let current = matrix.get(0, y);
    let start = 0;
    let len = 1;
    for (let x = 1; x < width; x++) {
      const v = matrix.get(x, y);
      if (v === current) { len++; }
      else { runs.push({ dark: current, start, len }); current = v; start = x; len = 1; }
    }
    runs.push({ dark: current, start, len });
    return runs;
  }

  function classify(len, unit) { return len > unit * 1.5 ? "W" : "N"; }
  function withinTol(len, unit, tol) { return Math.abs(len - unit) <= unit * tol; }

  /* スタート (太,太,狭バー) + 数字ごとの5バー + ストップ (太,狭,太バー)。
     バーのみが情報を持ち、スペースは全て狭幅 (encodeIndustrial2of5 の逆変換)。
     バーとスペースが必ず交互のランになるため、ラン列をそのまま突き合わせる。 */
  function decodeIndustrial2of5Row(runs) {
    // 最小構成: スタート3 + 数字5 + ストップ3 = バー11本 + 間の狭スペース10 = 21ラン
    for (let startIdx = 0; startIdx + 21 <= runs.length; startIdx++) {
      if (!runs[startIdx].dark) continue;
      const unit0 = runs[startIdx].len / 2; // スタート先頭は太バー (2ユニット)
      if (unit0 < 1) continue;

      /* シンボル範囲のラン収集: 狭幅でないスペース (クワイエットゾーン) か
         バーとして不正な幅のランが現れたら終端 */
      const bars = [];
      const spaces = [];
      for (let i = startIdx; i < runs.length; i++) {
        const r = runs[i];
        if (r.dark) {
          if (!withinTol(r.len, unit0, 0.6) && !withinTol(r.len, unit0 * 2, 0.6)) break;
          bars.push(r);
        } else {
          if (!withinTol(r.len, unit0, 0.6)) break;
          spaces.push(r);
        }
      }
      const n = bars.length;
      if (n < 11 || (n - 6) % 5 !== 0) continue;

      /* スペースは全て狭幅固定なので、その平均を基準幅にしてバーを分類する */
      const unit = spaces.length ? spaces.reduce((sum, r) => sum + r.len, 0) / spaces.length : unit0;
      const kinds = bars.map((r) => classify(r.len, unit)).join("");
      if (!kinds.startsWith("WWN") || !kinds.endsWith("WNW")) continue;

      let text = "";
      for (let i = 3; i <= n - 8; i += 5) {
        const digit = TOF5_LOOKUP[kinds.slice(i, i + 5)];
        if (digit === undefined) { text = null; break; }
        text += digit;
      }
      if (!text) continue;
      const last = bars[n - 1];
      return { text, x0: runs[startIdx].start, x1: last.start + last.len };
    }
    return null;
  }

  /* バーのみが情報を持ち (狭=1,太=2)、間は常に狭スペース。開始/終了マーカーが
     存在せず他形式との誤検出リスクがあるため、バー本数・スペース幅の均一性・
     復元値の範囲 (3〜131070) で妥当性を検証し、それでも通った場合のみ採用する。
     encodePharmacode (barcode1d.js) の逆変換 (v = 0; for each bar d: v = 2v + d)。 */
  function decodePharmacodeRow(runs) {
    const firstDark = runs.findIndex((r) => r.dark);
    let lastDark = -1;
    for (let i = runs.length - 1; i >= 0; i--) { if (runs[i].dark) { lastDark = i; break; } }
    if (firstDark < 0 || lastDark <= firstDark) return null;

    const segment = runs.slice(firstDark, lastDark + 1);
    if (!segment.every((r, i) => r.dark === (i % 2 === 0))) return null;
    const bars = segment.filter((r) => r.dark);
    const spaces = segment.filter((r) => !r.dark);
    if (bars.length < 2 || bars.length > 20) return null;
    /* スペースは常に狭幅固定 (encodePharmacode 参照) なので、これを基準幅とする。
       バー側の最小値を基準にすると、全バーがたまたま太幅になる値 (例: 131070)
       で誤って太幅を狭幅と取り違えてしまう */
    if (spaces.length === 0) return null;
    const unit = spaces.reduce((sum, r) => sum + r.len, 0) / spaces.length;
    if (unit < 1) return null;
    if (!spaces.every((r) => withinTol(r.len, unit, 0.6))) return null;
    if (!bars.every((r) => withinTol(r.len, unit, 0.6) || withinTol(r.len, unit * 2, 0.6))) return null;

    let v = 0;
    for (const r of bars) {
      const d = classify(r.len, unit) === "W" ? 2 : 1;
      v = v * 2 + d;
    }
    if (v < 3 || v > 131070) return null;

    const last = segment[segment.length - 1];
    return { text: String(v), x0: segment[0].start, x1: last.start + last.len };
  }

  function rowsToScan(height) {
    const rows = [];
    const n = Math.min(height, 31);
    for (let i = 0; i < n; i++) rows.push(Math.floor((i + 0.5) * height / n));
    return rows;
  }

  function makeResult(symbology, hit, y, offCanvas) {
    const w = Math.max(1, hit.x1 - hit.x0);
    const h = Math.max(1, Math.round(offCanvas.height * 0.06));
    return {
      std: "barcode",
      symbology,
      text: hit.text,
      box: { x0: hit.x0, y0: Math.max(0, y - h / 2), w, h },
    };
  }

  /* Industrial 2 of 5 は開始/終了マーカーがあり誤検出しにくいため先に試し、
     Pharmacode はマーカーがなく誤検出しやすいため最後の手段として試す。 */
  function tryDecodeBarcode1D(offCanvas) {
    if (typeof ZXing === "undefined") return null;
    const luminanceSource = new ZXing.HTMLCanvasElementLuminanceSource(offCanvas);
    const binarizer = new ZXing.HybridBinarizer(luminanceSource);
    const matrix = new ZXing.BinaryBitmap(binarizer).getBlackMatrix();
    const rows = rowsToScan(matrix.getHeight());

    for (const y of rows) {
      const hit = decodeIndustrial2of5Row(scanRuns(matrix, y));
      if (hit) return makeResult("industrial2of5", hit, y, offCanvas);
    }
    for (const y of rows) {
      const hit = decodePharmacodeRow(scanRuns(matrix, y));
      if (hit) return makeResult("pharmacode", hit, y, offCanvas);
    }
    return null;
  }

  /* ロー単位のデコーダも公開する (ブラウザ外での単体テスト用) */
  const Bar1DLib = { tryDecodeBarcode1D, decodeIndustrial2of5Row, decodePharmacodeRow };
  if (typeof module !== "undefined" && module.exports) module.exports = Bar1DLib;
  else global.Bar1DLib = Bar1DLib;
})(typeof globalThis !== "undefined" ? globalThis : this);
