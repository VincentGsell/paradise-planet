// ============================================================================
// WGSL: the sea (OpenG ocean): FFT waves, water surface, seabed through the water, underwater fog
// ============================================================================
// Waves: Tessendorf FFT, three cascades of 256^2 (tiles of 233, 41 and 7.3 m), spectrum JONSWAP + directional
// spreading generated in ocean.js. The seabed is lit through the water and coloured by its absorption in the
// terrain pass; the water surface adds the light scattered in the water column and attenuates what lies below by
// the scalar transmittance (blend factor). Under water, the composite applies the water along the view.
const WAVE_N = 256, CASC = [233, 41, 7.3];
const W_WAVES = /*wgsl*/`
struct WaveU { lengths: vec4f, time: vec4f };
const N: u32 = 256u; const HALF: u32 = 128u; const LOG_N: u32 = 8u; const PI = 3.14159265;
@group(0) @binding(0) var<uniform> wu: WaveU;
@group(0) @binding(1) var h0Tex: texture_2d_array<f32>;
@group(0) @binding(2) var specOut: texture_storage_2d_array<rgba32float, write>;
@group(0) @binding(3) var fftIn: texture_2d_array<f32>;
@group(0) @binding(4) var fftOut: texture_storage_2d_array<rgba32float, write>;
@group(0) @binding(5) var dispOut: texture_storage_2d_array<rgba16float, write>;
@group(0) @binding(6) var slopeOut: texture_storage_2d_array<rgba16float, write>;
@group(0) @binding(7) var dispIn: texture_2d_array<f32>;
@group(0) @binding(8) var slopeIn: texture_2d_array<f32>;
fn cmul(a: vec2f, b: vec2f) -> vec2f { return vec2f(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x); }
fn ci(z: vec2f) -> vec2f { return vec2f(-z.y, z.x); }
fn pk(a: vec2f, b: vec2f) -> vec2f { return vec2f(a.x - b.y, a.y + b.x); }
fn freq(i: u32) -> f32 { return select(f32(i), f32(i) - f32(N), i >= HALF); }
@compute @workgroup_size(8, 8, 1) fn evolve(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= N || id.y >= N) { return; }
  let c = id.z; let l = wu.lengths[c];
  let k = vec2f(freq(id.x), freq(id.y)) * (2.0 * PI / l); let kl = length(k);
  let h0 = textureLoad(h0Tex, vec2i(id.xy), i32(c), 0);
  let w0 = wu.time.z; let om = floor(sqrt(wu.time.w * kl) / w0) * w0; let ph = om * wu.time.x;
  let e = vec2f(cos(ph), sin(ph));
  let ht = cmul(h0.xy, e) + cmul(h0.zw, vec2f(e.x, -e.y));
  let kn = select(vec2f(0.0), k / kl, kl > 0.0); let lam = wu.time.y;
  let dx = ci(ht) * (kn.x * lam); let dz = ci(ht) * (kn.y * lam);
  let hx = ci(ht) * k.x; let hz = ci(ht) * k.y;
  let dxx = ht * (-kn.x * k.x * lam); let dzz = ht * (-kn.y * k.y * lam); let dxz = ht * (-kn.x * k.y * lam);
  textureStore(specOut, vec2i(id.xy), i32(2u * c), vec4f(pk(ht, dx), pk(dz, hx)));
  textureStore(specOut, vec2i(id.xy), i32(2u * c + 1u), vec4f(pk(hz, dxx), pk(dzz, dxz)));
}
var<workgroup> sh: array<vec4f, 512>;
// inverse FFT of the line in sh[0..N), radix-2 Stockham (two complex per element); result back in sh[0..N)
fn fftLine(t: u32) {
  var src = 0u; var dst = N; var p = 1u;
  for (var s = 0u; s < LOG_N; s++) {
    let k = t & (p - 1u);
    let u0 = sh[src + t]; let u1 = sh[src + t + HALF];
    let ang = PI * f32(k) / f32(p); let w = vec2f(cos(ang), sin(ang));
    let v1 = vec4f(cmul(u1.xy, w), cmul(u1.zw, w));
    let j = (t << 1u) - k;
    sh[dst + j] = u0 + v1; sh[dst + j + p] = u0 - v1;
    workgroupBarrier();
    let tmp = src; src = dst; dst = tmp; p = p << 1u;
  }
}
@compute @workgroup_size(128, 1, 1) fn rows(@builtin(local_invocation_id) lid: vec3u, @builtin(workgroup_id) wg: vec3u) {
  let t = lid.x; let row = i32(wg.x); let layer = i32(wg.y);
  sh[t] = textureLoad(fftIn, vec2i(i32(t), row), layer, 0); sh[t + HALF] = textureLoad(fftIn, vec2i(i32(t + HALF), row), layer, 0);
  workgroupBarrier(); fftLine(t);
  textureStore(fftOut, vec2i(i32(t), row), layer, sh[t]); textureStore(fftOut, vec2i(i32(t + HALF), row), layer, sh[t + HALF]);
}
@compute @workgroup_size(128, 1, 1) fn cols(@builtin(local_invocation_id) lid: vec3u, @builtin(workgroup_id) wg: vec3u) {
  let t = lid.x; let col = i32(wg.x); let layer = i32(wg.y);
  sh[t] = textureLoad(fftIn, vec2i(col, i32(t)), layer, 0); sh[t + HALF] = textureLoad(fftIn, vec2i(col, i32(t + HALF)), layer, 0);
  workgroupBarrier(); fftLine(t);
  textureStore(fftOut, vec2i(col, i32(t)), layer, sh[t]); textureStore(fftOut, vec2i(col, i32(t + HALF)), layer, sh[t + HALF]);
}
@compute @workgroup_size(8, 8, 1) fn assemble(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= N || id.y >= N) { return; }
  let c = i32(id.z); let p = vec2i(id.xy);
  let a = textureLoad(fftIn, p, 2 * c, 0); let b = textureLoad(fftIn, p, 2 * c + 1, 0);
  let jxx = 1.0 + b.y; let jzz = 1.0 + b.z; let jac = jxx * jzz - b.w * b.w;
  let sx = a.w / max(jxx, 0.25); let sz = b.x / max(jzz, 0.25);
  textureStore(dispOut, p, c, vec4f(a.y, a.x, a.z, jac));
  textureStore(slopeOut, p, c, vec4f(sx, sz, sx * sx, sz * sz));
}
@compute @workgroup_size(8, 8, 1) fn down(@builtin(global_invocation_id) id: vec3u) {
  let size = textureDimensions(dispOut);
  if (id.x >= size.x || id.y >= size.y) { return; }
  let c = i32(id.z); let q = vec2i(id.xy) * 2;
  var d = vec4f(0.0); var s = vec4f(0.0);
  for (var j = 0; j < 2; j++) { for (var i = 0; i < 2; i++) { d += textureLoad(dispIn, q + vec2i(i, j), c, 0); s += textureLoad(slopeIn, q + vec2i(i, j), c, 0); } }
  textureStore(dispOut, vec2i(id.xy), c, d * 0.25); textureStore(slopeOut, vec2i(id.xy), c, s * 0.25);
}
`;

// the water, for the scene shaders (group 2)
const W_WATER = /*wgsl*/`
struct Ocean {
  mode: vec4f,    // x: waves on, y: camera depth below the mean sea (m, < 0 above), z: wave time (s), w: beach height (m)
  absorb: vec4f,  // absorption (1/m), w: whitecaps
  scatter: vec4f, // scattering (1/m), w: shore foam
  ax: vec4f,      // wave plane axis along the wind (body frame), w: caustics strength
  az: vec4f,      // second axis, w: significant wave height (m)
  cas: array<vec4f, 3>, // per cascade: camera in the plane modulo the tile (m), 1 / tile, texel (m)
  waves: vec4f,   // xy: unresolved slope variance, z: cell size per metre of distance, w: near clearance (m)
};
@group(2) @binding(0) var<uniform> O: Ocean;
@group(2) @binding(1) var wDisp: texture_2d_array<f32>;
@group(2) @binding(2) var wSlope: texture_2d_array<f32>;
const IOR = 1.333;
fn wExt() -> vec3f { return O.absorb.rgb + O.scatter.rgb; }
fn refrCos(mu: f32) -> f32 { let s2 = max(1.0 - mu * mu, 0.0) / (IOR * IOR); return sqrt(max(1.0 - s2, 0.0)); }
fn fresnelW(mu: f32) -> f32 { return 0.02 + 0.98 * pow(1.0 - clamp(mu, 0.0, 1.0), 5.0); }
fn pathInt(q: vec3f, d: f32) -> vec3f {
  let x = q * d;
  let series = d * (1.0 - 0.5 * x + x * x / 6.0);
  let exact = (1.0 - exp(-x)) / select(q, vec3f(1.0), abs(q) < vec3f(1e-6));
  return select(exact, series, abs(x) < vec3f(1e-3));
}
struct WLight { sun: vec3f, sky: vec3f, lt: vec3f, mu_t: f32, k: vec3f };
// the light entering the water at the surface above a point of vertical up
fn wLight(sun: vec3f, sky: vec3f, up: vec3f) -> WLight {
  var w: WLight;
  let l = F.sun.xyz; let mu = dot(l, up); let muc = max(mu, 0.0);
  w.mu_t = refrCos(muc);
  w.lt = normalize(up * w.mu_t + (l - up * mu) / IOR);
  w.sun = sun * (1.0 - fresnelW(muc)) * smoothstep(-0.02, 0.02, mu);
  w.sky = sky * 0.9;
  w.k = (O.absorb.rgb + 0.3 * O.scatter.rgb) / max(w.mu_t, 0.75);
  return w;
}
fn wSource(w: WLight, e: vec3f) -> vec3f {
  let g = 0.75; let ct = dot(-w.lt, e);
  let hg = (1.0 - g * g) / (4.0 * PI * pow(max(1.0 + g * g - 2.0 * g * ct, 1e-4), 1.5));
  return O.scatter.rgb * (w.sun * mix(1.0 / (4.0 * PI), hg, 0.6) + w.sky * 0.5);
}
fn wPath(src: vec3f, k: vec3f, z0: f32, s: f32, d: f32) -> vec3f { return src * exp(-k * max(z0, 0.0)) * pathInt(wExt() + k * s, d); }
fn wDeep(w: WLight, e: vec3f, z: f32, s: f32) -> vec3f { return wSource(w, e) * exp(-w.k * max(z, 0.0)) / max(wExt() + w.k * s, vec3f(1e-3)); }
// the light at the surface above a point: sun (through the clouds) and sky radiance
fn surfLight(up: vec3f, rel: vec3f) -> WLight {
  let cs = cloudShadow(rel);
  return wLight(sunAt(up, 0.0) * cs.x, skyIrr(up, 0.0) / PI * (0.55 + 0.45 * cs.y), up);
}
// the sky the sea reflects (sky-view LUT at the camera, clamped above the horizon), dimmed on the night side
fn skyRad(dir: vec3f, up: vec3f) -> vec3f {
  let cu = normalize(F.cam.xyz); let mu = dot(dir, cu);
  let rh = dir - cu * mu; let lh = length(rh);
  let sx = F.sun.xyz - cu * dot(F.sun.xyz, cu); let sl = length(sx);
  var lv = 1.0; if (lh > 1e-5 && sl > 1e-5) { lv = dot(rh / lh, sx / sl); }
  let h0 = clamp(F.cam.w * 0.001 - rb(), 0.0, thick());
  var uv = skyUV(h0, max(mu, 0.0), lv); uv.y = min(uv.y, 0.5 - 0.5 / SSZ.y);
  let tw = smoothstep(-0.25, 0.3, dot(up, F.sun.xyz)); let twc = smoothstep(-0.25, 0.3, dot(cu, F.sun.xyz));
  return textureSampleLevel(tSky, sLin, uv, 0.0).rgb * clamp((tw + 0.02) / (twc + 0.02), 0.0, 1.0);
}
fn wPlane(rel: vec3f) -> vec2f { return vec2f(dot(rel, O.ax.xyz), dot(rel, O.az.xyz)); }
fn casUV(p: vec2f, c: u32) -> vec2f { return (p + O.cas[c].xy) * O.cas[c].z; }
// caustics on the seabed: focusing of the refracted sunlight by the divergence of the wave slopes
fn caustics(rel: vec3f, lt: vec3f, up: vec3f, depth: f32, foot: f32) -> f32 {
  let k = O.ax.w;
  if (k <= 0.0 || depth <= 0.0) { return 1.0; }
  let mu = max(dot(lt, up), 0.3);
  let p = wPlane(rel + (lt - up * mu) * (depth / mu));
  var div = 0.0; var wt = 0.0;
  for (var c = 1u; c < 3u; c++) {
    let cc = O.cas[c];
    let fade = 1.0 - smoothstep(0.5, 2.0, foot / (cc.w * 32.0));
    if (fade <= 0.0) { continue; }
    let lod = max(log2(foot / cc.w), 0.0); let e = cc.w * 2.0 * exp2(lod);
    let uv = casUV(p, c); let du = vec2f(e * cc.z, 0.0); let dv = vec2f(0.0, e * cc.z);
    let sxp = textureSampleLevel(wSlope, sRep, uv + du, c, lod).x; let sxm = textureSampleLevel(wSlope, sRep, uv - du, c, lod).x;
    let szp = textureSampleLevel(wSlope, sRep, uv + dv, c, lod).y; let szm = textureSampleLevel(wSlope, sRep, uv - dv, c, lod).y;
    let reach = min(depth, 0.3 / cc.z) * (1.0 - smoothstep(0.5, 4.0, depth * cc.z));
    div += ((sxp - sxm) + (szp - szm)) / (2.0 * e) * reach * fade; wt += fade;
  }
  if (wt <= 0.0) { return 1.0; }
  let focus = clamp(1.0 - 0.25 * div, 0.35, 2.6);
  return mix(1.0, focus * focus * 0.85, 0.8 * k * (1.0 - smoothstep(2.0, 30.0, depth)) * min(wt, 1.0));
}
fn viewPath(rel: vec3f, up: vec3f, depth: f32) -> f32 { return max(depth, 0.0) / max(refrCos(clamp(dot(normalize(-rel), up), 0.0, 1.0)), 0.05); }
// the seabed: lit through the water (sun with caustics, sky), coloured by the water along the refracted view
fn seabed(alb: vec3f, n: vec3f, up: vec3f, rel: vec3f, depth: f32, foot: f32) -> vec3f {
  let w = surfLight(up, rel);
  let caus = caustics(rel, w.lt, up, depth, foot);
  let c = clamp(dot(n, up), 0.0, 1.0);
  let lit = alb * (w.sun * exp(-w.k * depth) * caus * max(dot(n, w.lt), 0.0) / PI + w.sky * exp(-w.k * depth * 0.8) * (0.65 + 0.35 * c));
  if (O.mode.y > 0.0) { return lit; }
  let ext = wExt();
  return lit * exp(-(ext - min(ext.r, min(ext.g, ext.b))) * viewPath(rel, up, depth));
}
fn shoaling(depth: f32) -> vec2f { return vec2f(smoothstep(-0.3, 5.0, depth), 0.3 + 0.7 * smoothstep(0.0, 8.0, depth)); }
`;

const W_SURFACE = /*wgsl*/`
@group(1) @binding(2) var<storage, read> WL: array<u32>;
struct WO { @builtin(position) clip: vec4f, @location(0) rel: vec3f, @location(1) plane: vec2f, @location(2) up: vec3f, @location(3) data: vec4f };
@vertex fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> WO {
  let pt = PT[WL[ii]];
  let v = V[u32(pt.info.x) * ${NV}u + vi];
  let base = pt.crel.xyz + v.p.xyz;
  let m = morph(length(base), pt.crel.w, F.nz2.w);
  let loc = v.p.xyz + v.d.xyz * m;
  let up = normalize(pt.cbody.xyz + loc);
  let h = v.p.w + v.d.w * m;
  var rel = pt.crel.xyz + loc - up * h;
  let plane = wPlane(rel);
  let depth = -h;
  let cell = length(base) * O.waves.z;
  var d = vec3f(0.0);
  for (var c = 0u; c < 3u; c++) { let lod = max(log2(6.0 * cell / O.cas[c].w), 0.0); d += textureSampleLevel(wDisp, sRep, casUV(plane, c), c, lod).xyz; }
  let sh = shoaling(depth);
  var hw = d.y * sh.x;
  // the surface never reaches the camera (OpenG): it stays under a cone around the eye
  let span = 3.0 * cell;
  let r = max(min(length(plane), length(plane + d.xz * sh.y)) - span, 0.0);
  let cd = O.mode.y; let gap = max(0.2 * abs(cd), O.waves.w);
  if (cd < 0.0) { hw = min(hw, -cd - gap + 0.3 * r); } else { hw = max(hw, -(cd - gap) - 0.3 * r); }
  rel += (O.ax.xyz * d.x + O.az.xyz * d.z) * sh.y + up * hw;
  if (v.n.z == 1u && cd < 0.0) { rel -= up * (0.5 + 0.05 * pt.info.z); }
  var o: WO;
  o.clip = F.vp * vec4f(rel, 1.0); o.rel = rel; o.plane = plane; o.up = up; o.data = vec4f(h, hw, sh.x, f32(v.n.z));
  return o;
}
fn erfcA(x: f32) -> f32 { return 2.0 * exp(-x * x) / (2.319 * x + sqrt(4.0 + 1.52 * x * x)); }
fn smithL(ct: f32, s2: f32) -> f32 { let v = ct / sqrt(max((1.0 - ct * ct) * 2.0 * s2, 1e-8)); return max(0.0, (exp(-v * v) - v * sqrt(PI) * erfcA(v)) / (2.0 * v * sqrt(PI))); }
fn glint(l: vec3f, v: vec3f, n: vec3f, tx: vec3f, ty: vec3f, s2: vec2f) -> f32 {
  let hv = normalize(l + v); let zh = max(dot(hv, n), 1e-3); let zx = dot(hv, tx) / zh; let zy = dot(hv, ty) / zh;
  let p = exp(-0.5 * (zx * zx / s2.x + zy * zy / s2.y)) / (2.0 * PI * sqrt(s2.x * s2.y));
  let vx = dot(v, tx); let vy = dot(v, ty); let cv2 = vx * vx / max(vx * vx + vy * vy, 1e-8);
  let lx = dot(l, tx); let ly = dot(l, ty); let cl2 = lx * lx / max(lx * lx + ly * ly, 1e-8);
  let zl = max(dot(l, n), 0.01); let zv = max(dot(v, n), 0.01);
  let sv = s2.x * cv2 + s2.y * (1.0 - cv2); let sl = s2.x * cl2 + s2.y * (1.0 - cl2);
  return fresnelW(dot(v, hv)) * p / ((1.0 + smithL(zl, sl) + smithL(zv, sv)) * zv * zh * zh * zh * zh * 4.0);
}
fn sunWindow(l: vec3f, t: vec3f, up: vec3f, s2: vec2f, ci: f32, ct: f32) -> f32 {
  let g = IOR * ci / max(ct, 0.05) - 1.0; let vt = max(0.5 * (s2.x + s2.y) * g * g, 2e-5);
  var a = cross(t, up); if (dot(a, a) < 1e-8) { a = vec3f(1.0, 0.0, 0.0) - up * up.x; }
  a = normalize(a); let b = cross(a, t);
  let dx = dot(l, a); let dy = dot(l, b);
  return select(0.0, 1.0, dot(l, t) > 0.0) * exp(-0.5 * (dx * dx + dy * dy) / vt) / (2.0 * PI * vt);
}
fn meanFres(cv: f32, sg: f32) -> f32 { let f = pow(1.0 - clamp(cv, 0.0, 1.0), 5.0 * exp(-2.69 * sg)) / (1.0 + 22.7 * pow(sg, 1.5)); return clamp(0.02 + 0.98 * f, 0.02, 1.0); }
fn vn2(p: vec2f) -> f32 { return vnoise(vec3f(p, 7.31)); }
fn seaFoot(rel: vec3f, up: vec3f) -> f32 {
  let t = length(rel); let rd = rel / max(t, 1e-6);
  let drx = dpdx(rd); let dry = dpdy(rd); let rn = dot(rd, up);
  let rnc = select(min(rn, -1e-3), max(rn, 1e-3), rn > 0.0);
  let px = t * (drx - rd * (dot(drx, up) / rnc)); let py = t * (dry - rd * (dot(dry, up) / rnc));
  return sqrt(max(dot(px, px), dot(py, py)));
}
@fragment fn fs(i: WO) -> @location(0) vec4f {
  let up = normalize(i.up);
  let major = seaFoot(i.rel, up);
  var sm = vec2f(0.0); var sv = vec2f(0.0); var jac = 0.0; var wh = 0.0;
  for (var c = 0u; c < 3u; c++) {
    let uv = casUV(i.plane, c);
    let tl = smoothstep(0.03, 0.15, major * O.cas[c].z);
    let s = mix(textureSample(wSlope, sRep, uv, c), textureSampleLevel(wSlope, sRep, vec2f(0.5), c, 16.0), tl);
    let d = mix(textureSample(wDisp, sRep, uv, c), textureSampleLevel(wDisp, sRep, vec2f(0.5), c, 16.0), tl);
    sm += s.xy; sv += max(s.zw - s.xy * s.xy, vec2f(0.0)); wh += d.y;
    if (c < 2u) { jac += d.w - 1.0; }
  }
  let depth = -i.data.x;
  let foot = length(i.rel) * F.misc.x;
  let sh = shoaling(depth);
  sm *= sh.y;
  let s2 = max(sv * sh.y * sh.y + O.waves.xy, vec2f(2e-4));
  let ax = normalize(O.ax.xyz - up * dot(O.ax.xyz, up)); let az = normalize(cross(up, ax));
  let n = normalize(up - ax * sm.x - az * sm.y);
  let tx = normalize(ax - n * dot(ax, n)); let ty = cross(n, tx);
  let v = normalize(-i.rel); let l = F.sun.xyz; let mus = dot(up, l);
  let cs = cloudShadow(i.rel);
  let sun = sunAt(up, 0.0) * cs.x * sunShadow(i.rel, up);
  let amb = skyIrr(up, 0.0) / PI * (0.55 + 0.45 * cs.y);
  let w = wLight(sun, amb, up);
  // foam: whitecaps where the surface folds, surf and swash at the shore
  let t = O.mode.z; let fp = i.plane;
  let bub = vn2(fp * 0.9 + vec2f(t * 0.05, 0.0)) * 0.6 + vn2(fp * 3.7) * 0.4;
  let far = 1.0 - smoothstep(0.3, 1.5, foot);
  var foam = O.absorb.w * smoothstep(-0.25, -0.75, jac) * (0.5 + 0.8 * bub) * sh.y;
  if (depth < 4.0) {
    let lace = smoothstep(0.3, 0.8, bub);
    let holes = smoothstep(0.4, 0.7, vn2(fp * 2.3 + vec2f(0.0, t * 0.08)));
    let swash = (1.0 - smoothstep(0.0, 0.04 + 0.1 * bub, depth)) * (0.1 + 0.5 * lace) * holes;
    let ph = depth / 0.9 + t * 0.12 + vn2(fp * 0.05) * 1.5;
    let surf = smoothstep(0.9, 1.0, sin(ph * 2.0 * PI)) * (1.0 - smoothstep(0.3, 2.0, depth)) * lace * 0.55;
    foam += O.scatter.w * (swash + surf) * mix(0.35, 1.0, far);
  }
  foam = clamp(foam, 0.0, 1.0);
  if (O.mode.y <= 0.0) {
    // seen from above
    let vn = dot(v, n); let vt = vec2f(dot(v, tx), dot(v, ty));
    let sg = sqrt(dot(vt * vt / max(1.0 - vn * vn, 1e-4), s2));
    let f = meanFres(vn, sg);
    var r = reflect(-v, n); r = normalize(r + up * max(0.02 - dot(r, up), 0.0));
    let refl = skyRad(r, up);
    let gl = sun * glint(l, v, n, tx, ty, s2) * smoothstep(0.0, 0.05, mus);
    let crest = clamp(wh * sh.x / max(O.az.w * 0.5, 0.05), 0.0, 1.0);
    let back = pow(clamp(dot(v, -l) * 0.5 + 0.5, 0.0, 1.0), 4.0);
    let sss = wSource(w, v) * 9.0 * crest * back * (1.0 - f);
    let foamRad = 0.85 * (sun * max(mus, 0.0) / PI + amb);
    let dv = viewPath(i.rel, up, depth);
    let muvt = refrCos(clamp(dot(v, up), 0.0, 1.0));
    let et = normalize(up * muvt + (v - up * dot(v, up)) / IOR);
    let ext = wExt(); let ts = exp(-min(ext.r, min(ext.g, ext.b)) * dv);
    let column = wPath(wSource(w, et), w.k, 0.0, muvt, dv);
    let rgb = (1.0 - foam) * (f * refl + gl + sss + (1.0 - f) * column) + foam * foamRad;
    return vec4f(rgb, (1.0 - foam) * (1.0 - (1.0 - f) * ts) + foam);
  }
  // seen from below: Snell's window, total internal reflection beyond it
  let nb = -n; let ci = clamp(dot(v, nb), 0.0, 1.0); let st2 = IOR * IOR * (1.0 - ci * ci);
  let rd = reflect(-v, nb);
  let below = wDeep(w, -rd, 0.0, max(-dot(rd, up), 0.0));
  var rgb: vec3f;
  if (st2 >= 1.0) { rgb = below; }
  else {
    let ct = sqrt(1.0 - st2);
    let td = normalize(-v * IOR - n * (IOR * ci - ct));
    let rs = (IOR * ci - ct) / (IOR * ci + ct); let rp = (ci - IOR * ct) / (ci + IOR * ct);
    let fr = clamp(0.5 * (rs * rs + rp * rp), 0.0, 1.0);
    let sky = skyRad(td, up) + sun * sunWindow(l, td, up, s2, ci, ct);
    rgb = (1.0 - fr) * sky + fr * below;
  }
  rgb = mix(rgb, 0.85 * 0.6 * (w.sun * w.mu_t / PI + w.sky), foam * 0.7);
  return vec4f(rgb, 1.0);
}
`;

// under water, the composite looks through the water instead of the air (OpenG fs_fog)
const W_UNDERWATER = /*wgsl*/`
fn underwater(base: vec3f, rd: vec3f, dist0: f32) -> vec3f {
  let up = normalize(F.cam.xyz);
  let w = surfLight(up, vec3f(0.0));
  let z0 = O.mode.y; let s = -dot(rd, up);
  var dist = dist0;
  if (s < 0.0) { dist = min(dist, z0 / max(-s, 1e-4)); }
  return base * exp(-wExt() * dist) + wPath(wSource(w, -rd), w.k, z0, s, dist);
}
`;
