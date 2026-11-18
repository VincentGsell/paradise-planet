// ============================================================================
// the atmosphere: parameters, LUT bakes, per-frame sky-view, composite pipeline
// ============================================================================
// Vertical scale of the Earth's atmosphere on this planet: the Rayleigh scale height is 5 % of the radius. Lengths x k,
// coefficients / k: the zenith optical depth stays the Earth's (OpenG `scaled_with`). The tiny horizon air mass is
// partly made up with a little more scattering (BOOST), for warm sunsets.
const AK = R / 1000 * 0.045 / 8, BOOST = 1.5;
{
  const k = AK, b = BOOST, a = AU;
  a.set([5.802e-3 * b / k, 13.558e-3 * b / k, 33.1e-3 * b / k, R / 1000], 0);
  a.set([3.996e-3 * b / k, 3.996e-3 * b / k, 3.996e-3 * b / k, R / 1000 + 100 * k], 4);
  a.set([4.4e-3 * b / k, 4.4e-3 * b / k, 4.4e-3 * b / k, 0.8], 8);
  a.set([0.65e-3 / k, 1.881e-3 / k, 0.085e-3 / k, 8 * k], 12);
  a.set([0.09, 0.12, 0.1, 1.2 * k], 16);
  a.set([3, 2.95, 2.85, 0.0093], 20); // a slightly warm sun, twice the apparent size of ours
  a.set([25 * k, 15 * k, 1, 1], 24);
  Q.writeBuffer(uAtmo, 0, AU);
}
const ATOP = AU[7] * 1000; // top of the atmosphere (m from the centre)
const mLut = mod(W_LUT), mSkyV = mod(W_SKYVIEW);
const pLut = (e) => device.createComputePipeline({ layout: lay(bgl0, bglOut), compute: { module: mLut, entryPoint: e } });
const pSkyV = device.createComputePipeline({ layout: lay(bgl0, bglOut), compute: { module: mSkyV, entryPoint: 'main' } });
const bgSkyOut = outBG(tSkyV);
function bakeAtmo() {
  const e = device.createCommandEncoder(), wg = (s) => [ceil(s[0] / 8), ceil(s[1] / 8)];
  const run = (p, g0, t, s) => { const c = e.beginComputePass(); c.setPipeline(p); c.setBindGroup(0, g0); c.setBindGroup(1, outBG(t)); c.dispatchWorkgroups(...wg(s)); c.end(); };
  run(pLut('trans'), mkBG0(tBlack, tBlack, tBlack, tBlack, tBlack), tTrans, TLUT);
  run(pLut('multi'), mkBG0(tTrans, tBlack, tBlack, tBlack, tBlack), tMulti, MLUT);
  run(pLut('irr'), mkBG0(tTrans, tMulti, tBlack, tBlack, tBlack), tIrr, ELUT);
  Q.submit([e.finish()]);
}
const skyView = (e) => { const c = e.beginComputePass(); c.setPipeline(pSkyV); c.setBindGroup(0, bg0Sky); c.setBindGroup(1, bgSkyOut); c.dispatchWorkgroups(ceil(SLUT[0] / 8), ceil(SLUT[1] / 8)); c.end(); };

const STU = new Float32Array(4), uStars = ubuf(16);
