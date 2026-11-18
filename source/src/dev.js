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
    // look ahead, a little down toward the ground when low
    lookAt(P[0], P[1], P[2], Q2[0], Q2[1], Q2[2]);
  };
}
