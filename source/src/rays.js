// ============================================================================
// god rays: light shafts in a low haze, shadowed by the trees, the relief and the clouds (reduced resolution)
// ============================================================================
// The atmosphere composite already holds the unshadowed in-scattering of the air. This pass adds a low haze whose
// light is shadowed: shafts where the sun gets through, none where it does not. Mie forward scattering, so they
// show most toward the sun; thicker when the sun is low (sunset). Under water, the same march in the water, lit by
// the caustics of the waves above (L6).
const W_RAYS = /*wgsl*/`
@group(1) @binding(0) var dIn: texture_depth_multisampled_2d;
@group(1) @binding(1) var<uniform> RY: vec4f; // x: render width / rays width, y: steps, z: frame, w: haze strength
@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f { let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u)); return vec4f(p * 2.0 - 1.0, 0.0, 1.0); }
fn shadowTap(rel: vec3f) -> f32 {
  let d = length(rel); let nc = u32(F.shp.w);
  var c = 0u; if (d > F.shp.x * 0.8) { c = 1u; } if (d > F.shp.y * 0.85) { c = 2u; }
  if (c >= nc) { return 1.0; }
  let q = F.shm[c] * vec4f(rel, 1.0);
  let uv = vec2f(q.x * 0.5 + 0.5, 0.5 - q.y * 0.5);
  if (any(uv < vec2f(0.0)) || any(uv > vec2f(1.0)) || q.z > 1.0) { return 1.0; }
  return textureSampleCompareLevel(tShadow, sCmp, uv, c, q.z - 0.001);
}
fn hg2(c: f32, g: f32) -> f32 { let g2 = g * g; return (1.0 - g2) / (4.0 * PI * pow(max(1.0 + g2 - 2.0 * g * c, 1e-4), 1.5)); }
@fragment fn fs(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let full = fc.xy * RY.x;
  let depth = textureLoad(dIn, vec2i(full), 0);
  let ndc = vec2f(full.x * F.scr.z * 2.0 - 1.0, 1.0 - full.y * F.scr.w * 2.0);
  let rd = normalize(F.fwd.xyz + F.right.xyz * ndc.x * F.right.w + F.up.xyz * ndc.y * F.up.w);
  var tEnd = 3000.0;
  if (depth > 0.0) { tEnd = min(tEnd, F.fwd.w / depth / max(dot(rd, F.fwd.xyz), 1e-6)); }
  let cu = normalize(F.cam.xyz); let mus = dot(cu, F.sun.xyz);
  if (O.mode.y > 0.0) { return vec4f(underRays(rd, tEnd, fc.xy), 1.0); }
  if (mus < -0.08) { return vec4f(0.0); }
  // above the sea: the shafts stop at the water
  let s = dot(rd, cu);
  if (s < 0.0) { tEnd = min(tEnd, max(F.cam.w - F.pl.x, 0.0) / max(-s, 1e-4)); }
  let n = u32(RY.y);
  let jit = fract(52.9829189 * fract(0.06711056 * fc.x + 0.00583715 * fc.y + 0.618 * RY.z));
  var L = vec3f(0.0); var T = 1.0;
  let low = 1.0 - smoothstep(0.02, 0.45, mus);
  // the haze lives in the lowest kilometre: march only through that shell (from high up, every step lands in it)
  let hz = F.pl.x + 1100.0;
  var tS = 0.0;
  let bq = dot(F.cam.xyz, rd); let cq = dot(F.cam.xyz, F.cam.xyz) - hz * hz; let dq = bq * bq - cq;
  if (cq > 0.0) { if (dq < 0.0 || bq > 0.0) { return vec4f(0.0); } tS = -bq - sqrt(dq); }
  else { tEnd = min(tEnd, -bq + sqrt(max(dq, 0.0))); }
  if (tEnd <= tS) { return vec4f(0.0); }
  var t0 = tS;
  for (var i = 0u; i < n; i++) {
    let u = (f32(i) + jit) / f32(n);
    let t = tS + (tEnd - tS) * u * u;
    let ds = t - t0; t0 = t;
    let p = rd * t; let b = F.cam.xyz + p; let r = length(b); let h = r - F.pl.x;
    let dens = RY.w * exp(-max(h, 0.0) / mix(260.0, 420.0, low)) * (1.0 + 1.8 * low);
    let vis = shadowTap(p) * cloudShadowMap(p).x;
    L += T * dens * ds * vis * sunAt(b / r, h);
    T *= exp(-dens * ds);
  }
  let ct = dot(rd, F.sun.xyz);
  return vec4f(L * (hg2(ct, 0.78) * 0.85 + 0.15 / (4.0 * PI)), 1.0);
}
// under water: shafts of light through the waves (the caustic focusing of the surface above each sample)
fn underRays(rd: vec3f, tEnd0: f32, fc: vec2f) -> vec3f {
  let up = normalize(F.cam.xyz);
  let w = surfLight(up, vec3f(0.0));
  let n = u32(RY.y);
  let jit = fract(52.9829189 * fract(0.06711056 * fc.x + 0.00583715 * fc.y + 0.618 * RY.z));
  let tEnd = min(tEnd0, 70.0);
  var L = vec3f(0.0); var t0 = 0.0;
  let z0 = O.mode.y;
  for (var i = 0u; i < n; i++) {
    let u = (f32(i) + jit) / f32(n); let t = tEnd * u * u; let ds = t - t0; t0 = t;
    let p = rd * t; let z = z0 - dot(p, up);
    if (z < 0.0) { break; }
    let c = caustics(p, w.lt, up, z, 0.2);
    let sh = (c - 0.8) * 2.0;
    L += max(sh, 0.0) * exp(-wExt() * t) * w.sun * exp(-w.k * z) * O.scatter.rgb * ds;
  }
  return L * hg2(dot(rd, w.lt), 0.7) * 2.5;
}
`;
// depth-aware blur of the shafts (hides the dither)
const W_RBLUR = /*wgsl*/`
@group(0) @binding(0) var src: texture_2d<f32>;
@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f { let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u)); return vec4f(p * 2.0 - 1.0, 0.0, 1.0); }
@fragment fn fs(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let p = vec2i(fc.xy); var s = vec3f(0.0); var w = 0.0;
  for (var j = -2; j <= 2; j++) { for (var i = -2; i <= 2; i++) { let k = exp(-f32(i * i + j * j) * 0.35); s += textureLoad(src, p + vec2i(i, j), 0).rgb * k; w += k; } }
  return vec4f(s / w, 1.0);
}
`;
const RSTEPS = [32, 24, 16][LV];
const mRays = mod(W_SCENE + W_RAYS.replace('texture_depth_multisampled_2d', AA > 1 ? 'texture_depth_multisampled_2d' : 'texture_depth_2d')), mRBlur = mod(W_RBLUR);
const bglRays = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: SS.FRAGMENT, texture: { sampleType: 'depth', multisampled: AA > 1 } }, { binding: 1, visibility: SS.FRAGMENT, buffer: {} }] });
const pRays = await rp({ layout: lay(bgl0, bglRays), vertex: { module: mRays, entryPoint: 'vs' }, fragment: { module: mRays, entryPoint: 'fs', targets: [{ format: HDR }] } });
const pRBlur = await rp({ layout: 'auto', vertex: { module: mRBlur, entryPoint: 'vs' }, fragment: { module: mRBlur, entryPoint: 'fs', targets: [{ format: HDR }] } });
const RYU = new Float32Array(4), uRays = ubuf(16);
let rTex = [], passRays, passRBlur, bgRays, bgRBlur, vRays;
function rayTargets(W, H, vDp) {
  for (const t of rTex) t.destroy();
  const div = max(2, round(sqrt(W * H / 1.1e6))), w = max(1, ceil(W / div)), h = max(1, ceil(H / div));
  const a = tex(w, h, HDR, TU.RENDER_ATTACHMENT | TU.TEXTURE_BINDING), b = tex(w, h, HDR, TU.RENDER_ATTACHMENT | TU.TEXTURE_BINDING);
  rTex = [a, b]; vRays = b.createView();
  RYU[0] = W / w; RYU[1] = RSTEPS; RYU[3] = URLQ.has('norays') ? 0 : 0.00028;
  passRays = { colorAttachments: [colorAtt(a.createView(), true)] }; passRBlur = { colorAttachments: [colorAtt(vRays, true)] };
  bgRays = device.createBindGroup({ layout: bglRays, entries: [{ binding: 0, resource: vDp }, { binding: 1, resource: { buffer: uRays } }] });
  bgRBlur = device.createBindGroup({ layout: pRBlur.getBindGroupLayout(0), entries: [{ binding: 0, resource: a.createView() }] });
}
function rayPasses(e) {
  RYU[2] = frameN % 64; Q.writeBuffer(uRays, 0, RYU);
  let r = e.beginRenderPass(passRays); r.setPipeline(pRays); r.setBindGroup(0, bg0); r.setBindGroup(1, bgRays); r.draw(3); r.end();
  r = e.beginRenderPass(passRBlur); r.setPipeline(pRBlur); r.setBindGroup(0, bgRBlur); r.draw(3); r.end();
}
