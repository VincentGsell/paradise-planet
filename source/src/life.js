// ============================================================================
// what grows and lives: the vegetation jobs over the drawn patches, grass and flowers
// ============================================================================
const W_SCENE = W_FRAME + W_NOISE + W_ATMO + W_LIGHT + W_WATER + W_PATCH + W_TERRAIN_VS;
const GRASS_R = [72, 56, 34][LV], FLOWER_R = [42, 32, 20][LV], GRASS_CELL = [0.17, 0.21, 0.3][LV];
const latDepth = (cell) => min(20, round(log2(R * PI / 2 / cell)));
const LFU = new Float32Array(32), uLife = ubuf(128);
const MAXJOB = 4096, JOBB = new ArrayBuffer(MAXJOB * 48), JOBI = new Int32Array(JOBB), JOBUV = new Uint32Array(JOBB);
const bLifeJobs = sbuf(MAXJOB * 48);
const bglLife = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: VFC, buffer: {} }, { binding: 1, visibility: VFC, buffer: { type: 'read-only-storage' } }] });
const bgLife = device.createBindGroup({ layout: bglLife, entries: [{ binding: 0, resource: { buffer: uLife } }, { binding: 1, resource: { buffer: bLifeJobs } }] });
// bglTerr is visible to vertex and fragment only: the compute passes get their own view of the patches
const bglTerrC = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: VFC, buffer: { type: 'read-only-storage' } }, { binding: 1, visibility: VFC, buffer: { type: 'read-only-storage' } }] });
const bgTerrC = device.createBindGroup({ layout: bglTerrC, entries: [{ binding: 0, resource: { buffer: bVerts } }, { binding: 1, resource: { buffer: bPatches } }] });
const TPOS = new Float64Array(3);
// Jobs of one lattice (depth dg) over the drawn patches within `rad` m of the camera: a rectangle of cells per patch
// (8 x 8 cells per workgroup). Returns the number of tiles.
let nJob = 0;
function latticeJobs(dg, rad) {
  nJob = 0; let tiles = 0;
  const cr = v3len(CAM, 0), cx = CAM[0] / cr, cy = CAM[1] / cr, cz = CAM[2] / cr;
  const rs = rad / R * 1.9;
  for (let i = 0; i < nDraw && nJob < MAXJOB; i++) {
    const s = PTF[i * 12 + 8], o = s * 3;
    const dx = nC[o] - CAM[0], dy = nC[o + 1] - CAM[1], dz = nC[o + 2] - CAM[2];
    if (sqrt(dx * dx + dy * dy + dz * dz) - nRad[s] > rad) continue;
    const f = nF[s], L = nL[s], sh = dg - L, k = 2 / (1 << L), b = f * 9;
    let x0 = 0, y0 = 0, w = 1, h = 1;
    if (sh >= 0) {
      const n = 1 << sh, du = FACE[b] * cx + FACE[b + 1] * cy + FACE[b + 2] * cz;
      if (du < 0.1) continue;
      // the camera on the face plane, in this patch's cells
      const cs = (FACE[b + 3] * cx + FACE[b + 4] * cy + FACE[b + 5] * cz) / du, ct = (FACE[b + 6] * cx + FACE[b + 7] * cy + FACE[b + 8] * cz) / du;
      const s0 = nX[s] * k - 1, t0 = nY[s] * k - 1, c = k / n;
      x0 = max(0, floor((cs - rs - s0) / c)); y0 = max(0, floor((ct - rs - t0) / c));
      const x1 = min(n, ceil((cs + rs - s0) / c)), y1 = min(n, ceil((ct + rs - t0) / c));
      w = x1 - x0; h = y1 - y0; if (w <= 0 || h <= 0) continue;
    }
    const tw = ceil(w / 8), j = nJob++ * 12;
    JOBUV[j] = i; JOBUV[j + 1] = f; JOBUV[j + 2] = L; JOBUV[j + 3] = nX[s]; JOBUV[j + 4] = nY[s]; JOBI[j + 5] = sh;
    JOBUV[j + 6] = x0; JOBUV[j + 7] = y0; JOBUV[j + 8] = w; JOBUV[j + 9] = h; JOBUV[j + 10] = tiles; JOBUV[j + 11] = tw;
    tiles += tw * ceil(h / 8);
  }
  return tiles;
}
function lifeUniform(tiles, dg, seed) {
  const l = LFU;
  l[0] = WAX[0]; l[1] = WAX[1]; l[2] = WAX[2]; l[3] = WIND;
  l[4] = ftime % 3600; l[5] = WPOS[0] - 76 * floor(WPOS[0] / 76); l[6] = 38; l[7] = tiles;
  for (let p = 0; p < 4; p++) { l[8 + p * 4] = FR[p * 3]; l[9 + p * 4] = FR[p * 3 + 1]; l[10 + p * 4] = FR[p * 3 + 2]; l[11 + p * 4] = 0; }
  l[24] = GRASS_R; l[25] = 0; l[26] = FLOWER_R; l[27] = 0;
  l[28] = 0; l[29] = nJob; l[30] = dg; l[31] = seed;
}

// ---------------------------------------------------------------- grass and flowers
const W_LIFE = W_SCENE + W_VEG;
const bGrass = device.createBuffer({ size: MAXB * 32, usage: BU.STORAGE }), bFlowers = device.createBuffer({ size: MAXF * 32, usage: BU.STORAGE });
const bGArgs = device.createBuffer({ size: 48, usage: BU.STORAGE | BU.INDIRECT | BU.COPY_DST }), bFireflies = device.createBuffer({ size: FFMAX * 32, usage: BU.STORAGE });
const GROWS = [5, 4, 3][LV], GARGS = new Uint32Array([2 * (GROWS + 1), 0, 0, 0, 18, 0, 0, 0, 4, 0, 0, 0]);
const bglGOut = device.createBindGroupLayout({ entries: [0, 1, 2, 3].map((b) => ({ binding: b, visibility: SS.COMPUTE, buffer: { type: 'storage' } })) });
const bgGOut = device.createBindGroup({ layout: bglGOut, entries: [{ binding: 0, resource: { buffer: bGrass } }, { binding: 1, resource: { buffer: bGArgs } }, { binding: 2, resource: { buffer: bFlowers } }, { binding: 3, resource: { buffer: bFireflies } }] });
const mGrassCS = mod(W_LIFE + W_GRASS_CS);
const pGrassCS = await cp({ layout: lay(bgl0, bglTerrC, bglLife, bglGOut), compute: { module: mGrassCS, entryPoint: 'main' } });
const pGrassFin = await cp({ layout: lay(bgl0, bglTerrC, bglLife, bglGOut), compute: { module: mGrassCS, entryPoint: 'fin' } });
const bglRead = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: VF, buffer: { type: 'read-only-storage' } }] });
const bgGrassR = device.createBindGroup({ layout: bglRead, entries: [{ binding: 0, resource: { buffer: bGrass } }] });
const bgFlowerR = device.createBindGroup({ layout: bglRead, entries: [{ binding: 0, resource: { buffer: bFlowers } }] });
const GRASS_DG = latDepth(GRASS_CELL);
function grassPass(e) {
  const tiles = latticeJobs(GRASS_DG, GRASS_R);
  lifeUniform(tiles, GRASS_DG, 4242);
  Q.writeBuffer(uLife, 0, LFU); Q.writeBuffer(bLifeJobs, 0, JOBB, 0, nJob * 48); Q.writeBuffer(bGArgs, 0, GARGS);
  const c = e.beginComputePass();
  c.setBindGroup(0, bg0); c.setBindGroup(1, bgTerrC); c.setBindGroup(2, bgLife); c.setBindGroup(3, bgGOut);
  if (tiles) { c.setPipeline(pGrassCS); c.dispatchWorkgroups(min(tiles, 65535), ceil(tiles / 65535)); }
  c.setPipeline(pGrassFin); c.dispatchWorkgroups(1);
  c.end();
}
