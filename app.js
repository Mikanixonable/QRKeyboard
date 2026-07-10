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
    saveScope: "code", // "code" (クワイエットゾーンまで) | "full" (背景・内容表示を含む)
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

  /* 指定した型番(複雑度)で現在の入力内容が1コードに収まるか判定する。
     state を変更せず、ライブラリを直接呼び出して確かめる */
  function versionFitsSingleCode(std, version) {
    const text = dataInput.value;
    if (!text) return false;
    const st = state[std];
    try {
      switch (std) {
        case "qr":
        case "micro":
          QRLib.encode({ standard: std, text, ecLevel: st.ec, version, mask: -1 });
          return true;
        case "rmqr":
          QRLib.encode({ standard: "rmqr", text, ecLevel: st.ec, version });
          return true;
        case "datamatrix":
          DMLib.encode({ text, size: version });
          return true;
        case "aztec":
          AZLib.encode({ text, ecIndex: st.ec, version });
          return true;
      }
    } catch (e) {
      return false;
    }
    return false;
  }

  /* ---------- 複雑度(型番)コントロール ---------- */

  function buildVersionControl() {
    const box = $("version-control");
    const label = $("version-label");
    box.textContent = "";
    const std = state.standard;
    const st = state[std];
    label.textContent = std === "barcode" ? "種類" : "型番(複雑度)";

    if (std === "barcode") {
      const seg = document.createElement("div");
      seg.className = "segmented segmented-vertical";
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
          fits: versionFitsSingleCode("qr", v),
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
          fits: versionFitsSingleCode("datamatrix", i + 1),
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
          fits: versionFitsSingleCode("aztec", l),
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
          fits: versionFitsSingleCode("aztec", v),
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
      if (item.fits) btn.classList.add("tile-fits");
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
        if (versionFitsSingleCode("rmqr", rmqrVersionOf(h, w))) btn.classList.add("tile-fits");
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
    field.hidden = false;
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

  /* 保存/コピーで書き出す範囲: クワイエットゾーンまでか、背景色 (と内容表示のテキスト) を
     含めるか。 */
  function buildSaveScopeControl() {
    const field = $("save-scope-field");
    const box = $("save-scope-control");
    field.hidden = false;
    box.textContent = "";
    [["コードのみ", "code"], ["背景を含む", "full"]].forEach(([label, v]) => {
      box.appendChild(makeSegButton(label, state.saveScope === v, () => {
        state.saveScope = v;
        rebuildControls();
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
    buildSaveScopeControl();
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
  /* 「コード (+内容表示)」ブロックが正方形の表示域に対して占める余白の割合。
     画面表示・「背景を含む」書き出しの両方で共通して使い、見た目の縮尺比を
     一致させる (でないと画面表示だけ余白が薄い/濃いといったズレが生じる)。 */
  const MARGIN_RATIO = 0.12;

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
      const showCaption = effectivePlacement() === "each";
      const totalW = r.quietLeft + r.width + r.quietRight;
      const outerColor = state.outerSame ? state.bg : state.outerBg;
      const fontPxBase = Math.round(12 * dpr);
      const fontPxMin = Math.round(8 * dpr);

      /* QR 系と同じ正方形の表示域に、余白 (MARGIN_RATIO) を確保した上で
         バーコードを中央揃えで配置する (規格によって配置ロジックが違うと
         見た目の余白比率がバラバラになるため、他規格と統一する)。 */
      const squareSize = Math.max(40, Math.min(availW, availH));
      const budget = Math.max(20, squareSize * (1 - MARGIN_RATIO * 2));

      const scale = Math.max(1, Math.floor(budget / totalW));
      const textH = showText ? Math.round(16 * scale) : 0;
      const barH = Math.max(30 * dpr, Math.min(budget - 16 * dpr - textH, Math.round(totalW * scale * 0.3)));
      const contentW = totalW * scale;
      const contentH = barH + 16 * scale + textH;

      let lines = [], captionFontPx = fontPxBase, captionH = 0;
      if (showCaption) {
        const maxW = Math.max(20, contentW - 8 * dpr);
        const fit = fitCaptionLines(ctx, perCodeContentText(0), maxW, 3, fontPxBase, fontPxMin);
        captionFontPx = fit.fontPx;
        lines = fit.lines;
        const lineH = Math.round(captionFontPx * 1.4);
        captionH = lines.length * lineH + Math.round(6 * dpr);
      }
      const blockH = contentH + captionH;

      canvas.width = squareSize;
      canvas.height = squareSize;
      canvas.style.width = `${canvas.width / dpr}px`;
      canvas.style.height = `${canvas.height / dpr}px`;
      ctx.fillStyle = outerColor;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      /* 半端な小数ピクセルで矩形を描くと、隣接するバー同士の境界がアンチ
         エイリアスされ、灰色の筋が入ってしまう。整数ピクセルに丸める。 */
      const originX = Math.max(0, Math.round((squareSize - contentW) / 2));
      const originY = Math.max(0, Math.round((squareSize - blockH) / 2));
      ctx.fillStyle = state.bg;
      ctx.fillRect(originX, originY, contentW, contentH);
      ctx.fillStyle = state.fg;
      for (let x = 0; x < r.width; x++) {
        if (r.pattern[x]) {
          ctx.fillRect(originX + (r.quietLeft + x) * scale, originY + 8 * scale, scale, barH);
        }
      }
      if (showText) {
        ctx.font = `${Math.round(12 * scale)}px monospace`;
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.fillText(r.display, originX + contentW / 2, originY + barH + 8 * scale + 2 * scale, contentW);
      }
      if (showCaption) {
        ctx.font = `${captionFontPx}px monospace`;
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        const maxW = canvas.width - 8 * dpr;
        const lineH = Math.round(captionFontPx * 1.4);
        const textBlockH = lines.length * lineH;
        /* コード (+表示文字) 下端から表示域 (正方形) 下端までの帯の縦中央に
           内容表示の文字ブロックが来るようにする */
        const contentBottom = originY + contentH;
        const bandH = canvas.height - contentBottom;
        const startY = contentBottom + (bandH - textBlockH) / 2;
        lines.forEach((line, i) => {
          ctx.fillText(line, canvas.width / 2, startY + i * lineH, maxW);
        });
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

      /* キャンバス自体を QR 表示域 (.qr-card) と同じ正方形にする。以前はキャンバスを
         コード+キャプションぶんだけタイトなサイズにし、CSS の flex 中央寄せで正方形内に
         配置していたため、キャプション下の本当の余白量が JS から見えず、「クワイエット
         ゾーン下端〜表示域下端の中間」を正しく計算できなかった。
         さらに、コードをここまで viewport いっぱいに拡大していたため余白がほぼ 0 になり、
         「背景を含む」書き出し (常に一定割合の余白を確保する) と見た目の縮尺比が
         食い違っていた (画面表示は余白が薄く、書き出しは厚い)。書き出しと同じ
         MARGIN_RATIO を使い、コード+キャプションが正方形の中央に一定の余白を
         残して収まるようにすることで、両者の見た目を一致させる。 */
      const squareSize = Math.max(40, Math.min(availW, availH));
      const budget = Math.max(20, squareSize * (1 - MARGIN_RATIO * 2));

      /* キャプション幅は最終的なコード幅 (mw*scale) に依存し、その幅は
         キャプションの高さにも依存するため、収束するまで数回計算し直す。
         行数上限に収まらない場合は、収まるまでフォントを縮小する。 */
      let scale = Math.max(1, Math.floor(Math.min(budget / mw, budget / mh)));
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
          const newScale = Math.max(1, Math.floor(Math.min(budget / mw, (budget - newCaptionH) / mh)));
          captionH = newCaptionH;
          if (newScale === scale) break;
          scale = newScale;
        }
      }
      canvas.width = squareSize;
      canvas.height = squareSize;
      canvas.style.width = `${canvas.width / dpr}px`;
      canvas.style.height = `${canvas.height / dpr}px`;
      /* 背景色 (外側) を正方形全体に敷き、その上にクワイエットゾーン込みのコード面を
         中央揃えで塗る。内容表示はクワイエットゾーンの外 (背景色の上) に表示する。 */
      ctx.fillStyle = outerColor;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      const contentW = mw * scale, contentH = mh * scale;
      /* 正方形内で中央揃えする対象は「コード+キャプション」の全体ブロックであって、
         コード単体ではない。コード単体で中央揃えしてしまうと、キャプション分の
         高さがまるごと下側の余白に追加されるだけになり、上下の余白が非対称になって
         「下の余白の中間に文字が来る」計算が狂う。 */
      const blockH = contentH + captionH;
      /* 半端な小数ピクセルで矩形を描くと、隣接するモジュール同士の境界がアンチ
         エイリアスされ、灰色の格子状の線が入ってしまう。整数ピクセルに丸める。 */
      const originX = Math.max(0, Math.round((squareSize - contentW) / 2));
      const originY = Math.max(0, Math.round((squareSize - blockH) / 2));
      ctx.fillStyle = state.bg;
      ctx.fillRect(originX, originY, contentW, contentH);
      ctx.fillStyle = state.fg;
      const modules = current.modulesList[0];
      for (let y = 0; y < r.height; y++) {
        const row = modules[y];
        for (let x = 0; x < r.width; x++) {
          if (row[x]) ctx.fillRect(originX + (x + qz) * scale, originY + (y + qz) * scale, scale, scale);
        }
      }
      if (showCaption) {
        ctx.font = `${captionFontPx}px monospace`;
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        const maxW = canvas.width - 8 * dpr;
        const lineH = Math.round(captionFontPx * 1.4);
        const textBlockH = lines.length * lineH;
        /* クワイエットゾーン下端から表示域 (正方形キャンバス) 下端までの帯の
           縦中央に文字ブロックが来るようにする */
        const qzBottom = originY + contentH;
        const bandH = canvas.height - qzBottom;
        const startY = qzBottom + (bandH - textBlockH) / 2;
        lines.forEach((line, i) => {
          ctx.fillText(line, canvas.width / 2, startY + i * lineH, maxW);
        });
      }
      lastDraw = { scale, qz, dpr, originX, originY };
      return;
    }

    /* 複数コード: QR 表示域の大きさは変えず、グリッドに縮小配置する。編集は非対応。
       単一コードの場合と同じ MARGIN_RATIO ぶんを四辺の余白として確保し、
       「背景を含む」書き出しと見た目の縮尺比を一致させる。 */
    const n = results.length;
    const placement = effectivePlacement();
    const showCaptions = placement === "each" || placement === "both";
    const showCombined = placement === "combined" || placement === "both";
    const { cols, rows } = gridDims(n);
    const gap = GRID_GAP * dpr;
    const outerColor = state.outerSame ? state.bg : state.outerBg;
    const squareSizeMulti = Math.max(40, Math.min(availW, availH));
    const budgetW = Math.max(20, squareSizeMulti * (1 - MARGIN_RATIO * 2));
    const budgetH = budgetW;

    const cellFontPxBase = Math.round(10 * dpr);
    const cellFontPxMin = Math.round(7 * dpr);
    const cellWEstimate = (budgetW - gap * (cols - 1)) / cols;
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
      ? fitCaptionLines(ctx, combinedRaw == null ? "(読み取り不能)" : combinedRaw, budgetW - 8 * dpr, 2, combinedFontPxBase, combinedFontPxMin)
      : { fontPx: combinedFontPxBase, lines: [] };
    const combinedFontPx = combinedFit.fontPx;
    const combinedLines = combinedFit.lines;
    const combinedLineH = Math.round(combinedFontPx * 1.4);
    const combinedH = showCombined ? combinedLines.length * combinedLineH + Math.round(6 * dpr) : 0;

    const gridAvailH = budgetH - combinedH;
    const cellW = (budgetW - gap * (cols - 1)) / cols;
    const cellH = (gridAvailH - gap * (rows - 1)) / rows - captionH;
    const dims = results.map((r) => ({ mw: r.width + r.quietZone * 2, mh: r.height + r.quietZone * 2 }));
    let scale = Infinity;
    for (const { mw, mh } of dims) scale = Math.min(scale, Math.floor(Math.min(cellW / mw, cellH / mh)));
    scale = Math.max(1, scale);

    /* グリッド全体 (+結合キャプション) のブロックを正方形の中央に配置する */
    const gridBlockW = cols * cellW + (cols - 1) * gap;
    const gridBlockH = gridAvailH + combinedH;
    const gridOriginX = Math.max(0, Math.round((squareSizeMulti - gridBlockW) / 2));
    const gridOriginY = Math.max(0, Math.round((squareSizeMulti - gridBlockH) / 2));

    canvas.width = squareSizeMulti;
    canvas.height = squareSizeMulti;
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
      const cellX = gridOriginX + col * (cellW + gap);
      const cellY = gridOriginY + row * (cellH + captionH + gap);
      /* 半端な小数ピクセルで矩形を描くと、隣接するモジュール同士の境界がアンチ
         エイリアスされ、灰色の格子状の線が入ってしまう。整数ピクセルに丸める。 */
      const offX = Math.round(cellX + (cellW - mw * scale) / 2);
      const offY = Math.round(cellY + (cellH - mh * scale) / 2);
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
        const blockH = cellLines[i].length * cellLineH;
        /* このコードのクワイエットゾーン下端からセル (キャプション込み) 下端までの
           帯の縦中央に文字ブロックが来るようにする */
        const qzBottom = offY + mh * scale;
        const bandH = cellY + cellH + captionH - qzBottom;
        const startY = qzBottom + (bandH - blockH) / 2;
        cellLines[i].forEach((line, li) => {
          ctx.fillText(line, cellX + cellW / 2, startY + li * cellLineH, maxW);
        });
      }
    }
    if (showCombined) {
      ctx.font = `${combinedFontPx}px monospace`;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      const maxW = budgetW - 8 * dpr;
      const blockH = combinedLines.length * combinedLineH;
      /* グリッド下端から表示域 (正方形キャンバス) 下端までの帯の縦中央に
         文字ブロックが来るようにする */
      const gridBottom = gridOriginY + gridAvailH;
      const bandH = canvas.height - gridBottom;
      const startY = gridBottom + (bandH - blockH) / 2;
      combinedLines.forEach((line, li) => {
        ctx.fillText(line, canvas.width / 2, startY + li * combinedLineH, maxW);
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
    const { scale, qz, dpr, originX, originY } = lastDraw;
    const x = Math.floor(((ev.clientX - rect.left) * dpr - originX) / scale) - qz;
    const y = Math.floor(((ev.clientY - rect.top) * dpr - originY) / scale) - qz;
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
    if (results.length === 1 && results[0].type === "linear" && state.saveScope === "full") {
      renderFullLinearCanvas(off, octx);
    } else if (results.length === 1 && results[0].type === "linear") {
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
    } else if (results.length === 1 && state.saveScope === "full") {
      renderFullSingleCanvas(off, octx);
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
    } else if (state.saveScope === "full") {
      renderFullMultiCanvas(off, octx);
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

  /* 1次元バーコードを、背景色と内容表示テキストまで含めて書き出す
     (renderPngCanvas の「背景を含む」モード用)。他規格と同じく正方形に
     余白 (MARGIN_RATIO) を確保した上で中央揃えにする。 */
  function renderFullLinearCanvas(off, octx) {
    const r = current.results[0];
    const showText = state.barcode.showText;
    const showCaption = effectivePlacement() === "each";
    const outerColor = state.outerSame ? state.bg : state.outerBg;
    const totalW = r.quietLeft + r.width + r.quietRight;
    const scale = 4;
    const fontPxBase = Math.max(14, Math.round(scale * 2.2));
    const fontPxMin = Math.max(8, Math.round(scale));

    const barH = Math.max(120, Math.round(totalW * scale * 0.3));
    const textH = showText ? 48 : 0;
    const contentW = totalW * scale;
    const contentH = barH + 40 + textH;

    let lines = [], captionFontPx = fontPxBase, captionH = 0;
    if (showCaption) {
      const maxW = Math.max(20, contentW - 16);
      const fit = fitCaptionLines(octx, perCodeContentText(0), maxW, 3, fontPxBase, fontPxMin);
      captionFontPx = fit.fontPx;
      lines = fit.lines;
      const lineH = Math.round(captionFontPx * 1.4);
      captionH = lines.length * lineH + 12;
    }
    const blockH = contentH + captionH;
    const margin = Math.round(Math.max(contentW, blockH) * MARGIN_RATIO);
    const square = Math.max(contentW, blockH) + margin * 2;
    off.width = square;
    off.height = square;
    const originX = Math.round((square - contentW) / 2);
    const originY = Math.round((square - blockH) / 2);

    octx.fillStyle = outerColor;
    octx.fillRect(0, 0, off.width, off.height);
    octx.fillStyle = state.bg;
    octx.fillRect(originX, originY, contentW, contentH);
    octx.fillStyle = state.fg;
    for (let x = 0; x < r.width; x++) {
      if (r.pattern[x]) octx.fillRect(originX + (r.quietLeft + x) * scale, originY + 20, scale, barH);
    }
    if (showText) {
      octx.font = "36px monospace";
      octx.textAlign = "center";
      octx.textBaseline = "top";
      octx.fillText(r.display, originX + contentW / 2, originY + barH + 24, contentW);
    }
    if (showCaption) {
      octx.font = `${captionFontPx}px monospace`;
      octx.textAlign = "center";
      octx.textBaseline = "top";
      const lineH = Math.round(captionFontPx * 1.4);
      const maxW = off.width - 16;
      const textBlockH = lines.length * lineH;
      const contentBottom = originY + contentH;
      const bandH = off.height - contentBottom;
      const startY = contentBottom + (bandH - textBlockH) / 2;
      lines.forEach((line, i) => octx.fillText(line, off.width / 2, startY + i * lineH, maxW));
    }
  }

  /* 単一コードを、背景色 (クワイエットゾーンの外側) と内容表示テキストまで含めて
     書き出す (renderPngCanvas の「背景を含む」モード用)。オンスクリーン描画の
     drawCurrent() と同じ構図を、保存用の高解像度スケールで再現する。 */
  function renderFullSingleCanvas(off, octx) {
    const r = current.results[0];
    const qz = r.quietZone;
    const mw = r.width + qz * 2, mh = r.height + qz * 2;
    const scale = Math.max(4, Math.min(16, Math.floor(2048 / Math.max(mw, mh))));
    const outerColor = state.outerSame ? state.bg : state.outerBg;
    const showCaption = effectivePlacement() === "each";
    const fontPxBase = Math.max(14, Math.round(scale * 2.2));
    const fontPxMin = Math.max(8, Math.round(scale));
    let lines = [], captionFontPx = fontPxBase, captionH = 0;
    if (showCaption) {
      const maxW = Math.max(20, mw * scale - 16);
      const fit = fitCaptionLines(octx, perCodeContentText(0), maxW, 3, fontPxBase, fontPxMin);
      captionFontPx = fit.fontPx;
      lines = fit.lines;
      const lineH = Math.round(captionFontPx * 1.4);
      captionH = lines.length * lineH + 12;
    }
    /* WebUI 上の QR 表示域 (.qr-card) は常に正方形で、コード (+内容表示) は
       その中央に配置される。書き出しもそれをそのまま再現する。
       正方形にするために大きい方の辺に合わせるだけだと、既に元々ほぼ正方形の
       コード (+わずかなキャプション) では上下 or 左右の余白がほぼ 0 になって
       しまう (実際に発生していた不具合)。そこで常に一定の余白 (margin) を
       四辺に確保した上で正方形化する。 */
    const contentW = mw * scale, contentH = mh * scale + captionH;
    const margin = Math.round(Math.max(contentW, contentH) * MARGIN_RATIO);
    const square = Math.max(contentW, contentH) + margin * 2;
    off.width = square;
    off.height = square;
    /* 半端な小数ピクセルで矩形を描くと、隣接するモジュール同士の境界がアンチ
       エイリアスされ、灰色の格子状の線が入ってしまう。整数ピクセルに丸める。 */
    const originX = Math.round((square - contentW) / 2);
    const originY = Math.round((square - contentH) / 2);
    octx.fillStyle = outerColor;
    octx.fillRect(0, 0, off.width, off.height);
    octx.fillStyle = state.bg;
    octx.fillRect(originX, originY, mw * scale, mh * scale);
    octx.fillStyle = state.fg;
    const modules = current.modulesList[0];
    for (let y = 0; y < r.height; y++) {
      for (let x = 0; x < r.width; x++) {
        if (modules[y][x]) octx.fillRect(originX + (x + qz) * scale, originY + (y + qz) * scale, scale, scale);
      }
    }
    if (showCaption) {
      octx.font = `${captionFontPx}px monospace`;
      octx.textAlign = "center";
      octx.textBaseline = "top";
      const lineH = Math.round(captionFontPx * 1.4);
      const maxW = contentW - 16;
      const blockH = lines.length * lineH;
      /* クワイエットゾーン下端から表示域 (正方形) 下端までの帯の縦中央に
         文字ブロックが来るようにする */
      const qzBottom = originY + mh * scale;
      const bandH = off.height - qzBottom;
      const startY = qzBottom + (bandH - blockH) / 2;
      lines.forEach((line, i) => octx.fillText(line, originX + contentW / 2, startY + i * lineH, maxW));
    }
  }

  /* 複数コードを、背景色と内容表示テキストまで含めて書き出す (「背景を含む」モード用) */
  function renderFullMultiCanvas(off, octx) {
    const results = current.results;
    const { cols, rows } = gridDims(results.length);
    const dims = results.map((r) => ({ mw: r.width + r.quietZone * 2, mh: r.height + r.quietZone * 2 }));
    const maxMw = Math.max(...dims.map((d) => d.mw));
    const maxMh = Math.max(...dims.map((d) => d.mh));
    const scale = Math.max(2, Math.min(16, Math.floor(2048 / (Math.max(maxMw, maxMh) * Math.max(cols, rows)))));
    const gap = 4 * scale;
    const cellW = maxMw * scale, cellH = maxMh * scale;
    const outerColor = state.outerSame ? state.bg : state.outerBg;
    const placement = effectivePlacement();
    const showCaptions = placement === "each" || placement === "both";
    const showCombined = placement === "combined" || placement === "both";

    const cellFontPxBase = Math.max(14, Math.round(scale * 2.2));
    const cellFontPxMin = Math.max(8, Math.round(scale));
    let cellFontPx = cellFontPxBase;
    let cellLines = [];
    if (showCaptions) {
      for (let px = cellFontPxBase; px >= cellFontPxMin; px--) {
        octx.font = `${px}px monospace`;
        let allFit = true;
        const trial = results.map((_, i) => {
          const result = wrapToLines(octx, perCodeContentText(i), cellW - 8, 3);
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
    const captionH = showCaptions ? maxCellLines * cellLineH + 8 : 0;
    const totalGridW = cols * cellW + (cols - 1) * gap;

    const combinedFontPxBase = Math.max(14, Math.round(scale * 2.2));
    const combinedFontPxMin = Math.max(8, Math.round(scale));
    const combinedRaw = combinedContentText();
    const combinedFit = showCombined
      ? fitCaptionLines(octx, combinedRaw == null ? "(読み取り不能)" : combinedRaw, totalGridW - 16, 3, combinedFontPxBase, combinedFontPxMin)
      : { fontPx: combinedFontPxBase, lines: [] };
    const combinedFontPx = combinedFit.fontPx;
    const combinedLines = combinedFit.lines;
    const combinedLineH = Math.round(combinedFontPx * 1.4);
    const combinedH = showCombined ? combinedLines.length * combinedLineH + 12 : 0;
    const gridH = rows * (cellH + captionH) + (rows - 1) * gap;

    /* WebUI 上の QR 表示域 (.qr-card) は常に正方形で、グリッド全体はその中央に
       配置される。書き出しもそれをそのまま再現する。常に一定の余白 (margin) を
       四辺に確保した上で正方形化する (単一コードの場合と同じ理由)。 */
    const contentW = totalGridW, contentH = gridH + combinedH;
    const margin = Math.round(Math.max(contentW, contentH) * MARGIN_RATIO);
    const square = Math.max(contentW, contentH) + margin * 2;
    off.width = square;
    off.height = square;
    /* 半端な小数ピクセルで矩形を描くと、隣接するモジュール同士の境界がアンチ
       エイリアスされ、灰色の格子状の線が入ってしまう。整数ピクセルに丸める。 */
    const originX = Math.round((square - contentW) / 2);
    const originY = Math.round((square - contentH) / 2);
    octx.fillStyle = outerColor;
    octx.fillRect(0, 0, off.width, off.height);
    results.forEach((r, i) => {
      const qz = r.quietZone;
      const col = i % cols, row = Math.floor(i / cols);
      const cellX = originX + col * (cellW + gap);
      const cellY = originY + row * (cellH + captionH + gap);
      const offX = Math.round(cellX + (cellW - dims[i].mw * scale) / 2);
      const offY = Math.round(cellY + (cellH - dims[i].mh * scale) / 2);
      octx.fillStyle = state.bg;
      octx.fillRect(offX, offY, dims[i].mw * scale, dims[i].mh * scale);
      octx.fillStyle = state.fg;
      const modules = current.modulesList[i];
      for (let y = 0; y < r.height; y++) {
        for (let x = 0; x < r.width; x++) {
          if (modules[y][x]) octx.fillRect(offX + (x + qz) * scale, offY + (y + qz) * scale, scale, scale);
        }
      }
      if (showCaptions) {
        octx.font = `${cellFontPx}px monospace`;
        octx.textAlign = "center";
        octx.textBaseline = "top";
        const maxW = cellW - 4;
        const blockH = cellLines[i].length * cellLineH;
        /* このコードのクワイエットゾーン下端からセル (キャプション込み) 下端までの
           帯の縦中央に文字ブロックが来るようにする */
        const qzBottom = offY + dims[i].mh * scale;
        const bandH = cellY + cellH + captionH - qzBottom;
        const startY = qzBottom + (bandH - blockH) / 2;
        cellLines[i].forEach((line, li) => {
          octx.fillText(line, cellX + cellW / 2, startY + li * cellLineH, maxW);
        });
      }
    });
    if (showCombined) {
      octx.font = `${combinedFontPx}px monospace`;
      octx.textAlign = "center";
      octx.textBaseline = "top";
      const maxW = contentW - 16;
      const blockH = combinedLines.length * combinedLineH;
      /* グリッド下端から表示域 (正方形) 下端までの帯の縦中央に文字ブロックが来るようにする */
      const gridBottom = originY + gridH;
      const bandH = off.height - gridBottom;
      const startY = gridBottom + (bandH - blockH) / 2;
      combinedLines.forEach((line, li) => {
        octx.fillText(line, originX + contentW / 2, startY + li * combinedLineH, maxW);
      });
    }
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
      const contentH = barH + 10 + textH;
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
      if (state.saveScope === "full") {
        const outerColor = state.outerSame ? state.bg : state.outerBg;
        const showCaption = effectivePlacement() === "each";
        let captionH = 0, captionLines = [], fontSize = 0, lineH = 0;
        if (showCaption) {
          fontSize = Math.max(3, Math.round(totalW * 0.045));
          captionLines = wrapMonospace(perCodeContentText(0), fontSize, totalW - fontSize, 3);
          lineH = fontSize * 1.4;
          captionH = captionLines.length * lineH + fontSize * 0.6;
        }
        const blockH = contentH + captionH;
        const margin = Math.round(Math.max(totalW, blockH) * MARGIN_RATIO);
        const square = Math.max(totalW, blockH) + margin * 2;
        const originX = Math.round((square - totalW) / 2);
        const originY = Math.round((square - blockH) / 2);
        let captionSvg = "";
        if (showCaption) {
          const blockTextH = captionLines.length * lineH;
          const contentBottom = contentH;
          const bandH = (square - originY) - contentBottom;
          const startTop = contentBottom + (bandH - blockTextH) / 2;
          captionSvg = `<g font-family="monospace" font-size="${fontSize}" text-anchor="middle" fill="${state.fg}">` +
            captionLines.map((line, i) => `<text x="${totalW / 2}" y="${startTop + i * lineH + fontSize}">${escapeXml(line)}</text>`).join("") +
            `</g>`;
        }
        svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${square} ${square}" ` +
          `width="${square * 4}" height="${square * 4}" shape-rendering="crispEdges">` +
          `<rect width="100%" height="100%" fill="${outerColor}"/>` +
          `<g transform="translate(${originX} ${originY})">` +
          `<rect x="0" y="0" width="${totalW}" height="${contentH}" fill="${state.bg}"/>` +
          `<g fill="${state.fg}">${rects}${text}</g>${captionSvg}</g></svg>`;
      } else {
        svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalW} ${contentH}" ` +
          `width="${totalW * 4}" height="${contentH * 4}" shape-rendering="crispEdges">` +
          `<rect width="100%" height="100%" fill="${state.bg}"/><g fill="${state.fg}">${rects}${text}</g></svg>`;
      }
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
      if (state.saveScope === "full") {
        const outerColor = state.outerSame ? state.bg : state.outerBg;
        const showCaption = effectivePlacement() === "each";
        let captionH = 0, captionLines = [], fontSize = 0, lineH = 0;
        if (showCaption) {
          fontSize = Math.max(3, Math.round(mw * 0.045));
          captionLines = wrapMonospace(perCodeContentText(0), fontSize, mw - fontSize, 3);
          lineH = fontSize * 1.4;
          captionH = captionLines.length * lineH + fontSize * 0.6;
        }
        /* WebUI 上の QR 表示域 (.qr-card) は常に正方形で、コード (+内容表示) は
           その中央に配置される。書き出しもそれをそのまま再現する。常に一定の
           余白 (margin) を四辺に確保した上で正方形化する。 */
        const contentH = mh + captionH;
        const margin = Math.round(Math.max(mw, contentH) * MARGIN_RATIO);
        const square = Math.max(mw, contentH) + margin * 2;
        const originX = (square - mw) / 2;
        const originY = (square - contentH) / 2;
        let captionSvg = "";
        if (showCaption) {
          const blockH = captionLines.length * lineH;
          /* クワイエットゾーン下端から表示域 (正方形) 下端までの帯の縦中央に
             文字ブロックが来るようにする */
          const qzBottom = mh;
          const bandH = square - originY - qzBottom;
          const startTop = qzBottom + (bandH - blockH) / 2;
          captionSvg = `<g font-family="monospace" font-size="${fontSize}" text-anchor="middle" fill="${state.fg}">` +
            captionLines.map((line, i) => `<text x="${mw / 2}" y="${startTop + i * lineH + fontSize}">${escapeXml(line)}</text>`).join("") +
            `</g>`;
        }
        svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${square} ${square}" ` +
          `width="${square * 10}" height="${square * 10}" shape-rendering="crispEdges">` +
          `<rect width="100%" height="100%" fill="${outerColor}"/>` +
          `<g transform="translate(${originX} ${originY})">` +
          `<rect x="0" y="0" width="${mw}" height="${mh}" fill="${state.bg}"/>` +
          `<g fill="${state.fg}">${rects}</g>${captionSvg}</g></svg>`;
      } else {
        svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${mw} ${mh}" ` +
          `width="${mw * 10}" height="${mh * 10}" shape-rendering="crispEdges">` +
          `<rect width="100%" height="100%" fill="${state.bg}"/><g fill="${state.fg}">${rects}</g></svg>`;
      }
    } else if (state.saveScope === "full") {
      const { cols, rows } = gridDims(results.length);
      const dims = results.map((r) => ({ mw: r.width + r.quietZone * 2, mh: r.height + r.quietZone * 2 }));
      const maxMw = Math.max(...dims.map((d) => d.mw));
      const maxMh = Math.max(...dims.map((d) => d.mh));
      const gap = Math.round(maxMw * 0.15);
      const outerColor = state.outerSame ? state.bg : state.outerBg;
      const placement = effectivePlacement();
      const showCaptions = placement === "each" || placement === "both";
      const showCombined = placement === "combined" || placement === "both";
      const cellFontSize = Math.max(3, Math.round(maxMw * 0.045));
      const cellLineH = cellFontSize * 1.4;
      const cellLines = showCaptions
        ? results.map((_, i) => wrapMonospace(perCodeContentText(i), cellFontSize, maxMw - cellFontSize, 3))
        : [];
      const captionH = showCaptions ? Math.max(...cellLines.map((l) => l.length)) * cellLineH + cellFontSize * 0.6 : 0;
      const totalW = cols * maxMw + (cols - 1) * gap;
      const gridH = rows * (maxMh + captionH) + (rows - 1) * gap;
      const combinedFontSize = Math.max(3, Math.round(totalW * 0.03));
      const combinedLineH = combinedFontSize * 1.4;
      const combinedRaw = combinedContentText();
      const combinedLines = showCombined
        ? wrapMonospace(combinedRaw == null ? "(読み取り不能)" : combinedRaw, combinedFontSize, totalW - combinedFontSize, 3)
        : [];
      const combinedH = showCombined ? combinedLines.length * combinedLineH + combinedFontSize * 0.6 : 0;
      const totalH = gridH + combinedH;
      /* WebUI 上の QR 表示域 (.qr-card) は常に正方形で、グリッド全体はその中央に
         配置される。書き出しもそれをそのまま再現する。常に一定の余白 (margin) を
         四辺に確保した上で正方形化する。 */
      const margin = Math.round(Math.max(totalW, totalH) * MARGIN_RATIO);
      const square = Math.max(totalW, totalH) + margin * 2;
      const originX = (square - totalW) / 2;
      const originY = (square - totalH) / 2;
      let groups = "";
      results.forEach((r, i) => {
        const qz = r.quietZone;
        const col = i % cols, row = Math.floor(i / cols);
        const cellX = col * (maxMw + gap);
        const cellY = row * (maxMh + captionH + gap);
        const baseX = cellX + (maxMw - dims[i].mw) / 2;
        const baseY = cellY + (maxMh - dims[i].mh) / 2;
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
        let captionSvg = "";
        if (showCaptions) {
          /* このコードのクワイエットゾーン下端からセル (キャプション込み) 下端までの
             帯の縦中央に文字ブロックが来るようにする */
          const blockH = cellLines[i].length * cellLineH;
          const qzBottom = baseY + dims[i].mh;
          const bandH = cellY + maxMh + captionH - qzBottom;
          const startTop = qzBottom + (bandH - blockH) / 2;
          captionSvg = `<g font-family="monospace" font-size="${cellFontSize}" text-anchor="middle" fill="${state.fg}">` +
            cellLines[i].map((line, li) => `<text x="${cellX + maxMw / 2}" y="${startTop + li * cellLineH + cellFontSize}">${escapeXml(line)}</text>`).join("") +
            `</g>`;
        }
        groups += `<rect x="${baseX}" y="${baseY}" width="${dims[i].mw}" height="${dims[i].mh}" fill="${state.bg}"/>` +
          `<g transform="translate(${baseX} ${baseY})" fill="${state.fg}">${rects}</g>${captionSvg}`;
      });
      let combinedSvg = "";
      if (showCombined) {
        const combinedBlockH = combinedLines.length * combinedLineH;
        /* グリッド下端から表示域 (正方形) 下端までの帯の縦中央に文字ブロックが来るようにする */
        const gridBottomLocal = gridH;
        const bandH = (square - originY) - gridBottomLocal;
        const combinedStartTop = gridBottomLocal + (bandH - combinedBlockH) / 2;
        combinedSvg = `<g font-family="monospace" font-size="${combinedFontSize}" text-anchor="middle" fill="${state.fg}">` +
          combinedLines.map((line, li) => `<text x="${totalW / 2}" y="${combinedStartTop + li * combinedLineH + combinedFontSize}">${escapeXml(line)}</text>`).join("") +
          `</g>`;
      }
      svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${square} ${square}" ` +
        `width="${square * 10}" height="${square * 10}" shape-rendering="crispEdges">` +
        `<rect width="100%" height="100%" fill="${outerColor}"/>` +
        `<g transform="translate(${originX} ${originY})">${groups}${combinedSvg}</g></svg>`;
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
     (MicroQR・rMQRは ZXing 非対応のため読み取れない) */
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

  /* ---------- MicroQR・rMQR 用の自前検出 (ZXing が非対応のため) ----------
     位置検出パターン (1:1:3:1:1 濃淡比) を画像から探し、そこを基準に
     取りうる型番/寸法を総当たりでグリッドサンプリングして QRLib.decode に
     渡す。回転・傾きへの補正は行わないため、正面から近い角度で撮影/取り込み
     した画像を前提とする簡易実装。 */

  function checkFinderRatio(counts) {
    let total = 0;
    for (let i = 0; i < 5; i++) total += counts[i];
    if (total < 7) return 0;
    const moduleSize = total / 7;
    const maxVariance = moduleSize / 1.5;
    const targets = [1, 1, 3, 1, 1];
    for (let i = 0; i < 5; i++) {
      if (Math.abs(counts[i] - targets[i] * moduleSize) >= targets[i] * maxVariance) return 0;
    }
    return moduleSize;
  }

  function crossCheckLine(matrix, fixed, varStart, vertical, maxCount) {
    const limit = vertical ? matrix.getHeight() : matrix.getWidth();
    const get = (v) => (vertical ? matrix.get(fixed, v) : matrix.get(v, fixed));
    const counts = [0, 0, 0, 0, 0];
    let i = varStart;
    while (i >= 0 && get(i)) { counts[2]++; i--; }
    if (i < 0) return null;
    while (i >= 0 && !get(i) && counts[1] < maxCount) { counts[1]++; i--; }
    if (i < 0 || counts[1] >= maxCount) return null;
    while (i >= 0 && get(i) && counts[0] < maxCount) { counts[0]++; i--; }
    if (counts[0] >= maxCount) return null;

    i = varStart + 1;
    while (i < limit && get(i)) { counts[2]++; i++; }
    if (i === limit) return null;
    while (i < limit && !get(i) && counts[3] < maxCount) { counts[3]++; i++; }
    if (i === limit || counts[3] >= maxCount) return null;
    while (i < limit && get(i) && counts[4] < maxCount) { counts[4]++; i++; }
    if (counts[4] >= maxCount) return null;

    const moduleSize = checkFinderRatio(counts);
    if (!moduleSize) return null;
    return { center: i - counts[4] - counts[3] - counts[2] / 2, moduleSize };
  }

  /* 位置検出パターン候補を探し、支持数 (一致した走査行数) の多い順に返す */
  function findFinderCandidates(matrix) {
    const width = matrix.getWidth(), height = matrix.getHeight();
    const raw = [];
    const counts = [0, 0, 0, 0, 0];
    for (let y = 0; y < height; y++) {
      counts[0] = counts[1] = counts[2] = counts[3] = counts[4] = 0;
      let currentState = 0;
      for (let x = 0; x < width; x++) {
        const black = matrix.get(x, y);
        if (black) {
          if ((currentState & 1) === 1) currentState++;
          counts[currentState]++;
        } else if ((currentState & 1) === 0) {
          if (currentState === 4) {
            const moduleSize = checkFinderRatio(counts);
            if (moduleSize) {
              const centerX = x - counts[4] - counts[3] - counts[2] / 2;
              const total = (counts[0] + counts[1] + counts[2] + counts[3] + counts[4]) * 2;
              const vcheck = crossCheckLine(matrix, Math.round(centerX), y, true, total);
              if (vcheck) {
                const hcheck = crossCheckLine(matrix, Math.round(vcheck.center), Math.round(centerX), false, total);
                if (hcheck) {
                  raw.push({
                    x: hcheck.center,
                    y: vcheck.center,
                    moduleSize: (moduleSize + vcheck.moduleSize + hcheck.moduleSize) / 3,
                  });
                }
              }
            }
            counts[0] = counts[2]; counts[1] = counts[3]; counts[2] = counts[4];
            counts[3] = 1; counts[4] = 0;
            currentState = 3;
          } else {
            currentState++;
            counts[currentState]++;
          }
        } else {
          counts[currentState]++;
        }
      }
    }
    const clusters = [];
    for (const c of raw) {
      let merged = false;
      for (const cl of clusters) {
        if (Math.hypot(cl.x / cl.n - c.x, cl.y / cl.n - c.y) < (cl.moduleSize / cl.n) * 2) {
          cl.x += c.x; cl.y += c.y; cl.moduleSize += c.moduleSize; cl.n++;
          merged = true;
          break;
        }
      }
      if (!merged) clusters.push({ x: c.x, y: c.y, moduleSize: c.moduleSize, n: 1 });
    }
    return clusters
      .map((cl) => ({ x: cl.x / cl.n, y: cl.y / cl.n, moduleSize: cl.moduleSize / cl.n, support: cl.n }))
      .sort((a, b) => b.support - a.support);
  }

  /* ---- 回転・歪みへの対応 ----
     位置検出パターンの外枠 (黒画素の連結領域) を塗りつぶし探索して外形の4隅を求め、
     その4隅から得た2軸ベクトル (1モジュールあたりの移動量) でグリッドをサンプリング
     する。軸を水平・垂直に固定しないため、任意角度の回転や、軽度の遠近歪み・
     せん断による歪みにもある程度追従できる。外枠の検出に失敗した場合は、
     従来通り水平垂直を仮定したサンプリングにフォールバックする。 */

  function floodFillBlack(matrix, seedX, seedY, cx, cy, maxRadius) {
    const maxR2 = maxRadius * maxRadius;
    const visited = new Set();
    const stack = [[seedX, seedY]];
    const points = [];
    while (stack.length) {
      const [x, y] = stack.pop();
      const k = x + "," + y;
      if (visited.has(k)) continue;
      visited.add(k);
      const dx = x - cx, dy = y - cy;
      if (dx * dx + dy * dy > maxR2) continue;
      if (!matrix.get(x, y)) continue;
      points.push([x, y]);
      if (points.length > 20000) break; // 暴走防止
      stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
    }
    return points;
  }

  /* 単調連鎖法による凸包 */
  function convexHull(points) {
    const pts = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lower = [];
    for (const p of pts) {
      while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
      lower.push(p);
    }
    const upper = [];
    for (let i = pts.length - 1; i >= 0; i--) {
      const p = pts[i];
      while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
      upper.push(p);
    }
    lower.pop(); upper.pop();
    return lower.concat(upper);
  }

  function dist2(a, b) { const dx = a[0] - b[0], dy = a[1] - b[1]; return dx * dx + dy * dy; }
  function distToLine(p, a, b) {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const len = Math.hypot(dx, dy) || 1;
    return Math.abs((p[0] - a[0]) * dy - (p[1] - a[1]) * dx) / len;
  }
  function sideOfLine(p, a, b) {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    return (p[0] - a[0]) * dy - (p[1] - a[1]) * dx;
  }

  /* 凸包から四角形の4隅を推定する: 最も離れた対角の2点を求め、
     その対角線の両側でそれぞれ最も遠い点をもう2隅とする */
  function hullToQuadCorners(hull) {
    if (hull.length < 4) return null;
    let p1 = hull[0];
    for (const p of hull) if (dist2(p, hull[0]) > dist2(p1, hull[0])) p1 = p;
    let p2 = hull[0];
    for (const p of hull) if (dist2(p, p1) > dist2(p2, p1)) p2 = p;
    let p3 = null, p4 = null, d3 = -1, d4 = -1;
    for (const p of hull) {
      const side = sideOfLine(p, p1, p2);
      const d = distToLine(p, p1, p2);
      if (side >= 0) { if (d > d3) { d3 = d; p3 = p; } } else { if (d > d4) { d4 = d; p4 = p; } }
    }
    if (!p3 || !p4) return null;
    return [p1, p3, p2, p4];
  }

  /* 2点だけで辺の向きを決めると画素量子化ノイズが型番数の多い rMQR で大きく
     増幅されてしまうため、各辺に属する点群全体を全最小二乗 (PCA) で直線に
     フィットし直し、隣り合う辺どうしの交点として4隅を再計算する */
  function fitLineTLS(points) {
    let mx = 0, my = 0;
    for (const p of points) { mx += p[0]; my += p[1]; }
    mx /= points.length; my /= points.length;
    let sxx = 0, sxy = 0, syy = 0;
    for (const p of points) {
      const dx = p[0] - mx, dy = p[1] - my;
      sxx += dx * dx; sxy += dx * dy; syy += dy * dy;
    }
    const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy);
    return { point: [mx, my], dir: [Math.cos(theta), Math.sin(theta)] };
  }
  function intersectLines(l1, l2) {
    const [d1x, d1y] = l1.dir, [d2x, d2y] = l2.dir;
    const det = -d1x * d2y + d2x * d1y;
    if (Math.abs(det) < 1e-9) return null;
    const dx = l2.point[0] - l1.point[0], dy = l2.point[1] - l1.point[1];
    const t1 = (dx * -d2y - -d2x * dy) / det;
    return [l1.point[0] + t1 * d1x, l1.point[1] + t1 * d1y];
  }
  function refineQuadCorners(points, roughCorners) {
    const edges = [];
    for (let i = 0; i < 4; i++) edges.push([roughCorners[i], roughCorners[(i + 1) % 4]]);
    const groups = [[], [], [], []];
    for (const p of points) {
      let best = -1, bestD = Infinity;
      for (let i = 0; i < 4; i++) {
        const d = distToLine(p, edges[i][0], edges[i][1]);
        if (d < bestD) { bestD = d; best = i; }
      }
      groups[best].push(p);
    }
    if (groups.some((g) => g.length < 4)) return null;
    const lines = groups.map(fitLineTLS);
    const corners = [];
    for (let i = 0; i < 4; i++) {
      const pt = intersectLines(lines[(i + 3) % 4], lines[i]);
      if (!pt) return null;
      corners.push(pt);
    }
    return corners;
  }

  /* 位置検出パターン (候補点周辺) の外枠を塗りつぶし探索し、外形の4隅を返す */
  function findFinderCorners(matrix, cand) {
    let seed = null;
    for (let a = 0; a < 24 && !seed; a++) {
      const ang = (a / 24) * Math.PI * 2;
      const sx = Math.round(cand.x + Math.cos(ang) * cand.moduleSize * 2.7);
      const sy = Math.round(cand.y + Math.sin(ang) * cand.moduleSize * 2.7);
      if (matrix.get(sx, sy)) seed = [sx, sy];
    }
    if (!seed) return null;
    const points = floodFillBlack(matrix, seed[0], seed[1], cand.x, cand.y, cand.moduleSize * 5);
    if (points.length < 8) return null;
    const roughCorners = hullToQuadCorners(convexHull(points));
    if (!roughCorners) return null;
    const corners = refineQuadCorners(points, roughCorners) || roughCorners;
    const expected = cand.moduleSize * 7;
    for (let i = 0; i < 4; i++) {
      const len = Math.sqrt(dist2(corners[i], corners[(i + 1) % 4]));
      if (len < expected * 0.5 || len > expected * 1.8) return null;
    }
    return corners;
  }

  /* 4隅を周回順に保ったまま、原点(0,0)モジュールの候補として4通り
     (回転0/90/180/270相当) の軸ベクトルを作る。ミラー画像は対象外なので
     周回の向きは固定でよく、4通りで足りる。隅どうしの距離 (ノイズを含む) は
     方向のみに使い、実際の大きさはサブピクセル精度の moduleSize / 中心座標
     から再計算する (離れたモジュールほど誤差が拡大されるため) */
  function cornerOrientationCandidates(corners, finderModules, moduleSize, center) {
    const cx = corners.reduce((s, p) => s + p[0], 0) / 4;
    const cy = corners.reduce((s, p) => s + p[1], 0) / 4;
    const ordered = corners.slice().sort((a, b) => Math.atan2(a[1] - cy, a[0] - cx) - Math.atan2(b[1] - cy, b[0] - cx));
    const candidates = [];
    for (let i = 0; i < 4; i++) {
      const origin = ordered[i];
      const next = ordered[(i + 1) % 4];
      const prev = ordered[(i + 3) % 4];
      const xLen = Math.hypot(next[0] - origin[0], next[1] - origin[1]) || 1;
      const yLen = Math.hypot(prev[0] - origin[0], prev[1] - origin[1]) || 1;
      const xAxis = [(next[0] - origin[0]) / xLen * moduleSize, (next[1] - origin[1]) / xLen * moduleSize];
      const yAxis = [(prev[0] - origin[0]) / yLen * moduleSize, (prev[1] - origin[1]) / yLen * moduleSize];
      const half = finderModules / 2;
      candidates.push({
        origin: [center.x - half * xAxis[0] - half * yAxis[0], center.y - half * xAxis[1] - half * yAxis[1]],
        xAxis,
        yAxis,
      });
    }
    return candidates;
  }

  function sampleGridWithAxes(matrix, origin, xAxis, yAxis, cols, rows) {
    const grid = [];
    for (let r = 0; r < rows; r++) {
      const row = [];
      for (let c = 0; c < cols; c++) {
        const px = Math.round(origin[0] + (c + 0.5) * xAxis[0] + (r + 0.5) * yAxis[0]);
        const py = Math.round(origin[1] + (c + 0.5) * xAxis[1] + (r + 0.5) * yAxis[1]);
        row.push(matrix.get(px, py) ? 1 : 0);
      }
      grid.push(row);
    }
    return grid;
  }

  function boxFromOrientation(ori, cols, rows) {
    const corners = [
      ori.origin,
      [ori.origin[0] + cols * ori.xAxis[0], ori.origin[1] + cols * ori.xAxis[1]],
      [ori.origin[0] + rows * ori.yAxis[0], ori.origin[1] + rows * ori.yAxis[1]],
      [ori.origin[0] + cols * ori.xAxis[0] + rows * ori.yAxis[0], ori.origin[1] + cols * ori.xAxis[1] + rows * ori.yAxis[1]],
    ];
    const xs = corners.map((p) => p[0]), ys = corners.map((p) => p[1]);
    const x0 = Math.min(...xs), y0 = Math.min(...ys);
    return { x0, y0, w: Math.max(...xs) - x0, h: Math.max(...ys) - y0 };
  }

  /* 位置検出パターンの向き候補一覧を作る。外枠検出に成功すれば回転・歪み耐性のある
     4候補、失敗すれば従来通りの水平垂直サンプリングにフォールバックする */
  function finderOrientations(matrix, cand) {
    const orientations = [];
    const corners = findFinderCorners(matrix, cand);
    if (corners) orientations.push(...cornerOrientationCandidates(corners, 7, cand.moduleSize, { x: cand.x, y: cand.y }));
    orientations.push({
      origin: [cand.x - 3.5 * cand.moduleSize, cand.y - 3.5 * cand.moduleSize],
      xAxis: [cand.moduleSize, 0],
      yAxis: [0, cand.moduleSize],
    });
    return orientations;
  }

  /* MicroQR (4 型番) と rMQR (32 型番) を、検出した位置検出パターンを起点に総当たりで試す */
  function tryDecodeMicroRmqr(offCanvas) {
    if (!zxingAvailable) return null;
    const luminanceSource = new ZXing.HTMLCanvasElementLuminanceSource(offCanvas);
    const binarizer = new ZXing.HybridBinarizer(luminanceSource);
    const matrix = new ZXing.BinaryBitmap(binarizer).getBlackMatrix();
    const candidates = findFinderCandidates(matrix).slice(0, 5);
    for (const cand of candidates) {
      for (const ori of finderOrientations(matrix, cand)) {
        for (const size of QRLib.MICRO_SIZES) {
          try {
            const grid = sampleGridWithAxes(matrix, ori.origin, ori.xAxis, ori.yAxis, size, size);
            const decoded = QRLib.decode(grid, "micro");
            return { std: "micro", decoded, box: boxFromOrientation(ori, size, size) };
          } catch (e) { /* 次の候補を試す */ }
        }
        for (let i = 0; i < QRLib.RMQR_HEIGHTS.length; i++) {
          try {
            const grid = sampleGridWithAxes(matrix, ori.origin, ori.xAxis, ori.yAxis, QRLib.RMQR_WIDTHS[i], QRLib.RMQR_HEIGHTS[i]);
            const decoded = QRLib.decode(grid, "rmqr");
            return { std: "rmqr", decoded, box: boxFromOrientation(ori, QRLib.RMQR_WIDTHS[i], QRLib.RMQR_HEIGHTS[i]) };
          } catch (e) { /* 次の候補を試す */ }
        }
      }
    }
    return null;
  }

  function handleCustomDecodeResult(found, offCanvas) {
    const { std, decoded, box } = found;
    const x0 = Math.max(0, Math.floor(box.x0));
    const y0 = Math.max(0, Math.floor(box.y0));
    const w = Math.min(offCanvas.width - x0, Math.ceil(box.w));
    const h = Math.min(offCanvas.height - y0, Math.ceil(box.h));
    const colors = sampleScanColorsInBox(offCanvas, x0, y0, w, h);
    if (colors) {
      if (colors.fg) state.fg = colors.fg;
      if (colors.bg) { state.bg = colors.bg; state.outerBg = colors.bg; state.outerSame = true; }
      $("color-fg").value = state.fg;
      $("color-bg").value = state.bg;
      $("color-outer").value = state.outerBg;
      $("color-outer").disabled = state.outerSame;
      $("color-outer-same").checked = state.outerSame;
    }
    dataInput.value = decoded.text;
    if (std === "micro") {
      state.micro.versionAuto = false;
      state.micro.version = Number(decoded.versionName.slice(1));
      state.micro.ec = decoded.ecLevel;
      state.micro.maskAuto = false;
      state.micro.mask = decoded.mask;
    } else {
      const m = /^R(\d+)x(\d+)$/.exec(decoded.versionName);
      state.rmqr.versionAuto = false;
      state.rmqr.height = Number(m[1]);
      state.rmqr.width = Number(m[2]);
      state.rmqr.ec = decoded.ecLevel;
    }
    setScanStatus(`読み取り成功 (${std === "micro" ? "MicroQR" : "rMQR"})`);
    selectStandard(std);
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

  /* 指定した矩形領域内の画素を明暗2群に分け、それぞれの平均色を返す */
  function sampleScanColorsInBox(offCanvas, x0, y0, w, h) {
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

  /* 読み取ったコードの明暗モジュールの平均色を、背景色・本体色として採用する (ZXing の結果点群から) */
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
    return sampleScanColorsInBox(offCanvas, x0, y0, w, h);
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
    let frameCount = 0;
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
          // このフレームでは見つからなかった。MicroQR/rMQR用の自前検出も
          // 毎フレームだと重いため、数フレームに一度だけ試す
          frameCount++;
          if (frameCount % 3 === 0) {
            const small = scaleCanvasTo(off, 500);
            const found = tryDecodeMicroRmqr(small);
            if (found) {
              stopCameraScan();
              handleCustomDecodeResult(found, small);
              return;
            }
          }
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
        const found = tryDecodeMicroRmqr(off);
        if (found) {
          handleCustomDecodeResult(found, off);
        } else {
          setScanStatus("コードが見つかりませんでした", true);
        }
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

  /* モバイル用「規格選択」パネル: デスクトップの .tabs-vertical をそのまま
     複製し (アイコン・説明文つきのリッチな見た目を再利用)、折りたたみ式の
     ボタン+パネルとして表示する。「デコード」カテゴリは規格選択と無関係な
     操作ボタン (#scan-status 等) を含むため、複製すると id が重複して
     document.getElementById 系のルックアップが壊れる。複製後に取り除く */
  const standardComboPanel = $("standard-combo-panel");
  const tabsVerticalClone = document.querySelector(".left-menu-zone > .tabs-vertical").cloneNode(true);
  tabsVerticalClone.querySelector('.tab-category[data-category="decode"]')?.remove();
  standardComboPanel.appendChild(tabsVerticalClone);

  function selectStandard(std) {
    state.standard = std;
    for (const tab of document.querySelectorAll(".tab")) {
      tab.setAttribute("aria-selected", tab.dataset.standard === std ? "true" : "false");
    }
    const source = document.querySelector(`.left-menu-zone > .tabs-vertical .tab-rich[data-standard="${std}"]`);
    if (source) $("standard-combo-current").innerHTML = source.querySelector(".tab-rich-main").innerHTML;
    rebuildControls();
    render();
  }

  for (const tab of document.querySelectorAll(".tab")) {
    tab.addEventListener("click", () => {
      selectStandard(tab.dataset.standard);
      closeQuickCombos();
    });
  }
  dataInput.addEventListener("input", render);

  /* 入力部右上の「全削除」ボタン: 入力文字列だけを消す (規格・色などの設定は保持) */
  $("data-clear-btn").addEventListener("click", () => {
    dataInput.value = "";
    dataInput.focus();
    render();
  });

  /* サイトタイトル下の「初回ロード時の状態に戻す」ボタン: URL のクエリパラメーターを
     含め、入力内容・色・複雑度などすべての設定を初回アクセス時の状態にリセットする。
     状態を1つずつ手動で戻すと漏れが出やすいため、URL を素の状態にしてページ自体を
     再読み込みする方式にする。 */
  $("reset-all-btn").addEventListener("click", () => {
    if (!confirm("入力内容や設定をすべて初回ロード時の状態に戻します。よろしいですか?")) return;
    location.href = location.pathname;
  });

  /* モバイル用の折りたたみメニュー (規格選択・デコード) の開閉制御 */
  function closeQuickCombos() {
    for (const combo of document.querySelectorAll(".quick-combo")) {
      combo.querySelector(".quick-combo-panel").hidden = true;
      combo.querySelector(".quick-combo-btn").setAttribute("aria-expanded", "false");
    }
  }
  function toggleQuickCombo(combo) {
    const panel = combo.querySelector(".quick-combo-panel");
    const wasHidden = panel.hidden;
    closeQuickCombos();
    panel.hidden = !wasHidden;
    combo.querySelector(".quick-combo-btn").setAttribute("aria-expanded", wasHidden ? "true" : "false");
  }
  $("standard-combo-btn").addEventListener("click", () => toggleQuickCombo($("standard-combo")));
  $("decode-combo-btn").addEventListener("click", () => toggleQuickCombo($("decode-combo")));
  document.addEventListener("click", (ev) => {
    if (!ev.target.closest(".quick-combo")) closeQuickCombos();
  });
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") closeQuickCombos();
  });
  $("decode-combo-camera").addEventListener("click", () => {
    closeQuickCombos();
    startCameraScan();
  });
  $("decode-combo-image").addEventListener("click", () => {
    closeQuickCombos();
    scanFileInput.click();
  });

  /* 右メニューゾーンのタブ切り替え (モバイルのみ CSS で有効化) */
  for (const btn of document.querySelectorAll(".right-menu-tab-btn")) {
    btn.addEventListener("click", () => {
      for (const b of document.querySelectorAll(".right-menu-tab-btn")) {
        b.setAttribute("aria-selected", b === btn ? "true" : "false");
      }
      for (const panel of document.querySelectorAll(".right-menu-panel")) {
        panel.classList.toggle("tab-inactive", panel.dataset.tab !== btn.dataset.tab);
      }
    });
  }

  /* 「諸元」「外観」はデスクトップでは中央カラムに置くが、モバイルでは
     右メニューゾーンのタブに移して縦幅を節約する。DOM 上の1つの要素を、
     幅の判定に応じて付け替える (2箇所に複製すると renderInfo() 等が
     二重管理になるため)。デスクトップに戻す際は元の挿入位置 (親要素・
     直後の兄弟要素) を記憶しておき、並び順が崩れないようにする */
  function makeResponsiveMover(el, mobileHome) {
    const desktopParent = el.parentElement;
    const desktopNextSibling = el.nextSibling;
    return () => {
      if (mobileMq.matches) mobileHome.appendChild(el);
      else desktopParent.insertBefore(el, desktopNextSibling);
    };
  }
  const mobileMq = window.matchMedia("(max-width: 760px)");
  const responsiveMovers = [
    makeResponsiveMover($("info-field"), $("right-menu-info-panel")),
    makeResponsiveMover($("color-field"), $("right-menu-color-panel")),
    /* #scan-status は .tabs-vertical (デコードのカテゴリ内) に置かれているが、
       モバイルでは .tabs-vertical ごと display:none になるため、カメラ起動
       失敗時のエラーメッセージ等が一切見えなくなっていた。常に見える
       mobile-top-bar の直下に付け替える */
    makeResponsiveMover(scanStatus, $("mobile-scan-status-slot")),
  ];
  function applyResponsiveMovers() {
    responsiveMovers.forEach((move) => move());
  }
  mobileMq.addEventListener("change", applyResponsiveMovers);
  applyResponsiveMovers();

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
