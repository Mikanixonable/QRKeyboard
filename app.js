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
  const contentBar = $("content-bar");
  const contentLabel = $("content-label");
  const contentText = $("content-text");
  const contentStatus = $("content-status");
  const editReset = $("edit-reset");

  const MODE_NAMES = { numeric: "数字", alphanumeric: "英数字", byte: "バイト (UTF-8)" };
  const QR_FAMILY = ["qr", "micro", "rmqr"];

  function rmqrWidthsFor(h) {
    const widths = [];
    for (let i = 0; i < 32; i++) {
      if (QRLib.RMQR_HEIGHTS[i] === h) widths.push(QRLib.RMQR_WIDTHS[i]);
    }
    return widths;
  }
  function rmqrVersionOf(h, w) {
    for (let i = 0; i < 32; i++) {
      if (QRLib.RMQR_HEIGHTS[i] === h && QRLib.RMQR_WIDTHS[i] === w) return i + 1;
    }
    return 0;
  }

  /* 規格ごとの選択状態 */
  const state = {
    standard: "qr",
    fg: "#000000",
    bg: "#ffffff",
    outerBg: "#e5e7eb",
    outerSame: false,
    splitMode: "simple", // "simple" | "structured" (QR の Structured Append)
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

  function makeAutoToggle(checked, onChange, text) {
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
      [["JAN / EAN-13", "ean13"], ["Code 128", "code128"], ["Code 39", "code39"]].forEach(([name, sym]) => {
        seg.appendChild(makeSegButton(name, st.symbology === sym, () => {
          st.symbology = sym;
          rebuildControls();
          render();
        }));
      });
      box.appendChild(seg);
      return;
    }

    const line = document.createElement("div");
    line.className = "version-line";
    const autoKey = std === "datamatrix" ? "sizeAuto" : "versionAuto";
    line.appendChild(makeAutoToggle(st[autoKey], (checked) => {
      st[autoKey] = checked;
      if (std === "micro") normalizeMicroEc();
      rebuildControls();
      render();
    }));

    if (std === "qr") {
      const range = document.createElement("input");
      range.type = "range";
      range.min = "1";
      range.max = "40";
      range.value = String(st.version);
      range.disabled = st.versionAuto;
      const value = document.createElement("span");
      value.className = "version-value";
      value.textContent = st.versionAuto ? "—" : `型番 ${st.version}`;
      range.addEventListener("input", () => {
        st.version = Number(range.value);
        value.textContent = `型番 ${st.version}`;
        render();
      });
      line.append(range, value);
      box.appendChild(line);
    } else if (std === "micro") {
      const seg = document.createElement("div");
      seg.className = "segmented";
      for (let v = 1; v <= 4; v++) {
        seg.appendChild(makeSegButton(`M${v}`, !st.versionAuto && st.version === v, () => {
          st.versionAuto = false;
          st.version = v;
          normalizeMicroEc();
          rebuildControls();
          render();
        }));
      }
      line.appendChild(seg);
      box.appendChild(line);
    } else if (std === "rmqr") {
      // 高さ・幅の2パラメーターで決まるため、2次元タイル選択のモーダルで選ぶ
      box.appendChild(line);
      const trigger = document.createElement("button");
      trigger.type = "button";
      trigger.className = "small-button version-modal-trigger";
      trigger.disabled = st.versionAuto;
      trigger.textContent = st.versionAuto
        ? "自動選択中"
        : `R${st.height} × ${st.width} (タップで変更)`;
      trigger.addEventListener("click", openRmqrModal);
      box.appendChild(trigger);
      return;
    } else if (std === "datamatrix") {
      const select = document.createElement("select");
      select.disabled = st.sizeAuto;
      const sq = document.createElement("optgroup");
      sq.label = "正方形";
      const rect = document.createElement("optgroup");
      rect.label = "長方形 (DMRE ではない標準サイズ)";
      DMLib.SIZES.forEach((s, i) => {
        const opt = document.createElement("option");
        opt.value = String(i + 1);
        opt.textContent = `${DMLib.SIZE_NAMES[i]} (${s.data} 語)`;
        (s.rect ? rect : sq).appendChild(opt);
      });
      select.append(sq, rect);
      select.value = String(st.size);
      select.addEventListener("change", () => {
        st.size = Number(select.value);
        render();
      });
      line.appendChild(select);
      box.appendChild(line);
      return;
    } else if (std === "aztec") {
      const select = document.createElement("select");
      select.disabled = st.versionAuto;
      const compact = document.createElement("optgroup");
      compact.label = "コンパクト型";
      for (let l = 1; l <= 4; l++) {
        const opt = document.createElement("option");
        opt.value = String(l);
        const dim = 11 + 4 * l;
        opt.textContent = `コンパクト ${l}層 (${dim}×${dim})`;
        compact.appendChild(opt);
      }
      const full = document.createElement("optgroup");
      full.label = "フル型";
      for (let l = 1; l <= 32; l++) {
        const opt = document.createElement("option");
        opt.value = String(l + 4);
        const dim = 151 - 2 * [66, 64, 62, 60, 57, 55, 53, 51, 49, 47, 45, 42, 40, 38, 36, 34,
          32, 30, 28, 25, 23, 21, 19, 17, 15, 13, 10, 8, 6, 4, 2, 0][l - 1];
        opt.textContent = `フル ${l}層 (${dim}×${dim})`;
        full.appendChild(opt);
      }
      select.append(compact, full);
      select.value = String(st.version);
      select.addEventListener("change", () => {
        st.version = Number(select.value);
        render();
      });
      line.appendChild(select);
      box.appendChild(line);
      return;
    }
  }

  /* ---------- 型番選択モーダル (rMQR: 高さ×幅の2次元タイル選択) ---------- */

  /* 列(幅)は右に行くほど、行(高さ)は上に行くほど単純・小さい選択肢になるよう並べる */
  const RMQR_MODAL_WIDTHS = [139, 99, 77, 59, 43, 27];
  const RMQR_MODAL_HEIGHTS = [7, 9, 11, 13, 15, 17];

  function openRmqrModal() {
    const st = state.rmqr;
    const grid = $("version-modal-grid");
    grid.textContent = "";
    grid.style.gridTemplateColumns = `auto repeat(${RMQR_MODAL_WIDTHS.length}, 1fr)`;

    grid.appendChild(document.createElement("span"));
    for (const w of RMQR_MODAL_WIDTHS) {
      const lbl = document.createElement("span");
      lbl.className = "modal-axis-label";
      lbl.textContent = `×${w}`;
      grid.appendChild(lbl);
    }
    for (const h of RMQR_MODAL_HEIGHTS) {
      const hLbl = document.createElement("span");
      hLbl.className = "modal-axis-label";
      hLbl.textContent = `R${h}`;
      grid.appendChild(hLbl);
      const validWidths = rmqrWidthsFor(h);
      for (const w of RMQR_MODAL_WIDTHS) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "modal-tile";
        if (!validWidths.includes(w)) {
          btn.disabled = true;
          grid.appendChild(btn);
          continue;
        }
        btn.setAttribute("role", "radio");
        btn.setAttribute("aria-checked", st.height === h && st.width === w ? "true" : "false");
        btn.textContent = `R${h} × ${w}`;
        btn.addEventListener("click", () => {
          st.versionAuto = false;
          st.height = h;
          st.width = w;
          closeRmqrModal();
          rebuildControls();
          render();
        });
        grid.appendChild(btn);
      }
    }
    $("version-modal").hidden = false;
  }

  function closeRmqrModal() {
    $("version-modal").hidden = true;
  }

  $("version-modal-close").addEventListener("click", closeRmqrModal);
  $("version-modal").addEventListener("click", (ev) => {
    if (ev.target.id === "version-modal") closeRmqrModal();
  });
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") closeRmqrModal();
  });

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
    box.appendChild(makeAutoToggle(st.showText, (checked) => {
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

  function rebuildControls() {
    $("preview").classList.toggle("other-standard", !QR_FAMILY.includes(state.standard));
    buildEcControl();
    buildVersionControl();
    buildMaskControl();
    buildBarcodeTextControl();
    buildSplitModeControl();
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
     各コードを縮小してグリッド配置する (drawCurrent 側で対応)。 */
  function runEncodeMulti() {
    const std = state.standard;
    const text = dataInput.value;
    try {
      return [encodeOne(std, text, null)];
    } catch (e) {
      if (!(e && e.code === "TOO_LONG") || std === "barcode") throw e;
    }
    const structuredEligible = std === "qr" && state.splitMode === "structured";
    const maxCount = structuredEligible ? 16 : 40;
    let lastErr = null;
    for (let count = 2; count <= maxCount; count++) {
      const chunks = splitEvenly(text, count);
      if (chunks.length < count) break; // 1文字/コードが下限。これ以上細かくできない
      try {
        const parity = structuredEligible ? QRLib.computeParity(text) : null;
        return chunks.map((chunk, i) =>
          encodeOne(std, chunk, structuredEligible ? { index: i, count, parity } : null));
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
      const qz = r.quietZone;
      const mw = r.width + qz * 2;
      const mh = r.height + qz * 2;
      const scale = Math.max(1, Math.floor(Math.min(availW / mw, availH / mh)));
      canvas.width = mw * scale;
      canvas.height = mh * scale;
      canvas.style.width = `${canvas.width / dpr}px`;
      canvas.style.height = `${canvas.height / dpr}px`;
      ctx.fillStyle = state.bg;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = state.fg;
      const modules = current.modulesList[0];
      for (let y = 0; y < r.height; y++) {
        const row = modules[y];
        for (let x = 0; x < r.width; x++) {
          if (row[x]) ctx.fillRect((x + qz) * scale, (y + qz) * scale, scale, scale);
        }
      }
      lastDraw = { scale, qz, dpr };
      return;
    }

    /* 複数コード: QR 表示域の大きさは変えず、グリッドに縮小配置する。編集は非対応。 */
    const n = results.length;
    const { cols, rows } = gridDims(n);
    const gap = GRID_GAP * dpr;
    const cellW = (availW - gap * (cols - 1)) / cols;
    const cellH = (availH - gap * (rows - 1)) / rows;
    const dims = results.map((r) => ({ mw: r.width + r.quietZone * 2, mh: r.height + r.quietZone * 2 }));
    let scale = Infinity;
    for (const { mw, mh } of dims) scale = Math.min(scale, Math.floor(Math.min(cellW / mw, cellH / mh)));
    scale = Math.max(1, scale);

    canvas.width = Math.round(availW);
    canvas.height = Math.round(availH);
    canvas.style.width = `${canvas.width / dpr}px`;
    canvas.style.height = `${canvas.height / dpr}px`;
    ctx.fillStyle = state.bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = state.fg;
    for (let i = 0; i < n; i++) {
      const r = results[i];
      const { mw, mh } = dims[i];
      const col = i % cols, row = Math.floor(i / cols);
      const cellX = col * (cellW + gap);
      const cellY = row * (cellH + gap);
      const offX = cellX + (cellW - mw * scale) / 2;
      const offY = cellY + (cellH - mh * scale) / 2;
      const qz = r.quietZone;
      const modules = current.modulesList[i];
      for (let y = 0; y < r.height; y++) {
        const rowData = modules[y];
        for (let x = 0; x < r.width; x++) {
          if (rowData[x]) ctx.fillRect(offX + (x + qz) * scale, offY + (y + qz) * scale, scale, scale);
        }
      }
    }
    lastDraw = null;
  }

  /* ---------- 内容表示 (QR 系は行列からリアルタイム復号) ---------- */

  function updateContent() {
    const std = state.standard;
    contentText.classList.remove("unreadable");
    contentStatus.className = "content-status";
    if (!current) {
      contentText.textContent = "";
      contentStatus.textContent = "";
      return;
    }
    const results = current.results;
    const r = results[0];
    if (QR_FAMILY.includes(std)) {
      contentLabel.textContent = results.length > 1 ? "内容(復号・結合)" : "内容(復号)";
      try {
        let combined = "";
        let totalCorrected = 0;
        for (let i = 0; i < results.length; i++) {
          const d = QRLib.decode(current.modulesList[i], std);
          combined += d.text;
          totalCorrected += d.corrected;
        }
        contentText.textContent = combined === "" ? "(空)" : combined;
        if (totalCorrected > 0) {
          contentStatus.textContent = `誤り訂正で ${totalCorrected} コード語を復元`;
          contentStatus.classList.add("corrected");
        } else {
          contentStatus.textContent = current.edited ? "訂正なしで一致" : "";
        }
      } catch (e) {
        contentText.textContent = "(読み取り不能)";
        contentText.classList.add("unreadable");
        contentStatus.textContent = e.message;
        contentStatus.classList.add("error");
      }
    } else if (std === "barcode") {
      contentLabel.textContent = "内容";
      contentText.textContent = r.display;
      contentStatus.textContent = r.symbology === "ean13" && dataInput.value.length === 12
        ? `検査数字 ${r.display[12]} を付加` : "";
    } else {
      contentLabel.textContent = "内容";
      contentText.textContent = dataInput.value;
      contentStatus.textContent = "";
    }
  }

  /* ---------- 情報表示 ---------- */

  function renderInfo() {
    infoEl.textContent = "";
    if (!current) return;
    const std = state.standard;
    const st = state[std];
    const results = current.results;
    const r = results[0];
    const items = [];
    const sizeText = `${r.width}×${r.height}`;

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
    for (const [dt, dd] of items) {
      const div = document.createElement("div");
      const dtEl = document.createElement("dt");
      const ddEl = document.createElement("dd");
      dtEl.textContent = dt;
      ddEl.textContent = dd;
      div.append(dtEl, ddEl);
      infoEl.appendChild(div);
    }
  }

  /* ---------- レンダリング統括 ---------- */

  function showError(message) {
    current = null;
    lastDraw = null;
    canvas.hidden = true;
    qrMessage.hidden = false;
    qrMessage.textContent = message;
    /* content-bar / info は非表示にせず空にするだけにして、
       QR 表示域 (qr-frame) の高さがエラー時にも変化しないようにする */
    infoEl.textContent = "";
    contentText.textContent = "";
    contentStatus.textContent = "";
    editReset.hidden = true;
    qrCard.style.background = state.outerSame ? state.bg : state.outerBg;
  }

  function render() {
    const std = state.standard;
    try {
      const results = runEncodeMulti();
      current = {
        results,
        modulesList: results.map((res) => res.modules.map((row) => row.slice())),
        edited: false,
      };
      canvas.hidden = false;
      qrMessage.hidden = true;
      editReset.hidden = true;
      const editable = results.length === 1 && QR_FAMILY.includes(std);
      canvas.classList.toggle("editable", editable);
      drawCurrent();
      updateContent();
      renderInfo();
    } catch (e) {
      if (e && (e.code || e.name === "QREncodeError")) {
        showError(e.message);
      } else {
        showError("エンコードに失敗しました");
        console.error(e);
      }
    }
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
    updateContent();
  });

  editReset.addEventListener("click", () => {
    if (!current || current.results.length !== 1) return;
    current.modulesList[0] = current.results[0].modules.map((row) => row.slice());
    current.edited = false;
    editReset.hidden = true;
    drawCurrent();
    updateContent();
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

  $("save-png").addEventListener("click", () => {
    if (!current) return;
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
    off.toBlob((blob) => blob && download(blob, `${filenameBase()}.png`), "image/png");
  });

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
  });
  $("color-bg").addEventListener("input", () => {
    state.bg = $("color-bg").value;
    drawCurrent();
  });
  $("color-outer").addEventListener("input", () => {
    state.outerBg = $("color-outer").value;
    drawCurrent();
  });
  $("color-outer-same").addEventListener("change", () => {
    state.outerSame = $("color-outer-same").checked;
    $("color-outer").disabled = state.outerSame;
    drawCurrent();
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

  new ResizeObserver(() => {
    if (current) drawCurrent();
  }).observe(qrCard);

  selectStandard("qr");
})();
