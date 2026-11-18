// ============================================================================
// WGSL: life in the air: flocks of birds, gliding raptors, butterflies, pollen in the sunbeams, fireflies at dusk
// ============================================================================
// No simulation: each animal's path is a function of its anchor (a cell of a coarse lattice, placed by the same
// compute as the plants) and of the time.
const FLMAX = 40, BPF = 18, RPMAX = 6, BFMAX = 400;
const W_FAUNA_CS = /*wgsl*/`
struct Col { a: vec4f, b: vec4u };
struct Args { n: u32, count: atomic<u32>, first: u32, base: u32 };
@group(3) @binding(0) var<storage, read_write> FLK: array<Col>;
@group(3) @binding(1) var<storage, read_write> FA: array<Args, 4>;
@group(3) @binding(2) var<storage, read_write> RAP: array<Col>;
@group(3) @binding(3) var<storage, read_write> BFL: array<Col>;
override LAYER: u32 = 0u;
@compute @workgroup_size(64) fn main(@builtin(workgroup_id) w: vec3u, @builtin(local_invocation_index) li: u32) {
  let g = ground(w.x + w.y * 65535u, li, u32(LF.k2.w));
  if (!g.ok || g.h < 0.5) { return; }
  let d = length(g.rel);
  let b = biome(g.h, g.n, g.up, g.rel);
  if (LAYER == 0u) { // flocks over the land and the shore
    if (d < LF.k.x && rnd(g.hash, 3u) < 0.35) {
      let i = atomicAdd(&FA[0].count, 1u);
      if (i < ${FLMAX}u) { FLK[i] = Col(vec4f(g.rel + g.up * (25.0 + 50.0 * rnd(g.hash, 4u)), 1.0), vec4u(octEnc(g.up), g.hash, 0u, 0u)); }
    }
  } else if (LAYER == 1u) { // a raptor high over the hills
    if (d < LF.k.z && rnd(g.hash, 3u) < 0.5 && g.h > 15.0) {
      let i = atomicAdd(&FA[1].count, 1u);
      if (i < ${RPMAX}u) { RAP[i] = Col(vec4f(g.rel + g.up * (90.0 + 80.0 * rnd(g.hash, 4u)), 1.0), vec4u(octEnc(g.up), g.hash, 0u, 0u)); }
    }
  } else { // butterflies over the flowery meadows
    if (d < LF.k.w && rnd(g.hash, 3u) < b.x * 0.22 * smoothstep(0.5, 0.75, detail(2u, g.rel + 31.0, 0.0)) && inView(g.rel, 4.0)) {
      let i = atomicAdd(&FA[2].count, 1u);
      if (i < ${BFMAX}u) { BFL[i] = Col(vec4f(g.rel, 1.0), vec4u(octEnc(g.up), g.hash, 0u, 0u)); }
    }
  }
}
@compute @workgroup_size(1) fn fin() {
  atomicStore(&FA[0].count, min(atomicLoad(&FA[0].count), ${FLMAX}u) * ${BPF}u);
  atomicStore(&FA[1].count, min(atomicLoad(&FA[1].count), ${RPMAX}u));
  atomicStore(&FA[2].count, min(atomicLoad(&FA[2].count), ${BFMAX}u));
}
`;
const W_FAUNA_DRAW = /*wgsl*/`
struct Col { a: vec4f, b: vec4u };
@group(3) @binding(0) var<storage, read> AN: array<Col>;
override KIND: u32 = 0u; // 0 bird of a flock, 1 raptor, 2 butterfly
struct BO { @builtin(position) clip: vec4f, @location(0) rel: vec3f, @location(1) n: vec3f, @location(2) uv: vec2f, @location(3) @interpolate(flat) col: vec3f, @location(4) @interpolate(flat) up: vec3f };
@vertex fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> BO {
  let per = select(1u, ${BPF}u, KIND == 0u);
  let an = AN[ii / per]; let k = ii % per;
  let up = octDec(an.b.x); let ah = an.b.y; let t = LF.gust.x;
  let tA = normalize(cross(up, vec3f(0.31, 0.83, 0.47))); let tB = cross(up, tA);
  let bh = pcg(ah ^ (k * 0x9E3779B9u));
  var ctr: vec3f; var fwd: vec3f; var span: f32; var flap: f32; var bank = 0.0; var col: vec3f;
  if (KIND == 2u) {
    // a butterfly: flutters around its flower, 0.4 to 1.6 m above the grass
    let ph = rnd(ah, 1u) * 6.28;
    let q = vec3f(sin(t * 0.7 + ph) + 0.4 * sin(t * 1.9 + ph * 2.0), 0.0, cos(t * 0.53 + ph) + 0.4 * cos(t * 1.7 + ph)) * 1.6;
    ctr = an.a.xyz + tA * q.x + tB * q.z + up * (0.9 + 0.5 * sin(t * 1.3 + ph) + 0.15 * sin(t * 9.0 + ph));
    fwd = normalize(tA * (cos(t * 0.7 + ph) * 0.7) - tB * (sin(t * 0.53 + ph) * 0.53) + up * 0.05);
    span = 0.05; flap = sin(t * 26.0 + ph);
    let c = rnd(ah, 2u);
    col = select(select(vec3f(0.95, 0.92, 0.85), vec3f(0.98, 0.5, 0.05), c < 0.6), vec3f(0.15, 0.4, 0.95), c < 0.25);
  } else {
    // birds circle their anchor; a flock keeps loosely together, a raptor glides in wide rings
    let rad = select(22.0 + 30.0 * rnd(ah, 1u), 70.0 + 60.0 * rnd(ah, 1u), KIND == 1u);
    let spd = select(11.0, 7.0, KIND == 1u) * select(1.0, -1.0, rnd(ah, 2u) < 0.5);
    let ang = t * spd / rad + rnd(ah, 3u) * 6.28;
    var off = vec3f(0.0);
    if (KIND == 0u) { off = (vec3f(rnd(bh, 1u), rnd(bh, 2u), rnd(bh, 3u)) - 0.5) * vec3f(9.0, 4.0, 9.0) + vec3f(sin(t * 0.6 + rnd(bh, 4u) * 6.0), sin(t * 0.8 + rnd(bh, 5u) * 6.0), cos(t * 0.7 + rnd(bh, 6u) * 6.0)) * 1.5; }
    let ca = cos(ang); let sa = sin(ang);
    ctr = an.a.xyz + (tA * ca + tB * sa) * (rad + off.x) + up * (off.y + 6.0 * sin(t * 0.13 + rnd(ah, 4u) * 6.0)) + (tB * ca - tA * sa) * off.z * 0.3;
    fwd = normalize((-tA * sa + tB * ca) * sign(spd));
    span = select(0.32, 0.95, KIND == 1u);
    // flapping with glides; the raptor mostly soars
    let fl = sin(t * select(13.0, 4.0, KIND == 1u) + rnd(bh, 7u) * 6.28);
    let glide = smoothstep(0.2, 0.6, sin(t * 0.35 + rnd(bh, 8u) * 6.28));
    flap = mix(fl, 0.15, select(glide, 0.85, KIND == 1u));
    bank = 0.35 * sign(spd);
    col = select(vec3f(0.06, 0.055, 0.05), vec3f(0.18, 0.12, 0.07), KIND == 1u);
  }
  var side = normalize(cross(up, fwd));
  let upb = normalize(up * cos(bank) + side * sin(bank)); side = normalize(cross(upb, fwd));
  // 4 triangles: body, tail, two wings (raised by the flap)
  let W = array<vec3f, 12>(vec3f(0.5, 0.0, 0.0), vec3f(-0.3, 0.02, 0.07), vec3f(-0.3, 0.02, -0.07), vec3f(-0.25, 0.0, 0.0), vec3f(-0.6, 0.0, 0.14), vec3f(-0.6, 0.0, -0.14),
    vec3f(0.15, 0.0, 0.0), vec3f(-0.15, 0.0, 0.0), vec3f(-0.05, 0.0, 1.0), vec3f(0.15, 0.0, 0.0), vec3f(-0.05, 0.0, -1.0), vec3f(-0.15, 0.0, 0.0));
  var q = W[vi];
  var uv = vec2f(0.0);
  if (KIND == 2u) {
    // two wings each made of two triangles (a quad), hinged on the body
    let s = select(1.0, -1.0, vi >= 6u); let c = vi % 6u;
    let Q = array<vec2f, 6>(vec2f(0.0, 0.0), vec2f(1.0, 0.0), vec2f(1.0, 1.0), vec2f(0.0, 0.0), vec2f(1.0, 1.0), vec2f(0.0, 1.0));
    uv = Q[c];
    let a = flap * 1.1;
    q = vec3f((uv.y - 0.5) * 1.1, sin(a) * uv.x, cos(a) * uv.x * s);
  } else if (vi >= 6u) {
    let wing = q.z; q.y += flap * abs(wing) * 0.55; q.z = wing * (1.0 - 0.25 * abs(flap));
  }
  let p = ctr + (fwd * q.x + upb * q.y + side * q.z) * span * select(1.6, 1.0, KIND == 2u);
  var o: BO;
  o.clip = F.vp * vec4f(p, 1.0); o.rel = p; o.n = upb; o.uv = uv; o.col = col; o.up = up;
  return o;
}
@fragment fn fs(i: BO) -> @location(0) vec4f {
  var alb = i.col;
  if (KIND == 2u) {
    // a wing: rounded, darker veins and rim
    let r = length((i.uv - vec2f(0.1, 0.5)) * vec2f(1.0, 1.5)); if (r > 0.95) { discard; }
    alb = mix(alb, vec3f(0.03), smoothstep(0.75, 0.9, r) + 0.6 * smoothstep(0.92, 1.0, fract(i.uv.y * 4.0)));
  }
  let up = normalize(i.up);
  let cs = cloudShadow(i.rel);
  let sun = sunAt(up, 50.0) * cs.x; let sky = skyIrr(up, 50.0) * (0.45 + 0.55 * cs.y);
  let ndl = abs(dot(normalize(i.n), F.sun.xyz));
  return vec4f(alb * (sun * (ndl * 0.8 + 0.2) / PI + sky / PI), 1.0);
}
// pollen and seeds in the air around the camera: they show where the sun gets through (the god rays' light)
struct PO2 { @builtin(position) clip: vec4f, @location(0) uv: vec2f, @location(1) @interpolate(flat) col: vec3f };
@vertex fn vsPollen(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> PO2 {
  var o: PO2;
  let cu = normalize(F.cam.xyz);
  if (O.mode.y > 0.0 || F.cam.w - F.pl.x > 300.0) { o.clip = vec4f(0.0, 0.0, 2.0, 1.0); return o; }
  let N = 12u; let cell = 2.5;
  let c = vec3f(f32(ii % N), f32((ii / N) % N), f32(ii / (N * N))) - f32(N) * 0.5;
  let base = F.norg[3].xyz * 4.1;
  let ci = vec3i(floor(base / cell) + c);
  let h = pcg((bitcast<u32>(ci.x) * 73856093u) ^ (bitcast<u32>(ci.y) * 19349663u) ^ (bitcast<u32>(ci.z) * 83492791u));
  let t = LF.gust.x;
  var p = (c + vec3f(rnd(h, 1u), rnd(h, 2u), rnd(h, 3u))) * cell - (base - cell * floor(base / cell));
  p += LF.wind.xyz * (fract(t * 0.05 + rnd(h, 4u)) - 0.5) * cell * 2.0 + vec3f(sin(t * 0.4 + rnd(h, 5u) * 6.28), sin(t * 0.3 + rnd(h, 6u) * 6.28), cos(t * 0.35 + rnd(h, 7u) * 6.28)) * 0.3;
  let d = length(p);
  let q = vec2f(f32(vi & 1u), f32(vi >> 1u)) * 2.0 - 1.0;
  let sz = max(0.006 + 0.008 * rnd(h, 8u), d * 0.0011);
  o.clip = F.vp * vec4f(p + (F.right.xyz * q.x + F.up.xyz * q.y) * sz, 1.0); o.uv = q;
  // lit only in the sun (shadow cascades), most when looking toward it
  var vis = 1.0;
  let qs = F.shm[0] * vec4f(p, 1.0); let uv = vec2f(qs.x * 0.5 + 0.5, 0.5 - qs.y * 0.5);
  if (all(uv > vec2f(0.0)) && all(uv < vec2f(1.0))) { vis = textureSampleCompareLevel(tShadow, sCmp, uv, 0, qs.z - 0.001); }
  let ph = pow(max(dot(normalize(p), F.sun.xyz), 0.0), 6.0) * 3.0 + 0.15;
  o.col = sunAt(cu, 2.0) * vis * ph * 0.0018 * (sz * sz) / (sz * sz + d * d * 1e-6) * smoothstep(0.4, 1.5, d) * (1.0 - smoothstep(11.0, 15.0, d)) * rnd(h, 9u);
  return o;
}
@fragment fn fsPollen(i: PO2) -> @location(0) vec4f { let r = dot(i.uv, i.uv); if (r > 1.0) { discard; } return vec4f(i.col * exp(-r * 4.0), 0.0); }
// fireflies at dusk: from the grass pass (they know the ground), hovering and blinking
@vertex fn vsFirefly(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> PO2 {
  var o: PO2;
  let an = AN[ii]; let up = octDec(an.b.x); let h = an.b.y; let t = LF.gust.x;
  let dusk = 1.0 - smoothstep(-0.1, -0.01, dot(normalize(F.cam.xyz), F.sun.xyz));
  if (dusk <= 0.0) { o.clip = vec4f(0.0, 0.0, 2.0, 1.0); return o; }
  let tA = normalize(cross(up, vec3f(0.31, 0.83, 0.47))); let tB = cross(up, tA);
  let ph = rnd(h, 1u) * 6.28;
  let p = an.a.xyz + up * (0.5 + 0.8 * rnd(h, 2u) + 0.3 * sin(t * 0.7 + ph)) + (tA * sin(t * 0.3 + ph) + tB * cos(t * 0.23 + ph * 1.7)) * 0.8;
  let q = vec2f(f32(vi & 1u), f32(vi >> 1u)) * 2.0 - 1.0;
  let d = length(p); let sz = max(0.02, d * 0.0018);
  o.clip = F.vp * vec4f(p + (F.right.xyz * q.x + F.up.xyz * q.y) * sz, 1.0); o.uv = q;
  let blink = pow(0.5 + 0.5 * sin(t * (1.2 + rnd(h, 3u)) + ph * 3.0), 8.0);
  o.col = vec3f(0.55, 1.0, 0.2) * blink * dusk * 0.06 * (0.02 * 0.02) / (sz * sz);
  return o;
}
`;
