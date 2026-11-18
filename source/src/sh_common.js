// ============================================================================
// WGSL shared by every pass: the frame uniform, the relief noise, helpers
// ============================================================================
// Camera-relative rendering: every position a shader sees is relative to the camera (computed in f64 on the CPU),
// the view-projection has no translation; reversed-Z with an infinite far plane.
const W_FRAME = /*wgsl*/`
struct Frame {
  vp: mat4x4f,
  right: vec4f,   // camera right, w: tan of the half horizontal field of view
  up: vec4f,      // camera up, w: tan of the half vertical field of view
  fwd: vec4f,     // camera forward, w: near plane (m)
  cam: vec4f,     // camera, body frame (m), w: distance to the centre
  sun: vec4f,     // unit direction to the sun (body frame), w: time (s)
  pl: vec4f,      // x: radius R, y: top of the atmosphere, z: relief bound, w: shelf depth
  nz: vec4f,      // relief noise: lambda0, A0, gain, octaves
  nz2: vec4f,     // sea offset, shelf width, coastal plain, morph range
  scr: vec4f,     // render size, 1 / size
  misc: vec4f,    // x: pixel angle (rad), y: exposure, z: level, w: frame number
  norg: array<vec4f, 4>, // origins of the detail noise octaves (camera / scale, modulo the period)
  sunc: vec4f,    // sun radiance at the camera (rgb), w: sun disc visibility
  wind: vec4f,    // xyz: wind direction (body frame, tangent at the camera), w: strength
  csx: vec4f,     // cloud shadow map: sun-space x axis, w: 1 / half extent (m)
  csy: vec4f,     // sun-space y axis
};
@group(0) @binding(0) var<uniform> F: Frame;
@group(0) @binding(1) var<storage, read> PERM: array<u32, 512>;
const PI = 3.14159265;
`;

const W_NOISE = /*wgsl*/`
const GRAD = array<vec3f, 12>(vec3f(1, 1, 0), vec3f(-1, 1, 0), vec3f(1, -1, 0), vec3f(-1, -1, 0), vec3f(1, 0, 1), vec3f(-1, 0, 1),
  vec3f(1, 0, -1), vec3f(-1, 0, -1), vec3f(0, 1, 1), vec3f(0, -1, 1), vec3f(0, 1, -1), vec3f(0, -1, -1));
const REACH = array<vec3i, 14>(vec3i(-1, 0, 0), vec3i(0, -1, 0), vec3i(0, 0, -1), vec3i(0, 0, 0), vec3i(0, 0, 1), vec3i(0, 1, 0),
  vec3i(0, 1, 1), vec3i(1, 0, 0), vec3i(1, 0, 1), vec3i(1, 1, 0), vec3i(1, 1, 1), vec3i(1, 1, 2), vec3i(1, 2, 1), vec3i(2, 1, 1));
// simplex 3D, continuous kernel (OpenG): the 14 lattice corners within reach
fn snoise(p: vec3f) -> f32 {
  let s = (p.x + p.y + p.z) / 3.0;
  let b = vec3i(floor(p + s));
  var n = 0.0;
  for (var c = 0; c < 14; c++) {
    let q = b + REACH[c];
    let t = f32(q.x + q.y + q.z) / 6.0;
    let d = p - (vec3f(q) - t);
    var w = 0.6 - dot(d, d);
    if (w > 0.0) {
      w *= w;
      let g = PERM[u32(q.x & 255) + PERM[u32(q.y & 255) + PERM[u32(q.z & 255)]]] % 12u;
      n += w * w * dot(GRAD[g], d);
    }
  }
  return n * 32.0;
}
fn shape(h: f32) -> f32 {
  if (h >= 0.0) { return h * h / (h + F.nz2.z); }
  let d = -h;
  let u = 1.0 - min(d / F.nz2.y, 1.0);
  return -(F.pl.w * (1.0 - u * u * u) + max(d - F.nz2.y, 0.0) * 1.6);
}
// height above the sea (m) at unit direction dir, octaves down to wavelength 2 mw
fn height(dir: vec3f, mw: f32) -> f32 {
  var sum = 0.0; var amp = F.nz.y; var wave = F.nz.x; var w = 1.0;
  let oct = i32(F.nz.w);
  for (var i = 0; i < oct; i++) {
    if (mw > 0.0 && wave < mw * 2.0) { break; }
    var n = snoise(dir * (F.pl.x / wave));
    if (i >= 2) { let r = (1.0 - abs(n)) * (1.0 - abs(n)); n = (r * 2.0 - 1.0) * w; w = clamp(r, 0.0, 1.0); }
    sum += n * amp; amp *= F.nz.z; wave *= 0.5;
  }
  return shape(sum - F.nz2.x);
}

// octahedral normal encoding (one u32)
fn octEnc(n: vec3f) -> u32 {
  var p = n.xy / (abs(n.x) + abs(n.y) + abs(n.z));
  if (n.z < 0.0) { p = (1.0 - abs(p.yx)) * select(vec2f(-1.0), vec2f(1.0), p >= vec2f(0.0)); }
  return pack2x16snorm(p);
}
fn octDec(u: u32) -> vec3f {
  let p = unpack2x16snorm(u);
  var n = vec3f(p, 1.0 - abs(p.x) - abs(p.y));
  let t = max(-n.z, 0.0);
  n = vec3f(n.xy + select(vec2f(t), vec2f(-t), n.xy >= vec2f(0.0)), n.z);
  return normalize(n);
}

// periodic value noise (Hoskins hash on the lattice index modulo 256), in [0, 1]
fn hash13(i: vec3f) -> f32 {
  let w = i - 256.0 * floor(i / 256.0);
  var q = fract(w * 0.1031);
  q += dot(q, q.zyx + 31.32);
  return fract((q.x + q.y) * q.z);
}
fn vnoise(p: vec3f) -> f32 {
  let i = floor(p); let f = p - i; let u = f * f * (3.0 - 2.0 * f);
  let a = mix(hash13(i), hash13(i + vec3f(1, 0, 0)), u.x);
  let b = mix(hash13(i + vec3f(0, 1, 0)), hash13(i + vec3f(1, 1, 0)), u.x);
  let c = mix(hash13(i + vec3f(0, 0, 1)), hash13(i + vec3f(1, 0, 1)), u.x);
  let d = mix(hash13(i + vec3f(0, 1, 1)), hash13(i + vec3f(1, 1, 1)), u.x);
  return mix(mix(a, b, u.y), mix(c, d, u.y), u.z);
}
// detail noise octave k (wavelength DSC[k] m) at the camera-relative point rel, faded to 0.5 once a pixel covers a
// good part of it (no shimmer far away)
const DSC = array<f32, 4>(900.0, 140.0, 23.0, 4.1);
fn detail(k: u32, rel: vec3f, foot: f32) -> f32 {
  let fade = 1.0 - smoothstep(0.1, 0.35, foot / DSC[k]);
  if (fade <= 0.0) { return 0.5; }
  return mix(0.5, vnoise(F.norg[k].xyz + rel / DSC[k]), fade);
}
fn hash11(n: u32) -> f32 {
  var x = n * 747796405u + 2891336453u;
  x = ((x >> ((x >> 28u) + 4u)) ^ x) * 277803737u;
  return f32((x >> 22u) ^ x) / 4294967296.0;
}
fn pcg(n: u32) -> u32 {
  var x = n * 747796405u + 2891336453u;
  x = ((x >> ((x >> 28u) + 4u)) ^ x) * 277803737u;
  return (x >> 22u) ^ x;
}
`;
