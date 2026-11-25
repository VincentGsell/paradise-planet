// ============================================================================
// the garden under the sea: placement passes and draws (only while the camera is near the sea)
// ============================================================================
const KELP_R = [110, 85, 55][LV], SGRASS_R = [46, 36, 24][LV], SCHOOL_R = 140, KELP_DG = latDepth(3.2), SGRASS_DG = latDepth(0.85), SCHOOL_DG = latDepth(18);
const bKelp = device.createBuffer({ size: KLMAX * 32, usage: BU.STORAGE }), bSGrass = device.createBuffer({ size: SGMAX * 32, usage: BU.STORAGE }), bSchools = device.createBuffer({ size: SCHMAX * 32, usage: BU.STORAGE });
const bSArgs = device.createBuffer({ size: 64, usage: BU.STORAGE | BU.INDIRECT | BU.COPY_DST });
const SARGS = new Uint32Array([14, 0, 0, 0, 10, 0, 0, 0, 24, 0, 0, 0, 0, 0, 0, 0]);
const bglSOut = device.createBindGroupLayout({ entries: [0, 1, 2, 3].map((b) => ({ binding: b, visibility: SS.COMPUTE, buffer: { type: 'storage' } })) });
const bgSOut = device.createBindGroup({ layout: bglSOut, entries: [bKelp, bSArgs, bSGrass, bSchools].map((b, i) => ({ binding: i, resource: { buffer: b } })) });
const mSeaCS = mod(W_LIFE + W_SEA_CS);
const pSeaCS = await Promise.all([0, 1, 2].map((L) => cp({ layout: lay(bgl0, bglTerrC, bglLife, bglSOut), compute: { module: mSeaCS, entryPoint: 'main', constants: { LAYER: L } } })));
const pSeaFin = await cp({ layout: lay(bgl0, bglTerrC, bglLife, bglSOut), compute: { module: mSeaCS, entryPoint: 'fin' } });
const LS_SEA = [lifeSet(), lifeSet(), lifeSet()];
const readBG = (b) => device.createBindGroup({ layout: bglRead, entries: [{ binding: 0, resource: { buffer: b } }] });
const bgKelpR = readBG(bKelp), bgSGrassR = readBG(bSGrass), bgSchoolR = readBG(bSchools);
let seaOn = false;
function seaPass(e) {
  Q.writeBuffer(bSArgs, 0, SARGS);
  // the garden only matters near the sea (and under it)
  seaOn = v3len(CP, 0) - R < 400;
  const c = e.beginComputePass();
  c.setBindGroup(0, bg0); c.setBindGroup(1, bgTerrC); c.setBindGroup(3, bgSOut);
  if (seaOn) for (let L = 0; L < 3; L++) {
    const [u, j, g] = LS_SEA[L], dg = [KELP_DG, SGRASS_DG, SCHOOL_DG][L];
    const tiles = latticeJobs(dg, [KELP_R, SGRASS_R, SCHOOL_R][L]); lifeUniform(tiles, dg, [5151, 6262, 7373][L]);
    LFU[24] = KELP_R; LFU[26] = SGRASS_R; LFU[27] = SCHOOL_R;
    Q.writeBuffer(u, 0, LFU); Q.writeBuffer(j, 0, JOBB, 0, nJob * 48);
    if (tiles) { c.setPipeline(pSeaCS[L]); c.setBindGroup(2, g); c.dispatchWorkgroups(min(tiles, 65535), ceil(tiles / 65535)); }
  }
  c.setPipeline(pSeaFin); c.setBindGroup(2, LS_SEA[0][2]); c.dispatchWorkgroups(1);
  c.end();
}
const mSea = mod(W_LIFE + W_WLIT + W_SEA_DRAW);
const pKelp = await scenePipe(mSea, 'vs', 'fs', layGrass, { strip: true, constants: { ROWS: 7, KIND: 0 } });
const pSGrass = await scenePipe(mSea, 'vs', 'fs', layGrass, { strip: true, constants: { ROWS: 5, KIND: 1 } });
const pFish = await scenePipe(mSea, 'vsFish', 'fsFish', layGrass);
const pSnow = await scenePipe(mSea, 'vsSnow', 'fsSnow', layGrass, { strip: true, blend: ADD });
function seaDraw(r) {
  if (!seaOn) return;
  r.setBindGroup(2, LS_SEA[0][2]);
  r.setPipeline(pKelp); r.setBindGroup(3, bgKelpR); r.drawIndirect(bSArgs, 0);
  r.setPipeline(pSGrass); r.setBindGroup(3, bgSGrassR); r.drawIndirect(bSArgs, 16);
  r.setPipeline(pFish); r.setBindGroup(3, bgSchoolR); r.drawIndirect(bSArgs, 32);
}
function seaSnow(r) {
  if (OU[1] <= 0) return;
  r.setBindGroup(2, LS_SEA[0][2]); r.setBindGroup(3, bgKelpR);
  r.setPipeline(pSnow); r.draw(4, 14 * 14 * 14);
}
