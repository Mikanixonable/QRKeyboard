/* コードジェネレーター UI */
(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const canvas = $("qr-canvas");
  const ctx = canvas.getContext("2d");
  const qrCard = $("qr-card");
  const qrMessage = $("qr-message");
  const infoEl = $("info");
  const dataInput = $("data-input");
  const editReset = $("edit-reset");

  const MODE_NAMES = { numeric: "数字", alphanumeric: "英数字", byte: "バイト (UTF-8)" };
  const QR_FAMILY = ["qr", "micro", "rmqr"];

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

  /* 規格ごとの選択状態 */
  const state = {
    standard: "qr",
    fg: "#000000",
    bg: "#ffffff",
    outerBg: "#e5e7eb",
    outerSame: false,
    splitMode: "simple", // "simple" | "structured" (QR の Structured Append)
    showContent: true,
    contentPlacement: "combined", // "each" | "combined" | "both" (複数コード表示時のみ有効)
    qr: { ec: "M", versionAuto: true, version: 5, maskAuto: true, mask: 0 },
    micro: { ec: "L", versionAuto: true, version: 4, maskAuto: true, mask: 0 },
    rmqr: { ec: "M", versionAuto: true, height: 11, width: 43 },
    datamatrix: { sizeAuto: true, size: 4 },
    aztec: { ec: 1, versionAuto: true, version: 6 },
    barcode: { symbology: "code128", showText: true },
  };

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

  /* ---------- 誤り訂正コントロール ---------- */

  function microEcAvailable(st) {
    if (st.versionAuto) return ["L", "M", "Q"];
    return [["L"], ["L", "M"], ["L", "M"], ["L", "M", "Q"]][st.version - 1];
  }

  function buildEcControl() {
    const box = $("ec-control");
    box.textContent = "";
    const std = state.standard;
    const st = state[std];
    $("ec-field").hidden = std === "barcode";

    if (std === "datamatrix") {
      box.appendChild(makeNote("ECC 200 (リード・ソロモン符号) — 規格で固定です"));
      return;
    }
    if (std === "aztec") {
      [["10%", 0], ["23% (推奨)", 1], ["36%", 2], ["50%", 3]].forEach(([label, idx]) => {
        box.appendChild(makeSegButton(label, st.ec === idx, () => {
          st.ec = idx;
          rebuildControls();
          render();
        }));
      });
      return;
    }
    if (std === "barcode") return;

    const options = {
      qr: [["L (7%)", "L"], ["M (15%)", "M"], ["Q (25%)", "Q"], ["H (30%)", "H"]],
      micro: [["L", "L"], ["M", "M"], ["Q", "Q"]],
      rmqr: [["M (15%)", "M"], ["H (30%)", "H"]],
    }[std];
    const available = std === "micro" ? microEcAvailable(st) : null;
    for (const [label, v] of options) {
      const btn = makeSegButton(label, st.ec === v, () => {
        st.ec = v;
        rebuildControls();
        render();
      });
      if (available && !available.includes(v)) btn.disabled = true;
      box.appendChild(btn);
    }
    if (std === "micro" && !st.versionAuto && st.version === 1) {
      box.appendChild(makeNote("M1 は誤り検出のみ"));
    }
  }

  /* ---------- 複雑度(型番)コントロール ---------- */

  function buildVersionControl() {
    const box = $("version-control");
    const label = $("version-label");
    box.textContent = "";
    const std = state.standard;
    const st = state[std];
    label.textContent = std === "barcode" ? "種類" : "複雑度(型番)";

    if (std === "barcode") {
      const seg = document.createElement("div");
      seg.className = "segmented";
      [["JAN / EAN-13", "ean13"], ["Code 128", "code128"], ["Code 39", "code39"], ["GS1 DataBar-14", "gs1databar"]].forEach(([name, sym]) => {
        seg.appendChild(makeSegButton(name, st.symbology === sym, () => {
          st.symbology = sym;
          rebuildControls();
          render();
        }));
      });
      box.appendChild(seg);
      return;
    }

    const autoKey = std === "datamatrix" ? "sizeAuto" : "versionAuto";
    const setAuto = () => {
      st[autoKey] = true;
      if (std === "micro") normalizeMicroEc();
      rebuildControls();
      render();
    };

    const resolved = current && current.results[0];

    if (std === "qr") {
      const items = [{ label: "自動", checked: st.versionAuto, onClick: setAuto, full: true }];
      for (let v = 1; v <= 40; v++) {
        items.push({
          label: String(v),
          checked: st.versionAuto ? !!resolved && resolved.version === v : st.version === v,
          onClick: () => {
            st.versionAuto = false;
            st.version = v;
            rebuildControls();
            render();
          },
        });
      }
      box.appendChild(makeTileGrid(items));
      return;
    } else if (std === "micro") {
      const seg = document.createElement("div");
      seg.className = "segmented";
      const autoBtn = makeSegButton("自動", st.versionAuto, setAuto);
      autoBtn.classList.add("seg-btn-full");
      seg.appendChild(autoBtn);
      for (let v = 1; v <= 4; v++) {
        seg.appendChild(makeSegButton(`M${v}`, !st.versionAuto && st.version === v, () => {
          st.versionAuto = false;
          st.version = v;
          normalizeMicroEc();
          rebuildControls();
          render();
        }));
      }
      box.appendChild(seg);
    } else if (std === "rmqr") {
      // 高さ・幅の2パラメーターで決まるため、最初から2次元タイルを右メニューゾーンに表示する
      const seg = document.createElement("div");
      seg.className = "segmented";
      const autoBtn = makeSegButton("自動", st.versionAuto, setAuto);
      autoBtn.classList.add("seg-btn-full");
      seg.appendChild(autoBtn);
      box.appendChild(seg);
      box.appendChild(buildRmqrTileGrid());
      return;
    } else if (std === "datamatrix") {
      const items = [{ label: "自動", checked: st.sizeAuto, onClick: setAuto, full: true }];
      DMLib.SIZES.forEach((s, i) => {
        items.push({
          label: s.h === s.w ? String(s.h) : DMLib.SIZE_NAMES[i],
          title: `${DMLib.SIZE_NAMES[i]} (${s.data} 語)${s.rect ? " ・長方形" : ""}`,
          checked: st.sizeAuto ? !!resolved && resolved.sizeIndex === i + 1 : st.size === i + 1,
          onClick: () => {
            st.sizeAuto = false;
            st.size = i + 1;
            rebuildControls();
            render();
          },
        });
      });
      box.appendChild(makeTileGrid(items, "minmax(38px, 1fr)"));
      return;
    } else if (std === "aztec") {
      const items = [{ label: "自動", checked: st.versionAuto, onClick: setAuto, full: true }];
      for (let l = 1; l <= 4; l++) {
        const dim = 11 + 4 * l;
        items.push({
          label: `C${l}`,
          title: `コンパクト ${l}層 (${dim}×${dim})`,
          checked: st.versionAuto ? !!resolved && resolved.version === l : st.version === l,
          onClick: () => { st.versionAuto = false; st.version = l; rebuildControls(); render(); },
        });
      }
      const fullDims = [66, 64, 62, 60, 57, 55, 53, 51, 49, 47, 45, 42, 40, 38, 36, 34,
        32, 30, 28, 25, 23, 21, 19, 17, 15, 13, 10, 8, 6, 4, 2, 0];
      for (let l = 1; l <= 32; l++) {
        const dim = 151 - 2 * fullDims[l - 1];
        const v = l + 4;
        items.push({
          label: `F${l}`,
          title: `フル ${l}層 (${dim}×${dim})`,
          checked: st.versionAuto ? !!resolved && resolved.version === v : st.version === v,
          onClick: () => { st.versionAuto = false; st.version = v; rebuildControls(); render(); },
        });
      }
      box.appendChild(makeTileGrid(items));
      return;
    }
  }

  /* ---------- タイル選択UI (クリック数を減らすため、最初から選択肢を表示する) ---------- */

  function makeTileGrid(items, colWidth) {
    const grid = document.createElement("div");
    grid.className = "tile-grid";
    grid.setAttribute("role", "radiogroup");
    if (colWidth) grid.style.gridTemplateColumns = `repeat(auto-fill, minmax(${colWidth === true ? "28px" : colWidth}, 1fr))`;
    for (const item of items) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = item.full ? "tile tile-full" : "tile";
      btn.setAttribute("role", "radio");
      btn.setAttribute("aria-checked", item.checked ? "true" : "false");
      btn.disabled = !!item.disabled;
      btn.textContent = item.label;
      if (item.title) btn.title = item.title;
      btn.addEventListener("click", item.onClick);
      grid.appendChild(btn);
    }
    return grid;
  }

  /* rMQR: 高さ×幅の2次元タイル。列(幅)は左ほど小さく、行(高さ)は上ほど単純・小さい選択肢にする */
  const RMQR_TILE_WIDTHS = [27, 43, 59, 77, 99, 139];
  const RMQR_TILE_HEIGHTS = [7, 9, 11, 13, 15, 17];

  function buildRmqrTileGrid() {
    const st = state.rmqr;
    const resolved = current && current.results[0];
    const grid = document.createElement("div");
    grid.className = "tile-grid-2d";
    grid.style.gridTemplateColumns = `auto repeat(${RMQR_TILE_WIDTHS.length}, 1fr)`;

    grid.appendChild(document.createElement("span"));
    for (const w of RMQR_TILE_WIDTHS) {
      const lbl = document.createElement("span");
      lbl.className = "tile-axis-label";
      lbl.textContent = w;
      grid.appendChild(lbl);
    }
    for (const h of RMQR_TILE_HEIGHTS) {
      const hLbl = document.createElement("span");
      hLbl.className = "tile-axis-label";
      hLbl.textContent = `R${h}`;
      grid.appendChild(hLbl);
      const validWidths = rmqrWidthsFor(h);
      for (const w of RMQR_TILE_WIDTHS) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "tile";
        btn.setAttribute("role", "radio");
        if (!validWidths.includes(w)) {
          btn.disabled = true;
          btn.setAttribute("aria-checked", "false");
          grid.appendChild(btn);
          continue;
        }
        const isChecked = st.versionAuto
          ? !!resolved && resolved.height === h && resolved.width === w
          : st.height === h && st.width === w;
        btn.setAttribute("aria-checked", isChecked ? "true" : "false");
        btn.title = `R${h} × ${w}`;
        btn.textContent = String(w);
        btn.addEventListener("click", () => {
          st.versionAuto = false;
          st.height = h;
          st.width = w;
          rebuildControls();
          render();
        });
        grid.appendChild(btn);
      }
    }
    return grid;
  }

  /* ---------- マスクコントロール ---------- */

  function buildMaskControl() {
    const box = $("mask-control");
    box.textContent = "";
    const std = state.standard;
    const st = state[std];
    $("mask-field").hidden = !QR_FAMILY.includes(std);
    if ($("mask-field").hidden) return;

    if (std === "rmqr") {
      box.className = "segmented";
      box.style.gridTemplateColumns = "";
      box.appendChild(makeNote("rMQR のマスクは規格で固定です ((⌊y/2⌋+⌊x/3⌋) mod 2 = 0)"));
      return;
    }
    box.className = "segmented mask-grid";
    box.style.gridTemplateColumns = `repeat(${std === "qr" ? 8 : 4}, 1fr)`;
    box.appendChild(makeSegButton("自動", st.maskAuto, () => {
      st.maskAuto = true;
      rebuildControls();
      render();
    }));
    const count = std === "qr" ? 8 : 4;
    for (let m = 0; m < count; m++) {
      box.appendChild(makeSegButton(String(m), !st.maskAuto && st.mask === m, () => {
        st.maskAuto = false;
        st.mask = m;
        rebuildControls();
        render();
      }));
    }
  }

  function normalizeMicroEc() {
    const st = state.micro;
    const available = microEcAvailable(st);
    if (!available.includes(st.ec)) st.ec = available[available.length - 1];
  }

  function buildBarcodeTextControl() {
    const field = $("barcode-text-field");
    const box = $("barcode-text-control");
    const std = state.standard;
    field.hidden = std !== "barcode";
    if (field.hidden) return;
    box.textContent = "";
    const st = state[std];
    box.appendChild(makeToggle(st.showText, (checked) => {
      st.showText = checked;
      render();
    }, "バーコードの下に数字を表示"));
  }

  function buildSplitModeControl() {
    const field = $("split-mode-field");
    const box = $("split-mode-control");
    const std = state.standard;
    field.hidden = std !== "qr";
    if (field.hidden) return;
    box.textContent = "";
    [["シンプル分割", "simple"], ["Structured Append", "structured"]].forEach(([label, v]) => {
      box.appendChild(makeSegButton(label, state.splitMode === v, () => {
        state.splitMode = v;
        rebuildControls();
        render();
      }));
    });
  }

  function buildContentDisplayControl() {
    const field = $("content-display-field");
    const box = $("content-placement-control");
    const std = state.standard;
    field.hidden = std === "barcode";
    if (field.hidden) return;
    const n = current ? current.results.length : 1;
    const structuredNow = std === "qr" && current && current.results[0] && current.results[0].structured;
    box.hidden = !(n > 1 && !structuredNow);
    if (box.hidden) return;
    box.textContent = "";
    [["各コードの下", "each"], ["全体の下に一つ", "combined"], ["両方", "both"]].forEach(([label, v]) => {
      box.appendChild(makeSegButton(label, state.contentPlacement === v, () => {
        state.contentPlacement = v;
        rebuildControls();
        drawCurrent();
        renderInfo();
      }));
    });
  }

  function rebuildControls() {
    $("preview").classList.toggle("other-standard", !QR_FAMILY.includes(state.standard));
    buildEcControl();
    buildVersionControl();
    buildMaskControl();
    buildBarcodeTextControl();
    buildSplitModeControl();
    buildContentDisplayControl();
  }

  /* ---------- エンコード ---------- */

  function encodeOne(std, text, structuredOpts) {
    const st = state[std];
    switch (std) {
      case "qr":
      case "micro": {
        const opts = {
          standard: std, text, ecLevel: st.ec,
          version: st.versionAuto ? 0 : st.version,
          mask: st.maskAuto ? -1 : st.mask,
        };
        if (structuredOpts && std === "qr") opts.structured = structuredOpts;
        return QRLib.encode(opts);
      }
      case "rmqr":
        return QRLib.encode({
          standard: "rmqr", text, ecLevel: st.ec,
          version: st.versionAuto ? 0 : rmqrVersionOf(st.height, st.width),
        });
      case "datamatrix":
        return DMLib.encode({ text, size: st.sizeAuto ? 0 : st.size });
      case "aztec":
        return AZLib.encode({ text, ecIndex: st.ec, version: st.versionAuto ? 0 : st.version });
      case "barcode":
        return BARLib.encode({ symbology: st.symbology, text });
    }
  }

  /* 文字数ベースの均等分割 (structured append 時も含め、境界はコードポイント単位) */
  function splitEvenly(text, count) {
    const per = Math.ceil(text.length / count);
    const chunks = [];
    for (let i = 0; i < text.length; i += per) chunks.push(text.slice(i, i + per));
    return chunks;
  }

  /* 容量オーバー時は複数コードに分割する。QR 表示域の大きさは変えず、
     各コードを縮小してグリッド配置する (drawCurrent 側で対応)。
     戻り値は { results, texts } (texts は各コードに実際にエンコードした元テキスト) */
  function runEncodeMulti() {
    const std = state.standard;
    const text = dataInput.value;
    try {
      return { results: [encodeOne(std, text, null)], texts: [text] };
    } catch (e) {
      if (!(e && e.code === "TOO_LONG") || std === "barcode") throw e;
    }
    const structuredEligible = std === "qr" && state.splitMode === "structured";
    /* Structured Append は ISO/IEC 18004 で16記号までと規定されているが、
       シンプル分割にはコード数の上限がないため、1文字/コードになるまで試す */
    const maxCount = structuredEligible ? 16 : Math.max(2, text.length);
    let lastErr = null;
    let lastChunkCount = -1;
    for (let count = 2; count <= maxCount; count++) {
      const chunks = splitEvenly(text, count);
      /* Structured Append はヘッダーに記号数を厳密に埋め込むため、
         端数処理で実際の分割数が count と一致しない場合はそのまま使えない */
      if (structuredEligible && chunks.length !== count) continue;
      /* 端数処理で前回と同じ分割結果になる場合は再試行しても無駄なのでスキップ */
      if (chunks.length === lastChunkCount) continue;
      lastChunkCount = chunks.length;
      try {
        const parity = structuredEligible ? QRLib.computeParity(text) : null;
        const results = chunks.map((chunk, i) =>
          encodeOne(std, chunk, structuredEligible ? { index: i, count: chunks.length, parity } : null));
        return { results, texts: chunks };
      } catch (e) {
        if (e && e.code === "TOO_LONG") { lastErr = e; continue; }
        throw e;
      }
    }
    if (lastErr) throw lastErr;
    const err = new Error("分割してもデータが大きすぎます");
    err.code = "TOO_LONG";
    throw err;
  }

  /* コード数から縦横のグリッド分割数を決める (正方形に近くなるように) */
  function gridDims(n) {
    const cols = Math.ceil(Math.sqrt(n));
    const rows = Math.ceil(n / cols);
    return { cols, rows };
  }

  /* ---------- 描画 ---------- */

  let current = null; // { results[], modulesList[](編集用コピー), edited }
  let lastDraw = null; // クリック座標→モジュール変換用 (単一コードの場合のみ)

  /* コード端(クワイエットゾーン)からQR表示UI端までの最低距離。全規格で共通 */
  const CANVAS_MARGIN = 16;
  /* 複数コード表示時の、コード間の最低間隔 */
  const GRID_GAP = 6;

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

  function drawCurrent() {
    if (!current) return;
    const results = current.results;
    const box = qrCard.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const availW = Math.max(40, box.width - CANVAS_MARGIN * 2) * dpr;
    const availH = Math.max(40, box.height - CANVAS_MARGIN * 2) * dpr;

    qrCard.style.background = state.outerSame ? state.bg : state.outerBg;

    if (results.length === 1 && results[0].type === "linear") {
      const r = results[0];
      const showText = state.barcode.showText;
      const totalW = r.quietLeft + r.width + r.quietRight;
      const scale = Math.max(1, Math.floor(availW / totalW));
      const textH = showText ? Math.round(16 * scale) : 0;
      const barH = Math.max(30 * dpr, Math.min(availH - 8 * dpr - textH, Math.round(totalW * scale * 0.3)));
      canvas.width = totalW * scale;
      canvas.height = barH + 16 * scale + textH;
      canvas.style.width = `${canvas.width / dpr}px`;
      canvas.style.height = `${canvas.height / dpr}px`;
      ctx.fillStyle = state.bg;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = state.fg;
      for (let x = 0; x < r.width; x++) {
        if (r.pattern[x]) {
          ctx.fillRect((r.quietLeft + x) * scale, 8 * scale, scale, barH);
        }
      }
      if (showText) {
        ctx.font = `${Math.round(12 * scale)}px monospace`;
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.fillText(r.display, canvas.width / 2, barH + 8 * scale + 2 * scale, totalW * scale);
      }
      lastDraw = null;
      return;
    }

    if (results.length === 1) {
      const r = results[0];
      const showCaption = effectivePlacement() === "each";
      const qz = r.quietZone;
      const mw = r.width + qz * 2;
      const mh = r.height + qz * 2;
      const outerColor = state.outerSame ? state.bg : state.outerBg;
      const fontPxBase = Math.round(12 * dpr);
      const fontPxMin = Math.round(8 * dpr);

      /* キャプション幅は最終的なコード幅 (mw*scale) に依存し、その幅は
         キャプションの高さにも依存するため、収束するまで数回計算し直す。
         行数上限に収まらない場合は、収まるまでフォントを縮小する。 */
      let scale = Math.max(1, Math.floor(Math.min(availW / mw, availH / mh)));
      let lines = [];
      let captionFontPx = fontPxBase;
      let captionH = 0;
      if (showCaption) {
        for (let iter = 0; iter < 4; iter++) {
          const maxW = Math.max(20, mw * scale - 8 * dpr);
          const fit = fitCaptionLines(ctx, perCodeContentText(0), maxW, 3, fontPxBase, fontPxMin);
          captionFontPx = fit.fontPx;
          lines = fit.lines;
          const lineH = Math.round(captionFontPx * 1.4);
          const newCaptionH = lines.length * lineH + Math.round(6 * dpr);
          const newScale = Math.max(1, Math.floor(Math.min(availW / mw, (availH - newCaptionH) / mh)));
          captionH = newCaptionH;
          if (newScale === scale) break;
          scale = newScale;
        }
      }
      canvas.width = mw * scale;
      canvas.height = mh * scale + captionH;
      canvas.style.width = `${canvas.width / dpr}px`;
      canvas.style.height = `${canvas.height / dpr}px`;
      /* 背景色 (外側) を全体に敷き、その上にクワイエットゾーン込みのコード面だけ塗る。
         内容表示はクワイエットゾーンの外 (背景色の上) に表示されるようにする。 */
      ctx.fillStyle = outerColor;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = state.bg;
      ctx.fillRect(0, 0, mw * scale, mh * scale);
      ctx.fillStyle = state.fg;
      const modules = current.modulesList[0];
      for (let y = 0; y < r.height; y++) {
        const row = modules[y];
        for (let x = 0; x < r.width; x++) {
          if (row[x]) ctx.fillRect((x + qz) * scale, (y + qz) * scale, scale, scale);
        }
      }
      if (showCaption) {
        ctx.font = `${captionFontPx}px monospace`;
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        const maxW = canvas.width - 8 * dpr;
        const lineH = Math.round(captionFontPx * 1.4);
        lines.forEach((line, i) => {
          ctx.fillText(line, canvas.width / 2, mh * scale + 3 * dpr + i * lineH, maxW);
        });
      }
      lastDraw = { scale, qz, dpr };
      return;
    }

    /* 複数コード: QR 表示域の大きさは変えず、グリッドに縮小配置する。編集は非対応。 */
    const n = results.length;
    const placement = effectivePlacement();
    const showCaptions = placement === "each" || placement === "both";
    const showCombined = placement === "combined" || placement === "both";
    const { cols, rows } = gridDims(n);
    const gap = GRID_GAP * dpr;
    const outerColor = state.outerSame ? state.bg : state.outerBg;

    const cellFontPxBase = Math.round(10 * dpr);
    const cellFontPxMin = Math.round(7 * dpr);
    const cellWEstimate = (availW - gap * (cols - 1)) / cols;
    /* 全コードのキャプションが2行に収まる、共通で使える最大フォントサイズを探す */
    let cellFontPx = cellFontPxBase;
    let cellLines = [];
    if (showCaptions) {
      for (let px = cellFontPxBase; px >= cellFontPxMin; px--) {
        ctx.font = `${px}px monospace`;
        let allFit = true;
        const trial = results.map((_, i) => {
          const result = wrapToLines(ctx, perCodeContentText(i), cellWEstimate - 4 * dpr, 2);
          if (result.truncated) allFit = false;
          return result.lines;
        });
        cellFontPx = px;
        cellLines = trial;
        if (allFit) break;
      }
    }
    const cellLineH = Math.round(cellFontPx * 1.4);
    const maxCellLines = showCaptions ? Math.max(...cellLines.map((l) => l.length)) : 0;
    const captionH = showCaptions ? maxCellLines * cellLineH + Math.round(4 * dpr) : 0;

    const combinedFontPxBase = Math.round(10 * dpr);
    const combinedFontPxMin = Math.round(7 * dpr);
    const combinedRaw = combinedContentText();
    const combinedFit = showCombined
      ? fitCaptionLines(ctx, combinedRaw == null ? "(読み取り不能)" : combinedRaw, availW - 8 * dpr, 2, combinedFontPxBase, combinedFontPxMin)
      : { fontPx: combinedFontPxBase, lines: [] };
    const combinedFontPx = combinedFit.fontPx;
    const combinedLines = combinedFit.lines;
    const combinedLineH = Math.round(combinedFontPx * 1.4);
    const combinedH = showCombined ? combinedLines.length * combinedLineH + Math.round(6 * dpr) : 0;

    const gridAvailH = availH - combinedH;
    const cellW = (availW - gap * (cols - 1)) / cols;
    const cellH = (gridAvailH - gap * (rows - 1)) / rows - captionH;
    const dims = results.map((r) => ({ mw: r.width + r.quietZone * 2, mh: r.height + r.quietZone * 2 }));
    let scale = Infinity;
    for (const { mw, mh } of dims) scale = Math.min(scale, Math.floor(Math.min(cellW / mw, cellH / mh)));
    scale = Math.max(1, scale);

    canvas.width = Math.round(availW);
    canvas.height = Math.round(availH);
    canvas.style.width = `${canvas.width / dpr}px`;
    canvas.style.height = `${canvas.height / dpr}px`;
    /* 背景色 (外側) を全体に敷き、各コードのクワイエットゾーン込みの面だけ塗る。
       内容表示はクワイエットゾーンの外 (背景色の上) に表示されるようにする。 */
    ctx.fillStyle = outerColor;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = state.fg;
    for (let i = 0; i < n; i++) {
      const r = results[i];
      const { mw, mh } = dims[i];
      const col = i % cols, row = Math.floor(i / cols);
      const cellX = col * (cellW + gap);
      const cellY = row * (cellH + captionH + gap);
      const offX = cellX + (cellW - mw * scale) / 2;
      const offY = cellY + (cellH - mh * scale) / 2;
      const qz = r.quietZone;
      ctx.fillStyle = state.bg;
      ctx.fillRect(offX, offY, mw * scale, mh * scale);
      ctx.fillStyle = state.fg;
      const modules = current.modulesList[i];
      for (let y = 0; y < r.height; y++) {
        const rowData = modules[y];
        for (let x = 0; x < r.width; x++) {
          if (rowData[x]) ctx.fillRect(offX + (x + qz) * scale, offY + (y + qz) * scale, scale, scale);
        }
      }
      if (showCaptions) {
        ctx.font = `${cellFontPx}px monospace`;
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        const maxW = cellW - 4 * dpr;
        cellLines[i].forEach((line, li) => {
          ctx.fillText(line, cellX + cellW / 2, cellY + cellH + 2 * dpr + li * cellLineH, maxW);
        });
      }
    }
    if (showCombined) {
      ctx.font = `${combinedFontPx}px monospace`;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      const maxW = availW - 8 * dpr;
      combinedLines.forEach((line, li) => {
        ctx.fillText(line, canvas.width / 2, gridAvailH + 3 * dpr + li * combinedLineH, maxW);
      });
    }
    lastDraw = null;
  }

  /* ---------- 内容表示 (コード下に表示するかはユーザーが選択) ---------- */

  /* 複数コード時、各コードの下/全体の下に一つ/両方 のどれを使うか。
     Structured Append は各コード単体に意味のある内容がないため常に「全体の下に一つ」。 */
  function effectivePlacement() {
    if (!state.showContent || !current) return "none";
    if (current.results.length === 1) return "each";
    const structuredNow = state.standard === "qr" && current.results[0].structured;
    return structuredNow ? "combined" : state.contentPlacement;
  }

  /* 個々のコードの内容 (QR 系は行列からリアルタイム復号、それ以外は元テキストの断片)。
     drawCurrent/renderInfo が同じ current に対して何度も呼ばれる (キャプション幅の
     収束計算や色変更時の再描画など) ため、current ごとにキャッシュして毎回の再復号を避ける */
  function decodedTextAt(i) {
    if (!current._decodedCache) current._decodedCache = [];
    if (current._decodedCache[i] === undefined) {
      try {
        current._decodedCache[i] = QRLib.decode(current.modulesList[i], state.standard).text;
      } catch (e) {
        current._decodedCache[i] = null;
      }
    }
    return current._decodedCache[i];
  }

  function perCodeContentText(i) {
    const std = state.standard;
    if (QR_FAMILY.includes(std)) {
      const text = decodedTextAt(i);
      return text === null ? "(読み取り不能)" : text;
    }
    return current.texts[i];
  }

  function combinedContentText() {
    const std = state.standard;
    if (QR_FAMILY.includes(std)) {
      const texts = current.results.map((_, i) => decodedTextAt(i));
      return texts.some((t) => t === null) ? null : texts.join("");
    }
    return dataInput.value;
  }

  /* ---------- 情報表示 (諸元) ---------- */

  function renderInfo() {
    infoEl.textContent = "";
    if (!current) return;
    const std = state.standard;
    const st = state[std];
    const results = current.results;
    const r = results[0];
    const items = [];
    const sizeText = `${r.width}×${r.height}`;

    const contentValue = combinedContentText();
    items.push(["内容", contentValue == null ? "(読み取り不能)" : contentValue === "" ? "(空)" : contentValue]);

    if (results.length > 1) {
      const modeName = std === "qr" && state.splitMode === "structured" ? "Structured Append" : "シンプル分割";
      items.push(["分割", `${results.length} 個 (${modeName})`]);
    }

    if (std === "qr" || std === "micro" || std === "rmqr") {
      const auto = st.versionAuto ? "自動 → " : "";
      items.push(["型番", `${auto}${std === "qr" ? r.version : r.versionName} (${sizeText})`]);
      items.push(["モード", MODE_NAMES[r.mode]]);
      items.push(["誤り訂正", std === "micro" && r.version === 1 ? "M1 (誤り検出のみ)" : r.ecLevel]);
      if (r.mask == null) items.push(["マスク", "固定"]);
      else items.push(["マスク", `${st.maskAuto ? "自動 → " : ""}${r.mask}`]);
      items.push(["データ", `${r.usedBits} / ${r.capacityBits} bit`]);
      items.push(["コード語", `データ ${r.dataCodewords} + 訂正 ${r.totalCodewords - r.dataCodewords}`]);
    } else if (std === "datamatrix") {
      items.push(["サイズ", `${st.sizeAuto ? "自動 → " : ""}${r.versionName}`]);
      items.push(["データ", `${r.usedCodewords} / ${r.dataCodewords} 語`]);
      items.push(["訂正コード語", String(r.eccCodewords)]);
      items.push(["方式", "ECC 200"]);
    } else if (std === "aztec") {
      items.push(["サイズ", `${st.versionAuto ? "自動 → " : ""}${r.versionName}`]);
      items.push(["データ", `${r.usedBits} / ${r.capacityBits} bit`]);
      items.push(["コード語", `データ ${r.dataCodewords} + 訂正 ${r.eccCodewords} (${r.codewordBits}bit語)`]);
      items.push(["実効訂正率", `${r.eccPercent}%`]);
    } else if (std === "barcode") {
      items.push(["種類", r.versionName]);
      items.push(["幅", `${r.width} モジュール`]);
    }
    let contentDd = null;
    items.forEach(([dt, dd], i) => {
      const div = document.createElement("div");
      const dtEl = document.createElement("dt");
      const ddEl = document.createElement("dd");
      if (i === 0) {
        div.className = "info-content"; // 内容: 枠からはみ出さないよう改行する
        contentDd = ddEl;
      }
      dtEl.textContent = dt;
      ddEl.textContent = dd;
      div.append(dtEl, ddEl);
      infoEl.appendChild(div);
    });
    /* 2行に収まらない場合は、収まるまでフォントサイズを縮小する */
    if (contentDd) {
      for (let px = 12; px >= 8; px--) {
        contentDd.style.fontSize = `${px}px`;
        if (contentDd.scrollHeight <= contentDd.clientHeight + 1) break;
      }
    }
  }

  /* ---------- レンダリング統括 ---------- */

  function showError(message) {
    current = null;
    lastDraw = null;
    canvas.hidden = true;
    qrMessage.hidden = false;
    qrMessage.textContent = message;
    /* info は非表示にせず空にするだけにして、
       QR 表示域 (qr-frame) の高さがエラー時にも変化しないようにする */
    infoEl.textContent = "";
    editReset.hidden = true;
    qrCard.style.background = state.outerSame ? state.bg : state.outerBg;
    buildContentDisplayControl();
    buildVersionControl();
  }

  function render() {
    const std = state.standard;
    try {
      const { results, texts } = runEncodeMulti();
      current = {
        results,
        texts,
        modulesList: results.map((res) => res.modules.map((row) => row.slice())),
        edited: false,
      };
      canvas.hidden = false;
      qrMessage.hidden = true;
      editReset.hidden = true;
      const editable = results.length === 1 && QR_FAMILY.includes(std);
      canvas.classList.toggle("editable", editable);
      buildContentDisplayControl();
      buildVersionControl();
      drawCurrent();
      renderInfo();
    } catch (e) {
      if (e && (e.code || e.name === "QREncodeError")) {
        showError(e.message);
      } else {
        showError("エンコードに失敗しました");
        console.error(e);
      }
    }
    syncUrl();
  }

  /* ---------- URLへの状態保存 (規格・内容・色・複雑度・誤り訂正・マスク・分割方式) ---------- */

  function syncUrl() {
    const std = state.standard;
    const st = state[std];
    const params = new URLSearchParams();
    params.set("std", std);
    params.set("text", dataInput.value);
    params.set("fg", state.fg);
    params.set("bg", state.bg);
    params.set("obg", state.outerBg);
    if (state.outerSame) params.set("same", "1");
    if (std === "qr" && state.splitMode !== "simple") params.set("split", state.splitMode);

    if (std === "qr" || std === "micro" || std === "rmqr") {
      params.set("ec", st.ec);
    } else if (std === "aztec") {
      params.set("ec", String(st.ec));
    }

    if (std === "rmqr") {
      if (!st.versionAuto) {
        params.set("h", String(st.height));
        params.set("w", String(st.width));
      }
    } else if (std === "qr" || std === "micro" || std === "datamatrix" || std === "aztec") {
      const autoKey = std === "datamatrix" ? "sizeAuto" : "versionAuto";
      if (!st[autoKey]) params.set("ver", String(std === "datamatrix" ? st.size : st.version));
    }

    if ((std === "qr" || std === "micro") && !st.maskAuto) {
      params.set("mask", String(st.mask));
    }

    if (std === "barcode") {
      params.set("sym", st.symbology);
      if (!st.showText) params.set("btxt", "0");
    }

    history.replaceState(null, "", "?" + params.toString());
  }

  const STANDARDS = ["qr", "micro", "rmqr", "datamatrix", "aztec", "barcode"];

  /* 起動時に URL のクエリパラメーターから状態を復元する。復元した規格名 (なければ null) を返す */
  function loadFromUrl() {
    const params = new URLSearchParams(location.search);
    const std = params.get("std");
    if (!STANDARDS.includes(std)) return null;

    if (params.has("text")) dataInput.value = params.get("text");
    if (params.has("fg")) state.fg = params.get("fg");
    if (params.has("bg")) state.bg = params.get("bg");
    if (params.has("obg")) state.outerBg = params.get("obg");
    state.outerSame = params.get("same") === "1";
    if (params.has("split")) state.splitMode = params.get("split");
    $("color-fg").value = state.fg;
    $("color-bg").value = state.bg;
    $("color-outer").value = state.outerBg;
    $("color-outer").disabled = state.outerSame;
    $("color-outer-same").checked = state.outerSame;

    const st = state[std];
    if (params.has("ec")) st.ec = std === "aztec" ? Number(params.get("ec")) : params.get("ec");

    if (std === "rmqr") {
      if (params.has("h") && params.has("w")) {
        const h = Number(params.get("h"));
        const w = Number(params.get("w"));
        // 高さ×幅の組み合わせが有効な場合のみ手動指定として採用する。
        // 不正な組み合わせを黙って自動選択にフォールバックすると、
        // UI 上のタイル選択表示と実際に生成されるコードが食い違うため、
        // ここで弾いて自動のままにする。
        if (rmqrVersionOf(h, w) !== 0) {
          st.versionAuto = false;
          st.height = h;
          st.width = w;
        }
      }
    } else if (params.has("ver")) {
      const autoKey = std === "datamatrix" ? "sizeAuto" : "versionAuto";
      const ver = Number(params.get("ver"));
      const maxVer = std === "qr" ? 40 : std === "micro" ? 4 : std === "datamatrix" ? DMLib.SIZES.length : 36;
      if (Number.isInteger(ver) && ver >= 1 && ver <= maxVer) {
        st[autoKey] = false;
        if (std === "datamatrix") st.size = ver;
        else st.version = ver;
      }
    }

    if ((std === "qr" || std === "micro") && params.has("mask")) {
      st.maskAuto = false;
      st.mask = Number(params.get("mask"));
    }

    if (std === "barcode") {
      if (params.has("sym")) st.symbology = params.get("sym");
      if (params.has("btxt")) st.showText = params.get("btxt") !== "0";
    }

    return std;
  }

  /* ---------- 編集 (単一の QR 系コードのみ) ---------- */

  canvas.addEventListener("click", (ev) => {
    if (!current || !lastDraw || current.results.length !== 1 || !QR_FAMILY.includes(state.standard)) return;
    const rect = canvas.getBoundingClientRect();
    const { scale, qz, dpr } = lastDraw;
    const x = Math.floor(((ev.clientX - rect.left) * dpr) / scale) - qz;
    const y = Math.floor(((ev.clientY - rect.top) * dpr) / scale) - qz;
    const r = current.results[0];
    if (x < 0 || y < 0 || x >= r.width || y >= r.height) return;
    const modules = current.modulesList[0];
    modules[y][x] ^= 1;
    current.edited = modules.some((row, yy) =>
      row.some((v, xx) => v !== r.modules[yy][xx]));
    editReset.hidden = !current.edited;
    drawCurrent();
    renderInfo();
  });

  editReset.addEventListener("click", () => {
    if (!current || current.results.length !== 1) return;
    current.modulesList[0] = current.results[0].modules.map((row) => row.slice());
    current.edited = false;
    editReset.hidden = true;
    drawCurrent();
    renderInfo();
  });

  /* ---------- 保存 (PNG / SVG) ---------- */

  function download(blob, filename) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  function filenameBase() {
    return `code-${state.standard}`;
  }

  /* PNG 描画を save-png とクリップボードコピーの両方から使えるように切り出す */
  function renderPngCanvas() {
    const results = current.results;
    const off = document.createElement("canvas");
    const octx = off.getContext("2d");
    if (results.length === 1 && results[0].type === "linear") {
      const r = results[0];
      const showText = state.barcode.showText;
      const scale = 4;
      const totalW = r.quietLeft + r.width + r.quietRight;
      const barH = Math.max(120, Math.round(totalW * scale * 0.3));
      const textH = showText ? 48 : 0;
      off.width = totalW * scale;
      off.height = barH + 40 + textH;
      octx.fillStyle = state.bg;
      octx.fillRect(0, 0, off.width, off.height);
      octx.fillStyle = state.fg;
      for (let x = 0; x < r.width; x++) {
        if (r.pattern[x]) octx.fillRect((r.quietLeft + x) * scale, 20, scale, barH);
      }
      if (showText) {
        octx.font = "36px monospace";
        octx.textAlign = "center";
        octx.textBaseline = "top";
        octx.fillText(r.display, off.width / 2, barH + 24, off.width);
      }
    } else if (results.length === 1) {
      const r = results[0];
      const qz = r.quietZone;
      const mw = r.width + qz * 2, mh = r.height + qz * 2;
      const scale = Math.max(4, Math.min(16, Math.floor(2048 / Math.max(mw, mh))));
      off.width = mw * scale;
      off.height = mh * scale;
      octx.fillStyle = state.bg;
      octx.fillRect(0, 0, off.width, off.height);
      octx.fillStyle = state.fg;
      for (let y = 0; y < r.height; y++) {
        for (let x = 0; x < r.width; x++) {
          if (current.modulesList[0][y][x]) octx.fillRect((x + qz) * scale, (y + qz) * scale, scale, scale);
        }
      }
    } else {
      const { cols, rows } = gridDims(results.length);
      const dims = results.map((r) => ({ mw: r.width + r.quietZone * 2, mh: r.height + r.quietZone * 2 }));
      const maxMw = Math.max(...dims.map((d) => d.mw));
      const maxMh = Math.max(...dims.map((d) => d.mh));
      const scale = Math.max(2, Math.min(16, Math.floor(2048 / (Math.max(maxMw, maxMh) * Math.max(cols, rows)))));
      const gap = 4 * scale;
      const cellW = maxMw * scale, cellH = maxMh * scale;
      off.width = cols * cellW + (cols - 1) * gap;
      off.height = rows * cellH + (rows - 1) * gap;
      octx.fillStyle = state.bg;
      octx.fillRect(0, 0, off.width, off.height);
      octx.fillStyle = state.fg;
      results.forEach((r, i) => {
        const qz = r.quietZone;
        const col = i % cols, row = Math.floor(i / cols);
        const baseX = col * (cellW + gap) + (cellW - dims[i].mw * scale) / 2;
        const baseY = row * (cellH + gap) + (cellH - dims[i].mh * scale) / 2;
        const modules = current.modulesList[i];
        for (let y = 0; y < r.height; y++) {
          for (let x = 0; x < r.width; x++) {
            if (modules[y][x]) octx.fillRect(baseX + (x + qz) * scale, baseY + (y + qz) * scale, scale, scale);
          }
        }
      });
    }
    return off;
  }

  $("save-png").addEventListener("click", () => {
    if (!current) return;
    renderPngCanvas().toBlob((blob) => blob && download(blob, `${filenameBase()}.png`), "image/png");
  });

  const copyPngBtn = $("copy-png");
  if (copyPngBtn) {
    copyPngBtn.addEventListener("click", async () => {
      if (!current) return;
      if (!navigator.clipboard || !window.ClipboardItem) {
        setCopyStatus("このブラウザはクリップボードへの画像コピーに対応していません", true);
        return;
      }
      try {
        const blob = await new Promise((resolve) => renderPngCanvas().toBlob(resolve, "image/png"));
        if (!blob) throw new Error("blob generation failed");
        await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
        setCopyStatus("コピーしました");
      } catch (e) {
        setCopyStatus(`コピーに失敗しました: ${e.message}`, true);
      }
    });
  }

  function setCopyStatus(text, isError) {
    const el = $("copy-status");
    if (!el) return;
    el.textContent = text;
    el.classList.toggle("error", !!isError);
    clearTimeout(setCopyStatus._t);
    setCopyStatus._t = setTimeout(() => { el.textContent = ""; }, 2500);
  }

  $("save-svg").addEventListener("click", () => {
    if (!current) return;
    const results = current.results;
    const escapeXml = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    let svg;
    if (results.length === 1 && results[0].type === "linear") {
      const r = results[0];
      const showText = state.barcode.showText;
      const totalW = r.quietLeft + r.width + r.quietRight;
      const barH = Math.max(30, Math.round(totalW * 0.3));
      const textH = showText ? 14 : 0;
      const totalH = barH + 10 + textH;
      let rects = "";
      let x = 0;
      while (x < r.width) {
        if (r.pattern[x]) {
          let run = 1;
          while (x + run < r.width && r.pattern[x + run]) run++;
          rects += `<rect x="${r.quietLeft + x}" y="5" width="${run}" height="${barH}"/>`;
          x += run;
        } else x++;
      }
      const text = showText
        ? `<text x="${totalW / 2}" y="${barH + 8 + textH}" font-family="monospace" ` +
          `font-size="${textH}" text-anchor="middle">${escapeXml(r.display)}</text>`
        : "";
      svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalW} ${totalH}" ` +
        `width="${totalW * 4}" height="${totalH * 4}" shape-rendering="crispEdges">` +
        `<rect width="100%" height="100%" fill="${state.bg}"/><g fill="${state.fg}">${rects}${text}</g></svg>`;
    } else if (results.length === 1) {
      const r = results[0];
      const qz = r.quietZone;
      const mw = r.width + qz * 2, mh = r.height + qz * 2;
      const modules = current.modulesList[0];
      let rects = "";
      for (let y = 0; y < r.height; y++) {
        let x = 0;
        while (x < r.width) {
          if (modules[y][x]) {
            let run = 1;
            while (x + run < r.width && modules[y][x + run]) run++;
            rects += `<rect x="${x + qz}" y="${y + qz}" width="${run}" height="1"/>`;
            x += run;
          } else x++;
        }
      }
      svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${mw} ${mh}" ` +
        `width="${mw * 10}" height="${mh * 10}" shape-rendering="crispEdges">` +
        `<rect width="100%" height="100%" fill="${state.bg}"/><g fill="${state.fg}">${rects}</g></svg>`;
    } else {
      const { cols, rows } = gridDims(results.length);
      const dims = results.map((r) => ({ mw: r.width + r.quietZone * 2, mh: r.height + r.quietZone * 2 }));
      const maxMw = Math.max(...dims.map((d) => d.mw));
      const maxMh = Math.max(...dims.map((d) => d.mh));
      const gap = Math.round(maxMw * 0.15);
      const totalW = cols * maxMw + (cols - 1) * gap;
      const totalH = rows * maxMh + (rows - 1) * gap;
      let groups = "";
      results.forEach((r, i) => {
        const qz = r.quietZone;
        const col = i % cols, row = Math.floor(i / cols);
        const baseX = col * (maxMw + gap) + (maxMw - dims[i].mw) / 2;
        const baseY = row * (maxMh + gap) + (maxMh - dims[i].mh) / 2;
        const modules = current.modulesList[i];
        let rects = "";
        for (let y = 0; y < r.height; y++) {
          let x = 0;
          while (x < r.width) {
            if (modules[y][x]) {
              let run = 1;
              while (x + run < r.width && modules[y][x + run]) run++;
              rects += `<rect x="${x + qz}" y="${y + qz}" width="${run}" height="1"/>`;
              x += run;
            } else x++;
          }
        }
        groups += `<g transform="translate(${baseX} ${baseY})">${rects}</g>`;
      });
      svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalW} ${totalH}" ` +
        `width="${totalW * 10}" height="${totalH * 10}" shape-rendering="crispEdges">` +
        `<rect width="100%" height="100%" fill="${state.bg}"/><g fill="${state.fg}">${groups}</g></svg>`;
    }
    download(new Blob([svg], { type: "image/svg+xml" }), `${filenameBase()}.svg`);
  });

  /* ---------- 色 ---------- */

  $("color-fg").addEventListener("input", () => {
    state.fg = $("color-fg").value;
    drawCurrent();
    syncUrl();
  });
  $("color-bg").addEventListener("input", () => {
    state.bg = $("color-bg").value;
    drawCurrent();
    syncUrl();
  });
  $("color-outer").addEventListener("input", () => {
    state.outerBg = $("color-outer").value;
    drawCurrent();
    syncUrl();
  });
  $("color-outer-same").addEventListener("change", () => {
    state.outerSame = $("color-outer-same").checked;
    $("color-outer").disabled = state.outerSame;
    drawCurrent();
    syncUrl();
  });
  $("color-reset").addEventListener("click", () => {
    state.fg = "#000000";
    state.bg = "#ffffff";
    state.outerBg = "#e5e7eb";
    state.outerSame = false;
    $("color-fg").value = state.fg;
    $("color-bg").value = state.bg;
    $("color-outer").value = state.outerBg;
    $("color-outer").disabled = false;
    $("color-outer-same").checked = false;
    drawCurrent();
    syncUrl();
  });

  /* ---------- 読み取り (カメラ / 画像) ---------- */
  /* デコード自体は ZXing (https://github.com/zxing-js/library) に委譲する。
     自前の decode() は「完璧なモジュール格子」を前提にしており、二値化・
     ファインダーパターン検出・遠近補正・グリッドサンプリングは行っていないため。 */

  const scanVideo = $("scan-video");
  const scanStatus = $("scan-status");
  const scanCameraBtn = $("scan-camera-btn");
  const scanImageBtn = $("scan-image-btn");
  const scanStopBtn = $("scan-stop-btn");
  const scanFileInput = $("scan-file-input");
  const zxingAvailable = typeof ZXing !== "undefined";
  const zxingReader = zxingAvailable ? new ZXing.MultiFormatReader() : null;
  if (zxingReader) {
    const hints = new Map();
    hints.set(ZXing.DecodeHintType.TRY_HARDER, true);
    zxingReader.setHints(hints);
  }

  /* ZXing が報告するバーコード形式 → このアプリの規格・シンボロジーへの対応
     (マイクロQR・rMQRは ZXing 非対応のため読み取れない) */
  function mapZXingFormat(format) {
    if (!zxingAvailable) return null;
    const F = ZXing.BarcodeFormat;
    if (format === F.QR_CODE) return { std: "qr" };
    if (format === F.DATA_MATRIX) return { std: "datamatrix" };
    if (format === F.AZTEC) return { std: "aztec" };
    if (format === F.CODE_128) return { std: "barcode", symbology: "code128" };
    if (format === F.CODE_39) return { std: "barcode", symbology: "code39" };
    if (format === F.EAN_13) return { std: "barcode", symbology: "ean13" };
    if (format === F.RSS_14) return { std: "barcode", symbology: "gs1databar" };
    return null;
  }

  function decodeCanvas(offCanvas) {
    const luminanceSource = new ZXing.HTMLCanvasElementLuminanceSource(offCanvas);
    const binarizer = new ZXing.HybridBinarizer(luminanceSource);
    const bitmap = new ZXing.BinaryBitmap(binarizer);
    return zxingReader.decode(bitmap);
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

  /* ZXing は非常に大きくフラットなモジュール (このアプリ自身が生成した画像の
     再取り込みなど) だと検出に失敗することがあるため、段階的に縮小して再試行する */
  function decodeCanvasWithFallback(sourceCanvas, sizes) {
    let lastErr = null;
    for (const maxDim of sizes) {
      const target = maxDim ? scaleCanvasTo(sourceCanvas, maxDim) : sourceCanvas;
      try {
        return { result: decodeCanvas(target), canvas: target };
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr;
  }

  /* 読み取ったコードの明暗モジュールの平均色を、背景色・本体色として採用する */
  function sampleScanColors(offCanvas, points) {
    if (!points || points.length === 0) return null;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of points) {
      const x = p.getX(), y = p.getY();
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
    const padX = (maxX - minX) * 0.08, padY = (maxY - minY) * 0.08;
    const x0 = Math.max(0, Math.floor(minX - padX));
    const y0 = Math.max(0, Math.floor(minY - padY));
    const w = Math.min(offCanvas.width - x0, Math.ceil(maxX - minX + padX * 2));
    const h = Math.min(offCanvas.height - y0, Math.ceil(maxY - minY + padY * 2));
    if (w < 1 || h < 1) return null;
    const data = offCanvas.getContext("2d").getImageData(x0, y0, w, h).data;
    const lums = new Float32Array(data.length / 4);
    for (let i = 0, j = 0; i < data.length; i += 4, j++) {
      lums[j] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    }
    const sorted = Array.from(lums).sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    const dark = [0, 0, 0], light = [0, 0, 0];
    let darkN = 0, lightN = 0;
    for (let i = 0, j = 0; i < data.length; i += 4, j++) {
      const target = lums[j] < median ? dark : light;
      target[0] += data[i]; target[1] += data[i + 1]; target[2] += data[i + 2];
      if (lums[j] < median) darkN++; else lightN++;
    }
    const toHex = (sum, n) => {
      if (n === 0) return null;
      return `#${[sum[0], sum[1], sum[2]].map((v) => Math.round(v / n).toString(16).padStart(2, "0")).join("")}`;
    };
    return { fg: toHex(dark, darkN), bg: toHex(light, lightN) };
  }

  function setScanStatus(text, isError) {
    scanStatus.textContent = text;
    scanStatus.classList.toggle("error", !!isError);
  }

  function handleScanResult(result, offCanvas) {
    const format = result.getBarcodeFormat();
    const text = result.getText();
    const mapping = mapZXingFormat(format);
    const colors = sampleScanColors(offCanvas, result.getResultPoints());
    if (colors) {
      if (colors.fg) state.fg = colors.fg;
      if (colors.bg) { state.bg = colors.bg; state.outerBg = colors.bg; state.outerSame = true; }
      $("color-fg").value = state.fg;
      $("color-bg").value = state.bg;
      $("color-outer").value = state.outerBg;
      $("color-outer").disabled = state.outerSame;
      $("color-outer-same").checked = state.outerSame;
    }
    dataInput.value = text;
    if (mapping) {
      if (mapping.symbology) state.barcode.symbology = mapping.symbology;
      /* ZXing の Result は誤り訂正レベルは取得できるが、型番やマスクパターンは
         内部で使い切った後に破棄されており公開APIからは取得できないため、
         それらは自動選択のままにする */
      if (mapping.std === "qr") {
        const ec = result.getResultMetadata() && result.getResultMetadata().get(ZXing.ResultMetadataType.ERROR_CORRECTION_LEVEL);
        const ecLevel = ec && ec.toString ? ec.toString() : ec;
        if (ecLevel && ["L", "M", "Q", "H"].includes(ecLevel)) state.qr.ec = ecLevel;
      }
      setScanStatus(`読み取り成功 (${ZXing.BarcodeFormat[format]})`);
      selectStandard(mapping.std);
    } else {
      setScanStatus(`読み取り成功 (このツールでは非対応の形式: ${ZXing.BarcodeFormat[format]})`, true);
      render();
    }
  }

  /* decodeCanvasWithFallback に渡す縮小サイズ候補。カメラは毎フレーム実行されるため
     試行回数を絞ってレイテンシを優先し、画像アップロードは一度きりなので広く試す */
  const CAMERA_FALLBACK_SIZES = [null, 400];
  const IMAGE_FALLBACK_SIZES = [null, 640, 400, 300, 200, 120];

  let scanStream = null;
  let scanRAF = null;

  function stopCameraScan() {
    if (scanRAF != null) cancelAnimationFrame(scanRAF);
    scanRAF = null;
    if (scanStream) {
      scanStream.getTracks().forEach((t) => t.stop());
      scanStream = null;
    }
    scanVideo.hidden = true;
    scanVideo.srcObject = null;
    scanStopBtn.hidden = true;
    scanCameraBtn.hidden = false;
    scanImageBtn.hidden = false;
    render();
  }

  async function startCameraScan() {
    if (!zxingAvailable) {
      setScanStatus("読み取り機能を読み込めませんでした (ネットワーク接続を確認してください)", true);
      return;
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setScanStatus("このブラウザではカメラを利用できません", true);
      return;
    }
    try {
      scanStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
    } catch (e) {
      setScanStatus(`カメラを起動できませんでした: ${e.message}`, true);
      return;
    }
    scanVideo.srcObject = scanStream;
    await scanVideo.play();
    // カメラが権限取り消しや切断で途中終了した場合、映像要素は最後のフレームの
    // 寸法を保持し続けるため videoWidth 判定だけではループが停止しない。
    // トラック終了イベントで明示的にスキャンを止める。
    scanStream.getVideoTracks().forEach((t) => {
      t.addEventListener("ended", () => {
        if (scanStream) {
          setScanStatus("カメラが切断されました", true);
          stopCameraScan();
        }
      });
    });
    canvas.hidden = true;
    qrMessage.hidden = true;
    editReset.hidden = true;
    scanVideo.hidden = false;
    scanStopBtn.hidden = false;
    scanCameraBtn.hidden = true;
    scanImageBtn.hidden = true;
    setScanStatus("コードにカメラを向けてください…");

    const off = document.createElement("canvas");
    const octx = off.getContext("2d", { willReadFrequently: true });
    const loop = () => {
      if (!scanStream) return;
      if (scanVideo.videoWidth > 0) {
        off.width = scanVideo.videoWidth;
        off.height = scanVideo.videoHeight;
        octx.drawImage(scanVideo, 0, 0);
        try {
          const { result, canvas: decodedCanvas } = decodeCanvasWithFallback(off, CAMERA_FALLBACK_SIZES);
          stopCameraScan();
          handleScanResult(result, decodedCanvas);
          return;
        } catch (e) {
          // このフレームでは見つからなかった。次のフレームで再試行する
        }
      }
      scanRAF = requestAnimationFrame(loop);
    };
    scanRAF = requestAnimationFrame(loop);
  }

  function decodeImageFile(file) {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const off = document.createElement("canvas");
      off.width = img.naturalWidth;
      off.height = img.naturalHeight;
      off.getContext("2d").drawImage(img, 0, 0);
      URL.revokeObjectURL(url);
      try {
        const { result, canvas: decodedCanvas } = decodeCanvasWithFallback(off, IMAGE_FALLBACK_SIZES);
        handleScanResult(result, decodedCanvas);
      } catch (e) {
        setScanStatus("コードが見つかりませんでした", true);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      setScanStatus("画像を読み込めませんでした", true);
    };
    img.src = url;
  }

  scanCameraBtn.addEventListener("click", startCameraScan);
  scanStopBtn.addEventListener("click", stopCameraScan);
  scanImageBtn.addEventListener("click", () => scanFileInput.click());
  scanFileInput.addEventListener("change", (ev) => {
    const file = ev.target.files[0];
    if (file) decodeImageFile(file);
    ev.target.value = "";
  });

  /* ---------- タブ切り替え ---------- */

  function selectStandard(std) {
    state.standard = std;
    for (const tab of document.querySelectorAll(".tab")) {
      tab.setAttribute("aria-selected", tab.dataset.standard === std ? "true" : "false");
    }
    rebuildControls();
    render();
  }

  for (const tab of document.querySelectorAll(".tab")) {
    tab.addEventListener("click", () => selectStandard(tab.dataset.standard));
  }
  dataInput.addEventListener("input", render);

  $("show-content-toggle").addEventListener("change", () => {
    state.showContent = $("show-content-toggle").checked;
    rebuildControls();
    drawCurrent();
    renderInfo();
  });

  new ResizeObserver(() => {
    if (current) drawCurrent();
  }).observe(qrCard);

  const restoredStd = loadFromUrl();
  selectStandard(restoredStd || "qr");
})();
