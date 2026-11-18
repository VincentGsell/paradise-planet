// ============================================================================
// the sea: wave spectrum (OpenG spectrum.rs), FFT passes, per-frame uniform
// ============================================================================
// A gentle trade wind: 6.5 m/s over 60 km of fetch, a little swell. Clear tropical water.
const WIND = 6.5, FETCH = 60e3, SWELL = 0.25, GRAV = 9.81, REPEAT = 512, CHOP = 1.0;
const ABSORB = [0.30, 0.040, 0.024], SCATTER = [0.010, 0.016, 0.022];
{
  // JONSWAP + Mitsuyasu/Hasselmann spreading (OpenG), Box-Muller amplitudes from the seeded stream
  const lnGamma = (x) => {
    const C = [0.9999999999998099, 676.5203681218851, -1259.1392167224028, 771.3234287776531, -176.6150291621406, 12.507343278686905, -0.13857109526572012, 9.984369578019572e-6, 1.5056327351493116e-7];
    if (x < 0.5) return log(PI / sin(PI * x)) - lnGamma(1 - x);
    x -= 1; let a = C[0]; const t = x + 7.5; for (let i = 1; i < 9; i++) a += C[i] / (x + i);
    return 0.5 * log(2 * PI) + (x + 0.5) * log(t) - t + log(a);
  };
  const wp = max(22 * Math.cbrt(GRAV * GRAV / (WIND * FETCH)), 0.855 * GRAV / WIND);
  const alpha = 0.076 * pow(WIND * WIND / (FETCH * GRAV), 0.22);
  const jonswap = (om) => { if (om <= 0) return 0; const sg = om <= wp ? 0.07 : 0.09, r = exp(-((om - wp) ** 2) / (2 * sg * sg * wp * wp)); return alpha * GRAV * GRAV / om ** 5 * exp(-1.25 * (wp / om) ** 4) * pow(3.3, r); };
  const spread = (om, th) => {
    const sp = 11.5 * pow(GRAV / (wp * WIND), 2.5), x = om / wp;
    let s = x <= 1 ? sp * x ** 5 : sp * pow(x, -2.5); s += 16 * Math.tanh(wp / om) * SWELL * SWELL; s = clamp(s, 0.1, 200);
    return exp((2 * s - 1) * log(2) + 2 * lnGamma(s + 1) - lnGamma(2 * s + 1)) / PI * pow(abs(cos(th * 0.5)), 2 * s);
  };
  const N = WAVE_N, H0 = new Float32Array(N * N * 4 * 3), raw = new Float64Array(N * N * 2), fi = (i) => (i < N / 2 ? i : i - N);
  let hv = 0;
  for (let c = 0; c < 3; c++) {
    const L = CASC[c], dk = 2 * PI / L, lo = c ? 2 * PI / CASC[c] * 3 : 0, hi = c < 2 ? 2 * PI / CASC[c + 1] * 3 : 1e9;
    rseed(911 + c); raw.fill(0);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const u = max(rnd(), 1e-12), v = rnd(), rg = sqrt(-2 * log(u)), g0 = rg * cos(TAU * v), g1 = rg * sin(TAU * v);
      const kx = fi(x) * dk, kz = fi(y) * dk, k = hypot(kx, kz);
      if (k <= 0 || k < lo || k >= hi) continue;
      const om = sqrt(GRAV * k), s = jonswap(om) * spread(om, atan2(kz, kx)) * (GRAV / (2 * om)) / k, a = 0.5 * sqrt(s * dk * dk);
      raw[(y * N + x) * 2] = g0 * a; raw[(y * N + x) * 2 + 1] = g1 * a;
    }
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const i = (y * N + x) * 2, m = (((N - y) % N) * N + (N - x) % N) * 2, o = (c * N * N + y * N + x) * 4;
      H0[o] = raw[i]; H0[o + 1] = raw[i + 1]; H0[o + 2] = raw[m]; H0[o + 3] = -raw[m + 1];
      hv += raw[i] ** 2 + raw[i + 1] ** 2 + raw[m] ** 2 + raw[m + 1] ** 2;
    }
  }
  var HSIG = 4 * sqrt(hv), tH0 = device.createTexture({ size: [N, N, 3], format: 'rgba32float', usage: TU.TEXTURE_BINDING | TU.COPY_DST });
  Q.writeTexture({ texture: tH0 }, H0, { bytesPerRow: N * 16, rowsPerImage: N }, [N, N, 3]);
}
const WMIPS = 9;
const tSpec = device.createTexture({ size: [WAVE_N, WAVE_N, 6], format: 'rgba32float', usage: TU.STORAGE_BINDING | TU.TEXTURE_BINDING });
const tFft = device.createTexture({ size: [WAVE_N, WAVE_N, 6], format: 'rgba32float', usage: TU.STORAGE_BINDING | TU.TEXTURE_BINDING });
const tDisp = device.createTexture({ size: [WAVE_N, WAVE_N, 3], format: HDR, mipLevelCount: WMIPS, usage: TU.STORAGE_BINDING | TU.TEXTURE_BINDING });
const tSlope = device.createTexture({ size: [WAVE_N, WAVE_N, 3], format: HDR, mipLevelCount: WMIPS, usage: TU.STORAGE_BINDING | TU.TEXTURE_BINDING });
const WU = new Float32Array(8), uWave = ubuf(32);
WU.set([CASC[0], CASC[1], CASC[2], 0, 0, CHOP, TAU / REPEAT, GRAV]);
const mWaves = mod(W_WAVES);
const wpipe = (e) => device.createComputePipeline({ layout: 'auto', compute: { module: mWaves, entryPoint: e } });
const pEvolve = wpipe('evolve'), pRows = wpipe('rows'), pCols = wpipe('cols'), pAsm = wpipe('assemble'), pWDown = wpipe('down');
const arr = (t, mip) => t.createView({ dimension: '2d-array', baseMipLevel: mip || 0, mipLevelCount: 1 });
const wbg = (p, ent) => device.createBindGroup({ layout: p.getBindGroupLayout(0), entries: ent });
const bgEvolve = wbg(pEvolve, [{ binding: 0, resource: { buffer: uWave } }, { binding: 1, resource: tH0.createView({ dimension: '2d-array' }) }, { binding: 2, resource: arr(tSpec) }]);
const bgRows = wbg(pRows, [{ binding: 3, resource: arr(tSpec) }, { binding: 4, resource: arr(tFft) }]);
const bgCols = wbg(pCols, [{ binding: 3, resource: arr(tFft) }, { binding: 4, resource: arr(tSpec) }]);
const bgAsm = wbg(pAsm, [{ binding: 3, resource: arr(tSpec) }, { binding: 5, resource: arr(tDisp) }, { binding: 6, resource: arr(tSlope) }]);
const bgWDown = [];
for (let m = 1; m < WMIPS; m++) bgWDown.push(wbg(pWDown, [{ binding: 5, resource: arr(tDisp, m) }, { binding: 6, resource: arr(tSlope, m) }, { binding: 7, resource: arr(tDisp, m - 1) }, { binding: 8, resource: arr(tSlope, m - 1) }]));
function waves(e) {
  WU[4] = ftime % REPEAT; Q.writeBuffer(uWave, 0, WU);
  const c = e.beginComputePass();
  c.setPipeline(pEvolve); c.setBindGroup(0, bgEvolve); c.dispatchWorkgroups(WAVE_N / 8, WAVE_N / 8, 3);
  c.setPipeline(pRows); c.setBindGroup(0, bgRows); c.dispatchWorkgroups(WAVE_N, 6);
  c.setPipeline(pCols); c.setBindGroup(0, bgCols); c.dispatchWorkgroups(WAVE_N, 6);
  c.setPipeline(pAsm); c.setBindGroup(0, bgAsm); c.dispatchWorkgroups(WAVE_N / 8, WAVE_N / 8, 3);
  c.setPipeline(pWDown);
  for (let m = 1; m < WMIPS; m++) { const s = WAVE_N >> m; c.setBindGroup(0, bgWDown[m - 1]); c.dispatchWorkgroups(ceil(s / 8), ceil(s / 8), 3); }
  c.end();
}

// ---------------------------------------------------------------- group 2 of the scene: the water
const OU = new Float32Array(36), uOcean = ubuf(144);
const bglOcean = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: VF, buffer: {} },
  { binding: 1, visibility: VF, texture: { viewDimension: '2d-array' } }, { binding: 2, visibility: VF, texture: { viewDimension: '2d-array' } }] });
const bgOcean = device.createBindGroup({ layout: bglOcean, entries: [{ binding: 0, resource: { buffer: uOcean } },
  { binding: 1, resource: tDisp.createView({ dimension: '2d-array' }) }, { binding: 2, resource: tSlope.createView({ dimension: '2d-array' }) }] });
const bglWater = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: VF, buffer: { type: 'read-only-storage' } }, { binding: 1, visibility: VF, buffer: { type: 'read-only-storage' } },
  { binding: 2, visibility: VF, buffer: { type: 'read-only-storage' } }] });
const bWaterList = sbuf(SLOTS * 4);
const bgWater = device.createBindGroup({ layout: bglWater, entries: [{ binding: 0, resource: { buffer: bVerts } }, { binding: 1, resource: { buffer: bPatches } }, { binding: 2, resource: { buffer: bWaterList } }] });
// the composite: its group 1 holds the resolved scene, the depth and the star uniform
const mComp = mod(W_FRAME + W_NOISE + W_ATMO + W_LIGHT + W_WATER + W_UNDERWATER + W_COMPOSITE.replace('texture_depth_multisampled_2d', AA > 1 ? 'texture_depth_multisampled_2d' : 'texture_depth_2d'));
const bglComp = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: SS.FRAGMENT, texture: { sampleType: 'unfilterable-float' } },
  { binding: 1, visibility: SS.FRAGMENT, texture: { sampleType: 'depth', multisampled: AA > 1 } }, { binding: 2, visibility: SS.FRAGMENT, buffer: {} },
  { binding: 3, visibility: SS.FRAGMENT, texture: {} }, { binding: 4, visibility: SS.FRAGMENT, texture: {} }] });
const pComp = device.createRenderPipeline({ layout: lay(bgl0, bglComp, bglOcean), vertex: { module: mComp, entryPoint: 'vs' }, fragment: { module: mComp, entryPoint: 'fs', targets: [{ format: HDR }] } });
// the camera in the wave plane, accumulated from its motion (f64): the waves stay put as it flies
const WPOS = new Float64Array(2), WLAST = new Float64Array(3), WAX = new Float64Array(6);
let wFirst = true;
function oceanFrame() {
  const r = v3len(CP, 0), ux = CP[0] / r, uy = CP[1] / r, uz = CP[2] / r;
  // wind axis: the local east, turned 35 degrees (trade winds); second axis = up x wind
  let ex = -uz, ez = ux; const el = hypot(ex, ez) || 1; ex /= el; ez /= el;
  const nx = uy * ez, ny = uz * ex - ux * ez, nz = -uy * ex; // up x east = north
  const ca = cos(0.6), sa = sin(0.6);
  WAX[0] = ex * ca + nx * sa; WAX[1] = ny * sa; WAX[2] = ez * ca + nz * sa;
  WAX[3] = uy * WAX[2] - uz * WAX[1]; WAX[4] = uz * WAX[0] - ux * WAX[2]; WAX[5] = ux * WAX[1] - uy * WAX[0];
  if (wFirst) { WLAST.set(CP); wFirst = false; }
  const dx = CP[0] - WLAST[0], dy = CP[1] - WLAST[1], dz = CP[2] - WLAST[2]; WLAST.set(CP);
  WPOS[0] += dx * WAX[0] + dy * WAX[1] + dz * WAX[2]; WPOS[1] += dx * WAX[3] + dy * WAX[4] + dz * WAX[5];
  const o = OU;
  o[0] = 1; o[1] = R - r; o[2] = ftime % REPEAT; o[3] = 1.6;
  o[4] = ABSORB[0]; o[5] = ABSORB[1]; o[6] = ABSORB[2]; o[7] = 0.6;
  o[8] = SCATTER[0]; o[9] = SCATTER[1]; o[10] = SCATTER[2]; o[11] = 0.45;
  o[12] = WAX[0]; o[13] = WAX[1]; o[14] = WAX[2]; o[15] = 1;
  o[16] = WAX[3]; o[17] = WAX[4]; o[18] = WAX[5]; o[19] = HSIG;
  for (let c = 0; c < 3; c++) { const L = CASC[c]; o[20 + c * 4] = WPOS[0] - L * floor(WPOS[0] / L); o[21 + c * 4] = WPOS[1] - L * floor(WPOS[1] / L); o[22 + c * 4] = 1 / L; o[23 + c * 4] = L / WAVE_N; }
  o[32] = 0.003; o[33] = 0.003; o[34] = 2 / (LODQ * 32); o[35] = NEAR * 1.6;
  Q.writeBuffer(uOcean, 0, OU);
}
