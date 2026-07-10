/* MicroQR・rMQR 用の自前位置検出・グリッドサンプリング (ZXing が非対応のため) */
(function () {
  "use strict";

  /* 位置検出パターン (1:1:3:1:1 濃淡比) を画像から探し、そこを基準に
     取りうる型番/寸法を総当たりでグリッドサンプリングして QRLib.decode に渡す。 */

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
    if (typeof ZXing === "undefined") return null;
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

  window.FinderLib = { tryDecodeMicroRmqr };
})();
