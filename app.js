/* QRコードジェネレーター UI */
(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const canvas = $("qr-canvas");
  const ctx = canvas.getContext("2d");
  const qrCard = $("qr-card");
  const qrMessage = $("qr-message");
  const infoEl = $("info");
  const dataInput = $("data-input");

  const MODE_NAMES = { numeric: "数字", alphanumeric: "英数字", byte: "バイト (UTF-8)" };

  /* 規格ごとの UI 設定と選択状態 */
  const state = {
    standard: "qr",
    qr:    { ec: "M", versionAuto: true, version: 5, maskAuto: true, mask: 0 },
    micro: { ec: "L", versionAuto: true, version: 4, maskAuto: true, mask: 0 },
    rmqr:  { ec: "M", versionAuto: true, version: 12 }, // R11x43
  };

  const EC_OPTIONS = {
    qr: [
      { v: "L", label: "L (7%)" }, { v: "M", label: "M (15%)" },
      { v: "Q", label: "Q (25%)" }, { v: "H", label: "H (30%)" },
    ],
    micro: [
      { v: "L", label: "L" }, { v: "M", label: "M" }, { v: "Q", label: "Q" },
    ],
    rmqr: [
      { v: "M", label: "M (15%)" }, { v: "H", label: "H (30%)" },
    ],
  };

  /* マイクロQR: 型番ごとに使える誤り訂正レベル */
  function microEcAvailable(st) {
    if (st.versionAuto) return ["L", "M", "Q"];
    return [["L"], ["L", "M"], ["L", "M"], ["L", "M", "Q"]][st.version - 1];
  }

  /* ---------- コントロール生成 ---------- */

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

  function buildEcControl() {
    const box = $("ec-control");
    box.textContent = "";
    const std = state.standard;
    const st = state[std];
    const available = std === "micro" ? microEcAvailable(st) : null;
    for (const opt of EC_OPTIONS[std]) {
      const btn = makeSegButton(opt.label, st.ec === opt.v, () => {
        st.ec = opt.v;
        rebuildControls();
        render();
      });
      if (available && !available.includes(opt.v)) btn.disabled = true;
      box.appendChild(btn);
    }
    if (std === "micro" && !st.versionAuto && st.version === 1) {
      const note = document.createElement("span");
      note.className = "seg-note";
      note.textContent = "M1 は誤り検出のみ";
      box.appendChild(note);
    }
  }

  function buildVersionControl() {
    const box = $("version-control");
    box.textContent = "";
    const std = state.standard;
    const st = state[std];

    box.appendChild(makeAutoToggle(st.versionAuto, (checked) => {
      st.versionAuto = checked;
      normalizeMicroEc();
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
      box.append(range, value);
    } else if (std === "micro") {
      const seg = document.createElement("div");
      seg.className = "segmented";
      seg.style.flex = "1";
      for (let v = 1; v <= 4; v++) {
        const btn = makeSegButton("M" + v, !st.versionAuto && st.version === v, () => {
          st.versionAuto = false;
          st.version = v;
          normalizeMicroEc();
          rebuildControls();
          render();
        });
        if (st.versionAuto) btn.setAttribute("aria-checked", "false");
        seg.appendChild(btn);
      }
      box.appendChild(seg);
    } else {
      const select = document.createElement("select");
      select.disabled = st.versionAuto;
      QRLib.RMQR_VERSION_NAMES.forEach((name, i) => {
        const opt = document.createElement("option");
        opt.value = String(i + 1);
        opt.textContent = name;
        select.appendChild(opt);
      });
      select.value = String(st.version);
      select.addEventListener("change", () => {
        st.version = Number(select.value);
        render();
      });
      box.appendChild(select);
    }
  }

  function buildMaskControl() {
    const box = $("mask-control");
    box.textContent = "";
    const std = state.standard;
    const st = state[std];

    if (std === "rmqr") {
      box.className = "segmented";
      box.style.gridTemplateColumns = "";
      const note = document.createElement("span");
      note.className = "seg-note";
      note.textContent = "rMQR のマスクは規格で固定です ((⌊y/2⌋+⌊x/3⌋) mod 2 = 0)";
      box.appendChild(note);
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

  /* マイクロQRで型番を固定したとき、使えない誤り訂正レベルを補正 */
  function normalizeMicroEc() {
    const st = state.micro;
    const available = microEcAvailable(st);
    if (!available.includes(st.ec)) st.ec = available[available.length - 1];
  }

  function rebuildControls() {
    buildEcControl();
    buildVersionControl();
    buildMaskControl();
  }

  /* ---------- 描画 ---------- */

  let current = null; // 最後にエンコードした結果

  function drawModules(result) {
    const { modules, quietZone } = result;
    const mw = result.width + quietZone * 2;
    const mh = result.height + quietZone * 2;

    const box = qrCard.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const availW = Math.max(40, box.width - 24) * dpr;
    const availH = Math.max(40, box.height - 24) * dpr;
    const scale = Math.max(1, Math.floor(Math.min(availW / mw, availH / mh)));

    canvas.width = mw * scale;
    canvas.height = mh * scale;
    canvas.style.width = canvas.width / dpr + "px";
    canvas.style.height = canvas.height / dpr + "px";

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#000000";
    for (let y = 0; y < result.height; y++) {
      const row = modules[y];
      for (let x = 0; x < result.width; x++) {
        if (row[x]) {
          ctx.fillRect((x + quietZone) * scale, (y + quietZone) * scale, scale, scale);
        }
      }
    }
  }

  function renderInfo(result) {
    infoEl.textContent = "";
    const std = state.standard;
    const st = state[std];
    const items = [];
    const sizeText = result.width + "×" + result.height;
    if (std === "qr") {
      items.push(["型番", (st.versionAuto ? "自動 → " : "") + result.version + " (" + sizeText + ")"]);
    } else {
      items.push(["型番", (st.versionAuto ? "自動 → " : "") + result.versionName + " (" + sizeText + ")"]);
    }
    items.push(["モード", MODE_NAMES[result.mode]]);
    if (std === "micro" && result.version === 1) {
      items.push(["誤り訂正", "M1 (誤り検出のみ)"]);
    } else {
      items.push(["誤り訂正", result.ecLevel]);
    }
    if (result.mask == null) {
      items.push(["マスク", "固定"]);
    } else {
      items.push(["マスク", (st.maskAuto ? "自動 → " : "") + result.mask]);
    }
    items.push(["データ", result.usedBits + " / " + result.capacityBits + " bit"]);
    items.push(["コード語", "データ " + result.dataCodewords + " + 訂正 " +
      (result.totalCodewords - result.dataCodewords)]);
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

  function showError(message) {
    current = null;
    canvas.hidden = true;
    qrMessage.hidden = false;
    qrMessage.textContent = message;
    infoEl.textContent = "";
    infoEl.hidden = true;
  }

  function render() {
    const std = state.standard;
    if (std === "iqr") return;
    const st = state[std];
    try {
      const result = QRLib.encode({
        standard: std,
        text: dataInput.value,
        ecLevel: st.ec,
        version: st.versionAuto ? 0 : st.version,
        mask: std !== "rmqr" && !st.maskAuto ? st.mask : -1,
      });
      current = result;
      canvas.hidden = false;
      qrMessage.hidden = true;
      infoEl.hidden = false;
      drawModules(result);
      renderInfo(result);
    } catch (e) {
      if (e instanceof QRLib.QREncodeError) {
        showError(e.message);
      } else {
        showError("エンコードに失敗しました");
        console.error(e);
      }
    }
  }

  /* ---------- タブ切り替え ---------- */

  function selectStandard(std) {
    state.standard = std;
    for (const tab of document.querySelectorAll(".tab")) {
      tab.setAttribute("aria-selected", tab.dataset.standard === std ? "true" : "false");
    }
    const isIqr = std === "iqr";
    $("controls").hidden = isIqr;
    document.querySelector(".preview").hidden = isIqr;
    $("iqr-notice").hidden = !isIqr;
    if (!isIqr) {
      rebuildControls();
      render();
    }
  }

  for (const tab of document.querySelectorAll(".tab")) {
    tab.addEventListener("click", () => selectStandard(tab.dataset.standard));
  }
  $("goto-rmqr").addEventListener("click", () => selectStandard("rmqr"));

  dataInput.addEventListener("input", render);

  /* コンテナサイズ変更時に再描画 (モジュールを整数ピクセルに保つ) */
  new ResizeObserver(() => {
    if (current) drawModules(current);
  }).observe(qrCard);

  selectStandard("qr");
})();
