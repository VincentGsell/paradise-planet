// ============================================================================
// life in the air: placement passes and draws
// ============================================================================
const FLOCK_R = [900, 700, 450][LV], RAPTOR_R = 2200, BFLY_R = [40, 30, 20][LV], FLOCK_DG = latDepth(110), RAPTOR_DG = latDepth(420), BFLY_DG = latDepth(5);
const bFlocks = device.createBuffer({ size: FLMAX * 32, usage: BU.STORAGE }), bRaptors = device.createBuffer({ size: RPMAX * 32, usage: BU.STORAGE }), bBflies = device.createBuffer({ size: BFMAX * 32, usage: BU.STORAGE });
const bFArgs = device.createBuffer({ size: 64, usage: BU.STORAGE | BU.INDIRECT | BU.COPY_DST });
const FARGS = new Uint32Array([12, 0, 0, 0, 12, 0, 0, 0, 12, 0, 0, 0, 0, 0, 0, 0]);
const bglFOut = device.createBindGroupLayout({ entries: [0, 1, 2, 3].map((b) => ({ binding: b, visibility: SS.COMPUTE, buffer: { type: 'storage' } })) });
const bgFOut = device.createBindGroup({ layout: bglFOut, entries: [bFlocks, bFArgs, bRaptors, bBflies].map((b, i) => ({ binding: i, resource: { buffer: b } })) });
const mFaunaCS = mod(W_LIFE + W_FAUNA_CS);
const pFaunaCS = [0, 1, 2].map((L) => device.createComputePipeline({ layout: lay(bgl0, bglTerrC, bglLife, bglFOut), compute: { module: mFaunaCS, entryPoint: 'main', constants: { LAYER: L } } }));
const pFaunaFin = device.createComputePipeline({ layout: lay(bgl0, bglTerrC, bglLife, bglFOut), compute: { module: mFaunaCS, entryPoint: 'fin' } });
const LS_FAUNA = [lifeSet(), lifeSet(), lifeSet()];
const bgFlockR = readBG(bFlocks), bgRaptorR = readBG(bRaptors), bgBflyR = readBG(bBflies), bgFireR = readBG(bFireflies);
let faunaOn = true;
function faunaPass(e) {
  Q.writeBuffer(bFArgs, 0, FARGS);
  faunaOn = v3len(CP, 0) - R < 2500;
  const c = e.beginComputePass();
  c.setBindGroup(0, bg0); c.setBindGroup(1, bgTerrC); c.setBindGroup(3, bgFOut);
  if (faunaOn) for (let L = 0; L < 3; L++) {
    const [u, j, g] = LS_FAUNA[L], dg = [FLOCK_DG, RAPTOR_DG, BFLY_DG][L];
    const tiles = latticeJobs(dg, [FLOCK_R, RAPTOR_R, BFLY_R][L]); lifeUniform(tiles, dg, [8181, 9292, 1313][L]);
    LFU[24] = FLOCK_R; LFU[26] = RAPTOR_R; LFU[27] = BFLY_R;
    Q.writeBuffer(u, 0, LFU); Q.writeBuffer(j, 0, JOBB, 0, nJob * 48);
    if (tiles) { c.setPipeline(pFaunaCS[L]); c.setBindGroup(2, g); c.dispatchWorkgroups(min(tiles, 65535), ceil(tiles / 65535)); }
  }
  c.setPipeline(pFaunaFin); c.setBindGroup(2, LS_FAUNA[0][2]); c.dispatchWorkgroups(1);
  c.end();
}
const mFauna = mod(W_LIFE + W_FAUNA_DRAW);
const pBirds = [0, 1, 2].map((k) => scenePipe(mFauna, 'vs', 'fs', layGrass, { constants: { KIND: k } }));
const pPollen = scenePipe(mFauna, 'vsPollen', 'fsPollen', layGrass, { strip: true, blend: ADD });
const pFirefly = scenePipe(mFauna, 'vsFirefly', 'fsPollen', layGrass, { strip: true, blend: ADD });
function faunaDraw(r) {
  r.setBindGroup(2, LS_FAUNA[0][2]);
  if (faunaOn) {
    r.setPipeline(pBirds[0]); r.setBindGroup(3, bgFlockR); r.drawIndirect(bFArgs, 0);
    r.setPipeline(pBirds[1]); r.setBindGroup(3, bgRaptorR); r.drawIndirect(bFArgs, 16);
    r.setPipeline(pBirds[2]); r.setBindGroup(3, bgBflyR); r.drawIndirect(bFArgs, 32);
  }
  r.setPipeline(pFirefly); r.setBindGroup(3, bgFireR); r.drawIndirect(bGArgs, 32);
  r.setPipeline(pPollen); r.draw(4, 12 * 12 * 12);
}
