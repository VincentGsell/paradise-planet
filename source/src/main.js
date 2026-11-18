// ============================================================================
// camera, flight, sun and time, rendering, menu
// ============================================================================
await say('Shaping the planet…', 0.1, 400);

// ---------------------------------------------------------------- pipelines of the scene
const mTerr = mod(W_SCENE + W_GROUND + W_TERRAIN);
const mSurf = mod(W_SCENE + W_SURFACE.replace('@group(1) @binding(2)', '@group(1) @binding(2)'));
const pTerrain = scenePipe(mTerr, 'vs', 'fs', lay(bgl0, bglTerr));
const pSurf = scenePipe(mSurf, 'vs', 'fs', lay(bgl0, bglWater), { blend: OVER, depthWrite: true });
const mGrass = mod(W_LIFE + W_GRASS_DRAW);
const pGrass = scenePipe(mGrass, 'vsGrass', 'fsGrass', layGrass, { strip: true, constants: { ROWS: GROWS } });
const pFlower = scenePipe(mGrass, 'vsFlower', 'fsFlower', layGrass);
const mProps = mod(W_LIFE + W_WLIT + W_PROPS_DRAW);
const pProps = scenePipe(mProps, 'vs', 'fs', layGrass, { buffers: [vlProps] });
const mBlit = mod(W_BLIT);
const bglBlit = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: SS.FRAGMENT, texture: {} }, { binding: 1, visibility: SS.FRAGMENT, sampler: {} }] });
const blitPipe = (e, add) => device.createRenderPipeline({ layout: lay(bglBlit), vertex: { module: mBlit, entryPoint: 'vs' },
  fragment: { module: mBlit, entryPoint: e, targets: [{ format: HDR, blend: add ? ADD : undefined }] } });
const pDown0 = blitPipe('fsDown0'), pDown = blitPipe('fsDown'), pUp = blitPipe('fsUp', true);
const blitBG = (view) => device.createBindGroup({ layout: bglBlit, entries: [{ binding: 0, resource: view }, { binding: 1, resource: sLin }] });
const mPost = mod(W_POST);
const bglPost = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: SS.FRAGMENT, texture: {} }, { binding: 1, visibility: SS.FRAGMENT, texture: {} },
  { binding: 2, visibility: SS.FRAGMENT, sampler: {} }, { binding: 3, visibility: SS.FRAGMENT, texture: {} }, { binding: 4, visibility: SS.FRAGMENT, buffer: { type: 'read-only-storage' } }] });
const pPost = device.createRenderPipeline({ layout: lay(bgl0, bglPost), vertex: { module: mPost, entryPoint: 'vs' }, fragment: { module: mPost, entryPoint: 'fs', targets: [{ format: FMT }] } });
const mExpo = mod(W_EXPO);
const bglExpo = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: SS.COMPUTE, texture: {} }, { binding: 1, visibility: SS.COMPUTE, buffer: { type: 'storage' } }] });
const pExpo = device.createComputePipeline({ layout: lay(bgl0, bglExpo), compute: { module: mExpo, entryPoint: 'main' } });
const bExpo = sbuf(16);

// ---------------------------------------------------------------- render targets (rebuilt on resize)
// The scene is drawn at `pix` pixels and scaled up to the window; frame() tunes `pix` for 60 fps.
const PIXMAX = 3840 * 2160, PIXMIN = mob ? 25e4 : 6e5;
let W = 0, H = 0, DW = 0, DH = 0, pix = +SV[1] || (LV > 1 ? 1280 * 720 : mob ? 1280 * 720 : PIXMAX), dynN = 0, dynT = 0, dynG = 0, dynGN = 0, dynBad = 0, dynOk = 0, dynWait = 3;
let passScene, passComp, passPost, bgComp, bgPost, bgExpo, bloomPass = [], bloomBG = [], targets = [];
const NB = 6;
function resize() {
  DW = max(2, round(canvas.clientWidth * devicePixelRatio)); DH = max(2, round(canvas.clientHeight * devicePixelRatio));
  const s = min(1, sqrt(pix / (DW * DH)));
  const w = max(2, round(DW * s) & ~1), h = max(2, round(DH * s) & ~1);
  if (w === W && h === H) return;
  dynN = dynG = dynGN = 0; dynT = -300;
  W = w; H = h; canvas.width = W; canvas.height = H;
  ctx.configure({ device, format: FMT, alphaMode: 'opaque' });
  for (const t of targets) t.destroy();
  const tMS = tex(AA > 1 ? W : 1, H, HDR, TU.RENDER_ATTACHMENT, { samples: AA }), tDp = tex(W, H, DEPTH, TU.RENDER_ATTACHMENT | TU.TEXTURE_BINDING, { samples: AA });
  const tScene = tex(W, H, HDR, TU.RENDER_ATTACHMENT | TU.TEXTURE_BINDING), tComp = tex(W, H, HDR, TU.RENDER_ATTACHMENT | TU.TEXTURE_BINDING);
  targets = [tMS, tDp, tScene, tComp];
  const bl = [];
  for (let i = 0; i < NB; i++) { const t = tex(max(1, W >> (i + 1)), max(1, H >> (i + 1)), HDR, TU.RENDER_ATTACHMENT | TU.TEXTURE_BINDING); bl.push(t); targets.push(t); }
  const vDp = tDp.createView(), vScene = tScene.createView(), vComp = tComp.createView(), vBl = bl.map((t) => t.createView());
  passScene = { colorAttachments: [{ view: AA > 1 ? tMS.createView() : vScene, resolveTarget: AA > 1 ? vScene : undefined, loadOp: 'clear', storeOp: AA > 1 ? 'discard' : 'store', clearValue: [0, 0, 0, 1] }],
    depthStencilAttachment: { view: vDp, depthClearValue: 0, depthLoadOp: 'clear', depthStoreOp: 'store' } };
  passComp = { colorAttachments: [colorAtt(vComp, true)] };
  cloudTargets(W, H, vDp); rayTargets(W, H, vDp);
  bgComp = [0, 1].map((i) => device.createBindGroup({ layout: bglComp, entries: [{ binding: 0, resource: vScene }, { binding: 1, resource: vDp }, { binding: 2, resource: { buffer: uStars } },
    { binding: 3, resource: cHist[i][0].createView() }, { binding: 4, resource: cHist[i][1].createView() }] }));
  passPost = { colorAttachments: [{ view: null, loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] }] };
  bgPost = device.createBindGroup({ layout: bglPost, entries: [{ binding: 0, resource: vComp }, { binding: 1, resource: vBl[0] }, { binding: 2, resource: sLin },
    { binding: 3, resource: vRays }, { binding: 4, resource: { buffer: bExpo } }] });
  bgExpo = device.createBindGroup({ layout: bglExpo, entries: [{ binding: 0, resource: vBl[NB - 1] }, { binding: 1, resource: { buffer: bExpo } }] });
  bloomPass = []; bloomBG = [];
  for (let i = 0; i < NB; i++) { bloomPass.push({ colorAttachments: [colorAtt(vBl[i], true)] }); bloomBG.push(blitBG(i ? vBl[i - 1] : vComp)); }
  for (let i = NB - 1; i > 0; i--) { bloomPass.push({ colorAttachments: [colorAtt(vBl[i - 1], false)] }); bloomBG.push(blitBG(vBl[i])); }
}

// ---------------------------------------------------------------- timing (GPU timestamp queries)
let qs, qResolve, qRead = [], tsBegin, tsEnd, gpuMs = 0;
if (hasTS) {
  qs = device.createQuerySet({ type: 'timestamp', count: 2 });
  qResolve = device.createBuffer({ size: 16, usage: BU.QUERY_RESOLVE | BU.COPY_SRC });
  for (let i = 0; i < 6; i++) {
    const b = device.createBuffer({ size: 16, usage: BU.MAP_READ | BU.COPY_DST });
    const o = { b, busy: false, done: null };
    o.done = () => {
      const a = new BigInt64Array(b.getMappedRange());
      const ms = Number(a[1] - a[0]) / 1e6; gpuMs = ms; b.unmap(); o.busy = false;
      if (dynT > 0 && ms > 0 && ms < 1e3) { dynG += ms; dynGN++; }
      if (gpuLog) gpuLog(ms);
    };
    qRead.push(o);
  }
  tsBegin = { querySet: qs, beginningOfPassWriteIndex: 0 }; tsEnd = { querySet: qs, endOfPassWriteIndex: 1 };
}
let gpuLog = null;
const cpTS = { timestampWrites: tsBegin };

// ---------------------------------------------------------------- camera
// position (body frame, f64) and an orthonormal basis: forward, up, right
const CP = new Float64Array(3), CB = new Float64Array(9), CV = new Float64Array(3), TMP = new Float64Array(12);
const TANH = 0.62, NEAR = 0.1;
let sunPhi = 0, timeIdx = 3, simT = 0;
const SPEEDS = [0, 1, 10, 60, 240, 900, 3600];
const DECL = 0.32; // the sun's declination (the season)
const lonOf = (x, z) => atan2(z, x);
// local solar time (h) at the camera
const localHour = () => { let h = 12 + (lonOf(CP[0], CP[2]) - sunPhi) / TAU * 24; h %= 24; return h < 0 ? h + 24 : h; };
const setHour = (h) => { sunPhi = lonOf(CP[0], CP[2]) - (h - 12) / 24 * TAU; };
// the evening hour at which the sun stands `alt` rad above the horizon of the unit vertical (ux, uy, uz)
function eveningHour(ux, uy, uz, alt) {
  const cd = cos(DECL);
  for (let h = 12; h < 24; h += 0.01) {
    const phi = lonOf(ux, uz) - (h - 12) / 24 * TAU;
    if (cd * cos(phi) * ux + sin(DECL) * uy + cd * sin(phi) * uz < sin(alt)) return h;
  }
  return 18.5;
}
// places the camera at p looking at t (body frame)
function lookAt(px, py, pz, tx, ty, tz) {
  CP[0] = px; CP[1] = py; CP[2] = pz; CV.fill(0);
  CB[0] = tx - px; CB[1] = ty - py; CB[2] = tz - pz; v3norm(CB, 0);
  TMP[0] = px; TMP[1] = py; TMP[2] = pz; v3norm(TMP, 0);
  // looking straight up or down: the vertical gives no right vector, take another reference
  if (abs(v3dot(CB, 0, TMP, 0)) > 0.999) { TMP[0] = 0.31; TMP[1] = 0.83; TMP[2] = 0.47; }
  v3cross(CB, 6, CB, 0, TMP, 0); v3norm(CB, 6);
  v3cross(CB, 3, CB, 6, CB, 0);
}
// ground height under a direction, full detail (the camera never goes below it)
const groundAt = (x, y, z) => { const l = sqrt(x * x + y * y + z * z); return height(x / l, y / l, z / l, 0); };

// ---------------------------------------------------------------- viewpoints, found on this planet
// One coastal region is chosen (a sandy shore with land rising behind it); every viewpoint is set around it.
const POSES = [];
{
  rseed(2026); // the choice of the coast does not depend on what drew random numbers before
  const N = 24000, d = new Float64Array(3), e = new Float64Array(3);
  let best = -1e9, bd = new Float64Array(3);
  for (let i = 0; i < N; i++) {
    fibDir(d, 0, i, N);
    if (abs(d[1]) > 0.75) continue;
    const h = height(d[0], d[1], d[2], 4);
    if (h < 0.4 || h > 2.5) continue;
    // land rising inland and a shelf offshore within ~600 m: sample a ring
    let up = 0, sea = 0, shelf = 0;
    const s = 600 / R;
    for (let a = 0; a < 8; a++) {
      const an = a / 8 * TAU; e[0] = d[0] + cos(an) * s * (d[1] * 0 + 1); e[1] = d[1] + sin(an) * s; e[2] = d[2] - cos(an) * s * d[0];
      v3norm(e, 0); const g = height(e[0], e[1], e[2], 4);
      if (g > 25) up++; if (g < -3) sea++; if (g < -18 && g > -50) shelf++;
    }
    const score = min(up, 3) + min(sea, 3) + min(shelf, 2) * 1.5 + rnd() * 0.5;
    if (score > best) { best = score; bd.set(d); }
  }
  // the local frame at the shore: up, and the direction toward the sea
  const U = bd, T = new Float64Array(3), B = new Float64Array(3), p = new Float64Array(3);
  let bestA = 0, lowH = 1e9;
  for (let a = 0; a < 16; a++) {
    const an = a / 16 * TAU; T[0] = -U[2]; T[1] = 0; T[2] = U[0]; v3norm(T, 0); v3cross(B, 0, U, 0, T, 0);
    p[0] = U[0] + (T[0] * cos(an) + B[0] * sin(an)) * 300 / R; p[1] = U[1] + (T[1] * cos(an) + B[1] * sin(an)) * 300 / R; p[2] = U[2] + (T[2] * cos(an) + B[2] * sin(an)) * 300 / R;
    v3norm(p, 0); const g = height(p[0], p[1], p[2], 4); if (g < lowH) { lowH = g; bestA = an; }
  }
  T[0] = -U[2]; T[1] = 0; T[2] = U[0]; v3norm(T, 0); v3cross(B, 0, U, 0, T, 0);
  const sx = T[0] * cos(bestA) + B[0] * sin(bestA), sy = T[1] * cos(bestA) + B[1] * sin(bestA), sz = T[2] * cos(bestA) + B[2] * sin(bestA); // toward the sea
  const lx = U[1] * sz - U[2] * sy, ly = U[2] * sx - U[0] * sz, lz = U[0] * sy - U[1] * sx; // along the shore
  // a point at `along` m along the shore, `out` m toward the sea, `up` m above the ground (or `abs` m above the sea)
  const at = (along, out, upm, abs) => {
    p[0] = U[0] + (lx * along + sx * out) / R; p[1] = U[1] + (ly * along + sy * out) / R; p[2] = U[2] + (lz * along + sz * out) / R; v3norm(p, 0);
    const g = height(p[0], p[1], p[2], 0);
    // upm > 0: above the ground and the sea; upm < 0: that far below the sea surface (never under the ground)
    const r = R + (abs !== undefined ? abs : upm > 0 ? max(g, 0) + upm : max(upm, g + 1.5));
    return [p[0] * r, p[1] * r, p[2] * r];
  };
  const pose = (a, b, hour, sun) => POSES.push([...a, ...b, hour, sun || 0]);
  // a beach facing the sunset: the sun's direction at 18:20 (west, made horizontal) crosses open sea for 2 km
  let SUNSET = [at(-40, -20, 1.7), at(60, 140, 0, 0)], SUNH = 18.3;
  {
    SUNH = eveningHour(U[0], U[1], U[2], 0.06);
    const phi = lonOf(U[0] * R, U[2] * R) - (SUNH - 12) / 24 * TAU, cd = cos(DECL);
    let qx = cd * cos(phi), qy = sin(DECL), qz = cd * sin(phi); const k = qx * U[0] + qy * U[1] + qz * U[2]; qx -= U[0] * k; qy -= U[1] * k; qz -= U[2] * k;
    const l = hypot(qx, qy, qz); qx /= l; qy /= l; qz /= l;
    const al = qx * lx + qy * ly + qz * lz, ou = qx * sx + qy * sy + qz * sz; // the sun direction in (along, out)
    for (let s = 0; s < 300; s++) {
      const a = s * 2.399, rr = 60 + s * 9, ca = cos(a) * rr, co = sin(a) * rr, q = at(ca, co, 1.6);
      const g = height(...(() => { const r2 = hypot(q[0], q[1], q[2]); return [q[0] / r2, q[1] / r2, q[2] / r2]; })(), 0);
      if (g < 0.4 || g > 2.2) continue;
      let wet = 0; for (let m = 1; m <= 10; m++) { const p2 = at(ca + al * m * 200, co + ou * m * 200, 0, 0), r2 = hypot(p2[0], p2[1], p2[2]); if (height(p2[0] / r2, p2[1] / r2, p2[2] / r2, 4) < -2) wet++; }
      if (wet >= 9) { SUNSET = [q, at(ca + al * 100, co + ou * 100, 0, 6)]; break; }
    }
  }
  // the forest edge: a point of the meadows 15 to 250 m above the sea, at the edge of the woods of groundAlbedo
  // (n0 at 900 m + (n2 at 23 m - 0.5) x 0.2 crossing 0.55), the camera looking into them
  const woods = (q) => vn(q[0] / 900, q[1] / 900, q[2] / 900) + (vn(q[0] / 23, q[1] / 23, q[2] / 23) - 0.5) * 0.2;
  let FOREST = at(-200, -420, 1.8), FTGT = at(-60, -700, 10);
  for (let s = 0; s < 400; s++) {
    const a = s * 2.399, rr = 150 + s * 12, q = at(cos(a) * rr, sin(a) * rr, 1.8);
    const g = hypot(q[0], q[1], q[2]) - R - 1.8; if (g < 15 || g > 250) continue;
    const w0 = woods(q); if (w0 < 0.5 || w0 > 0.55) continue;
    // the woods side: the neighbour 25 m away with the most woods
    let best = -1, bq = null;
    for (let k = 0; k < 8; k++) { const b = k / 8 * TAU, q2 = at(cos(a) * rr + cos(b) * 25, sin(a) * rr + sin(b) * 25, 6); const w = woods(q2); if (w > best) { best = w; bq = q2; } }
    if (best > 0.62) { FOREST = q; FTGT = bq; break; }
  }
  pose(at(-R * 0.9, -R * 0.6, 0, R * 2.4), at(0, 0, 0, -R), 15.2);            // 1 orbit, the planet three-quarter lit
  pose(at(-2600, -3800, 0, CBASE + CTHICK + 900), at(300, 900, 0, 0), 16.9);  // 2 high altitude, above the clouds
  pose(at(-600, -900, 0, CBASE * 0.8), at(800, 900, 0, CBASE * 0.55), 16.8);   // 3 under the cloud layer
  pose(SUNSET[0], SUNSET[1], SUNH, 1);                                      // 4 a beach facing the sunset over the open sea
  pose(at(30, -260, 1.6), at(160, -500, 8), 10.5);                          // 5 meadow at eye level
  pose(FOREST, FTGT, 7.4);                                                   // 6 forest edge, morning sun through the trees
  // under the sea: the first place along a spiral off the shore whose floor is in the wanted depth, the camera a few
  // metres above it, looking along the floor where it stays in that depth
  // the kelp's patches (sh_sea.js): detail(1) x 0.6 + detail(0) of (p + 50 m) x 0.4
  const kelp = (q) => sstep(0.42, 0.62, vn(q[0] / 140, q[1] / 140, q[2] / 140) * 0.6 + vn((q[0] + 50) / 900, (q[1] + 50) / 900, (q[2] + 50) / 900) * 0.4);
  const seaSpot = (lo, hi, up, look, clearing) => {
    for (let s = 0; s < 1500; s++) {
      const a = s * 2.399, rr = 40 + s * 3, ca = cos(a) * rr, co = abs(sin(a)) * rr + 30, q = at(ca, co, 0, 0), r2 = hypot(q[0], q[1], q[2]);
      const g = height(q[0] / r2, q[1] / r2, q[2] / r2, 0); if (g < lo || g > hi) continue;
      if (clearing && kelp(q) > 0.3) continue;
      let bd = -1, bs = 0;
      for (let k = 0; k < 12; k++) {
        const b = k / 12 * TAU; let ok = 0;
        for (let m = 1; m <= 4; m++) { const p2 = at(ca + cos(b) * m * 10, co + sin(b) * m * 10, 0, 0), r3 = hypot(p2[0], p2[1], p2[2]), g2 = height(p2[0] / r3, p2[1] / r3, p2[2] / r3, 0); if (g2 > lo - 6 && g2 < hi + 4) ok++; }
        if (clearing && kelp(at(ca + cos(b) * 28, co + sin(b) * 28, 0, 0)) < 0.45) ok = 0;
        if (ok > bs) { bs = ok; bd = b; }
      }
      if (bs >= 3) return [at(ca, co, 0, g + up), at(ca + cos(bd) * 40, co + sin(bd) * 40, 0, g + up + look)];
    }
    return clearing ? seaSpot(lo, hi, up, look, false) : [at(20, 200, -9), at(60, 300, -24)];
  };
  const REEF = seaSpot(-14, -10, 3, -5), GARDEN = seaSpot(-43, -36, 9, -6, true);
  pose(REEF[0], REEF[1], 12.5);                                             // 7 the reef, a few metres over the floor
  pose(GARDEN[0], GARDEN[1], 13);                                           // 8 garden at 40 m
}
// the scripted 60 s flight (dev.js): orbit -> above the clouds -> through them -> meadow -> beach -> dive
const FLIGHT = [];
{
  const P = POSES, k = (t, p) => FLIGHT.push([t, p[0], p[1], p[2]]);
  k(0, P[0]); k(9, P[1]); k(17, P[2]); k(27, [P[4][0], P[4][1], P[4][2]].map((v, i) => v + (P[2][i] - P[4][i]) * 0.25)); k(35, P[4]); k(42, P[5]); k(48, P[3]);
  k(53, P[6]); k(60, P[7]); k(66, P[7]);
}
const goPose = (i) => {
  const p = POSES[i]; lookAt(p[0], p[1], p[2], p[3], p[4], p[5]); setHour(p[6]);
  if (p[7]) {
    // face the low sun: its direction made horizontal at the camera, a little above the horizon
    const r = v3len(CP, 0), ux = CP[0] / r, uy = CP[1] / r, uz = CP[2] / r, cd = cos(DECL);
    let sx = cd * cos(sunPhi), sy = sin(DECL), sz = cd * sin(sunPhi); const k = sx * ux + sy * uy + sz * uz;
    sx -= ux * k; sy -= uy * k; sz -= uz * k; const l = hypot(sx, sy, sz);
    lookAt(CP[0], CP[1], CP[2], CP[0] + sx / l * 100 + ux * 6, CP[1] + sy / l * 100 + uy * 6, CP[2] + sz / l * 100 + uz * 6);
  }
};

// ---------------------------------------------------------------- frame uniform
const DSC = [900, 140, 23, 4.1];
let frameN = 0, ftime = 0, dtLast = 0.016;
function writeFrame() {
  const f = FU, tx = TANH * W / H, ty = TANH, sx = 1 / tx, sy = 1 / ty;
  const fx = CB[0], fy = CB[1], fz = CB[2], ux = CB[3], uy = CB[4], uz = CB[5], rx = CB[6], ry = CB[7], rz = CB[8];
  f[0] = rx * sx; f[4] = ry * sx; f[8] = rz * sx; f[12] = 0;
  f[1] = ux * sy; f[5] = uy * sy; f[9] = uz * sy; f[13] = 0;
  f[2] = 0; f[6] = 0; f[10] = 0; f[14] = NEAR;
  f[3] = fx; f[7] = fy; f[11] = fz; f[15] = 0;
  f[16] = rx; f[17] = ry; f[18] = rz; f[19] = tx;
  f[20] = ux; f[21] = uy; f[22] = uz; f[23] = ty;
  f[24] = fx; f[25] = fy; f[26] = fz; f[27] = NEAR;
  f[28] = CP[0]; f[29] = CP[1]; f[30] = CP[2]; f[31] = v3len(CP, 0);
  const cd = cos(DECL);
  f[32] = cd * cos(sunPhi); f[33] = sin(DECL); f[34] = cd * sin(sunPhi); f[35] = ftime;
  f[36] = R; f[37] = ATOP; f[38] = AMAX * 0.6; f[39] = SHELF;
  f[40] = PL.L0; f[41] = PL.A0; f[42] = PL.G; f[43] = PL.OCT;
  f[44] = PL.SEA; f[45] = PL.DS; f[46] = PL.CST; f[47] = MR;
  f[48] = W; f[49] = H; f[50] = 1 / W; f[51] = 1 / H;
  f[52] = 2 * ty / H; f[53] = 1; f[54] = LV; f[55] = frameN;
  for (let k = 0; k < 4; k++) for (let c = 0; c < 3; c++) { const v = CP[c] / DSC[k]; f[56 + k * 4 + c] = v - 256 * floor(v / 256); }
  f[75] = dtLast;
  shadowMatrices();
  Q.writeBuffer(uFrame, 0, FU);
  // the star field turns with the sun
  STU[0] = cos(sunPhi); STU[1] = sin(sunPhi); STU[2] = 1; STU[3] = 4000;
  Q.writeBuffer(uStars, 0, STU);
  for (let c = 0; c < 3; c++) CAM[c] = CP[c];
  // frustum side planes: inside where dot(p, n) >= -r
  plane(0, -rx, -ry, -rz, tx); plane(3, rx, ry, rz, tx); plane(6, -ux, -uy, -uz, ty); plane(9, ux, uy, uz, ty);
}
function plane(o, ax, ay, az, k) {
  FR[o] = CB[0] * k + ax; FR[o + 1] = CB[1] * k + ay; FR[o + 2] = CB[2] * k + az;
  const l = sqrt(FR[o] * FR[o] + FR[o + 1] * FR[o + 1] + FR[o + 2] * FR[o + 2]); FR[o] /= l; FR[o + 1] /= l; FR[o + 2] /= l;
}

// ---------------------------------------------------------------- render
const submitList = [null];
let lastDraw = 0;
function render() {
  writeFrame();
  const e = device.createCommandEncoder();
  let slot = null;
  if (hasTS) { for (let i = 0; i < qRead.length; i++) if (!qRead[i].busy) { slot = qRead[i]; break; } }
  // the first pass carries the start timestamp
  const c = e.beginComputePass(slot ? cpTS : undefined);
  c.setPipeline(pSkyV); c.setBindGroup(0, bg0Sky); c.setBindGroup(1, bgSkyOut); c.dispatchWorkgroups(ceil(SLUT[0] / 8), ceil(SLUT[1] / 8)); c.end();
  lastDraw = lodUpdate(e, BUILDS);
  oceanFrame(); waves(e); cloudFrame(); cloudPasses(e); grassPass(e); propsPass(e); seaPass(e); faunaPass(e); shadowPasses(e);
  let r = e.beginRenderPass(passScene);
  r.setBindGroup(0, bg0);
  r.setPipeline(pTerrain); r.setBindGroup(1, bgTerr); r.setIndexBuffer(ibPatch, 'uint16'); r.drawIndexed(NIDX, lastDraw);
  r.setBindGroup(2, bgLife);
  r.setPipeline(pGrass); r.setBindGroup(3, bgGrassR); r.drawIndirect(bGArgs, 0);
  r.setPipeline(pFlower); r.setBindGroup(3, bgFlowerR); r.drawIndirect(bGArgs, 16);
  r.setPipeline(pProps); r.setBindGroup(2, LS_TREE[2]); r.setVertexBuffer(0, vbProps); r.setIndexBuffer(ibProps, 'uint32');
  for (let b = 0; b < NBK; b++) { r.setBindGroup(3, bgPropsR[b]); r.drawIndexedIndirect(bPArgs, b * 20); }
  seaDraw(r); faunaDraw(r);
  r.setPipeline(pSurf); r.setBindGroup(1, bgWater); r.setIndexBuffer(ibPatch, 'uint16'); r.drawIndexed(NIDX, nWater);
  r.setBindGroup(1, bgTerr); seaSnow(r);
  r.end();
  cloudMarch(e); rayPasses(e);
  r = e.beginRenderPass(passComp); r.setPipeline(pComp); r.setBindGroup(0, bg0); r.setBindGroup(1, bgComp[cPing]); r.draw(3); r.end();
  for (let i = 0; i < bloomPass.length; i++) {
    r = e.beginRenderPass(bloomPass[i]); r.setPipeline(i === 0 ? pDown0 : i < NB ? pDown : pUp); r.setBindGroup(0, bloomBG[i]); r.draw(3); r.end();
    if (i === NB - 1) { const x = e.beginComputePass(); x.setPipeline(pExpo); x.setBindGroup(0, bg0); x.setBindGroup(1, bgExpo); x.dispatchWorkgroups(1); x.end(); }
  }
  passPost.colorAttachments[0].view = ctx.getCurrentTexture().createView();
  passPost.timestampWrites = slot ? tsEnd : undefined;
  r = e.beginRenderPass(passPost); r.setPipeline(pPost); r.setBindGroup(0, bg0); r.setBindGroup(1, bgPost); r.draw(3); r.end();
  if (slot) { e.resolveQuerySet(qs, 0, 2, qResolve, 0); e.copyBufferToBuffer(qResolve, 0, slot.b, 0, 16); }
  submitList[0] = e.finish();
  Q.submit(submitList);
  if (slot) { slot.busy = true; slot.b.mapAsync(GPUMapMode.READ).then(slot.done); }
  frameN++;
}

// ---------------------------------------------------------------- flight
// The ship of OpenG: the mouse turns the camera around its own axes (no stop: loops are fine), you fly where you
// look; near the planet the horizon levels itself (roll only), unless you look almost straight up or down.
let kf = 0, kb = 0, kl = 0, kr = 0, ku = 0, kd = 0, ks = 0, mdx = 0, mdy = 0, lkx = 0, lky = 0, l2x = 0, l2y = 0, speedMul = 1;
let hud = false, hN = 0, hMax = 0, hT = 0;
function fly(dt) {
  // mouse look through two cascaded low-pass stages
  const kq = 1 - exp(-dt * 30); lkx += mdx * 0.0021; lky += mdy * 0.0021; mdx = 0; mdy = 0;
  const ax = lkx * kq, ay = lky * kq; lkx -= ax; lky -= ay; l2x += ax; l2y += ay;
  const yaw = l2x * kq, pit = l2y * kq; l2x -= yaw; l2y -= pit;
  // yaw around the camera's up, pitch around its right
  v3rot(CB, 0, CB, 3, -yaw); v3rot(CB, 6, CB, 3, -yaw);
  v3rot(CB, 0, CB, 6, -pit); v3rot(CB, 3, CB, 6, -pit);
  // local vertical
  const r = v3len(CP, 0); TMP[0] = CP[0] / r; TMP[1] = CP[1] / r; TMP[2] = CP[2] / r;
  const alt = r - R;
  if (r < 5 * R) {
    const fu = v3dot(CB, 0, TMP, 0);
    if (abs(fu) < 0.96) {
      // the right vector the level horizon would have; roll toward it
      v3cross(TMP, 3, CB, 0, TMP, 0); v3norm(TMP, 3);
      v3cross(TMP, 6, CB, 6, TMP, 3);
      const sn = v3dot(TMP, 6, CB, 0), cs = v3dot(CB, 6, TMP, 3);
      const k = (1 - exp(-dt / 0.22)) * (1 - sstep(0.85, 0.96, abs(fu)));
      const ang = atan2(sn, cs) * k;
      v3rot(CB, 3, CB, 0, ang); v3rot(CB, 6, CB, 0, ang);
    }
  }
  // re-orthonormalize: right = forward x up, up = right x forward
  v3norm(CB, 0); v3cross(CB, 6, CB, 0, CB, 3); v3norm(CB, 6); v3cross(CB, 3, CB, 6, CB, 0); v3norm(CB, 3);
  // speed follows the height above the ground (or the sea floor); slow under water
  const gh = groundAt(CP[0], CP[1], CP[2]), above = max(alt - max(gh, -1e9), 0.5);
  const wet = alt < 0;
  let sp = clamp(above * 0.9, wet ? 1.2 : 3.5, wet ? 9 : 9000) * speedMul * (ks ? 5 : 1);
  const mf = kf - kb, mr = kr - kl, mu = ku - kd, k = 1 - exp(-dt * 5);
  for (let c = 0; c < 3; c++) CV[c] += ((CB[c] * mf + CB[6 + c] * mr + TMP[c] * mu) * sp - CV[c]) * k;
  for (let c = 0; c < 3; c++) CP[c] += CV[c] * dt;
  // the ground: never closer than 1.5 m; space: not farther than 8 radii
  let rr = v3len(CP, 0); const g = groundAt(CP[0], CP[1], CP[2]), lo = R + g + 1.5;
  if (rr < lo) { const s = lo / rr; CP[0] *= s; CP[1] *= s; CP[2] *= s; const vn = (CV[0] * CP[0] + CV[1] * CP[1] + CV[2] * CP[2]) / lo; if (vn < 0) for (let c = 0; c < 3; c++) CV[c] -= CP[c] / lo * vn; rr = lo; }
  if (rr > 8 * R) { const s = 8 * R / rr; CP[0] *= s; CP[1] *= s; CP[2] *= s; }
}

function frame(now) {
  requestAnimationFrame(frame);
  const dtr = now - ftimeMs; ftimeMs = now;
  let dt = dtr / 1000; if (dt > 0.1) dt = 0.1; if (dt < 0) dt = 0;
  dtLast = dt;
  // dynamic resolution for 60 fps (Abyssal Garden's controller): every second, scale the pixel count
  if (!fixedRes && dtr < 1e3 && (dynT += dtr) > 0 && (dynN++, dynT > (menu ? 400 : 1000))) {
    const a = dynT / dynN, gm = dynGN ? dynG / dynGN : 0; let k = 1;
    if (gm) { if (gm > 13.6 || gm < 9.8) k = 11.7 / gm; }
    else if (a > 17.6) { dynOk = 0; if (++dynBad > 1) { k = 15 / a; dynBad = 0; dynWait = min(dynWait * 2, 60); } }
    else { dynBad = 0; if (a < 12.5) k = 15 / a; else if (++dynOk > dynWait) { k = 1.17; dynOk = 0; } }
    k = clamp(k, 0.5, 1.7); const top = min(PIXMAX, DW * DH), was = pix;
    pix = clamp(pix * k, PIXMIN, top);
    if (was !== pix) keep('paradise', [LV, pix < top ? pix | 0 : '', DIAM]);
    dynN = dynT = dynG = dynGN = 0; resize();
  }
  ftime += dt;
  simT += dt * SPEEDS[timeIdx];
  sunPhi -= dt * SPEEDS[timeIdx] / 86400 * TAU;
  if (flightFn) flightFn(dt); else if (!menu) fly(dt); else idle(dt);
  render();
  if (hud) {
    hN++; if (dtr > hMax) hMax = dtr; hT += dtr / 1000;
    if (hT > 0.5) { info.textContent = `${(hN / hT).toFixed(0)} fps · worst ${hMax.toFixed(1)} ms · GPU ${gpuMs.toFixed(2)} ms · ${W}x${H} (${W * 100 / DW | 0}%) · ${lastDraw} patches · alt ${(v3len(CP, 0) - R).toFixed(1)} m`; hT = 0; hN = 0; hMax = 0; }
  }
  if ((frameN & 15) === 0) clock();
}
let ftimeMs = 0, fixedRes = false, flightFn = null;
// behind the menu the camera drifts slowly along its view, high above the ground
function idle(dt) { fly(0); }

// ---------------------------------------------------------------- the clock and the pace of time
let lastClock = '';
function clock() {
  const h = localHour(), hh = floor(h), mm = floor((h - hh) * 60);
  const s = `${hh < 10 ? '0' : ''}${hh}:${mm < 10 ? '0' : ''}${mm} · ${timeIdx ? '×' + SPEEDS[timeIdx] : 'paused'}`;
  if (s !== lastClock) { $('tc').textContent = s; lastClock = s; }
}
const pace = (d) => { timeIdx = d === 0 ? (timeIdx ? 0 : 3) : clamp(timeIdx + d, 0, SPEEDS.length - 1); clock(); };
$('tt').onclick = () => pace(1); $('tg').onclick = () => pace(-1);

// ---------------------------------------------------------------- input
const key = (e, v) => {
  switch (e.code) {
    case 'KeyW': kf = v; break; case 'KeyS': kb = v; break; case 'KeyA': kl = v; break; case 'KeyD': kr = v; break;
    case 'KeyE': ku = v; break; case 'KeyQ': kd = v; break; case 'ShiftLeft': case 'ShiftRight': ks = v; break;
    default: if (v && !e.repeat) {
      if (e.code === 'KeyH') { hud = !hud; info.textContent = ''; }
      else if (e.code === 'KeyT') pace(1); else if (e.code === 'KeyG') pace(-1); else if (e.code === 'KeyP') pace(0);
      else if (e.code === 'Escape') ui(true);
      else if (e.code >= 'Digit1' && e.code <= 'Digit8') goPose(e.code.charCodeAt(5) - 49);
    }
  }
};
addEventListener('keydown', (e) => { if (menu && e.code !== 'KeyH') return; key(e, 1); });
addEventListener('keyup', (e) => key(e, 0));
addEventListener('wheel', (e) => { if (!menu) speedMul = clamp(speedMul * (e.deltaY > 0 ? 0.8 : 1.25), 0.05, 20); }, { passive: true });
const release = () => { kf = kb = kl = kr = ku = kd = ks = 0; };
const capture = () => { const p = canvas.requestPointerLock({ unadjustedMovement: true }); if (p && p.catch) p.catch(() => canvas.requestPointerLock()).catch(() => 0); };
canvas.addEventListener('click', capture);
addEventListener('mousemove', (e) => { if (document.pointerLockElement === canvas) { mdx += e.movementX; mdy += e.movementY; } });
addEventListener('blur', release);

// ---------------------------------------------------------------- menu
let menu = true;
const bFly = $('d');
const ui = (m) => {
  if (dead) return;
  menu = m; body.className = m ? 'm' : document.pointerLockElement ? 'g p' : 'g';
  if (m) { release(); setTimeout(() => menu && bFly.focus(), 100); } else document.activeElement.blur();
};
const go = () => { ui(false); bFly.textContent = 'Resume'; if (!mob) capture(); };
bFly.onclick = go; $('o').onclick = () => ui(true);
$('q').querySelectorAll('button').forEach((b, i) => { if (i === 2 - LV) b.className = 'on'; else b.onclick = () => { keep('paradise', [2 - i, '', DIAM]); location.reload(); }; });
const rng = $('r'); rng.value = DIAM; $('y').textContent = DIAM + ' km';
rng.oninput = () => { $('y').textContent = rng.value + ' km'; };
rng.onchange = () => { if (+rng.value !== DIAM) { keep('paradise', [LV, '', rng.value]); location.reload(); } };
document.addEventListener('pointerlockchange', () => ui(!document.pointerLockElement));

// ---------------------------------------------------------------- start
await say('Lighting the sky…', 0.3, 300);
bakeAtmo();
resize();
addEventListener('resize', resize);
goPose(+URLQ.get('pose') - 1 >= 0 ? +URLQ.get('pose') - 1 : 3);
keep('paradiseLoad', 1);
addEventListener('pagehide', () => keep('paradiseLoad', ''));
// grow the terrain around the first viewpoint before the reveal
await say('Growing the land…', 0.85, 1200);
for (let i = 0; i < 60; i++) { render(); if ((i & 7) === 7) await Q.onSubmittedWorkDone(); }
await say('Here comes the sun…', 1, 300);
await Q.onSubmittedWorkDone();
setTimeout(keep, 15e3, 'paradiseLoad', '');
ui(true);
requestAnimationFrame((t) => { ftimeMs = t; requestAnimationFrame(frame); });
