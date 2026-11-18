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
