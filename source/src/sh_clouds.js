// ============================================================================
// WGSL: volumetric clouds (after OpenG clouds: spherical shell, Nubis density, doubling light march, multiple
// scattering octaves, powder, vertical AO), their Beer shadow map, half-resolution march + temporal accumulation
// ============================================================================
// No weather: a fixed coverage field on the sphere, carried by the wind (the whole field turns slowly around a
// tilted axis), fair-weather cumulus.

// cloudShadowMap(rel): (sun transmittance through the clouds, openness of the sky) at a camera-relative point. The
// map is in sun space and covers the planet's disc: each texel holds the cloud shell segment on the sun side of
// its line (along-sun coordinates) and its optical depth.
const W_CLOUDSH = /*wgsl*/`
fn cloudShadowMap(rel: vec3f) -> vec2f {
  let p = F.cam.xyz + rel;
  let uv = vec2f(dot(p, F.csx.xyz), -dot(p, F.csy.xyz)) * F.csx.w * 0.5 + 0.5;
  let s = textureSampleLevel(tCloudSh, sLin, uv, 0.0);
  let along = dot(p, F.sun.xyz);
  let k = 1.0 - clamp((along - s.x) / max(s.y - s.x, 1.0), 0.0, 1.0);
  return vec2f(exp(-s.z * k), mix(1.0, s.w, k));
}
`;

// lighting of a surface point: the sun through the atmosphere and the clouds, the sky's irradiance
const W_LIGHT = W_CLOUDSH + /*wgsl*/`
fn cloudShadow(rel: vec3f) -> vec2f {
  let d = textureDimensions(tCloudSh);
  if (d.x < 2u) { return vec2f(1.0); }
  return cloudShadowMap(rel);
}
// the sun's shadow (cascades around the camera, PCF), with a normal offset against acne
fn sunShadow(rel: vec3f, n: vec3f) -> f32 {
  let d = length(rel);
  let nc = u32(F.shp.w);
  var c = 0u;
  if (d > F.shp.x * 0.8) { c = 1u; }
  if (d > F.shp.y * 0.85) { c = 2u; }
  if (c >= nc || d > F.shp[nc - 1u] * 0.9) { return 1.0; }
  let texel = F.shp[c] * 2.0 / f32(textureDimensions(tShadow).x);
  let p = rel + n * texel * 1.6;
  let q = F.shm[c] * vec4f(p, 1.0);
  let uv = vec2f(q.x * 0.5 + 0.5, 0.5 - q.y * 0.5);
  if (any(uv < vec2f(0.0)) || any(uv > vec2f(1.0)) || q.z > 1.0) { return 1.0; }
  let ts = 1.0 / f32(textureDimensions(tShadow).x);
  var s = 0.0;
  for (var j = -1; j <= 1; j++) { for (var i = -1; i <= 1; i++) { s += textureSampleCompareLevel(tShadow, sCmp, uv + vec2f(f32(i), f32(j)) * ts, c, q.z - 0.0004 * f32(c + 1u)); } }
  return s / 9.0;
}
// a lit Lambert surface: sun, sky (more from above than from the side)
fn surfaceLight(alb: vec3f, n: vec3f, up: vec3f, rel: vec3f, h: f32) -> vec3f {
  let cs = cloudShadow(rel);
  let sun = sunAt(up, h) * cs.x * sunShadow(rel, n);
  let sky = skyIrr(up, h) * (0.45 + 0.55 * cs.y);
  let c = dot(n, up);
  return alb * (sun * max(dot(n, F.sun.xyz), 0.0) / PI + sky / PI * (0.62 + 0.38 * c));
}
`;

// ---- noise volumes, baked once: shape (128^3: Perlin-Worley + 3 Worley octaves), detail (32^3: 3 Worley octaves)
const W_CNOISE = /*wgsl*/`
@group(0) @binding(0) var outV: texture_storage_3d<rgba8unorm, write>;
fn h33(p: vec3i) -> vec3f {
  var q = vec3u(p) * vec3u(1597334673u, 3812015801u, 2798796415u);
  q = (q.x ^ q.y ^ q.z) * vec3u(1597334673u, 3812015801u, 2798796415u);
  return vec3f(q) / 4294967295.0;
}
fn wrap(c: vec3i, n: i32) -> vec3i { return ((c % n) + n) % n; }
// tileable Worley (1 - distance to the nearest feature point), n cells per period
fn worley(p: vec3f, n: i32) -> f32 {
  let q = p * f32(n); let c = vec3i(floor(q)); let f = fract(q);
  var d = 1e9;
  for (var z = -1; z <= 1; z++) { for (var y = -1; y <= 1; y++) { for (var x = -1; x <= 1; x++) {
    let o = vec3i(x, y, z);
    let r = vec3f(o) + h33(wrap(c + o, n)) - f;
    d = min(d, dot(r, r));
  } } }
  return 1.0 - sqrt(d);
}
fn grad(c: vec3i, n: i32) -> vec3f { return normalize(h33(wrap(c, n) + vec3i(17, 5, 91)) * 2.0 - 1.0); }
// tileable Perlin, n cells per period, in [0, 1]
fn perlin(p: vec3f, n: i32) -> f32 {
  let q = p * f32(n); let c = vec3i(floor(q)); let f = fract(q); let u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  var v: array<f32, 8>;
  for (var i = 0; i < 8; i++) { let o = vec3i(i & 1, (i >> 1) & 1, i >> 2); v[i] = dot(grad(c + o, n), f - vec3f(o)); }
  let x0 = mix(mix(v[0], v[1], u.x), mix(v[2], v[3], u.x), u.y);
  let x1 = mix(mix(v[4], v[5], u.x), mix(v[6], v[7], u.x), u.y);
  return mix(x0, x1, u.z) * 0.9 + 0.5;
}
fn remap(v: f32, l0: f32, h0: f32, l1: f32, h1: f32) -> f32 { return l1 + (v - l0) * (h1 - l1) / (h0 - l0); }
@compute @workgroup_size(4, 4, 4) fn shape(@builtin(global_invocation_id) id: vec3u) {
  let p = (vec3f(id) + 0.5) / 128.0;
  let pf = perlin(p, 4) * 0.5 + perlin(p, 8) * 0.3 + perlin(p, 16) * 0.2;
  let w0 = worley(p, 4) * 0.625 + worley(p, 8) * 0.25 + worley(p, 16) * 0.125;
  let pw = clamp(remap(pf, 0.0, 1.0, w0 - 0.15, 1.0), 0.0, 1.0);
  let w1 = worley(p, 8) * 0.625 + worley(p, 16) * 0.25 + worley(p, 32) * 0.125;
  let w2 = worley(p, 16) * 0.625 + worley(p, 32) * 0.25 + worley(p, 64) * 0.125;
  textureStore(outV, id, vec4f(pw, w0, w1, w2));
}
@compute @workgroup_size(4, 4, 4) fn detail(@builtin(global_invocation_id) id: vec3u) {
  let p = (vec3f(id) + 0.5) / 32.0;
  textureStore(outV, id, vec4f(worley(p, 2) * 0.625 + worley(p, 4) * 0.25 + worley(p, 8) * 0.125,
    worley(p, 4) * 0.625 + worley(p, 8) * 0.25 + worley(p, 16) * 0.125, worley(p, 8) * 0.625 + worley(p, 16) * 0.25 + worley(p, 32) * 0.125, 1.0));
}
@group(0) @binding(1) var inV: texture_3d<f32>;
@compute @workgroup_size(4, 4, 4) fn mip(@builtin(global_invocation_id) id: vec3u) {
  if (any(id >= textureDimensions(outV))) { return; }
  var s = vec4f(0.0);
  for (var i = 0u; i < 8u; i++) { s += textureLoad(inV, id * 2u + vec3u(i & 1u, (i >> 1u) & 1u, i >> 2u), 0); }
  textureStore(outV, id, s / 8.0);
}
`;

// ---- the cloud field (group 1 of the cloud passes)
const W_CLOUD = /*wgsl*/`
struct Cloud {
  layer: vec4f,  // base (m above the sea), thickness, sigma (1/m), coverage bias
  rot0: vec4f,   // rows of the wind rotation (body -> cloud field), w: shape period (m)
  rot1: vec4f,   // w: detail period (m)
  rot2: vec4f,   // w: march steps
  prev: mat4x4f, // previous frame's camera-relative view-projection
  dcam: vec4f,   // camera motion since the previous frame (body), w: frame jitter index
  res: vec4f,    // size of the march targets (px)
};
@group(1) @binding(0) var<uniform> C: Cloud;
@group(1) @binding(1) var tShape: texture_3d<f32>;
@group(1) @binding(2) var tDetail: texture_3d<f32>;
@group(1) @binding(3) var tCov: texture_cube<f32>;
fn sat(x: f32) -> f32 { return clamp(x, 0.0, 1.0); }
fn remap(v: f32, l0: f32, h0: f32, l1: f32, h1: f32) -> f32 { return l1 + (v - l0) * (h1 - l1) / (h0 - l0); }
fn windRot(p: vec3f) -> vec3f { return vec3f(dot(C.rot0.xyz, p), dot(C.rot1.xyz, p), dot(C.rot2.xyz, p)); }
// coverage of the fair-weather field at a (wind-rotated) body point: cloud streets and clear patches
fn coverage(q: vec3f) -> f32 {
  let c = textureSampleLevel(tCov, sLin, q, 0.0).r;
  return sat(remap(c, 0.36 - C.layer.w, 0.74 - C.layer.w, 0.0, 0.92));
}
fn rayShell(o: vec3f, rd: vec3f, rad: f32) -> vec2f {
  let b = dot(o, rd); let c = dot(o, o) - rad * rad; let d = b * b - c;
  if (d < 0.0) { return vec2f(-1.0); }
  let s = sqrt(d); return vec2f(-b - s, -b + s);
}
struct CS { d: f32, hf: f32 };
// density (0..1) at body point p; shapeOnly: no erosion (light march, shadows); foot: pixel footprint (m)
fn cloudAt(p: vec3f, foot: f32, shapeOnly: bool, mipBias: f32) -> CS {
  var s: CS; s.d = 0.0; s.hf = 0.0;
  let h = length(p) - F.pl.x - C.layer.x;
  if (h <= 0.0 || h >= C.layer.y) { return s; }
  let hf = h / C.layer.y; s.hf = hf;
  let q = windRot(p);
  let cov = coverage(q);
  if (cov <= 0.01) { return s; }
  // cumulus profile: a flat base, rounded tops, taller where the coverage is high
  let top = 0.45 + 0.55 * cov;
  let prof = sat(hf / 0.07) * sat((top - hf) / (0.35 * top));
  if (prof <= 0.0) { return s; }
  let ks = smoothstep(0.06, 0.25, foot / C.rot0.w);
  var d = 0.0;
  if (ks < 1.0) {
    let n = textureSampleLevel(tShape, sRep, q / C.rot0.w, log2(1.0 + foot / (C.rot0.w / 128.0)) + mipBias);
    let wf = n.g * 0.625 + n.b * 0.25 + n.a * 0.125;
    let sh = sat(remap(n.r, wf - 1.0, 1.0, 0.0, 1.0));
    d = sat(remap(sh * prof, 1.0 - cov, 1.0, 0.0, 1.0));
    if (!shapeOnly && d > 0.0) {
      let kd = 1.0 - smoothstep(0.25, 1.0, foot / C.rot1.w);
      if (kd > 0.0) {
        let dn = textureSampleLevel(tDetail, sRep, q / C.rot1.w + (n.gba - 0.5) * 0.35, log2(1.0 + foot / (C.rot1.w / 32.0))).rgb;
        let df = dn.r * 0.625 + dn.g * 0.25 + dn.b * 0.125;
        let dm = mix(0.5, mix(df, 1.0 - df, sat(hf * 3.0)), kd);
        d = sat(remap(d, dm * 0.38, 1.0, 0.0, 1.0));
      }
    }
  }
  if (ks > 0.0) { d = mix(d, prof * smoothstep(0.3, 0.9, cov) * 0.45, ks); }
  s.d = d;
  return s;
}
fn hg(g: f32, c: f32) -> f32 { let g2 = g * g; return (1.0 - g2) / (4.0 * PI * pow(max(1.0 + g2 - 2.0 * g * c, 1e-5), 1.5)); }
fn cPhase(c: f32, k: f32) -> f32 { return max(mix(hg(0.8 * k, c), hg(-0.25 * k, c), 0.35), 0.0); }
// optical depth toward the sun: 6 doubling steps (shape only, coarser mips), then one far sample
fn lightOD(p: vec3f, foot: f32, jit: f32) -> f32 {
  let l = F.sun.xyz;
  var ds = 18.0 * (0.7 + 0.6 * jit); var t = 0.0; var od = 0.0;
  for (var i = 0; i < 6; i++) { od += cloudAt(p + l * (t + 0.5 * ds), foot, true, 1.0 + 0.5 * f32(i)).d * ds; t += ds; ds *= 2.0; }
  od += cloudAt(p + l * (3.0 * t), foot, true, 4.0).d * t;
  return od * C.layer.z;
}
`;

// ---- the march (half resolution): (luminance, transmittance) and the mean distance of the light
const W_CMARCH = /*wgsl*/`
@group(2) @binding(0) var dIn: texture_depth_multisampled_2d;
struct MO { @location(0) c: vec4f, @location(1) t: vec4f };
@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f { let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u)); return vec4f(p * 2.0 - 1.0, 0.0, 1.0); }
fn ign(p: vec2f, f: f32) -> f32 { let q = p + 5.588238 * f; return fract(52.9829189 * fract(0.06711056 * q.x + 0.00583715 * q.y)); }
@fragment fn fs(@builtin(position) fc: vec4f) -> MO {
  var o: MO; o.c = vec4f(0.0, 0.0, 0.0, 1.0); o.t = vec4f(6e4, 0.0, 0.0, 0.0);
  let sc = vec2f(textureDimensions(dIn)) / C.res.xy;
  let full = fc.xy * sc;
  let depth = textureLoad(dIn, vec2i(full), 0);
  let ndc = vec2f(full.x * F.scr.z * 2.0 - 1.0, 1.0 - full.y * F.scr.w * 2.0);
  let rd = normalize(F.fwd.xyz + F.right.xyz * ndc.x * F.right.w + F.up.xyz * ndc.y * F.up.w);
  var tScene = 1e9;
  if (depth > 0.0) { tScene = F.fwd.w / depth / max(dot(rd, F.fwd.xyz), 1e-6); }
  let cam = F.cam.xyz; let rB = F.pl.x + C.layer.x; let rT = rB + C.layer.y;
  let ot = rayShell(cam, rd, rT);
  if (ot.y <= 0.0) { return o; }
  var t0 = max(ot.x, 0.0); var t1 = ot.y;
  let ib = rayShell(cam, rd, rB);
  let r0 = length(cam);
  if (ib.y > 0.0) { if (r0 < rB) { t0 = ib.y; } else if (ib.x > 0.0) { t1 = ib.x; } }
  // the planet hides what lies behind it
  let ip = rayShell(cam, rd, F.pl.x);
  if (ip.x > 0.0) { t1 = min(t1, ip.x); }
  t1 = min(t1, min(tScene, 60000.0));
  if (t1 <= t0) { return o; }
  let n = C.rot2.w;
  // fine steps inside the clouds (never more than 180 m: no terraces on the tops seen at grazing angles), big
  // ones through the clear air, with a step back on entering a cloud
  let ds0 = clamp((t1 - t0) / n, 20.0, 180.0);
  let jit = ign(fc.xy, C.dcam.w);
  var t = t0 + ds0 * jit;
  var coarse = false;
  var T = 1.0; var L = vec3f(0.0); var tw = 0.0; var wsum = 0.0;
  let ct = dot(rd, F.sun.xyz);
  var ph: array<f32, 3>; var k = 1.0;
  for (var i = 0; i < 3; i++) { ph[i] = cPhase(ct, k); k *= 0.5; }
  let sig = C.layer.z;
  var ds = ds0;
  for (var i = 0; i < 220; i++) {
    if (t >= t1 || T < 0.01) { break; }
    let p = cam + rd * t;
    let foot = t * F.misc.x * 2.0;
    let s = cloudAt(p, foot, false, 0.0);
    if (s.d > 0.0 && coarse) { t -= ds * (1.0 - jit * 0.5); ds = ds0; coarse = false; continue; }
    if (s.d > 0.0) {
      let up = normalize(p); let hm = length(p) - F.pl.x;
      let od = lightOD(p, foot, ign(fc.xy + 7.0, C.dcam.w));
      var ms = 0.0; var a = 1.0; var b = 1.0;
      for (var j = 0; j < 3; j++) { ms += b * ph[j] * exp(-a * od); a *= 0.45; b *= 0.55; }
      let powder = mix(1.0, 1.0 - exp(-s.d * sig * 60.0), 0.55 * sat(0.5 - 0.5 * ct));
      let sunL = sunAt(up, hm) * ms * powder;
      let amb = skyIrr(up, hm) / PI * (0.25 + 0.75 * s.hf) + sunAt(up, 0.0) * max(dot(up, F.sun.xyz), 0.0) * 0.06 * (1.0 - s.hf);
      let ext = max(s.d * sig, 1e-6);
      let tr = exp(-ext * ds);
      L += T * (sunL + amb) * (1.0 - tr);
      tw += T * (1.0 - tr) * t; wsum += T * (1.0 - tr);
      T *= tr;
      ds = ds0;
    } else { ds = min(ds * 1.4, ds0 * 5.0); coarse = ds > ds0 * 1.5; }
    t += ds;
  }
  o.c = vec4f(L, T);
  o.t = vec4f(select(6e4, tw / wsum, wsum > 1e-4), 0.0, 0.0, 0.0);
  return o;
}
`;

// ---- temporal accumulation: the new half-resolution march blended into the reprojected history
const W_CTAA = /*wgsl*/`
@group(2) @binding(0) var curC: texture_2d<f32>;
@group(2) @binding(1) var curT: texture_2d<f32>;
@group(2) @binding(2) var histC: texture_2d<f32>;
@group(2) @binding(3) var histT: texture_2d<f32>;
struct MO { @location(0) c: vec4f, @location(1) t: vec4f };
@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f { let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u)); return vec4f(p * 2.0 - 1.0, 0.0, 1.0); }
@fragment fn fs(@builtin(position) fc: vec4f) -> MO {
  let px = vec2i(fc.xy);
  let c = textureLoad(curC, px, 0); let td = textureLoad(curT, px, 0).x;
  var lo = c; var hi = c;
  for (var j = -1; j <= 1; j++) { for (var i = -1; i <= 1; i++) { let q = textureLoad(curC, px + vec2i(i, j), 0); lo = min(lo, q); hi = max(hi, q); } }
  // where was this point last frame?
  let ndc = vec2f(fc.x / C.res.xy.x * 2.0 - 1.0, 1.0 - fc.y / C.res.xy.y * 2.0);
  let rd = normalize(F.fwd.xyz + F.right.xyz * ndc.x * F.right.w + F.up.xyz * ndc.y * F.up.w);
  let pr = rd * min(td, 6e4) + C.dcam.xyz;
  let cl = C.prev * vec4f(pr, 1.0);
  var o: MO; o.c = c; o.t = vec4f(td, 0.0, 0.0, 0.0);
  if (cl.w > 0.0) {
    let uv = vec2f(cl.x / cl.w * 0.5 + 0.5, 0.5 - cl.y / cl.w * 0.5);
    if (all(uv > vec2f(0.0)) && all(uv < vec2f(1.0))) {
      let h = textureSampleLevel(histC, sLin, uv, 0.0);
      let ht = textureSampleLevel(histT, sLin, uv, 0.0).x;
      let hc = clamp(h, lo - (hi - lo) * 0.6, hi + (hi - lo) * 0.6);
      o.c = mix(c, hc, C.res.z);
      o.t = vec4f(mix(td, ht, select(0.9, 0.0, abs(ht - td) > td * 0.5)), 0.0, 0.0, 0.0);
    }
  }
  return o;
}
`;

// ---- the shadow map: optical depth through the shell on the sun side of each texel's line
const W_CSHADOW = /*wgsl*/`
@group(2) @binding(0) var outSh: texture_storage_2d<rgba16float, write>;
@compute @workgroup_size(8, 8) fn main(@builtin(global_invocation_id) id: vec3u) {
  let n = textureDimensions(outSh);
  if (any(id.xy >= n)) { return; }
  let uv = (vec2f(id.xy) + 0.5) / vec2f(n);
  let e = 1.0 / F.csx.w;
  let p0 = F.csx.xyz * (uv.x * 2.0 - 1.0) * e - F.csy.xyz * (uv.y * 2.0 - 1.0) * e;
  let l = F.sun.xyz;
  let rB = F.pl.x + C.layer.x; let rT = rB + C.layer.y;
  let ot = rayShell(p0, l, rT);
  if (ot.y <= 0.0) { textureStore(outSh, id.xy, vec4f(0.0, 1.0, 0.0, 1.0)); return; }
  let ib = rayShell(p0, l, rB);
  let a0 = max(select(0.0, ib.y, ib.y > 0.0), ot.x); let a1 = ot.y;
  var od = 0.0;
  let ds = (a1 - a0) / 20.0;
  for (var i = 0; i < 20; i++) { od += cloudAt(p0 + l * (a0 + (f32(i) + 0.5) * ds), 120.0, true, 1.0).d * ds; }
  od *= C.layer.z;
  textureStore(outSh, id.xy, vec4f(a0, a1, od, exp(-od * 0.12)));
}
`;

// the coverage cube map (baked once): fbm of the planet's continuous simplex noise on the sphere, cloud systems of a
// few kilometres with streets and clear patches, no lattice
const W_CCOV = W_FRAME + W_NOISE + /*wgsl*/`
@group(1) @binding(0) var outC: texture_storage_2d_array<rgba8unorm, write>;
const CUP = array<vec3f, 6>(vec3f(1, 0, 0), vec3f(-1, 0, 0), vec3f(0, 1, 0), vec3f(0, -1, 0), vec3f(0, 0, 1), vec3f(0, 0, -1));
@compute @workgroup_size(8, 8) fn main(@builtin(global_invocation_id) id: vec3u) {
  let n = textureDimensions(outC).x;
  if (id.x >= n || id.y >= n) { return; }
  let uv = (vec2f(id.xy) + 0.5) / f32(n) * 2.0 - 1.0;
  // the cube-map face conventions of WebGPU (+X, -X, +Y, -Y, +Z, -Z)
  var d: vec3f;
  switch id.z {
    case 0u: { d = vec3f(1.0, -uv.y, -uv.x); } case 1u: { d = vec3f(-1.0, -uv.y, uv.x); }
    case 2u: { d = vec3f(uv.x, 1.0, uv.y); } case 3u: { d = vec3f(uv.x, -1.0, -uv.y); }
    case 4u: { d = vec3f(uv.x, -uv.y, 1.0); } default: { d = vec3f(-uv.x, -uv.y, -1.0); }
  }
  let p = normalize(d) * (F.pl.x / 3200.0);
  let c = 0.5 + 0.5 * (snoise(p) * 0.55 + snoise(p * 2.1 + 17.0) * 0.28 + snoise(p * 4.6 + 41.0) * 0.12 + snoise(p * 9.7 + 7.0) * 0.05);
  textureStore(outC, vec2u(id.xy), id.z, vec4f(c, 0.0, 0.0, 1.0));
}
`;
