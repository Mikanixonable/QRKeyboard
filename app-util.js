/* app-util.js — app.js から分離した、状態 (state/current 等) に依存しない
 * 純粋ヘルパー関数群。テキスト折返し、DOM 部品factory、rMQR バージョン索引、
 * 読み取り時の走査色サンプリングなどを提供する。QRLib (qrcode.js) の
 * グローバルに依存するため、qrcode.js より後に読み込む必要がある。 */
(function (global) {
  "use strict";

  /* 高さ×幅 -> バージョン番号 (1 始まり) の索引を一度だけ構築する */
  let rmqrIndex = null;
  function getRmqrIndex() {
    if (!rmqrIndex) {
      rmqrIndex = new Map();
      for (let i = 0; i < QRLib.RMQR_HEIGHTS.length; i++) {
        rmqrIndex.set(`${QRLib.RMQR_HEIGHTS[i]}x${QRLib.RMQR_WIDTHS[i]}`, i + 1);
      }
    }
    return rmqrIndex;
  }
  function rmqrWidthsFor(h) {
    const widths = [];
    for (let i = 0; i < QRLib.RMQR_HEIGHTS.length; i++) {
      if (QRLib.RMQR_HEIGHTS[i] === h) widths.push(QRLib.RMQR_WIDTHS[i]);
    }
    return widths;
  }
  function rmqrVersionOf(h, w) {
    return getRmqrIndex().get(`${h}x${w}`) || 0;
  }

  /* ---------- 共通部品 ---------- */

  function makeSegButton(label, checked, onClick) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "seg-btn";
    btn.setAttribute("role", "radio");
    btn.setAttribute("aria-checked", checked ? "true" : "false");
    btn.textContent = label;
    btn.addEventListener("click", onClick);
    return btn;
  }

  function makeToggle(checked, onChange, text) {
    const label = document.createElement("label");
    label.className = "auto-toggle";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = checked;
    cb.addEventListener("change", () => onChange(cb.checked));
    label.append(cb, document.createTextNode(text || "自動"));
    return label;
  }

  function makeNote(text) {
    const span = document.createElement("span");
    span.className = "seg-note";
    span.textContent = text;
    return span;
  }

  function splitEvenly(text, count) {
    const cps = Array.from(text);
    const per = Math.ceil(cps.length / count);
    const chunks = [];
    for (let i = 0; i < cps.length; i += per) chunks.push(cps.slice(i, i + per).join(""));
    return chunks;
  }

  /* コード数から縦横のグリッド分割数を決める (正方形に近くなるように) */
  function gridDims(n) {
    const cols = Math.ceil(Math.sqrt(n));
    const rows = Math.ceil(n / cols);
    return { cols, rows };
  }

  /* 内容表示 (文字入れ) のフォントサイズは、PNG/SVG書き出し (renderFull*Canvas) と
     同じ「1モジュールあたりのピクセル数 (scale) に比例させる」基準で決める。
     以前は画面表示域の絶対サイズを基準にしていたため、書き出し結果と画面表示の
     文字の見た目の大きさ (コードに対する比率) が食い違っていた
     (特にモバイルではコード自体が小さく表示されるため、書き出しと比べて
     文字だけが不釣り合いに大きく見えていた)。 */
  function captionFontFromScale(scale, dpr) {
    return {
      base: Math.max(Math.round(14 * dpr), Math.round(scale * 2.2)),
      min: Math.max(Math.round(8 * dpr), Math.round(scale)),
    };
  }

  /* 指定幅に収まるよう末尾を "…" で省略する */
  function truncateToWidth(context, text, maxWidth) {
    if (context.measureText(text).width <= maxWidth) return text;
    let lo = 0, hi = text.length;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (context.measureText(text.slice(0, mid) + "…").width <= maxWidth) lo = mid;
      else hi = mid - 1;
    }
    return lo === 0 ? "…" : text.slice(0, lo) + "…";
  }

  /* 指定幅を超える場合は改行する。maxLines に収まらない場合は最終行を省略し、truncated:true を返す */
  function wrapToLines(context, text, maxWidth, maxLines) {
    const lines = [];
    let remaining = text;
    let truncated = false;
    while (remaining.length > 0 && lines.length < maxLines) {
      if (context.measureText(remaining).width <= maxWidth) {
        lines.push(remaining);
        remaining = "";
        break;
      }
      if (lines.length === maxLines - 1) {
        lines.push(truncateToWidth(context, remaining, maxWidth));
        remaining = "";
        truncated = true;
        break;
      }
      let lo = 1, hi = remaining.length;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (context.measureText(remaining.slice(0, mid)).width <= maxWidth) lo = mid;
        else hi = mid - 1;
      }
      lines.push(remaining.slice(0, lo));
      remaining = remaining.slice(lo);
    }
    if (remaining.length > 0) truncated = true;
    return { lines: lines.length ? lines : [""], truncated };
  }

  /* SVG 書き出し用。SVG にはキャンバスの measureText 相当がないため、
     monospace フォントの等幅性を利用して文字数ベースで折り返す簡易版。 */
  function wrapMonospace(text, fontSize, maxWidth, maxLines) {
    const charW = fontSize * 0.6;
    const maxChars = Math.max(1, Math.floor(maxWidth / charW));
    const lines = [];
    let remaining = text;
    while (remaining.length > 0 && lines.length < maxLines) {
      if (remaining.length <= maxChars) {
        lines.push(remaining);
        remaining = "";
        break;
      }
      if (lines.length === maxLines - 1) {
        lines.push(remaining.slice(0, Math.max(1, maxChars - 1)) + "…");
        remaining = "";
        break;
      }
      lines.push(remaining.slice(0, maxChars));
      remaining = remaining.slice(maxChars);
    }
    return lines.length ? lines : [""];
  }

  /* 行数上限に収まらない場合は、収まるようになるまでフォントサイズを縮小する。
     最小サイズでも収まらなければ、その時点で省略する。 */
  function fitCaptionLines(context, text, maxWidth, maxLines, basePx, minPx) {
    let fontPx = minPx;
    let lines = [""];
    for (let px = basePx; px >= minPx; px--) {
      context.font = `${px}px monospace`;
      const result = wrapToLines(context, text, maxWidth, maxLines);
      fontPx = px;
      lines = result.lines;
      if (!result.truncated) break;
    }
    return { fontPx, lines };
  }

  function captionFontRange(scale) {
    return { base: Math.max(14, Math.round(scale * 2.2)), min: Math.max(8, Math.round(scale)) };
  }

  /* キャプションの帯を縦中央揃えで描く共通ヘルパー */
  function drawCaptionBand(octx, lines, fontPx, centerX, maxW, bandTop, bandBottom) {
    octx.font = `${fontPx}px monospace`;
    octx.textAlign = "center";
    octx.textBaseline = "top";
    const lineH = Math.round(fontPx * 1.4);
    const blockH = lines.length * lineH;
    const startY = bandTop + (bandBottom - bandTop - blockH) / 2;
    lines.forEach((line, i) => octx.fillText(line, centerX, startY + i * lineH, maxW));
  }

  function scaleCanvasTo(source, maxDim) {
    const scale = maxDim / Math.max(source.width, source.height);
    if (scale >= 1) return source;
    const out = document.createElement("canvas");
    out.width = Math.max(1, Math.round(source.width * scale));
    out.height = Math.max(1, Math.round(source.height * scale));
    out.getContext("2d").drawImage(source, 0, 0, out.width, out.height);
    return out;
  }

  /* 矩形領域の座標をキャンバス範囲内に丸める */
  function clampBox(offCanvas, x0, y0, w, h) {
    const cx0 = Math.max(0, Math.floor(x0));
    const cy0 = Math.max(0, Math.floor(y0));
    const cw = Math.min(offCanvas.width - cx0, Math.ceil(w));
    const ch = Math.min(offCanvas.height - cy0, Math.ceil(h));
    return { x0: cx0, y0: cy0, w: cw, h: ch };
  }

  /* コードの背景色 (クワイエットゾーン) と本体色を、それぞれ専用の領域から抽出する。
   * 背景色は inner (コード本体の矩形) の外側・outer の内側の「クワイエットゾーンの輪」
   * だけを平均する。以前は inner 全体を明暗2群に単純分割していたため、コード内部の
   * モジュールの色が混ざり込みコントラストが落ちていた。
   * 本体色は、inner 内の画素のうち背景色から最も離れた側 (中央値で分割) を採用する。
   * 輝度の明暗ではなく実測した背景色からの距離で判定するため、背景が暗色・コードが
   * 明色の反転配色でも正しく本体色/背景色を判別できる。 */
  function sampleScanColorsDual(offCanvas, inner, outer) {
    if (outer.w < 1 || outer.h < 1 || inner.w < 1 || inner.h < 1) return null;
    const ctx2d = offCanvas.getContext("2d");
    const outerData = ctx2d.getImageData(outer.x0, outer.y0, outer.w, outer.h).data;
    const bgSum = [0, 0, 0];
    let bgN = 0;
    for (let y = 0; y < outer.h; y++) {
      const py = outer.y0 + y;
      const insideInnerY = py >= inner.y0 && py < inner.y0 + inner.h;
      for (let x = 0; x < outer.w; x++) {
        if (insideInnerY) {
          const px = outer.x0 + x;
          if (px >= inner.x0 && px < inner.x0 + inner.w) continue;
        }
        const idx = (y * outer.w + x) * 4;
        bgSum[0] += outerData[idx]; bgSum[1] += outerData[idx + 1]; bgSum[2] += outerData[idx + 2];
        bgN++;
      }
    }
    if (bgN === 0) return null;
    const bgRef = [bgSum[0] / bgN, bgSum[1] / bgN, bgSum[2] / bgN];

    const innerData = ctx2d.getImageData(inner.x0, inner.y0, inner.w, inner.h).data;
    const dists = new Float32Array(innerData.length / 4);
    for (let i = 0, j = 0; i < innerData.length; i += 4, j++) {
      const dr = innerData[i] - bgRef[0], dg = innerData[i + 1] - bgRef[1], db = innerData[i + 2] - bgRef[2];
      dists[j] = dr * dr + dg * dg + db * db;
    }
    const sortedDists = Array.from(dists).sort((a, b) => a - b);
    const median = sortedDists[Math.floor(sortedDists.length / 2)];
    const fgSum = [0, 0, 0];
    let fgN = 0;
    for (let i = 0, j = 0; i < innerData.length; i += 4, j++) {
      if (dists[j] > median) {
        fgSum[0] += innerData[i]; fgSum[1] += innerData[i + 1]; fgSum[2] += innerData[i + 2];
        fgN++;
      }
    }
    const toHex = (sum, n) => {
      if (n === 0) return null;
      return `#${sum.map((v) => Math.round(v / n).toString(16).padStart(2, "0")).join("")}`;
    };
    return { fg: toHex(fgSum, fgN), bg: toHex(bgSum, bgN) };
  }

  /* 読み取ったコードの本体色・背景色を、ZXing の結果点群 (位置検出パターン等) から
     推定した矩形をもとに抽出する */
  function sampleScanColors(offCanvas, points) {
    if (!points || points.length === 0) return null;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of points) {
      const x = p.getX(), y = p.getY();
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
    /* 結果点群 (位置検出パターンの中心) はコード端から約3.5モジュール内側に
       あるため、コード全体を覆うには spanX/spanY だけでは足りない。この
       「あと何モジュール分外側まで広げるべきか」の必要割合はモジュール数
       (=コードの複雑さ) に反比例するため、span に対する固定割合では
       低モジュール数のコードには不足し、高モジュール数のコードには過剰になる。
       そこで、実際にキャンバス上でコード外側に残っている余白 (finder 矩形から
       キャンバス端までの距離) を上限として使い、どちらのケースでも
       背景の輪が潰れたり本体色に汚染されたりしないようにする。 */
    const spanX = maxX - minX, spanY = maxY - minY;
    const marginX = Math.min(minX, offCanvas.width - maxX);
    const marginY = Math.min(minY, offCanvas.height - maxY);
    const innerPadX = Math.min(spanX * 0.35, marginX * 0.6);
    const innerPadY = Math.min(spanY * 0.35, marginY * 0.6);
    const outerPadX = Math.min(spanX * 0.6, marginX * 0.9);
    const outerPadY = Math.min(spanY * 0.6, marginY * 0.9);
    const inner = clampBox(offCanvas, minX - innerPadX, minY - innerPadY, spanX + innerPadX * 2, spanY + innerPadY * 2);
    const outer = clampBox(offCanvas, minX - outerPadX, minY - outerPadY, spanX + outerPadX * 2, spanY + outerPadY * 2);
    return sampleScanColorsDual(offCanvas, inner, outer);
  }

  const AppUtil = {
    getRmqrIndex,
    rmqrWidthsFor,
    rmqrVersionOf,
    makeSegButton,
    makeToggle,
    makeNote,
    gridDims,
    splitEvenly,
    captionFontFromScale,
    truncateToWidth,
    wrapToLines,
    wrapMonospace,
    fitCaptionLines,
    captionFontRange,
    drawCaptionBand,
    scaleCanvasTo,
    clampBox,
    sampleScanColorsDual,
    sampleScanColors,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = AppUtil;
  } else {
    global.AppUtil = AppUtil;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
