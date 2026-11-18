// ============================================================================
// the clouds: noise bakes, field parameters, shadow map, half-resolution march + temporal accumulation
// ============================================================================
// Fair-weather cumulus. The layer follows the planet's size within bounds: a 10 km world keeps clouds you can fly
// over, a 50 km one gets taller ones.
const CK = clamp(R / 15000, 0.6, 1.3);
const CBASE = clamp(0.042 * R, 380, 950), CTHICK = clamp(0.075 * R, 520, 1500);
const CSTEPS = [64, 48, 32][LV], CDIV = LV > 1 ? 4 : 2, CSHN = [1024, 768, 512][LV];
const tCShape = device.createTexture({ size: [128, 128, 128], dimension: '3d', format: 'rgba8unorm', mipLevelCount: 4, usage: TU.STORAGE_BINDING | TU.TEXTURE_BINDING });
const tCDetail = device.createTexture({ size: [32, 32, 32], dimension: '3d', format: 'rgba8unorm', mipLevelCount: 3, usage: TU.STORAGE_BINDING | TU.TEXTURE_BINDING });
{
  const m = mod(W_CNOISE), p = (e) => device.createComputePipeline({ layout: 'auto', compute: { module: m, entryPoint: e } });
  const pS = p('shape'), pD = p('detail'), pM = p('mip');
  const v = (t, l) => t.createView({ dimension: '3d', baseMipLevel: l, mipLevelCount: 1 });
  const e = device.createCommandEncoder(), c = e.beginComputePass();
  c.setPipeline(pS); c.setBindGroup(0, device.createBindGroup({ layout: pS.getBindGroupLayout(0), entries: [{ binding: 0, resource: v(tCShape, 0) }] })); c.dispatchWorkgroups(32, 32, 32);
  c.setPipeline(pD); c.setBindGroup(0, device.createBindGroup({ layout: pD.getBindGroupLayout(0), entries: [{ binding: 0, resource: v(tCDetail, 0) }] })); c.dispatchWorkgroups(8, 8, 8);
  c.setPipeline(pM);
  for (const [t, n, s] of [[tCShape, 4, 128], [tCDetail, 3, 32]]) for (let l = 1; l < n; l++) {
    c.setBindGroup(0, device.createBindGroup({ layout: pM.getBindGroupLayout(0), entries: [{ binding: 0, resource: v(t, l) }, { binding: 1, resource: v(t, l - 1) }] }));
    const k = ceil((s >> l) / 4); c.dispatchWorkgroups(k, k, k);
  }
  c.end(); Q.submit([e.finish()]);
}
// group 1 of the cloud passes
const CU = new Float32Array(44), uCloud = ubuf(176);
const bglCloud = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: VFC, buffer: {} },
  { binding: 1, visibility: VFC, texture: { viewDimension: '3d' } }, { binding: 2, visibility: VFC, texture: { viewDimension: '3d' } }] });
const bgCloud = device.createBindGroup({ layout: bglCloud, entries: [{ binding: 0, resource: { buffer: uCloud } },
  { binding: 1, resource: tCShape.createView() }, { binding: 2, resource: tCDetail.createView() }] });
// the shadow map, then group 0 rebuilt with it
const tCSh = tex(CSHN, CSHN, HDR, TU.STORAGE_BINDING | TU.TEXTURE_BINDING);
const bg0NoSh = mkBG0(tTrans, tMulti, tIrr, tSkyV, tBlack);
bg0 = mkBG0(tTrans, tMulti, tIrr, tSkyV, tCSh);
const W_CL = W_FRAME + W_NOISE + W_ATMO + W_CLOUD;
const mCSh = mod(W_CL + W_CSHADOW), mCMarch = mod(W_CL + W_CMARCH.replace('texture_depth_multisampled_2d', AA > 1 ? 'texture_depth_multisampled_2d' : 'texture_depth_2d')), mCTaa = mod(W_CL + W_CTAA);
const bglCSh = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: SS.COMPUTE, storageTexture: { access: 'write-only', format: HDR } }] });
const pCSh = device.createComputePipeline({ layout: lay(bgl0, bglCloud, bglCSh), compute: { module: mCSh, entryPoint: 'main' } });
const bgCSh = device.createBindGroup({ layout: bglCSh, entries: [{ binding: 0, resource: tCSh.createView() }] });
const bglCMarch = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: SS.FRAGMENT, texture: { sampleType: 'depth', multisampled: AA > 1 } }] });
const CTGT = [{ format: HDR }, { format: 'r16float' }];
const pCMarch = device.createRenderPipeline({ layout: lay(bgl0, bglCloud, bglCMarch), vertex: { module: mCMarch, entryPoint: 'vs' }, fragment: { module: mCMarch, entryPoint: 'fs', targets: CTGT } });
const bglCTaa = device.createBindGroupLayout({ entries: [0, 1, 2, 3].map((b) => ({ binding: b, visibility: SS.FRAGMENT, texture: {} })) });
const pCTaa = device.createRenderPipeline({ layout: lay(bgl0, bglCloud, bglCTaa), vertex: { module: mCTaa, entryPoint: 'vs' }, fragment: { module: mCTaa, entryPoint: 'fs', targets: CTGT } });
// render targets (rebuilt with the frame): the march, two histories
let cW = 0, cH = 0, cTex = [], passCMarch, bgCMarch, passCTaa = [], bgCTaa = [], cHist = [], cPing = 0;
function cloudTargets(W, H, vDp) {
  for (const t of cTex) t.destroy();
  cW = max(1, ceil(W / CDIV)); cH = max(1, ceil(H / CDIV));
  const U = TU.RENDER_ATTACHMENT | TU.TEXTURE_BINDING;
  const mc = tex(cW, cH, HDR, U), mt = tex(cW, cH, 'r16float', U);
  const h = [[tex(cW, cH, HDR, U), tex(cW, cH, 'r16float', U)], [tex(cW, cH, HDR, U), tex(cW, cH, 'r16float', U)]];
  cTex = [mc, mt, ...h[0], ...h[1]]; cHist = h;
  passCMarch = { colorAttachments: [colorAtt(mc.createView(), true), colorAtt(mt.createView(), true)] };
  bgCMarch = device.createBindGroup({ layout: bglCMarch, entries: [{ binding: 0, resource: vDp }] });
  passCTaa = []; bgCTaa = [];
  for (let i = 0; i < 2; i++) {
    const src = h[1 - i], dst = h[i];
    passCTaa.push({ colorAttachments: [colorAtt(dst[0].createView(), true), colorAtt(dst[1].createView(), true)] });
    bgCTaa.push(device.createBindGroup({ layout: bglCTaa, entries: [{ binding: 0, resource: mc.createView() }, { binding: 1, resource: mt.createView() },
      { binding: 2, resource: src[0].createView() }, { binding: 3, resource: src[1].createView() }] }));
  }
}
// per frame: the field's rotation (the wind), the previous view for the reprojection
const PVP = new Float32Array(16), PCAM = new Float64Array(3), WAXIS = [0.3, 0.92, 0.25];
{ const l = hypot(...WAXIS); WAXIS[0] /= l; WAXIS[1] /= l; WAXIS[2] /= l; }
let cFirst = true;
function cloudFrame() {
  const c = CU, ang = ftime * 9 / (R + CBASE); // 9 m/s of wind at the base of the layer
  // rotation matrix rows around WAXIS by -ang (body -> field)
  const x = WAXIS[0], y = WAXIS[1], z = WAXIS[2], cs = cos(-ang), sn = sin(-ang), t = 1 - cs;
  c[4] = t * x * x + cs; c[5] = t * x * y - sn * z; c[6] = t * x * z + sn * y; c[7] = 2400 * CK;
  c[8] = t * x * y + sn * z; c[9] = t * y * y + cs; c[10] = t * y * z - sn * x; c[11] = 280 * CK;
  c[12] = t * x * z - sn * y; c[13] = t * y * z + sn * x; c[14] = t * z * z + cs; c[15] = CSTEPS;
  c[0] = CBASE; c[1] = CTHICK; c[2] = 0.045; c[3] = 0;
  if (cFirst) { PVP.set(FU.subarray(0, 16)); PCAM.set(CP); cFirst = false; }
  c.set(PVP, 16);
  c[32] = CP[0] - PCAM[0]; c[33] = CP[1] - PCAM[1]; c[34] = CP[2] - PCAM[2]; c[35] = frameN % 64;
  c[36] = cW; c[37] = cH;
  Q.writeBuffer(uCloud, 0, CU);
  PVP.set(FU.subarray(0, 16)); PCAM.set(CP);
  // shadow map axes (Frame): sun-space x and y, half extent = the planet and its clouds
  const sx = FU[32], sy = FU[33], sz = FU[34];
  let ax = sz, az = -sx; const al = hypot(ax, az) || 1; ax /= al; az /= al;
  FU[80] = ax; FU[81] = 0; FU[82] = az; FU[83] = 1 / (R + CBASE + CTHICK + 300);
  FU[84] = sy * az; FU[85] = sz * ax - sx * az; FU[86] = -sy * ax;
  Q.writeBuffer(uFrame, 320, FU, 80, 8);
}
function cloudPasses(e) {
  if ((frameN & 1) === 0 || frameN < 3) { const c = e.beginComputePass(); c.setPipeline(pCSh); c.setBindGroup(0, bg0NoSh); c.setBindGroup(1, bgCloud); c.setBindGroup(2, bgCSh); c.dispatchWorkgroups(CSHN / 8, CSHN / 8); c.end(); }
}
function cloudMarch(e) {
  let r = e.beginRenderPass(passCMarch); r.setPipeline(pCMarch); r.setBindGroup(0, bg0); r.setBindGroup(1, bgCloud); r.setBindGroup(2, bgCMarch); r.draw(3); r.end();
  cPing ^= 1;
  r = e.beginRenderPass(passCTaa[cPing]); r.setPipeline(pCTaa); r.setBindGroup(0, bg0); r.setBindGroup(1, bgCloud); r.setBindGroup(2, bgCTaa[cPing]); r.draw(3); r.end();
}
