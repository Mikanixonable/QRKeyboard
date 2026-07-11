/* Industrial 2 of 5 / Pharmacode 用の自前デコーダ (ZXing が非対応のため)。
 * ZXing と同じ二値化器で行列を作り、水平方向に複数の走査線を取って
 * バー/スペースのランレングス列に対しパターンマッチングする簡易実装。 */
(function () {
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

  /* encodeIndustrial2of5 (barcode1d.js) は各数字の最後のバーの直後のスペースを
     省略するため、ある数字の最終バーと次の数字 (またはストップ) の先頭バーが
     同色で隣接し、1本のランに融合することがある。そのため固定個数のランを
     読み進める単純な走査ではなく、「現在のランのうち何ユニット分を消費済みか」
     を保持するカーソルで、色とユニット数を指定しながら少しずつ消費していく。 */
  function makeCursor(runs, unit, startRunIdx) {
    if (startRunIdx >= runs.length) return null;
    return { runs, unit, runIdx: startRunIdx, remaining: unitLen(runs[startRunIdx], unit) };
  }
  function unitLen(run, unit) { return Math.max(1, Math.round(run.len / unit)); }
  /* exact=true の場合、そのランをちょうど使い切る (=ラン境界と一致する) 場合しか
     消費を認めない。ストップパターンの末尾の狭バーなど「これ以上バーが続かない」
     ことを検証したい箇所で使う (単に remaining>=n だけで許すと、実際には後続の
     数字の太バーの先頭部分を誤ってストップと解釈してしまう)。 */
  function consume(cursor, n, dark, exact) {
    const { runs, unit, runIdx, remaining } = cursor;
    if (runIdx >= runs.length || runs[runIdx].dark !== dark || remaining < n) return null;
    if (exact && remaining !== n) return null;
    const rest = remaining - n;
    if (rest === 0) {
      const nextIdx = runIdx + 1;
      return { runs, unit, runIdx: nextIdx, remaining: nextIdx < runs.length ? unitLen(runs[nextIdx], unit) : 0 };
    }
    return { runs, unit, runIdx, remaining: rest };
  }

  /* スタート (狭バー,狭スペース,狭バー,狭スペース) -> 数字ごとに
     (バー,スペース)x5 (バーのみが幅で情報を持ち、間のスペースは常に狭。ただし
     最後のバーの後のスペースは省略される) -> ストップ (太バー,狭スペース,狭バー)。
     encodeIndustrial2of5 (barcode1d.js) の逆変換。 */
  function decodeIndustrial2of5Row(runs) {
    for (let startIdx = 0; startIdx + 7 <= runs.length; startIdx++) {
      if (!runs[startIdx].dark) continue;
      const startRuns = runs.slice(startIdx, startIdx + 4);
      const unit = (startRuns[0].len + startRuns[1].len + startRuns[2].len + startRuns[3].len) / 4;
      if (unit < 1) continue;
      if (!startRuns.every((r) => withinTol(r.len, unit, 0.6))) continue;

      let cursor = makeCursor(runs, unit, startIdx + 4);
      let text = "";
      while (cursor) {
        let matched = null;
        for (let d = 0; d <= 9; d++) {
          const widths = TOF5_DIGIT[d].split("").map((c) => (c === "W" ? 2 : 1));
          let c = cursor;
          for (let k = 0; k < 5 && c; k++) {
            c = consume(c, widths[k], true);
            if (c && k < 4) c = consume(c, 1, false);
          }
          if (c) {
            if (matched) { matched = "AMBIGUOUS"; break; }
            matched = { digit: d, cursor: c };
          }
        }
        if (!matched || matched === "AMBIGUOUS") break;
        text += String(matched.digit);
        cursor = matched.cursor;

        /* ストップ (太バー,狭スペース,狭バー) は、数字の (バー2,スペース,バー1) と
           ラン長だけでは区別できないため、消費後にコード本体の末尾 (最後のラン =
           クワイエットゾーン) にちょうど到達しているかどうかで判定する */
        let stopCursor = consume(cursor, 2, true, true);
        stopCursor = stopCursor && consume(stopCursor, 1, false, true);
        stopCursor = stopCursor && consume(stopCursor, 1, true, true);
        if (stopCursor && stopCursor.runIdx >= runs.length - 1 && text.length > 0) {
          const lastRunIdx = Math.min(stopCursor.runIdx, runs.length - 1);
          const last = runs[lastRunIdx];
          return { text, x0: runs[startIdx].start, x1: last.start + last.len };
        }
      }
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

  window.Bar1DLib = { tryDecodeBarcode1D };
})();
