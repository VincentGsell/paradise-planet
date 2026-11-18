// ============================================================================
// development tools (dev.html only): test hooks, still shots, scripted flight
// ============================================================================
window.PP = {
  goPose, setHour, POSES, CP, CB,
  pending: () => nReq,
  frames: () => frameN,
  gpu: () => gpuMs,
  draws: () => lastDraw,
  slotsFree: () => nFree,
};
// ?shot: no menu, full resolution, time stopped (the harness drives the frames)
if (URLQ.has('shot')) {
  menu = false; body.className = 'g'; fixedRes = true; pix = 1e9; resize(); timeIdx = 0;
  for (const id of ['t', 'o']) $(id).style.display = 'none';
  document.head.insertAdjacentHTML('beforeend', '<style>*{transition:none!important}</style>');
  if (URLQ.get('hour')) setHour(+URLQ.get('hour'));
  // ?nudge=m: move the camera forward (tests)
  if (URLQ.get('nudge')) { const m = +URLQ.get('nudge'); for (let c = 0; c < 3; c++) CP[c] += CB[c] * m; }
  // ?cam=alt,pitch,yaw: the camera `alt` m above the ground, `pitch` degrees above the horizon, `yaw` degrees from
  // the sun's azimuth (tests: the clouds seen from below, toward the sun)
  if (URLQ.get('cam')) {
    const [alt, pitch, yaw] = URLQ.get('cam').split(',').map(Number), r0 = v3len(CP, 0), ux = CP[0] / r0, uy = CP[1] / r0, uz = CP[2] / r0;
    const g = max(groundAt(CP[0], CP[1], CP[2]), 0), r = R + g + alt; CP[0] = ux * r; CP[1] = uy * r; CP[2] = uz * r;
    let sx = FU[32] || cos(DECL) * cos(sunPhi), sy = FU[33] || sin(DECL), sz = FU[34] || cos(DECL) * sin(sunPhi);
    const k = sx * ux + sy * uy + sz * uz; sx -= ux * k; sy -= uy * k; sz -= uz * k; const l = hypot(sx, sy, sz); sx /= l; sy /= l; sz /= l;
    const T = new Float64Array([sx, sy, sz]), Uv = new Float64Array([ux, uy, uz]); v3rot(T, 0, Uv, 0, yaw * PI / 180);
    const cp = cos(pitch * PI / 180), sp = sin(pitch * PI / 180);
    lookAt(CP[0], CP[1], CP[2], CP[0] + (T[0] * cp + ux * sp) * 100, CP[1] + (T[1] * cp + uy * sp) * 100, CP[2] + (T[2] * cp + uz * sp) * 100);
  }
}
// ?prof: a GPU timestamp pair around every pass, summed per call site (function:line), in window.PROF (ms)
if (URLQ.has('prof') && hasTS) {
  qRead.length = 0; // the frame's own start / end timestamps are off
  const N = 96, qsP = device.createQuerySet({ type: 'timestamp', count: N * 2 });
  const res = device.createBuffer({ size: N * 16, usage: BU.QUERY_RESOLVE | BU.COPY_SRC });
  const rb = device.createBuffer({ size: N * 16, usage: BU.MAP_READ | BU.COPY_DST });
  let n = 0, labels = [], busy = false, pending = null; window.PROF = {};
  const site = () => { const s = new Error().stack.split('\n')[3] || ''; const m = s.match(/at (\S+) .*:(\d+):\d+\)?$/); return m ? m[1] + ':' + m[2] : '?'; };
  for (const name of ['beginRenderPass', 'beginComputePass']) {
    const f = GPUCommandEncoder.prototype[name];
    GPUCommandEncoder.prototype[name] = function (d) {
      if (n < N && !busy) { d = Object.assign({}, d || {}, { timestampWrites: { querySet: qsP, beginningOfPassWriteIndex: n * 2, endOfPassWriteIndex: n * 2 + 1 } }); labels[n++] = site(); }
      return f.call(this, d);
    };
  }
  const fin = GPUCommandEncoder.prototype.finish;
  GPUCommandEncoder.prototype.finish = function (d) {
    if (n && !busy) { this.resolveQuerySet(qsP, 0, n * 2, res, 0); this.copyBufferToBuffer(res, 0, rb, 0, n * 16); pending = [n, labels.slice(0, n)]; busy = true; n = 0; }
    return fin.call(this, d);
  };
  const sub = Q.submit.bind(Q);
  Q.submit = (l) => {
    sub(l);
    if (pending) {
      const [k, lb] = pending; pending = null;
      rb.mapAsync(GPUMapMode.READ).then(() => {
        const a = new BigInt64Array(rb.getMappedRange()), o = {}; let tot = 0;
        for (let i = 0; i < k; i++) { const ms = Number(a[i * 2 + 1] - a[i * 2]) / 1e6; o[lb[i]] = (o[lb[i]] || 0) + ms; tot += ms; }
        o.total = tot; rb.unmap(); window.PROF = o; busy = false;
      });
    }
  };
}
// the scripted flight: Catmull-Rom through FLIGHT (body frame, f64), looking ahead along the path; logs the frame
// and GPU times. PP.flight() starts it, PP.flightLog() returns { frames: [ms], gpu: [ms], done }
{
  const K = FLIGHT, P = new Float64Array(3), Q2 = new Float64Array(3);
  const cr = (o, t) => {
    let i = 0; while (i < K.length - 2 && K[i + 1][0] <= t) i++;
    const a = K[max(i - 1, 0)], b = K[i], c = K[i + 1], d = K[min(i + 2, K.length - 1)], u = clamp((t - b[0]) / (c[0] - b[0]), 0, 1);
    // smooth in log of the altitude: kilometres up high, metres near the ground, no overshoot below it
    for (let k = 1; k < 4; k++) { const p0 = a[k], p1 = b[k], p2 = c[k], p3 = d[k]; o[k - 1] = 0.5 * (2 * p1 + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u * u + (-p0 + 3 * p1 - 3 * p2 + p3) * u * u * u); }
    const r = v3len(o, 0), ra = v3len(b, 1) * (1 - u) + v3len(c, 1) * u; for (let k = 0; k < 3; k++) o[k] *= ra / r;
  };
  let ft = 0, on = false; const log = { frames: [], gpu: [], done: false };
  PP.flight = (hour) => { ft = 0; on = true; log.frames.length = 0; log.gpu.length = 0; log.done = false; if (hour) setHour(hour); gpuLog = (ms) => { if (on) log.gpu.push(ms); }; };
  PP.flightLog = () => log;
  let last = 0;
  flightFn = (dt) => {
    if (!on) return;
    const now = performance.now(); if (last) log.frames.push(now - last); last = now;
    ft += dt; if (ft >= 60) { on = false; log.done = true; return; }
    cr(P, ft); cr(Q2, min(ft + 1.2, 65));
    { const r = v3len(P, 0), g = groundAt(P[0], P[1], P[2]), lo = R + g + 2.5; if (r < lo) for (let k = 0; k < 3; k++) P[k] *= lo / r; }
    // look ahead, a little down toward the ground when low
    lookAt(P[0], P[1], P[2], Q2[0], Q2[1], Q2[2]);
  };
}
// LOD sanity: visible patches whose ancestor is visible too (overlaps), and duplicates
PP.overlaps = () => {
  const vis = new Map(); let dup = 0, ov = 0; const ex = [];
  for (let i = 0; i < nDraw; i++) { const s = PTF[i * 12 + 8]; if (vis.has(s)) dup++; vis.set(s, i); }
  for (const [s] of vis) {
    let p = nPar[s], guard = 0;
    while (p >= 0 && guard++ < 20) { if (vis.has(p)) { ov++; if (ex.length < 5) ex.push([s, nL[s], p, nL[p]]); break; } p = nPar[p]; }
  }
  // also: visible nodes whose key in the hash points elsewhere, and nodes with a parent link not matching geometry
  let bad = 0;
  for (const [s] of vis) { if (hGet(nKey[s]) !== s) bad++; const p = nPar[s]; if (p >= 0 && (nL[p] !== nL[s] - 1 || nX[p] !== nX[s] >> 1 || nY[p] !== nY[s] >> 1 || nF[p] !== nF[s])) bad++; }
  return { n: nDraw, dup, ov, bad, ex };
};
// the relief along the view ray, where it meets the sea (screen point sx, sy in -1..1): heights at several cell sizes
PP.probe = (sx, sy) => {
  const tx = TANH * W / H, ty = TANH, d = [0, 0, 0];
  for (let c = 0; c < 3; c++) d[c] = CB[c] + CB[6 + c] * sx * tx + CB[3 + c] * sy * ty;
  const l = hypot(d[0], d[1], d[2]); for (let c = 0; c < 3; c++) d[c] /= l;
  // intersect with the sphere of radius R
  const b = CP[0] * d[0] + CP[1] * d[1] + CP[2] * d[2], cc = CP[0] ** 2 + CP[1] ** 2 + CP[2] ** 2 - R * R, t = -b - sqrt(b * b - cc);
  const p = [CP[0] + d[0] * t, CP[1] + d[1] * t, CP[2] + d[2] * t], r = hypot(...p), u = p.map((v) => v / r);
  const out = { t };
  for (const mw of [0, 0.3, 1, 3, 10, 30, 100]) out['h' + mw] = height(u[0], u[1], u[2], mw);
  out.raw0 = relief(u[0], u[1], u[2], 0);
  // the visible patch containing it
  const o = new Float64Array(3); cubeFace(u[0], u[1], u[2], o);
  for (let i = 0; i < nDraw; i++) {
    const s = PTF[i * 12 + 8]; if (nF[s] !== o[0]) continue;
    const k = 2 / (1 << nL[s]), s0 = nX[s] * k - 1, t0 = nY[s] * k - 1;
    if (o[1] >= s0 && o[1] < s0 + k && o[2] >= t0 && o[2] < t0 + k) { out.patch = { i, slot: s, level: nL[s], cell: nSize[s] / 32, hmin: nHmin[s], hmax: nHmax[s], par: nPar[s] }; break; }
  }
  return out;
};
PP.why = (sx, sy) => {
  const tx = TANH * W / H, ty = TANH, d = [0, 0, 0];
  for (let c = 0; c < 3; c++) d[c] = CB[c] + CB[6 + c] * sx * tx + CB[3 + c] * sy * ty;
  const l = hypot(d[0], d[1], d[2]); for (let c = 0; c < 3; c++) d[c] /= l;
  const b = CP[0] * d[0] + CP[1] * d[1] + CP[2] * d[2], cc = CP[0] ** 2 + CP[1] ** 2 + CP[2] ** 2 - R * R, t = -b - sqrt(b * b - cc);
  const p = [CP[0] + d[0] * t, CP[1] + d[1] * t, CP[2] + d[2] * t], r = hypot(...p), u = p.map((v) => v / r);
  const o = new Float64Array(3); cubeFace(u[0], u[1], u[2], o);
  let s = roots[o[0]]; const path = [];
  for (let g = 0; g < 20; g++) {
    const q = s * 3, cx = nC[q] - CAM[0], cy = nC[q + 1] - CAM[1], cz = nC[q + 2] - CAM[2], dd = max(0, hypot(cx, cy, cz) - nRad[s]);
    const planes = []; for (let k = 0; k < 12; k += 3) planes.push(+(cx * FR[k] + cy * FR[k + 1] + cz * FR[k + 2] + nRad[s]).toFixed(1));
    const drawn = (() => { for (let i = 0; i < nDraw; i++) if (PTF[i * 12 + 8] === s) return i; return -1; })();
    path.push({ s, L: nL[s], used: nUsed[s] === frameNo, split: nL[s] < LMAX && dd < LODQ * nSize[s], kids: nKid[s * 4], drawn, planes, rad: +nRad[s].toFixed(1), dist: +hypot(cx, cy, cz).toFixed(1) });
    if (nKid[s * 4] < 0) break;
    // the kid containing the point
    const L = nL[s] + 1, k = 2 / (1 << L), ix = floor((o[1] + 1) / k), iy = floor((o[2] + 1) / k);
    let nx = -1; for (let c = 0; c < 4; c++) { const q2 = nKid[s * 4 + c]; if (nX[q2] === ix && nY[q2] === iy) nx = q2; }
    if (nx < 0) { path.push({ err: 'kid not found', ix, iy, kids: [0, 1, 2, 3].map((c) => [nX[nKid[s * 4 + c]], nY[nKid[s * 4 + c]]]) }); break; }
    s = nx;
  }
  return { face: o[0], st: [o[1], o[2]], path: path.slice(-4) };
};
// read back an indirect-args buffer (counts per bucket)
PP.readArgs = async (which) => {
  const b = { props: bPArgs, grass: bGArgs, sea: bSArgs, fauna: bFArgs }[which];
  const rb = device.createBuffer({ size: b.size, usage: BU.MAP_READ | BU.COPY_DST });
  const e = device.createCommandEncoder(); e.copyBufferToBuffer(b, 0, rb, 0, b.size); Q.submit([e.finish()]);
  await rb.mapAsync(GPUMapMode.READ); const a = Array.from(new Uint32Array(rb.getMappedRange())); rb.unmap(); return a;
};
PP.dump = () => {
  const o = []; o.push('CP ' + [...CP].map((v) => v.toFixed(0)) + ' |CP| ' + v3len(CP, 0).toFixed(0) + ' R ' + R);
  o.push('fwd ' + [...CB].slice(0, 3).map((v) => v.toFixed(3)) + ' toCentre ' + [...CP].map((v) => (-v / v3len(CP, 0)).toFixed(3)));
  for (let i = 0; i < Math.min(nDraw, 6); i++) { const q = i * 12; o.push(`rec ${i}: crel ${PTF[q].toFixed(0)},${PTF[q + 1].toFixed(0)},${PTF[q + 2].toFixed(0)} cbody ${PTF[q + 4].toFixed(0)},${PTF[q + 5].toFixed(0)},${PTF[q + 6].toFixed(0)} slot ${PTF[q + 8]} L ${PTF[q + 9]} crel+cam ${(PTF[q] + CP[0]).toFixed(0)}`); }
  o.push('FU cam ' + [FU[28], FU[29], FU[30], FU[31]].map((v) => v.toFixed(0)) + ' CAM ' + [...CAM].map((v) => v.toFixed(0)));
  return o.join('\n');
};
PP.proj = () => {
  // the planet's centre through the frame's view-projection (column-major), and a record's centre
  const m = FU, p = [-CP[0], -CP[1], -CP[2], 1], c = [0, 0, 0, 0];
  for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) c[r] += m[k * 4 + r] * p[k];
  return { ndc: [c[0] / c[3], c[1] / c[3], c[2] / c[3]], w: c[3], tx: FU[19], ty: FU[23], WH: [W, H], vp0: Array.from(FU.slice(0, 16)).map((v) => +v.toFixed(3)) };
};
