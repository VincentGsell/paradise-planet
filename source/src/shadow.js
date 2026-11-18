// ============================================================================
// the sun's shadows: cascades around the camera (terrain, trees, bushes, rocks)
// ============================================================================
// Each cascade is a sun-space square of radius SHR[c] a little ahead of the camera, its centre snapped to the texel
// grid in f64 (no shimmer as the camera moves). The grass receives but casts none.
const W_SHTERR = /*wgsl*/`
override CASC: u32 = 0u;
@vertex fn vsShT(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> @builtin(position) vec4f {
  return F.shm[CASC] * vec4f(terrainVertex(vi, ii).pos, 1.0);
}
`;
const W_SHPROPS = /*wgsl*/`
override CASC: u32 = 0u;
struct SO { @builtin(position) clip: vec4f, @location(0) uv: vec2f, @location(1) @interpolate(flat) k: u32, @location(2) @interpolate(flat) h: u32 };
@vertex fn vsSh(v: VI, @builtin(instance_index) ii: u32) -> SO {
  let p = propVertex(v, ii, F.shm[CASC]);
  var o: SO; o.clip = p.clip; o.uv = p.uv; o.k = u32(p.m.w * 255.0 + 0.5); o.h = p.h; return o;
}
@fragment fn fsSh(i: SO) {
  let hv = f32(i.h % 997u) / 997.0;
  var a = 1.0;
  if (i.k == 1u || i.k == 3u) { a = leaves(i.uv, hv * 6.28) * 3.0; }
  else if (i.k == 2u) { let q = i.uv - 0.5; a = (1.0 - length(q) * 2.0) * 2.0; }
  else if (i.k == 5u) { let y = abs(i.uv.y - 0.5) * 2.0; a = select(1.0 - smoothstep(0.85, 0.95, y / (sin(min(i.uv.x, 0.98) * 3.14159) + 0.05)), 1.0, y < 0.06); }
  if (a < 0.5) { discard; }
}
`;
const bg0Shd = mkBG0(tTrans, tMulti, tIrr, tSkyV, tCSh, tShDummy);
const shDepth = { format: DEPTH, depthWriteEnabled: true, depthCompare: 'less', depthBias: 3, depthBiasSlopeScale: 2.5 };
const mShT = mod(W_SCENE + W_SHTERR), mShP = mod(W_LIFE + W_PROPS_DRAW + W_SHPROPS);
const pShT = [], pShP = [], passSh = [];
for (let c = 0; c < NCASC; c++) {
  pShT.push(device.createRenderPipeline({ layout: lay(bgl0, bglTerr), vertex: { module: mShT, entryPoint: 'vsShT', constants: { CASC: c } }, primitive: { cullMode: 'none' }, depthStencil: shDepth }));
  pShP.push(device.createRenderPipeline({ layout: layGrass, vertex: { module: mShP, entryPoint: 'vsSh', buffers: [vlProps], constants: { CASC: c } },
    fragment: { module: mShP, entryPoint: 'fsSh', targets: [] }, primitive: { cullMode: 'none' }, depthStencil: shDepth }));
  passSh.push({ colorAttachments: [], depthStencilAttachment: { view: tShadow.createView({ dimension: '2d', baseArrayLayer: c, arrayLayerCount: 1 }), depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store' } });
}
// which (kind, LOD) buckets each cascade draws: near ones the detailed plants, the far one trees only
const SHB = [[0, 1, 3, 4, 6, 7, 9, 10, 12, 13], [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 13], [1, 2, 4, 5, 7, 8]];
const SHC = new Float64Array(3);
let sunUp = true;
// the cascade matrices (camera-relative), written into the frame uniform by writeFrame
function shadowMatrices() {
  const sx = FU[32], sy = FU[33], sz = FU[34];
  let ax = sz, az = -sx; const al = hypot(ax, az) || 1; ax /= al; az /= al; // x axis: horizontal, across the sun
  const bx = sy * az, by = sz * ax - sx * az, bz = -sy * ax;                  // y axis: sun x x-axis
  sunUp = (CP[0] * sx + CP[1] * sy + CP[2] * sz) / v3len(CP, 0) > -0.06;
  for (let c = 0; c < NCASC; c++) {
    const rc = SHR[c], zr = [250, 900, 4000][c], tx = 2 * rc / SHN;
    // centre ahead of the camera, snapped to the texel grid along both axes (f64, absolute)
    for (let i = 0; i < 3; i++) SHC[i] = CP[i] + CB[i] * rc * 0.45;
    const u = SHC[0] * ax + SHC[2] * az, v = SHC[0] * bx + SHC[1] * by + SHC[2] * bz;
    const du = floor(u / tx) * tx - u, dv = floor(v / tx) * tx - v;
    const cx = SHC[0] + ax * du + bx * dv - CP[0], cy = SHC[1] + by * dv - CP[1], cz = SHC[2] + az * du + bz * dv - CP[2];
    const m = 88 + c * 16, f = FU;
    f[m] = ax / rc; f[m + 4] = 0; f[m + 8] = az / rc; f[m + 12] = -(cx * ax + cz * az) / rc;
    f[m + 1] = bx / rc; f[m + 5] = by / rc; f[m + 9] = bz / rc; f[m + 13] = -(cx * bx + cy * by + cz * bz) / rc;
    f[m + 2] = -sx / (2 * zr); f[m + 6] = -sy / (2 * zr); f[m + 10] = -sz / (2 * zr); f[m + 14] = 0.5 + (cx * sx + cy * sy + cz * sz) / (2 * zr);
    f[m + 3] = 0; f[m + 7] = 0; f[m + 11] = 0; f[m + 15] = 1;
  }
  FU[136] = SHR[0]; FU[137] = SHR[1]; FU[138] = SHR[2]; FU[139] = NCASC;
}
function shadowPasses(e) {
  for (let c = 0; c < NCASC; c++) {
    const r = e.beginRenderPass(passSh[c]);
    if (sunUp && (c < 2 || (frameN & 1) === 0 || frameN < 4)) {
      r.setBindGroup(0, bg0Shd);
      r.setPipeline(pShT[c]); r.setBindGroup(1, bgTerr); r.setIndexBuffer(ibPatch, 'uint16'); r.drawIndexed(NIDX, nDrawSh);
      r.setPipeline(pShP[c]); r.setBindGroup(2, LS_TREE[2]); r.setVertexBuffer(0, vbProps); r.setIndexBuffer(ibProps, 'uint32');
      for (const b of SHB[c]) { r.setBindGroup(3, bgPropsR[b]); r.drawIndexedIndirect(bPArgs, b * 20); }
    }
    r.end();
  }
}
