// ============================================================================
// WGSL: the garden under the sea, 20 to 50 m deep (after Abyssal Garden's kelp, sea floor and fish)
// ============================================================================
// Kelp columns and tufts of sea grass are placed by the planet's lattice like the meadows; each column's leaves are
// rebuilt in the vertex shader from the column alone (instance = column x leaf), so nothing but the columns is
// stored. Fish swim in schools around anchors of a coarse lattice; two mantas glide over the garden.
const KLPC = 300, KLMAX = [2200, 1400, 700][LV], SGMAX = [70000, 45000, 20000][LV], SCHMAX = 48, FPS = 64;
const W_SEA_CS = /*wgsl*/`
struct Col { a: vec4f, b: vec4u };
struct Args { n: u32, count: atomic<u32>, first: u32, base: u32 };
@group(3) @binding(0) var<storage, read_write> KC: array<Col>;
@group(3) @binding(1) var<storage, read_write> SA: array<Args, 4>;
@group(3) @binding(2) var<storage, read_write> SG: array<Col>;
@group(3) @binding(3) var<storage, read_write> SC: array<Col>;
override LAYER: u32 = 0u;
// the garden lives between 18 and 55 m, thickest from 24 to 46 m
fn garden(depth: f32) -> f32 { return smoothstep(17.0, 24.0, depth) * (1.0 - smoothstep(46.0, 56.0, depth)); }
@compute @workgroup_size(64) fn main(@builtin(workgroup_id) w: vec3u, @builtin(local_invocation_index) li: u32) {
  let g = ground(w.x + w.y * 65535u, li, u32(LF.k2.w));
  if (!g.ok || g.h > -6.0) { return; }
  let depth = -g.h; let d = length(g.rel);
  let c = clamp(dot(g.n, g.up), 0.0, 1.0);
  let gd = garden(depth) * smoothstep(0.55, 0.75, c);
  if (LAYER == 0u) {
    // kelp forests in large patches, and schools of fish over the garden
    if (d < LF.k.x) {
      let patchy = smoothstep(0.42, 0.62, detail(1u, g.rel, 0.0) * 0.6 + detail(0u, g.rel + 50.0, 0.0) * 0.4);
      if (rnd(g.hash, 3u) < gd * patchy * 0.75 && inView(g.rel + g.up * 15.0, 25.0)) {
        let i = atomicAdd(&SA[0].count, 1u);
        if (i < ${KLMAX}u) { KC[i] = Col(vec4f(g.rel - g.up * 0.3, min(mix(12.0, 32.0, rnd(g.hash, 4u)), depth - 2.0)), vec4u(octEnc(g.up), g.hash, u32(rnd(g.hash, 5u) < 0.12), 0u)); }
      }
    }
  } else if (LAYER == 1u) {
    // tufts of sea grass and ground cover: green on the sand, magenta and violet around the rocks
    if (d < LF.k.z && rnd(g.hash, 3u) < gd * 0.55 * select(1.0, pow(LF.k.z * 0.3 / d, 1.3), d > LF.k.z * 0.3) && inView(g.rel, 2.0)) {
      let i = atomicAdd(&SA[1].count, 1u);
      if (i < ${SGMAX}u) {
        let mag = smoothstep(0.5, 0.7, detail(2u, g.rel + 13.0, 0.0));
        let r6 = rnd(g.hash, 6u);
        // green sea grass on the sand; soft corals (magenta, violet, red, teal) in the colourful patches
        let ty = select(select(1u, 7u, r6 < 0.25), select(select(5u, 3u, r6 < 0.4), select(6u, 7u, r6 < 0.85), r6 > 0.7), mag > 0.5);
        SG[i] = Col(vec4f(g.rel, (0.3 + 0.9 * rnd(g.hash, 4u)) * select(1.0, 1.6, mag > 0.5)), vec4u(octEnc(g.up), g.hash, ty, octEnc(g.n)));
      }
    }
  } else {
    // a school of fish over a cell, sometimes
    if (depth > 6.0 && d < LF.k.w && rnd(g.hash, 3u) < 0.8 * smoothstep(6.0, 14.0, depth)) {
      let i = atomicAdd(&SA[2].count, 1u);
      if (i < ${SCHMAX}u) { SC[i] = Col(vec4f(g.rel + g.up * mix(3.0, min(depth - 3.0, 14.0), rnd(g.hash, 4u)), 1.0), vec4u(octEnc(g.up), g.hash, 0u, 0u)); }
    }
  }
}
@compute @workgroup_size(1) fn fin() {
  atomicStore(&SA[0].count, min(atomicLoad(&SA[0].count), ${KLMAX}u) * ${KLPC}u);
  atomicStore(&SA[1].count, min(atomicLoad(&SA[1].count), ${SGMAX}u) * 6u);
  atomicStore(&SA[2].count, min(atomicLoad(&SA[2].count), ${SCHMAX}u) * ${FPS}u);
}
`;

// lighting under the water (any garden shader): the sun and the sky through the water above the point, the caustics,
// and the water along the view when the camera is above the sea
const W_WLIT = /*wgsl*/`
fn waterLit(alb: vec3f, n: vec3f, up: vec3f, rel: vec3f, trans: f32, foot: f32, glow: vec3f) -> vec3f {
  let depth = max(F.pl.x - length(F.cam.xyz + rel), 0.0);
  let w = surfLight(up, rel);
  let caus = mix(1.0, caustics(rel, w.lt, up, depth, foot), smoothstep(0.2, 0.7, dot(n, up)));
  let ndl = dot(n, w.lt);
  let sun = w.sun * exp(-w.k * depth) * caus;
  let back = (max(-ndl, 0.0) * 0.85 + 0.15) * trans;
  let lit = alb * (sun * (max(ndl, 0.0) + back) / PI + w.sky * exp(-w.k * depth * 0.8) * (0.55 + 0.45 * dot(n, up) * 0.5 + 0.3)) + glow;
  if (O.mode.y > 0.0) { return lit; }
  let ext = wExt();
  return lit * exp(-(ext - min(ext.r, min(ext.g, ext.b))) * viewPath(rel, up, depth));
}
`;

const W_SEA_DRAW = /*wgsl*/`
struct Col { a: vec4f, b: vec4u };
@group(3) @binding(0) var<storage, read> KC: array<Col>;
override ROWS: u32 = 7u;
override KIND: u32 = 0u; // 0 kelp, 1 sea grass
struct LO { @builtin(position) clip: vec4f, @location(0) rel: vec3f, @location(1) n: vec3f, @location(2) uv: vec2f,
  @location(3) @interpolate(flat) col: vec3f, @location(4) @interpolate(flat) pr: vec4f, @location(5) @interpolate(flat) sd: vec2f, @location(6) @interpolate(flat) spc: vec3f, @location(7) @interpolate(flat) up: vec3f };
fn pal(h: f32) -> vec3f {
  if (h < 0.3) { return vec3f(1.0, 0.62, 0.08); }
  if (h < 0.6) { return vec3f(0.12, 1.0, 0.22); }
  if (h < 0.8) { return vec3f(0.2, 0.85, 1.0); }
  return vec3f(1.0, 0.3, 0.8);
}
// the leaf: a curved ribbon (Abyssal Garden), in the local frame of its column (up = the local vertical)
@vertex fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> LO {
  var o: LO;
  let per = select(6u, ${KLPC}u, KIND == 0u);
  let cl = KC[ii / per]; let k = ii % per;
  let up = octDec(cl.b.x); let ch = cl.b.y; let t = LF.gust.x;
  let tA = normalize(cross(up, vec3f(0.31, 0.83, 0.47))); let tB = cross(up, tA);
  // the column: 2-4 strands winding up; leaves along them, more and longer at the bottom
  var base: vec3f; var len: f32; var yaw: f32; var tilt: f32; var wid: f32; var hA: f32; var ty: u32;
  let lh = pcg(ch ^ (k * 0x9E3779B9u));
  let s1 = rnd(lh, 1u); let s2 = rnd(lh, 2u);
  if (KIND == 0u) {
    let H = cl.a.w; let strands = 3u;
    let ph = rnd(ch, 1u) * 6.2831853; let tw = 0.1 + 0.18 * rnd(ch, 2u); let sr = 0.2 + 0.35 * rnd(ch, 3u); let sc = 0.75 + 0.5 * rnd(ch, 4u);
    let tt = pow(rnd(lh, 3u), 0.9); let h = tt * H; let s = f32(k % strands);
    let a = ph + s * 6.2831853 / f32(strands) + h * tw; let r = sr * (1.0 - 0.6 * h / H);
    base = cl.a.xyz + up * h + (tA * cos(a) + tB * sin(a)) * r;
    hA = h;
    if (k < 18u) { // the stems: long thin leaves standing up
      len = H / 6.0 + 0.5; base = cl.a.xyz + up * (f32(k / strands) * H / 6.0) + (tA * cos(a) + tB * sin(a)) * sr; yaw = a + 1.57; tilt = 0.08; wid = 0.12; ty = 1u;
    } else {
      len = ((0.55 + 0.75 * s1 * s2) * (1.0 - 0.5 * tt * tt) * sc + 0.25) * 1.15;
      yaw = rnd(lh, 4u) * 6.2831853; tilt = mix(0.4 + 0.6 * rnd(lh, 5u), 0.15 + 0.3 * rnd(lh, 5u), tt); wid = len * (0.15 + 0.06 * rnd(lh, 6u)) + 0.03;
      ty = select(0u, 4u, cl.b.z == 1u && rnd(lh, 7u) < 0.5);
    }
  } else {
    // a tuft of ribbons on the floor
    let a = rnd(lh, 3u) * 6.2831853; let r = rnd(lh, 4u) * 0.35;
    base = cl.a.xyz + (tA * cos(a) + tB * sin(a)) * r - up * 0.1;
    len = cl.a.w * (0.6 + 0.6 * rnd(lh, 5u)); yaw = a; tilt = 0.05 + 0.4 * rnd(lh, 6u); wid = len * 0.12 + 0.02; hA = 0.0; ty = cl.b.z;
  }
  let u = f32(vi & 1u) * 2.0 - 1.0; let v = sin(f32(vi >> 1u) / f32(ROWS - 1u) * 1.5708);
  let cy = cos(yaw); let sy = sin(yaw); let ct = cos(tilt); let st = sin(tilt);
  let d = normalize((tA * cy + tB * sy) * st + up * ct); let pe = normalize((tA * cy + tB * sy) * ct - up * st); let sd = -tA * sy + tB * cy;
  var col = vec3f(0.0); var pr = vec4f(0.0); var spc = vec3f(0.0); var shp = vec2f(0.75, 0.7); var wav = 1.0; var fls = 1.0;
  let hsel = rnd(lh, 9u);
  switch ty {
    case 0u { col = mix(vec3f(0.11, 0.125, 0.022), vec3f(0.04, 0.10, 0.04), s1); col = mix(col, vec3f(0.25, 0.17, 0.025), step(0.72, s2)); pr = vec4f(0.24, 0.9, 0.0, 0.0); spc = pal(hsel * 0.72); shp = vec2f(0.5, 0.32); wav = 1.9; }
    case 1u { col = vec3f(0.10, 0.11, 0.035); pr = vec4f(0.0, 0.2, 0.0, 0.0); shp = vec2f(0.05, 0.1); wav = 0.3; fls = 0.3; }
    case 3u { col = mix(vec3f(0.02, 0.05, 0.065), vec3f(0.05, 0.03, 0.08), s1); col = mix(col, vec3f(0.09, 0.03, 0.09), step(0.8, s2)); pr = vec4f(0.2, 0.85, 0.55, 0.02); spc = mix(vec3f(0.5, 0.35, 1.0), vec3f(0.2, 1.0, 0.7), step(0.6, hsel)); shp = vec2f(0.7, 0.6); wav = 2.4; }
    case 4u { col = mix(vec3f(0.30, 0.15, 0.02), vec3f(0.42, 0.25, 0.04), s1); pr = vec4f(0.2, 1.0, 0.1, 0.0); spc = vec3f(1.0, 0.85, 0.5); shp = vec2f(0.5, 0.4); wav = 1.8; }
    case 6u { col = mix(vec3f(0.80, 0.16, 0.16), vec3f(0.92, 0.36, 0.42), s1); pr = vec4f(0.06, 1.0, 0.0, 0.10); spc = vec3f(1.0, 0.5, 0.5); shp = vec2f(0.4, 0.3); wav = 2.0; }
    case 5u { col = mix(vec3f(0.85, 0.05, 0.40), vec3f(0.60, 0.10, 0.80), step(0.7, s1)); col = mix(col, vec3f(0.95, 0.25, 0.55), step(0.75, s2)); pr = vec4f(0.22, 0.8, 0.0, 0.30); spc = vec3f(1.0, 0.35, 0.8); shp = vec2f(0.6, 0.6); fls = 2.0; }
    default { col = mix(vec3f(0.05, 0.40, 0.36), vec3f(0.10, 0.52, 0.58), s1) * 0.5; pr = vec4f(0.1, 0.9, 0.2, 0.04); spc = vec3f(0.3, 1.0, 0.9); shp = vec2f(0.6, 0.5); }
  }
  pr.x = step(rnd(lh, 10u), pr.x);
  let kq0 = (rnd(lh, 11u) * 0.65 + 0.38 - 0.3) * 2.0 + sin(t * (0.8 + s1) * fls + s2 * 40.0 + hA * 0.25) * 0.10 * fls;
  let wph = v * (3.0 + 5.0 * s2) + s1 * 30.0 + t * 1.1;
  let wv = sin(wph) * 0.12 * wav;
  let kq = kq0 * 1.7; let ka = select(kq, 0.06, abs(kq) < 0.06);
  let sK = sin(ka * v); let cK = cos(ka * v);
  let c = base + len * (d * (sK / ka) + pe * ((1.0 - cK) / ka + wv * v));
  let sl = sK + wv + cos(wph) * 0.10 * wav * v * (3.0 + 5.0 * s2);
  let N = normalize(pe * cK - d * sl);
  let tw = (s1 - 0.5) * 2.4 * v + sin(t * 0.9 + s2 * 20.0) * 0.25 * v;
  let S = sd * cos(tw) + N * sin(tw); let N2 = N * cos(tw) - sd * sin(tw);
  let shape = pow(max(sin(3.14159 * pow(v, shp.x)), 0.0), shp.y);
  var p = c + S * (u * select(wid * 0.5 * shape, 0.09 * shape, ty == 1u));
  // the swell sways the whole column, more at the top
  let hs = hA + dot(p - base, up);
  let ph2 = dot(cl.a.xyz, vec3f(0.031, 0.017, 0.023));
  let am = 0.024 * pow(max(hs, 0.0), 1.25);
  p += (tA * (sin(t * 0.5 + ph2 + hs * 0.09) + 0.35 * sin(t * 1.3 + ph2 * 3.0 + hs * 0.3)) + tB * (cos(t * 0.37 + ph2 * 1.3 + hs * 0.07) + 0.35 * cos(t * 1.1 + ph2 * 2.0 + hs * 0.23))) * am;
  o.clip = F.vp * vec4f(p, 1.0); o.rel = p; o.n = normalize(N2 + S * u * 0.55); o.uv = vec2f(u, v);
  o.col = col; o.pr = pr; o.sd = vec2f(s1, s2); o.spc = spc; o.up = up;
  return o;
}
@fragment fn fs(i: LO, @builtin(front_facing) ff: bool) -> @location(0) vec4f {
  // never in the lens: within 1.6 m of the eye the leaves dissolve
  let dc = length(i.rel); if (dc < 1.6 && fract(sin(dot(i.clip.xy, vec2f(12.9898, 78.233))) * 43758.5) > smoothstep(0.6, 1.6, dc)) { discard; }
  var n = normalize(i.n); if (!ff) { n = -n; }
  let foot = length(i.rel) * F.misc.x;
  var alb = i.col * (0.72 + 0.28 * smoothstep(0.0, 0.25, abs(i.uv.x))) * mix(0.5, 1.12, i.uv.y);
  let ndv = clamp(dot(n, normalize(-i.rel)), 0.0, 1.0);
  let ir = 0.5 + 0.5 * cos(6.2831853 * (vec3f(0.0, 0.33, 0.67) + ndv * 1.1 + i.sd.x * 0.22 + i.uv.y * 0.5 + 0.55));
  alb = mix(alb, alb * 0.5 + ir * vec3f(0.15, 0.13, 0.30), i.pr.z * (1.0 - ndv) * 0.8);
  // sparkle: whole-leaf glints that twinkle slowly
  let tw = pow(0.5 + 0.5 * sin(LF.gust.x * (0.5 + i.sd.y * 1.4) + i.sd.x * 90.0), 5.0);
  let m = smoothstep(0.2, 0.0, abs(i.uv.y - (0.35 + 0.45 * i.sd.y))) * (1.0 - i.uv.x * i.uv.x);
  let glow = i.spc * i.pr.x * (0.1 + tw) * m * 0.035 + alb * i.pr.w * 0.02;
  return vec4f(waterLit(alb * 1.6, n, i.up, i.rel, i.pr.y, foot, glow), 1.0);
}
// ---- fish: schools milling around their anchor; a small body with a beating tail, built from the vertex index
struct FO { @builtin(position) clip: vec4f, @location(0) rel: vec3f, @location(1) n: vec3f, @location(2) @interpolate(flat) col: vec3f, @location(3) @interpolate(flat) up: vec3f, @location(4) side: f32 };
@vertex fn vsFish(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> FO {
  let sc = KC[ii / ${FPS}u]; let k = ii % ${FPS}u;
  let up = octDec(sc.b.x); let ch = sc.b.y; let t = LF.gust.x;
  let tA = normalize(cross(up, vec3f(0.31, 0.83, 0.47))); let tB = cross(up, tA);
  let fh = pcg(ch ^ (k * 0x9E3779B9u));
  // the school turns around its anchor; each fish keeps its place in it, with a little drift
  let rad = 3.0 + 4.0 * rnd(ch, 1u); let spd = (0.25 + 0.2 * rnd(ch, 2u)) * select(1.0, -1.0, rnd(ch, 3u) < 0.5);
  let ang = t * spd / rad * 3.0 + rnd(ch, 4u) * 6.28;
  let off = (vec3f(rnd(fh, 1u), rnd(fh, 2u), rnd(fh, 3u)) - 0.5) * vec3f(3.5, 1.4, 3.5);
  let wob = vec3f(sin(t * 0.7 + rnd(fh, 4u) * 6.28), sin(t * 0.9 + rnd(fh, 5u) * 6.28) * 0.4, cos(t * 0.8 + rnd(fh, 6u) * 6.28)) * 0.35;
  let ca = cos(ang + off.x * 0.08); let sa = sin(ang + off.x * 0.08);
  let ctr = sc.a.xyz + (tA * ca + tB * sa) * (rad + off.z) + up * (off.y + sin(t * 0.3 + rnd(ch, 5u) * 6.0) * 1.5) + wob;
  let fwd = normalize((-tA * sa + tB * ca) * sign(spd));
  let side = cross(up, fwd);
  // body: nose, back, belly, two flanks, tail fork (local x along the body)
  let L = 0.3 + 0.3 * rnd(ch, 6u);
  let P = array<vec3f, 7>(vec3f(0.5, 0.0, 0.0), vec3f(0.0, 0.17, 0.0), vec3f(0.0, -0.13, 0.0), vec3f(0.05, 0.0, 0.09), vec3f(-0.42, 0.0, 0.0), vec3f(-0.62, 0.17, 0.0), vec3f(-0.62, -0.17, 0.0));
  let IDX = array<u32, 24>(0u, 1u, 3u, 0u, 3u, 2u, 1u, 4u, 3u, 3u, 4u, 2u, 0u, 3u, 1u, 0u, 2u, 3u, 4u, 5u, 6u, 4u, 6u, 5u);
  let id = IDX[vi]; var q = P[id];
  let flip = select(1.0, -1.0, vi >= 12u && vi < 18u);
  q.z *= flip;
  // the tail beats
  let beat = sin(t * (9.0 + 3.0 * rnd(fh, 7u)) + rnd(fh, 8u) * 6.28) * 0.12 * smoothstep(0.1, -0.6, q.x);
  q.z += beat;
  let p = ctr + (fwd * q.x + up * q.y + side * q.z) * L;
  var o: FO;
  o.clip = F.vp * vec4f(p, 1.0); o.rel = p;
  o.n = normalize(up * q.y * 2.0 + side * (q.z + 0.05) * 3.0 + fwd * 0.2);
  let sp = rnd(ch, 7u);
  o.col = select(select(vec3f(0.55, 0.58, 0.62), vec3f(0.85, 0.65, 0.08), sp < 0.66), vec3f(0.12, 0.35, 0.85), sp < 0.33);
  o.up = up; o.side = q.y;
  return o;
}
@fragment fn fsFish(i: FO, @builtin(front_facing) ff: bool) -> @location(0) vec4f {
  var n = normalize(i.n); if (!ff) { n = -n; }
  // darker back, silver belly, a glint
  let alb = i.col * mix(1.15, 0.45, smoothstep(-0.05, 0.15, i.side));
  let spec = pow(max(dot(reflect(normalize(i.rel), n), i.up), 0.0), 12.0) * 0.4;
  return vec4f(waterLit(alb, n, i.up, i.rel, 0.1, 0.0, vec3f(0.0)) * (1.0 + spec), 1.0);
}
// ---- drifting particles (marine snow) around the camera under water, and rising bubbles
struct SO { @builtin(position) clip: vec4f, @location(0) uv: vec2f, @location(1) @interpolate(flat) col: vec3f };
@vertex fn vsSnow(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> SO {
  var o: SO;
  if (O.mode.y <= 0.0) { o.clip = vec4f(0.0, 0.0, 2.0, 1.0); return o; }
  // a 3D lattice of 3 m cells around the camera (anchored to the planet: the camera offset modulo the cell)
  let N = 14u; let cell = 3.0;
  let c = vec3f(f32(ii % N), f32((ii / N) % N), f32(ii / (N * N))) - f32(N) * 0.5;
  let base = F.norg[3].xyz * 4.1; // camera / 4.1 m, modulo 256: the drift is anchored to the planet
  let off = base - cell * floor(base / cell);
  let ci = vec3i(floor(base / cell) + c);
  let h = pcg((bitcast<u32>(ci.x) * 73856093u) ^ (bitcast<u32>(ci.y) * 19349663u) ^ (bitcast<u32>(ci.z) * 83492791u));
  let t = LF.gust.x;
  var p = (c + vec3f(rnd(h, 1u), rnd(h, 2u), rnd(h, 3u))) * cell - off;
  p += vec3f(sin(t * 0.2 + rnd(h, 4u) * 6.28), sin(t * 0.15 + rnd(h, 5u) * 6.28), cos(t * 0.17 + rnd(h, 6u) * 6.28)) * 0.4;
  let q = vec2f(f32(vi & 1u), f32(vi >> 1u)) * 2.0 - 1.0;
  let d = length(p);
  let sz = 0.012 + 0.012 * rnd(h, 7u);
  o.clip = F.vp * vec4f(p + (F.right.xyz * q.x + F.up.xyz * q.y) * max(sz, d * 0.0012), 1.0);
  o.uv = q;
  let w = surfLight(normalize(F.cam.xyz), vec3f(0.0));
  o.col = (w.sun * 0.05 + w.sky * 0.3) * exp(-w.k * O.mode.y) * exp(-wExt() * d) * smoothstep(0.3, 1.5, d) * (1.0 - smoothstep(16.0, 21.0, d)) * 0.6;
  return o;
}
@fragment fn fsSnow(i: SO) -> @location(0) vec4f {
  let r = dot(i.uv, i.uv); if (r > 1.0) { discard; }
  return vec4f(i.col * exp(-r * 3.0), 0.0);
}
`;
