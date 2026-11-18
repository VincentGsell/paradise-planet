// ============================================================================
// WGSL: the atmosphere (OpenG Atmo, after Hillaire 2020), sky, stars, aerial perspective, surface lighting
// ============================================================================
// Lengths in km inside the atmosphere code. A tiny planet keeps the Earth's vertical optical depth (zenith colour,
// brightness from the ground) with scale heights proportional to its radius and coefficients divided by the same
// factor (OpenG `scaled_with`).
const TLUT = [256, 64], MLUT = [32, 32], ELUT = [32, 32], SLUT = [192, 108];
const W_ATMO = /*wgsl*/`
struct Atmo {
  ray: vec4f,   // rayleigh scattering (1/km), w: bottom radius (km)
  mie: vec4f,   // mie scattering, w: top radius (km)
  mieA: vec4f,  // mie absorption, w: mie g
  ozo: vec4f,   // ozone absorption, w: rayleigh scale height (km)
  gnd: vec4f,   // ground albedo, w: mie scale height (km)
  sunI: vec4f,  // sun illuminance, w: sun angular radius (rad)
  misc: vec4f,  // ozone centre, ozone half width, multi-scattering factor, twilight softness
};
@group(0) @binding(2) var<uniform> A: Atmo;
@group(0) @binding(3) var sLin: sampler;
@group(0) @binding(4) var tTrans: texture_2d<f32>;
@group(0) @binding(5) var tMulti: texture_2d<f32>;
@group(0) @binding(6) var tIrr: texture_2d<f32>;
@group(0) @binding(7) var tSky: texture_2d<f32>;
@group(0) @binding(8) var sRep: sampler;
@group(0) @binding(9) var tCloudSh: texture_2d<f32>;
@group(0) @binding(10) var tShadow: texture_depth_2d_array;
@group(0) @binding(11) var sCmp: sampler_comparison;
const TSZ = vec2f(${TLUT}); const MSZ = vec2f(${MLUT}); const ESZ = vec2f(${ELUT}); const SSZ = vec2f(${SLUT});
fn rb() -> f32 { return A.ray.w; }
fn rt() -> f32 { return A.mie.w; }
fn thick() -> f32 { return A.mie.w - A.ray.w; }
fn toSub(u: vec2f, s: vec2f) -> vec2f { return (u * (s - 1.0) + 0.5) / s; }
fn fromSub(uv: vec2f, s: vec2f) -> vec2f { return (uv * s - 0.5) / (s - 1.0); }
struct Medium { ray: vec3f, mie: vec3f, sca: vec3f, ext: vec3f };
fn medium(hk: f32) -> Medium {
  let h = max(hk, 0.0);
  let dr = exp(-h / A.ozo.w); let dm = exp(-h / A.gnd.w);
  let dz = max(0.0, 1.0 - abs(h - A.misc.x) / A.misc.y);
  var m: Medium;
  m.ray = A.ray.xyz * dr; m.mie = A.mie.xyz * dm; m.sca = m.ray + m.mie;
  m.ext = m.sca + A.mieA.xyz * dm + A.ozo.xyz * dz;
  return m;
}
fn phaseR(c: f32) -> f32 { return 3.0 / (16.0 * PI) * (1.0 + c * c); }
fn phaseM(c: f32) -> f32 {
  let g = A.mieA.w; let g2 = g * g;
  return 3.0 / (8.0 * PI) * (1.0 - g2) / (2.0 + g2) * (1.0 + c * c) / pow(max(1.0 + g2 - 2.0 * g * c, 1e-6), 1.5);
}
fn rayRH(r0: f32, h0: f32, mu: f32, t: f32) -> vec2f {
  let q = h0 * (2.0 * rb() + h0) + t * (t + 2.0 * r0 * mu);
  let r = sqrt(max(rb() * rb() + q, 0.0));
  return vec2f(r, q / (r + rb()));
}
fn distTop(r: f32, h: f32, mu: f32) -> f32 {
  let d = r * r * mu * mu + (thick() - h) * (r + rt());
  if (d < 0.0) { return -1.0; }
  return -r * mu + sqrt(d);
}
fn distGround(r: f32, h: f32, mu: f32) -> f32 {
  if (mu >= 0.0) { return -1.0; }
  let d = r * r * mu * mu - max(h, 0.0) * (2.0 * rb() + max(h, 0.0));
  if (d < 0.0) { return -1.0; }
  return max(-r * mu - sqrt(d), 0.0);
}
fn transUnit(hk: f32, mu: f32) -> vec2f {
  let hh = clamp(hk, 0.0, thick()); let r = rb() + hh;
  let H = sqrt(thick() * (rt() + rb())); let rho = sqrt(max(hh * (2.0 * rb() + hh), 0.0));
  let d = max(distTop(r, hh, mu), 0.0); let dmin = rt() - r; let dmax = rho + H;
  return vec2f(clamp((d - dmin) / max(dmax - dmin, 1e-6), 0.0, 1.0), rho / H);
}
fn transTop(hk: f32, mu: f32) -> vec3f { return textureSampleLevel(tTrans, sLin, toSub(transUnit(hk, mu), TSZ), 0.0).rgb; }
fn multiSc(hk: f32, mus: f32) -> vec3f {
  let u = vec2f(clamp(mus * 0.5 + 0.5, 0.0, 1.0), clamp(hk / thick(), 0.0, 1.0));
  return textureSampleLevel(tMulti, sLin, toSub(u, MSZ), 0.0).rgb;
}
fn skyUV(h: f32, mu: f32, lv: f32) -> vec2f {
  let r = rb() + h; let beta = acos(clamp(sqrt(h * (2.0 * rb() + h)) / r, -1.0, 1.0)); let zh = PI - beta;
  let vza = acos(clamp(mu, -1.0, 1.0));
  var v: f32;
  if (vza < zh) { v = 0.5 * (1.0 - sqrt(max(1.0 - vza / zh, 0.0))); } else { v = 0.5 + 0.5 * sqrt(max((vza - zh) / max(beta, 1e-6), 0.0)); }
  return toSub(vec2f(sqrt(clamp(-lv * 0.5 + 0.5, 0.0, 1.0)), v), SSZ);
}
// the sun's visibility below the geometric horizon: a soft twilight fade through the upper atmosphere
fn perigee(h: f32, mu: f32) -> f32 { let r = rb() + h; return h - r * mu * mu / (1.0 + sqrt(max(1.0 - mu * mu, 0.0))); }
fn sunVis(hk: f32, mus: f32) -> f32 {
  if (mus >= 0.0) { return 1.0; }
  let h = max(hk, 0.0); let l = A.ozo.w * A.misc.w;
  let ha = min(h, thick()); let x = max(h - perigee(h, mus) - (h - ha), 0.0) / (ha + 0.25 * l);
  return exp(-2.0 * x) * (1.0 - smoothstep(0.55, 1.0, x));
}
fn segSample(i: u32, n: u32, t0: f32, t1: f32, tm: f32) -> vec2f {
  var a = t0; var b = t1; var k = i; var m = n; var dense = false;
  if (tm > t0 + 1e-6 && tm < t1 - 1e-6) {
    let n1 = n / 2u;
    if (i < n1) { b = tm; m = n1; dense = true; } else { a = tm; k = i - n1; m = n - n1; }
  } else if (tm >= t1 - 1e-6) { dense = true; }
  let u0 = f32(k) / f32(m); let u1 = f32(k + 1u) / f32(m);
  var ta: f32; var tb: f32;
  if (dense) { ta = b - (b - a) * (1.0 - u0) * (1.0 - u0); tb = b - (b - a) * (1.0 - u1) * (1.0 - u1); }
  else { ta = a + (b - a) * u0 * u0; tb = a + (b - a) * u1 * u1; }
  return vec2f(0.5 * (ta + tb), tb - ta);
}
struct Scat { lum: vec3f, tr: vec3f, ms: vec3f };
fn integrate(r0: f32, h0: f32, mu: f32, mus0: f32, nu: f32, t0: f32, t1: f32, n: u32, msMode: bool) -> Scat {
  var s: Scat; s.lum = vec3f(0.0); s.tr = vec3f(1.0); s.ms = vec3f(0.0);
  if (t1 <= t0) { return s; }
  let tm = clamp(-r0 * mu, t0, t1);
  var pr = phaseR(nu); var pm = phaseM(nu);
  if (msMode) { pr = 1.0 / (4.0 * PI); pm = pr; }
  for (var i = 0u; i < n; i++) {
    let q = segSample(i, n, t0, t1, tm);
    let rh = rayRH(r0, h0, mu, q.x);
    let m = medium(rh.y);
    let mus = clamp((r0 * mus0 + q.x * nu) / rh.x, -1.0, 1.0);
    let sun = transTop(rh.y, mus) * sunVis(rh.y, mus);
    var src = sun * (m.ray * pr + m.mie * pm);
    if (!msMode) { src += multiSc(rh.y, mus) * A.misc.z * m.sca; }
    let ext = max(m.ext, vec3f(1e-9));
    let st = exp(-ext * q.y);
    let ig = (1.0 - st) / ext;
    s.lum += s.tr * src * ig; s.ms += s.tr * m.sca * ig; s.tr *= st;
  }
  return s;
}
// ---- lighting of a surface point (any shader): the sun through the atmosphere, the sky's irradiance
fn altKm(up: vec3f, h: f32) -> f32 { return max(h, 0.0) * 0.001; }
fn sunAt(up: vec3f, h: f32) -> vec3f {
  let mus = dot(up, F.sun.xyz); let hk = altKm(up, h);
  return transTop(hk, mus) * sunVis(hk, mus) * A.sunI.xyz;
}
// sky irradiance on a horizontal surface (per unit sun illuminance, from the irradiance LUT)
fn skyIrr(up: vec3f, h: f32) -> vec3f {
  let u = vec2f(clamp(dot(up, F.sun.xyz) * 0.5 + 0.5, 0.0, 1.0), clamp(altKm(up, h) / thick(), 0.0, 1.0));
  return textureSampleLevel(tIrr, sLin, toSub(u, ESZ), 0.0).rgb * A.sunI.xyz;
}
`;

// one-time LUTs: transmittance, multiple scattering, sky irradiance
const W_LUT = W_FRAME + W_ATMO + /*wgsl*/`
@group(1) @binding(0) var outLut: texture_storage_2d<rgba16float, write>;
@compute @workgroup_size(8, 8) fn trans(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= vec2u(TSZ))) { return; }
  let u = fromSub((vec2f(id.xy) + 0.5) / TSZ, TSZ);
  let H = sqrt(thick() * (rt() + rb())); let rho = H * u.y; let r = sqrt(rho * rho + rb() * rb());
  let h = rho * rho / (r + rb()); let dmin = rt() - r; let dmax = rho + H; let d = dmin + u.x * (dmax - dmin);
  var mu = 1.0;
  if (d > 0.0) { mu = clamp((H * H - rho * rho - d * d) / (2.0 * r * d), -1.0, 1.0); }
  let tm = clamp(-r * mu, 0.0, d);
  var od = vec3f(0.0);
  for (var i = 0u; i < 64u; i++) { let q = segSample(i, 64u, 0.0, d, tm); od += medium(rayRH(r, h, mu, q.x).y).ext * q.y; }
  textureStore(outLut, id.xy, vec4f(exp(-od), 1.0));
}
@compute @workgroup_size(8, 8) fn multi(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= vec2u(MSZ))) { return; }
  let u = fromSub((vec2f(id.xy) + 0.5) / MSZ, MSZ);
  let mus0 = u.x * 2.0 - 1.0; let h = u.y * thick(); let r = rb() + h; let ss = sqrt(max(1.0 - mus0 * mus0, 0.0));
  var lum = vec3f(0.0); var fms = vec3f(0.0);
  for (var i = 0u; i < 8u; i++) {
    let th = 2.0 * PI * (f32(i) + 0.5) / 8.0;
    for (var j = 0u; j < 8u; j++) {
      let mu = 1.0 - 2.0 * (f32(j) + 0.5) / 8.0;
      let nu = mu * mus0 + sqrt(max(1.0 - mu * mu, 0.0)) * ss * cos(th);
      let tg = distGround(r, h, mu);
      var t1 = tg; if (tg < 0.0) { t1 = max(distTop(r, h, mu), 0.0); }
      let s = integrate(r, h, mu, mus0, nu, 0.0, t1, 20u, true);
      lum += s.lum; fms += s.ms;
      if (tg >= 0.0) {
        let rg = rayRH(r, h, mu, tg).x; let mug = clamp((r * mus0 + tg * nu) / rg, -1.0, 1.0);
        lum += s.tr * transTop(0.0, mug) * sunVis(0.0, mug) * max(mug, 0.0) * A.gnd.xyz / PI;
      }
    }
  }
  lum /= 64.0; fms /= 64.0;
  textureStore(outLut, id.xy, vec4f(lum / max(1.0 - fms, vec3f(1e-4)), 1.0));
}
// irradiance of the sky on a horizontal surface at (sun zenith cosine, altitude), per unit sun illuminance
@compute @workgroup_size(8, 8) fn irr(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= vec2u(ESZ))) { return; }
  let u = fromSub((vec2f(id.xy) + 0.5) / ESZ, ESZ);
  let mus0 = u.x * 2.0 - 1.0; let h = u.y * thick(); let r = rb() + h; let ss = sqrt(max(1.0 - mus0 * mus0, 0.0));
  var e = vec3f(0.0);
  for (var i = 0u; i < 8u; i++) {
    let th = 2.0 * PI * (f32(i) + 0.5) / 8.0;
    for (var j = 0u; j < 8u; j++) {
      let mu = (f32(j) + 0.5) / 8.0; // cosine-uniform over the upper hemisphere
      let nu = mu * mus0 + sqrt(max(1.0 - mu * mu, 0.0)) * ss * cos(th);
      let t1 = max(distTop(r, h, mu), 0.0);
      e += integrate(r, h, mu, mus0, nu, 0.0, t1, 16u, false).lum * mu;
    }
  }
  // E = integral of L cos over the hemisphere = 2 pi * mean(L cos)
  textureStore(outLut, id.xy, vec4f(e / 64.0 * 2.0 * PI, 1.0));
}
`;

// per-frame sky-view LUT at the camera
const W_SKYVIEW = W_FRAME + W_ATMO + /*wgsl*/`
@group(1) @binding(0) var outLut: texture_storage_2d<rgba16float, write>;
@compute @workgroup_size(8, 8) fn main(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= vec2u(SSZ))) { return; }
  let u = fromSub((vec2f(id.xy) + 0.5) / SSZ, SSZ);
  let up = normalize(F.cam.xyz); let h = clamp(F.cam.w * 0.001 - rb(), 0.0, thick()); let r = rb() + h;
  let beta = acos(clamp(sqrt(h * (2.0 * rb() + h)) / r, -1.0, 1.0)); let zh = PI - beta;
  var vza: f32;
  if (u.y < 0.5) { let c = 1.0 - 2.0 * u.y; vza = zh * (1.0 - c * c); } else { let c = 2.0 * u.y - 1.0; vza = zh + beta * c * c; }
  let mu = cos(vza); let lv = -(u.x * u.x * 2.0 - 1.0);
  let mus0 = clamp(dot(up, F.sun.xyz), -1.0, 1.0);
  let nu = mu * mus0 + sqrt(max(1.0 - mu * mu, 0.0)) * sqrt(max(1.0 - mus0 * mus0, 0.0)) * lv;
  let tg = distGround(r, h, mu);
  var t1 = tg; if (tg < 0.0) { t1 = max(distTop(r, h, mu), 0.0); }
  let s = integrate(r, h, mu, mus0, nu, 0.0, t1, 32u, false);
  textureStore(outLut, id.xy, vec4f(min(s.lum * A.sunI.xyz, vec3f(60000.0)), 1.0));
}
`;

// full-screen composite: sky (sky-view LUT inside the atmosphere, raymarched from space), sun disc, stars, and the
// aerial perspective on everything drawn
const W_COMPOSITE = /*wgsl*/`
@group(1) @binding(0) var cIn: texture_2d<f32>;
@group(1) @binding(1) var dIn: texture_depth_multisampled_2d;
@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u)); return vec4f(p * 2.0 - 1.0, 0.0, 1.0);
}
fn viewRay(fc: vec2f) -> vec3f {
  let ndc = vec2f(fc.x * F.scr.z * 2.0 - 1.0, 1.0 - fc.y * F.scr.w * 2.0);
  return normalize(F.fwd.xyz + F.right.xyz * ndc.x * F.right.w + F.up.xyz * ndc.y * F.up.w);
}
fn sunDisc(rd: vec3f) -> f32 {
  let a = A.sunI.w; let th = 2.0 * asin(clamp(length(rd - F.sun.xyz) * 0.5, 0.0, 1.0));
  let cov = clamp((a - th) / max(F.misc.x, 1e-7) + 0.5, 0.0, 1.0);
  if (cov <= 0.0) { return 0.0; }
  let x = clamp(th / a, 0.0, 1.0); let limb = (1.0 - 0.6 * (1.0 - sqrt(1.0 - x * x))) / 0.8;
  let sa = sin(0.5 * a);
  return cov * limb / (4.0 * PI * sa * sa);
}
// ---- stars (OpenG stars): cube-cell star field + Milky Way, turning with the sky
const SC = 96;
fn starFace(d: vec3f) -> vec3f {
  let a = abs(d);
  if (a.x >= a.y && a.x >= a.z) { return vec3f(select(1.0, 0.0, d.x > 0.0), d.z / a.x, d.y / a.x); }
  if (a.y >= a.z) { return vec3f(select(3.0, 2.0, d.y > 0.0), d.x / a.y, d.z / a.y); }
  return vec3f(select(5.0, 4.0, d.z > 0.0), d.x / a.z, d.y / a.z);
}
fn starDir(f: u32, uv: vec2f) -> vec3f {
  switch f {
    case 0u: { return normalize(vec3f(1.0, uv.y, uv.x)); } case 1u: { return normalize(vec3f(-1.0, uv.y, uv.x)); }
    case 2u: { return normalize(vec3f(uv.x, 1.0, uv.y)); } case 3u: { return normalize(vec3f(uv.x, -1.0, uv.y)); }
    case 4u: { return normalize(vec3f(uv.x, uv.y, 1.0)); } default: { return normalize(vec3f(uv.x, uv.y, -1.0)); }
  }
}
fn starColor(t: f32) -> vec3f {
  var c: vec3f;
  if (t < 0.1) { c = mix(vec3f(0.62, 0.74, 1.0), vec3f(0.8, 0.86, 1.0), t / 0.1); }
  else if (t < 0.7) { c = mix(vec3f(0.95, 0.96, 1.0), vec3f(1.0, 0.92, 0.8), (t - 0.1) / 0.6); }
  else { c = mix(vec3f(1.0, 0.82, 0.62), vec3f(1.0, 0.7, 0.48), (t - 0.7) / 0.3); }
  c = mix(vec3f(1.0), c, 0.7);
  return c / dot(c, vec3f(0.2126, 0.7152, 0.0722));
}
const GPOLE = vec3f(0.4226, 0.4540, -0.7845); const GCEN = vec3f(0.8660, 0.0, 0.5);
fn milky(d: vec3f) -> vec3f {
  let b = dot(d, GPOLE); let band = exp(-0.5 * b * b / 0.0144);
  if (band < 1e-3) { return vec3f(0.0); }
  let q = d * 4.0 + 50.0;
  let fb = 0.5 * vnoise(q * 1.5) + 0.3 * vnoise(q * 3.25) + 0.2 * vnoise(q * 7.25);
  let tw = 0.5 + 0.5 * dot(d, GCEN); let bulge = pow(tw, 6.0) * exp(-0.5 * b * b / 0.01);
  let wb = b + 0.035 * (vnoise(q * 2.25 + 1.3) - 0.5);
  let lane = 1.0 - 0.6 * exp(-0.5 * wb * wb / 0.0009) * (0.5 + 0.5 * vnoise(q * 4.25 + 5.1));
  let k = (band * (0.25 + 1.5 * fb * fb) * (0.6 + 0.6 * tw) + 0.5 * bulge) * lane;
  return k * mix(vec3f(0.9, 0.94, 1.0), vec3f(1.0, 0.92, 0.8), clamp(bulge * 3.0, 0.0, 1.0));
}
fn starField(rdw: vec3f, px: f32, sky: f32) -> vec3f {
  // the sky turns with the sun around the planet's axis (y)
  let ca = S.rot.x; let sa = S.rot.y;
  let d = vec3f(ca * rdw.x + sa * rdw.z, rdw.y, -sa * rdw.x + ca * rdw.z);
  let gain = S.rot.z / (1.0 + pow(max(sky * S.rot.w, 0.0), 2.5));
  let sig = clamp(0.75 * px, 1e-6, 0.25 * 1.5708 / f32(SC));
  if (gain * 0.04 * exp2(1.99) / (2.0 * PI * sig * sig) < 0.02 * sky) { return vec3f(0.0); }
  let fc = starFace(d); let f = u32(fc.x); let n = f32(SC);
  let c0 = vec2i(floor((fc.yz * 0.5 + 0.5) * n));
  let inv = 0.5 / (sig * sig); let nrm = 1.0 / (2.0 * PI * sig * sig);
  var acc = vec3f(0.0);
  for (var j = -1; j <= 1; j++) {
    for (var i = -1; i <= 1; i++) {
      let c = c0 + vec2i(i, j);
      if (any(c < vec2i(0)) || any(c >= vec2i(SC))) { continue; }
      let h = pcg(((f * u32(SC) + u32(c.y)) * u32(SC) + u32(c.x)) + 7u * 55296u);
      let h2 = pcg(h);
      let uv = (vec2f(c) + 0.1 + 0.8 * vec2f(f32(h2 & 0xffffu), f32(h2 >> 16u)) / 65536.0) / n * 2.0 - 1.0;
      let s = starDir(f, uv); let dd = d - s; let e = dot(dd, dd) * inv;
      if (e > 12.0) { continue; }
      let h3 = pcg(h2); let gb = dot(s, GPOLE);
      if (f32(h3 & 0xffffu) / 65536.0 > 0.7 + 0.3 * exp(-0.5 * gb * gb / 0.0625)) { continue; }
      let m = max(8.5 + 2.0 * log2(max(f32(h >> 8u) / 16777216.0, 1e-7)) * 0.30103, -1.5);
      acc += starColor(f32(h3 >> 16u) / 65536.0) * (exp2(-1.328771 * m) * exp(-e) * nrm);
    }
  }
  return (acc * 0.0015 + milky(d) * 0.00002) * gain;
}
struct Stars { rot: vec4f };
@group(1) @binding(2) var<uniform> S: Stars;
@group(1) @binding(3) var cloC: texture_2d<f32>;
@group(1) @binding(4) var cloT: texture_2d<f32>;
@fragment fn fs(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let px = vec2i(fc.xy);
  let base = textureLoad(cIn, px, 0);
  let depth = textureLoad(dIn, px, 0);
  let rd = viewRay(fc.xy);
  // under water: the water along the view, up to the surface (drawn) or the seabed
  if (O.mode.y > 0.0) {
    var dist = 1e5;
    if (depth > 0.0) { dist = F.fwd.w / depth / max(dot(rd, F.fwd.xyz), 1e-6); }
    return vec4f(underwater(base.rgb, rd, dist), 1.0);
  }
  let up = normalize(F.cam.xyz);
  let h0 = clamp(F.cam.w * 0.001 - rb(), 0.0, 1e9);
  let r0 = rb() + h0;
  let sun = F.sun.xyz; let nu = dot(rd, sun);
  let sky = depth <= 0.0;
  // the ray's start in the atmosphere (from outside: its entry point into the top sphere, OpenG ray_start)
  var sr = r0; var sh = h0; var smu = dot(rd, up); var smus = dot(up, sun); var st = 0.0; var hit = true;
  if (h0 >= thick()) {
    let pc = r0 * (up - rd * smu); let b = length(pc);
    if (smu >= 0.0 || b >= rt()) { hit = false; }
    else {
      let hc = sqrt((rt() - b) * (rt() + b)); let pe = pc - rd * hc;
      sr = rt(); sh = thick(); smu = -hc / rt(); smus = clamp(dot(pe, sun) / rt(), -1.0, 1.0); st = max(-r0 * dot(rd, up) - hc, 0.0);
    }
  }
  var disc = 0.0;
  if (sky) { disc = sunDisc(rd); }
  if (!hit) {
    var add = disc * A.sunI.xyz;
    if (sky) { add += starField(rd, F.misc.x, 0.0); }
    return vec4f(base.rgb + add, 1.0);
  }
  let tExit = distTop(sr, sh, smu); let tg = distGround(sr, sh, smu);
  var col: vec3f;
  if (!sky) {
    // depth = near / (forward distance)
    let tGeo = F.fwd.w / depth / max(dot(rd, F.fwd.xyz), 1e-6) * 0.001 - st;
    let tEnd = min(tGeo, tExit);
    if (tEnd <= 0.0) { return base; }
    let n = u32(clamp(ceil(4.0 + 4.0 * sqrt(tEnd / A.ozo.w)), 4.0, 20.0));
    let s = integrate(sr, sh, smu, smus, nu, 0.0, tEnd, n, false);
    col = base.rgb * s.tr + s.lum * A.sunI.xyz;
  } else {
    var lum: vec3f; var tr = vec3f(0.0);
    if (h0 < thick()) {
      let mu = dot(rd, up); let rh = rd - up * mu; let lh = length(rh);
      let sx = sun - up * dot(sun, up); let sl = length(sx);
      var lv = 1.0;
      if (lh > 1e-5 && sl > 1e-5) { lv = dot(rh / lh, sx / sl); }
      var uv = skyUV(h0, mu, lv);
      if (tg >= 0.0) {
        uv.y = min(uv.y, 0.5 - 0.5 / SSZ.y);
        tr = transTop(h0, -sqrt(max(h0 * (2.0 * rb() + h0), 0.0)) / r0 + 1e-4);
      } else { tr = transTop(h0, mu); }
      lum = textureSampleLevel(tSky, sLin, uv, 0.0).rgb;
    } else {
      var te = tExit; if (tg >= 0.0) { te = tg; }
      let s = integrate(sr, sh, smu, smus, nu, 0.0, te, 32u, false);
      lum = s.lum * A.sunI.xyz; if (tg < 0.0) { tr = s.tr; }
    }
    col = base.rgb * tr + lum + disc * A.sunI.xyz * tr;
    if (tg < 0.0) { col += starField(rd, F.misc.x, dot(lum, vec3f(0.2126, 0.7152, 0.0722))) * tr; }
  }
  // the clouds in front (OpenG): out = C Tc + T(0, tc) Lc + (1 - Tc) S(0, tc)
  let cuv = fc.xy * F.scr.zw;
  let cc = textureSampleLevel(cloC, sLin, cuv, 0.0);
  if (cc.a < 0.999) {
    let tc = max(textureSampleLevel(cloT, sLin, cuv, 0.0).x * 0.001 - st, 0.0);
    let s2 = integrate(sr, sh, smu, smus, nu, 0.0, tc, 8u, false);
    col = col * cc.a + s2.tr * cc.rgb + (1.0 - cc.a) * s2.lum * A.sunI.xyz;
  }
  return vec4f(col, 1.0);
}
`;
