// ============================================================================
// the planet's terrain: quadtree LOD over the cube-sphere (OpenG / Planets V5 rules), patches built on the GPU
// ============================================================================
// Every node lives in a GPU slot (its 35 x 35 vertices). Nodes are preallocated records indexed by slot; a hash
// table finds them by key. Split when the camera is closer to a node's bounding sphere than LODQ x its size, and only
// once its four children are built (no hole, ever). Children are built in fours, a few per frame, nearest first.
// Unused leaves are recycled, least recently used first.
const LMAX = min(13, ceil(log2(R * PI / 2 / 32 / 0.3)));
const MR = 0.4; // morph range
const nF = new Uint8Array(SLOTS), nL = new Uint8Array(SLOTS), nX = new Uint32Array(SLOTS), nY = new Uint32Array(SLOTS);
const nC = new Float64Array(SLOTS * 3), nRad = new Float64Array(SLOTS), nSize = new Float64Array(SLOTS), nKey = new Float64Array(SLOTS);
const nHmin = new Float64Array(SLOTS), nHmax = new Float64Array(SLOTS);
const nUsed = new Int32Array(SLOTS), nKid = new Int32Array(SLOTS * 4).fill(-1), nPar = new Int32Array(SLOTS).fill(-1), nLive = new Uint8Array(SLOTS);
const freeSl = new Int32Array(SLOTS); let nFree = 0;
for (let i = SLOTS - 1; i >= 0; i--) freeSl[nFree++] = i;
const keyOf = (f, l, x, y) => ((f * 16 + l) * 16384 + x) * 16384 + y;
// open addressing hash: key -> slot
const HN = 1 << ceil(log2(SLOTS * 4)), hK = new Float64Array(HN).fill(-1), hV = new Int32Array(HN);
const hslot = (k) => { let h = Math.imul((k % 4294967296) | 0, 0x9E3779B1) ^ Math.imul(floor(k / 4294967296) | 0, 0x85EBCA77); h ^= h >>> 15; h = Math.imul(h, 0x2C1B3C6D); return (h ^ (h >>> 12)) & (HN - 1); };
function hGet(k) { for (let i = hslot(k); ; i = (i + 1) & (HN - 1)) { if (hK[i] === k) return hV[i]; if (hK[i] < 0) return -1; } }
function hSet(k, v) { let i = hslot(k); while (hK[i] >= 0 && hK[i] !== k) i = (i + 1) & (HN - 1); hK[i] = k; hV[i] = v; }
function hDel(k) {
  let i = hslot(k); while (hK[i] !== k) { if (hK[i] < 0) return; i = (i + 1) & (HN - 1); }
  // backward-shift deletion keeps every probe chain unbroken
  for (let j = i; ;) {
    hK[i] = -1; j = (j + 1) & (HN - 1);
    for (;; j = (j + 1) & (HN - 1)) {
      if (hK[j] < 0) return;
      const h = hslot(hK[j]);
      if (i <= j ? (i < h && h <= j) : (i < h || h <= j)) continue;
      break;
    }
    hK[i] = hK[j]; hV[i] = hV[j]; i = j;
  }
}

// ---------------------------------------------------------------- GPU side
const NIDX = 34 * 34 * 6;
const ibPatch = (() => {
  const a = new Uint16Array(NIDX); let n = 0;
  for (let y = 0; y < 34; y++) for (let x = 0; x < 34; x++) {
    const i = y * 35 + x; a[n++] = i; a[n++] = i + 1; a[n++] = i + 36; a[n++] = i; a[n++] = i + 36; a[n++] = i + 35;
  }
  return buf(a, BU.INDEX);
})();
const bVerts = sbuf(SLOTS * NV * 48);
const MAXJ = 64, JOBA = new ArrayBuffer(MAXJ * 48), JOBU = new Uint32Array(JOBA), JOBF = new Float32Array(JOBA), bJobs = sbuf(MAXJ * 48);
const PTF = new Float32Array(SLOTS * 12), bPatches = sbuf(SLOTS * 48);
const mBuild = mod(W_BUILD);
const bglBuild = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: SS.COMPUTE, buffer: { type: 'read-only-storage' } }, { binding: 1, visibility: SS.COMPUTE, buffer: { type: 'storage' } }] });
const pBuild = device.createComputePipeline({ layout: lay(bgl0, bglBuild), compute: { module: mBuild, entryPoint: 'build' } });
const bgBuild = device.createBindGroup({ layout: bglBuild, entries: [{ binding: 0, resource: { buffer: bJobs } }, { binding: 1, resource: { buffer: bVerts } }] });
const bglTerr = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: VF, buffer: { type: 'read-only-storage' } }, { binding: 1, visibility: VF, buffer: { type: 'read-only-storage' } }] });
const bgTerr = device.createBindGroup({ layout: bglTerr, entries: [{ binding: 0, resource: { buffer: bVerts } }, { binding: 1, resource: { buffer: bPatches } }] });

// ---------------------------------------------------------------- nodes
const TD = new Float64Array(64);
// creates the node (f, l, x, y) in a free slot: bounds on the CPU (coarse samples + what the finer octaves can add),
// the vertices queued for the GPU
function makeNode(f, l, x, y, slot, par) {
  const n2 = 1 << l, k = 2 / n2, s0 = x * k - 1, t0 = y * k - 1;
  const size = R * PI / 2 / n2, cell = size / 32;
  // 3 x 3 coarse heights
  const mw = cell * 4; let lo = 1e9, hi = -1e9;
  for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) {
    cubeDir(TD, 0, f, s0 + k * i * 0.5, t0 + k * j * 0.5);
    const h = relief(TD[0], TD[1], TD[2], mw); if (h < lo) lo = h; if (h > hi) hi = h;
  }
  const rest = restAmp(mw) + (hi - lo) * 0.25 + 1;
  lo = shape(lo - rest); hi = shape(hi + rest);
  cubeDir(TD, 3, f, s0 + k * 0.5, t0 + k * 0.5);
  const rc = R + (lo + hi) * 0.5;
  nC[slot * 3] = TD[3] * rc; nC[slot * 3 + 1] = TD[4] * rc; nC[slot * 3 + 2] = TD[5] * rc;
  // bounding radius over the corners at both extreme heights
  let rad = 0;
  for (let c = 0; c < 4; c++) {
    cubeDir(TD, 0, f, s0 + k * (c & 1), t0 + k * (c >> 1));
    for (let e = 0; e < 2; e++) {
      const rr = R + (e ? hi : lo), dx = TD[0] * rr - nC[slot * 3], dy = TD[1] * rr - nC[slot * 3 + 1], dz = TD[2] * rr - nC[slot * 3 + 2];
      rad = max(rad, sqrt(dx * dx + dy * dy + dz * dz));
    }
  }
  nRad[slot] = rad * 1.02 + size * 0.02; nSize[slot] = size; nHmin[slot] = lo; nHmax[slot] = hi;
  nF[slot] = f; nL[slot] = l; nX[slot] = x; nY[slot] = y; nPar[slot] = par; nLive[slot] = 1; nUsed[slot] = frameNo;
  nKid[slot * 4] = nKid[slot * 4 + 1] = nKid[slot * 4 + 2] = nKid[slot * 4 + 3] = -1;
  nKey[slot] = keyOf(f, l, x, y); hSet(nKey[slot], slot);
  // the job
  const j = nJobs++, o = j * 12;
  JOBU[o] = f; JOBU[o + 1] = l; JOBU[o + 2] = x; JOBU[o + 3] = y; JOBU[o + 4] = slot;
  JOBF[o + 8] = Math.fround(nC[slot * 3]); JOBF[o + 9] = Math.fround(nC[slot * 3 + 1]); JOBF[o + 10] = Math.fround(nC[slot * 3 + 2]); JOBF[o + 11] = cell;
  nBuilt++;
}
// frees an unused leaf (clock sweep), unlinking it from its parent
let evClock = 0;
function evict() {
  for (let n = 0; n < SLOTS; n++) {
    const s = evClock; evClock = (evClock + 1) % SLOTS;
    if (!nLive[s] || nL[s] === 0 || nUsed[s] >= frameNo - 1 || nKid[s * 4] >= 0) continue;
    const p = nPar[s];
    if (p >= 0) { for (let c = 0; c < 4; c++) { const q = nKid[p * 4 + c]; if (q >= 0) nPar[q] = -1; nKid[p * 4 + c] = -1; } }
    hDel(nKey[s]); nLive[s] = 0;
    return s;
  }
  return -1;
}
const takeSlot = () => (nFree ? freeSl[--nFree] : evict());

// ---------------------------------------------------------------- per frame: select, request, draw list
let frameNo = 1, nJobs = 0, nDraw = 0, nReq = 0, nBuilt = 0, nWater = 0, nShOnly = 0, nDrawSh = 0;
const SHO = new Int32Array(SLOTS);
const WLU = new Uint32Array(SLOTS);
const MAXR = 256, reqS = new Int32Array(MAXR), reqP = new Float64Array(MAXR);
const CAM = new Float64Array(3), FR = new Float64Array(15); // camera; frustum planes (4 x normal) + forward
const roots = new Int32Array(6);
function visit(s) {
  nUsed[s] = frameNo;
  const o = s * 3, cx = nC[o] - CAM[0], cy = nC[o + 1] - CAM[1], cz = nC[o + 2] - CAM[2];
  const d = max(0, sqrt(cx * cx + cy * cy + cz * cz) - nRad[s]);
  if (nL[s] < LMAX && d < LODQ * nSize[s]) {
    if (nKid[s * 4] >= 0) { for (let c = 0; c < 4; c++) visit(nKid[s * 4 + c]); return; }
    if (nReq < MAXR) { reqS[nReq] = s; reqP[nReq++] = d / nSize[s]; }
  }
  // frustum: out of view, a patch near the camera still casts its shadow into it
  const r = nRad[s];
  for (let p = 0; p < 12; p += 3) if (cx * FR[p] + cy * FR[p + 1] + cz * FR[p + 2] < -r) { if (d < SHR[NCASC - 1] && nShOnly < SLOTS) SHO[nShOnly++] = s; return; }
  // below the horizon of the planet's bounding sphere: hidden behind it
  const pr = R + nHmax[s] + r, cr = sqrt(CAM[0] * CAM[0] + CAM[1] * CAM[1] + CAM[2] * CAM[2]);
  if (cr > R + AMAX * 0.5) {
    const nx = nC[o], ny = nC[o + 1], nz = nC[o + 2], nl = sqrt(nx * nx + ny * ny + nz * nz);
    const ang = acos(clamp((nx * CAM[0] + ny * CAM[1] + nz * CAM[2]) / (nl * cr), -1, 1));
    const hz = acos(clamp((R - 50) / cr, -1, 1)) + acos(clamp((R - 50) / max(pr, R), -1, 1)) + r / nl;
    if (ang > hz) return;
  }
  record(s, nDraw++);
  // the sea surface is drawn over the patches that reach below the sea level
  if (nHmin[s] < 2) WLU[nWater++] = nDraw - 1;
}
// the draw record of node s at index i
function record(s, i) {
  const o = s * 3, q = i * 12;
  PTF[q] = Math.fround(nC[o]) - CAM[0]; PTF[q + 1] = Math.fround(nC[o + 1]) - CAM[1]; PTF[q + 2] = Math.fround(nC[o + 2]) - CAM[2];
  PTF[q + 3] = nL[s] ? LODQ * nSize[s] * 2 : 0;
  PTF[q + 4] = nC[o]; PTF[q + 5] = nC[o + 1]; PTF[q + 6] = nC[o + 2]; PTF[q + 7] = nSize[s] / 32 * 3 + 0.5;
  PTF[q + 8] = s; PTF[q + 9] = nL[s]; PTF[q + 10] = nSize[s] / 32; PTF[q + 11] = 0;
}
// builds the requested children, nearest (relative to size) first, BUILDS patches at most
function serveRequests(budget) {
  while (nReq && nJobs + 4 <= min(MAXJ, budget)) {
    let b = 0; for (let i = 1; i < nReq; i++) if (reqP[i] < reqP[b]) b = i;
    const s = reqS[b]; reqS[b] = reqS[--nReq]; reqP[b] = reqP[nReq];
    if (!nLive[s] || nKid[s * 4] >= 0) continue;
    const f = nF[s], l = nL[s] + 1, x = nX[s] * 2, y = nY[s] * 2;
    let ok = true;
    for (let c = 0; c < 4; c++) {
      const k = keyOf(f, l, x + (c & 1), y + (c >> 1));
      let q = hGet(k);
      if (q < 0) { q = takeSlot(); if (q < 0) { ok = false; break; } makeNode(f, l, x + (c & 1), y + (c >> 1), q, s); }
      else { nPar[q] = s; nUsed[q] = frameNo; }
      nKid[s * 4 + c] = q;
    }
    if (!ok) { for (let c = 0; c < 4; c++) { const q = nKid[s * 4 + c]; if (q >= 0) nPar[q] = -1; nKid[s * 4 + c] = -1; } nReq = 0; break; }
  }
}
// one LOD update: select from the camera, then queue the builds; returns the number of patches to draw
function lodUpdate(enc, budget) {
  frameNo++; nDraw = 0; nReq = 0; nWater = 0; nShOnly = 0;
  for (let f = 0; f < 6; f++) visit(roots[f]);
  // the shadow casters out of view follow the visible patches
  nDrawSh = nDraw; for (let i = 0; i < nShOnly && nDrawSh < SLOTS; i++) record(SHO[i], nDrawSh++);
  serveRequests(budget);
  flushJobs(enc);
  Q.writeBuffer(bPatches, 0, PTF, 0, nDrawSh * 12);
  Q.writeBuffer(bWaterList, 0, WLU, 0, nWater);
  return nDraw;
}
function flushJobs(enc) {
  if (!nJobs) return;
  Q.writeBuffer(bJobs, 0, JOBA, 0, nJobs * 48);
  const c = enc.beginComputePass(); c.setPipeline(pBuild); c.setBindGroup(0, bg0); c.setBindGroup(1, bgBuild); c.dispatchWorkgroups(nJobs); c.end();
  nJobs = 0;
}
for (let f = 0; f < 6; f++) { roots[f] = takeSlot(); makeNode(f, 0, 0, 0, roots[f], -1); }
