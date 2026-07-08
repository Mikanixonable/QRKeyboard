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
  const editHint = $("edit-hint");
  const editReset = $("edit-reset");

  const MODE_NAMES = { numeric: "数字", alphanumeric: "英数字", byte: "バイト (UTF-8)" };
  const QR_FAMILY = ["qr", "micro", "rmqr"];
  const RMQR_HEIGHTS = [7, 9, 11, 13, 15, 17];

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
    qr: { ec: "M", versionAuto: true, version: 5, maskAuto: true, mask: 0 },
    micro: { ec: "L", versionAuto: true, version: 4, maskAuto: true, mask: 0 },
    rmqr: { ec: "M", versionAuto: true, height: 11, width: 43 },
    datamatrix: { sizeAuto: true, size: 4 },
    aztec: { ec: 1, versionAuto: true, version: 6 },
    barcode: { symbology: "code128" },
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

  function makeAutoToggle(checked, onChange) {
    const label = document.createElement("label");
    label.className = "auto-toggle";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = checked;
    cb.addEventListener("change", () => onChange(cb.checked));
    label.append(cb, document.createTextNode("自動"));
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
      value.textContent = st.versionAuto ? "—" : "型番 " + st.version;
      range.addEventListener("input", () => {
        st.version = Number(range.value);
        value.textContent = "型番 " + st.version;
        render();
      });
      line.append(range, value);
      box.appendChild(line);
    } else if (std === "micro") {
      const seg = document.createElement("div");
      seg.className = "segmented";
      for (let v = 1; v <= 4; v++) {
        seg.appendChild(makeSegButton("M" + v, !st.versionAuto && st.version === v, () => {
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
      // 高さ (R7〜R17) と幅を分けて選択
      box.appendChild(line);
      const hLine = document.createElement("div");
      hLine.className = "version-line";
      const hLabel = document.createElement("span");
      hLabel.className = "dim-label";
      hLabel.textContent = "高さ";
      const hSeg = document.createElement("div");
      hSeg.className = "segmented";
      for (const h of RMQR_HEIGHTS) {
        const btn = makeSegButton("R" + h, !st.versionAuto && st.height === h, () => {
          st.versionAuto = false;
          st.height = h;
          const widths = rmqrWidthsFor(h);
          if (!widths.includes(st.width)) st.width = widths[0];
          rebuildControls();
          render();
        });
        btn.disabled = st.versionAuto;
        hSeg.appendChild(btn);
      }
      hLine.append(hLabel, hSeg);
      box.appendChild(hLine);

      const wLine = document.createElement("div");
      wLine.className = "version-line";
      const wLabel = document.createElement("span");
      wLabel.className = "dim-label";
      wLabel.textContent = "幅";
      const wSeg = document.createElement("div");
      wSeg.className = "segmented";
      for (const w of rmqrWidthsFor(st.height)) {
        const btn = makeSegButton("×" + w, !st.versionAuto && st.width === w, () => {
          st.versionAuto = false;
          st.width = w;
          rebuildControls();
          render();
        });
        btn.disabled = st.versionAuto;
        wSeg.appendChild(btn);
      }
      wLine.append(wLabel, wSeg);
      box.appendChild(wLine);
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
        opt.textContent = DMLib.SIZE_NAMES[i] + " (" + s.data + " 語)";
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
        opt.textContent = "コンパクト " + l + "層 (" + (11 + 4 * l) + "×" + (11 + 4 * l) + ")";
        compact.appendChild(opt);
      }
      const full = document.createElement("optgroup");
      full.label = "フル型";
      for (let l = 1; l <= 32; l++) {
        const opt = document.createElement("option");
        opt.value = String(l + 4);
        const dim = 151 - 2 * [66, 64, 62, 60, 57, 55, 53, 51, 49, 47, 45, 42, 40, 38, 36, 34,
          32, 30, 28, 25, 23, 21, 19, 17, 15, 13, 10, 8, 6, 4, 2, 0][l - 1];
        opt.textContent = "フル " + l + "層 (" + dim + "×" + dim + ")";
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
    box.style.gridTemplateColumns = "repeat(" + (std === "qr" ? 8 : 4) + ", 1fr)";
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

  function rebuildControls() {
    $("controls").classList.toggle("other-standard", !QR_FAMILY.includes(state.standard));
    buildEcControl();
    buildVersionControl();
    buildMaskControl();
  }

  /* ---------- エンコード ---------- */

  function runEncode() {
    const std = state.standard;
    const st = state[std];
    const text = dataInput.value;
    switch (std) {
      case "qr":
      case "micro":
        return QRLib.encode({
          standard: std, text, ecLevel: st.ec,
          version: st.versionAuto ? 0 : st.version,
          mask: st.maskAuto ? -1 : st.mask,
        });
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

  /* ---------- 描画 ---------- */

  let current = null; // { result, modules(編集用コピー), edited }
  let lastDraw = null; // クリック座標→モジュール変換用

  function drawCurrent() {
    if (!current) return;
    const r = current.result;
    const box = qrCard.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const availW = Math.max(40, box.width - 24) * dpr;
    const availH = Math.max(40, box.height - 24) * dpr;

    qrCard.style.background = state.bg;

    if (r.type === "linear") {
      const totalW = r.quietLeft + r.width + r.quietRight;
      const scale = Math.max(1, Math.floor(availW / totalW));
      const barH = Math.max(30 * dpr, Math.min(availH - 8 * dpr, Math.round(totalW * scale * 0.3)));
      canvas.width = totalW * scale;
      canvas.height = barH + 16 * scale;
      canvas.style.width = canvas.width / dpr + "px";
      canvas.style.height = canvas.height / dpr + "px";
      ctx.fillStyle = state.bg;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = state.fg;
      for (let x = 0; x < r.width; x++) {
        if (r.pattern[x]) {
          ctx.fillRect((r.quietLeft + x) * scale, 8 * scale, scale, barH);
        }
      }
      lastDraw = null;
      return;
    }

    const qz = r.quietZone;
    const mw = r.width + qz * 2;
    const mh = r.height + qz * 2;
    const scale = Math.max(1, Math.floor(Math.min(availW / mw, availH / mh)));
    canvas.width = mw * scale;
    canvas.height = mh * scale;
    canvas.style.width = canvas.width / dpr + "px";
    canvas.style.height = canvas.height / dpr + "px";
    ctx.fillStyle = state.bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = state.fg;
    const modules = current.modules;
    for (let y = 0; y < r.height; y++) {
      const row = modules[y];
      for (let x = 0; x < r.width; x++) {
        if (row[x]) ctx.fillRect((x + qz) * scale, (y + qz) * scale, scale, scale);
      }
    }
    lastDraw = { scale, qz, dpr };
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
    const r = current.result;
    if (QR_FAMILY.includes(std)) {
      contentLabel.textContent = "内容(復号)";
      try {
        const d = QRLib.decode(current.modules, std);
        contentText.textContent = d.text === "" ? "(空)" : d.text;
        if (d.corrected > 0) {
          contentStatus.textContent = "誤り訂正で " + d.corrected + " コード語を復元";
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
        ? "検査数字 " + r.display[12] + " を付加" : "";
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
    const r = current.result;
    const items = [];
    const sizeText = r.width + "×" + r.height;

    if (std === "qr" || std === "micro" || std === "rmqr") {
      const auto = st.versionAuto ? "自動 → " : "";
      items.push(["型番", auto + (std === "qr" ? r.version : r.versionName) + " (" + sizeText + ")"]);
      items.push(["モード", MODE_NAMES[r.mode]]);
      items.push(["誤り訂正", std === "micro" && r.version === 1 ? "M1 (誤り検出のみ)" : r.ecLevel]);
      if (r.mask == null) items.push(["マスク", "固定"]);
      else items.push(["マスク", (st.maskAuto ? "自動 → " : "") + r.mask]);
      items.push(["データ", r.usedBits + " / " + r.capacityBits + " bit"]);
      items.push(["コード語", "データ " + r.dataCodewords + " + 訂正 " + (r.totalCodewords - r.dataCodewords)]);
    } else if (std === "datamatrix") {
      items.push(["サイズ", (st.sizeAuto ? "自動 → " : "") + r.versionName]);
      items.push(["データ", r.usedCodewords + " / " + r.dataCodewords + " 語"]);
      items.push(["訂正コード語", String(r.eccCodewords)]);
      items.push(["方式", "ECC 200"]);
    } else if (std === "aztec") {
      items.push(["サイズ", (st.versionAuto ? "自動 → " : "") + r.versionName]);
      items.push(["データ", r.usedBits + " / " + r.capacityBits + " bit"]);
      items.push(["コード語", "データ " + r.dataCodewords + " + 訂正 " + r.eccCodewords + " (" + r.codewordBits + "bit語)"]);
      items.push(["実効訂正率", r.eccPercent + "%"]);
    } else if (std === "barcode") {
      items.push(["種類", r.versionName]);
      items.push(["幅", r.width + " モジュール"]);
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
    infoEl.hidden = true;
    contentBar.hidden = true;
    editReset.hidden = true;
    qrCard.style.background = "";
  }

  function render() {
    const std = state.standard;
    if (std === "vericode") return;
    try {
      const result = runEncode();
      current = {
        result,
        modules: result.modules.map((row) => row.slice()),
        edited: false,
      };
      canvas.hidden = false;
      qrMessage.hidden = true;
      infoEl.hidden = false;
      contentBar.hidden = false;
      editReset.hidden = true;
      const editable = QR_FAMILY.includes(std);
      canvas.classList.toggle("editable", editable);
      editHint.hidden = !editable;
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

  /* ---------- 編集 (QR 系のみ) ---------- */

  canvas.addEventListener("click", (ev) => {
    if (!current || !lastDraw || !QR_FAMILY.includes(state.standard)) return;
    const rect = canvas.getBoundingClientRect();
    const { scale, qz, dpr } = lastDraw;
    const x = Math.floor(((ev.clientX - rect.left) * dpr) / scale) - qz;
    const y = Math.floor(((ev.clientY - rect.top) * dpr) / scale) - qz;
    const r = current.result;
    if (x < 0 || y < 0 || x >= r.width || y >= r.height) return;
    current.modules[y][x] ^= 1;
    current.edited = current.modules.some((row, yy) =>
      row.some((v, xx) => v !== r.modules[yy][xx]));
    editReset.hidden = !current.edited;
    drawCurrent();
    updateContent();
  });

  editReset.addEventListener("click", () => {
    if (!current) return;
    current.modules = current.result.modules.map((row) => row.slice());
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
    return "code-" + state.standard;
  }

  $("save-png").addEventListener("click", () => {
    if (!current) return;
    const r = current.result;
    const off = document.createElement("canvas");
    const octx = off.getContext("2d");
    if (r.type === "linear") {
      const scale = 4;
      const totalW = r.quietLeft + r.width + r.quietRight;
      const barH = Math.max(120, Math.round(totalW * scale * 0.3));
      off.width = totalW * scale;
      off.height = barH + 40;
      octx.fillStyle = state.bg;
      octx.fillRect(0, 0, off.width, off.height);
      octx.fillStyle = state.fg;
      for (let x = 0; x < r.width; x++) {
        if (r.pattern[x]) octx.fillRect((r.quietLeft + x) * scale, 20, scale, barH);
      }
    } else {
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
          if (current.modules[y][x]) octx.fillRect((x + qz) * scale, (y + qz) * scale, scale, scale);
        }
      }
    }
    off.toBlob((blob) => blob && download(blob, filenameBase() + ".png"), "image/png");
  });

  $("save-svg").addEventListener("click", () => {
    if (!current) return;
    const r = current.result;
    let svg;
    if (r.type === "linear") {
      const totalW = r.quietLeft + r.width + r.quietRight;
      const barH = Math.max(30, Math.round(totalW * 0.3));
      const totalH = barH + 10;
      let rects = "";
      let x = 0;
      while (x < r.width) {
        if (r.pattern[x]) {
          let run = 1;
          while (x + run < r.width && r.pattern[x + run]) run++;
          rects += '<rect x="' + (r.quietLeft + x) + '" y="5" width="' + run + '" height="' + barH + '"/>';
          x += run;
        } else x++;
      }
      svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + totalW + " " + totalH +
        '" width="' + totalW * 4 + '" height="' + totalH * 4 + '" shape-rendering="crispEdges">' +
        '<rect width="100%" height="100%" fill="' + state.bg + '"/><g fill="' + state.fg + '">' +
        rects + "</g></svg>";
    } else {
      const qz = r.quietZone;
      const mw = r.width + qz * 2, mh = r.height + qz * 2;
      let rects = "";
      for (let y = 0; y < r.height; y++) {
        let x = 0;
        while (x < r.width) {
          if (current.modules[y][x]) {
            let run = 1;
            while (x + run < r.width && current.modules[y][x + run]) run++;
            rects += '<rect x="' + (x + qz) + '" y="' + (y + qz) + '" width="' + run + '" height="1"/>';
            x += run;
          } else x++;
        }
      }
      svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + mw + " " + mh +
        '" width="' + mw * 10 + '" height="' + mh * 10 + '" shape-rendering="crispEdges">' +
        '<rect width="100%" height="100%" fill="' + state.bg + '"/><g fill="' + state.fg + '">' +
        rects + "</g></svg>";
    }
    download(new Blob([svg], { type: "image/svg+xml" }), filenameBase() + ".svg");
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
  $("color-reset").addEventListener("click", () => {
    state.fg = "#000000";
    state.bg = "#ffffff";
    $("color-fg").value = state.fg;
    $("color-bg").value = state.bg;
    drawCurrent();
  });

  /* ---------- タブ切り替え ---------- */

  function selectStandard(std) {
    state.standard = std;
    for (const tab of document.querySelectorAll(".tab")) {
      tab.setAttribute("aria-selected", tab.dataset.standard === std ? "true" : "false");
    }
    const isNotice = std === "vericode";
    $("controls").hidden = isNotice;
    $("preview").hidden = isNotice;
    $("vericode-notice").hidden = !isNotice;
    if (!isNotice) {
      rebuildControls();
      render();
    }
  }

  for (const tab of document.querySelectorAll(".tab")) {
    tab.addEventListener("click", () => selectStandard(tab.dataset.standard));
  }
  for (const btn of document.querySelectorAll("[data-goto]")) {
    btn.addEventListener("click", () => selectStandard(btn.dataset.goto));
  }

  dataInput.addEventListener("input", render);

  new ResizeObserver(() => {
    if (current) drawCurrent();
  }).observe(qrCard);

  selectStandard("qr");
})();
