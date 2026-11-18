// ============================================================================
// WGSL: what grows and lives (lots L5, L6)
// ============================================================================
// Vegetation streams around the camera from a lattice anchored to the planet (OpenG GrassField): every frame a
// compute pass walks the cells of a cube-face lattice of fixed depth over the drawn patches near the camera; the
// cell's hash places one candidate, which is set on the patch's morphed triangles (the surface as drawn), then
// lives or not (biome rules, distance, frustum). The same cell gives the same plant whatever the LOD of the ground.
const W_VEG = /*wgsl*/`
struct Job { draw: u32, face: u32, lv: u32, ix: u32, iy: u32, sh: i32, rx: u32, ry: u32, rw: u32, rh: u32, tile0: u32, tilesW: u32 };
struct Life {
  wind: vec4f,    // wind direction (body frame, horizontal at the camera), w: strength (m/s)
  gust: vec4f,    // x: time (s, wrapped), y: camera along the wind modulo the gust wavelength (m), z: gust wavelength (m), w: tiles
  planes: array<vec4f, 4>, // frustum side planes (camera-relative, normals inward)
  k: vec4f,       // x: grass radius (m), y: grass density (/m2), z: flower radius, w: prop radius
  k2: vec4f,      // x: tree radius (m), y: jobs, z: level, w: seed
};
@group(2) @binding(0) var<uniform> LF: Life;
@group(2) @binding(1) var<storage, read> JOBS: array<Job>;
fn rnd(h: u32, k: u32) -> f32 { return f32(pcg(h ^ (k * 0x9E3779B9u)) >> 8u) / 16777216.0; }
fn inView(c: vec3f, r: f32) -> bool {
  for (var i = 0u; i < 4u; i++) { if (dot(LF.planes[i].xyz, c) < -r) { return false; } }
  return true;
}
struct Ground { rel: vec3f, up: vec3f, n: vec3f, h: f32, ok: bool, hash: u32 };
fn gvert(pt: Patch, i: u32) -> TV {
  let v = V[u32(pt.info.x) * ${NV}u + i];
  let m = morph(length(pt.crel.xyz + v.p.xyz), pt.crel.w, F.nz2.w);
  var o: TV;
  o.pos = v.p.xyz + v.d.xyz * m; o.h = v.p.w + v.d.w * m; o.nrm = normalize(mix(octDec(v.n.x), octDec(v.n.y), m));
  return o;
}
// the candidate of a lattice cell set on the drawn surface of its patch
fn ground(wg: u32, li: u32, seed: u32) -> Ground {
  var g: Ground; g.ok = false;
  let tiles = u32(LF.gust.w);
  if (wg >= tiles) { return g; }
  // the job of this tile: the last one whose first tile is <= wg
  var lo = 0u; var hi = u32(LF.k2.y);
  loop { if (hi - lo <= 1u) { break; } let mid = (lo + hi) / 2u; if (JOBS[mid].tile0 <= wg) { lo = mid; } else { hi = mid; } }
  let j = JOBS[lo];
  let t = wg - j.tile0;
  let cx = (t % j.tilesW) * 8u + (li % 8u); let cy = (t / j.tilesW) * 8u + (li / 8u);
  if (cx >= j.rw || cy >= j.rh) { return g; }
  // global cell indices of the lattice
  var gx: u32; var gy: u32;
  if (j.sh >= 0) { gx = (j.ix << u32(j.sh)) + j.rx + cx; gy = (j.iy << u32(j.sh)) + j.ry + cy; }
  else { gx = j.ix >> u32(-j.sh); gy = j.iy >> u32(-j.sh); }
  let h = pcg(gx ^ pcg(gy ^ pcg((j.face * 0x68E31DA4u) ^ seed)));
  g.hash = h;
  let jx = rnd(h, 1u); let jy = rnd(h, 2u);
  // the candidate in the patch's grid (0..32), from integers (exact)
  var u: f32; var v: f32;
  if (j.sh >= 0) { let k = 32.0 / f32(1u << u32(j.sh)); u = (f32(j.rx + cx) + jx) * k; v = (f32(j.ry + cy) + jy) * k; }
  else { let s = f32(1u << u32(-j.sh)); u = (f32(i32(gx << u32(-j.sh)) - i32(j.ix)) + jx * s) * 32.0; v = (f32(i32(gy << u32(-j.sh)) - i32(j.iy)) + jy * s) * 32.0; }
  if (u < 0.0 || v < 0.0 || u >= 32.0 || v >= 32.0) { return g; }
  let pt = PT[j.draw];
  let i0 = u32(u); let j0 = u32(v); let fx = u - f32(i0); let fy = v - f32(j0);
  let ia = (j0 + 1u) * 35u + i0 + 1u;
  let a = gvert(pt, ia); let d = gvert(pt, ia + 36u);
  var p: vec3f; var n: vec3f; var hh: f32;
  // the very triangles the terrain draws: (a, b, d) and (a, d, c)
  if (fx >= fy) { let b = gvert(pt, ia + 1u); p = a.pos * (1.0 - fx) + b.pos * (fx - fy) + d.pos * fy; n = a.nrm * (1.0 - fx) + b.nrm * (fx - fy) + d.nrm * fy; hh = a.h * (1.0 - fx) + b.h * (fx - fy) + d.h * fy; }
  else { let c = gvert(pt, ia + 35u); p = a.pos * (1.0 - fy) + c.pos * (fy - fx) + d.pos * fx; n = a.nrm * (1.0 - fy) + c.nrm * (fy - fx) + d.nrm * fx; hh = a.h * (1.0 - fy) + c.h * (fy - fx) + d.h * fx; }
  g.rel = pt.crel.xyz + p; g.up = normalize(pt.cbody.xyz + p); g.n = normalize(n); g.h = hh; g.ok = true;
  return g;
}
// the ground's biome at a point, as groundAlbedo paints it: x meadow (grass), y forest, z beach / sand, w rock
fn biome(h: f32, n: vec3f, up: vec3f, rel: vec3f) -> vec4f {
  let foot = 0.0;
  let c = clamp(dot(n, up), 0.0, 1.0); let slope = sqrt(max(1.0 - c * c, 0.0));
  let n0 = detail(0u, rel, foot); let n1 = detail(1u, rel, foot); let n2 = detail(2u, rel, foot);
  let a = h / F.pl.z + (n0 - 0.5) * 0.08 + (n1 - 0.5) * 0.03;
  let beachTop = 1.6 + n1 * 2.2;
  let sand = 1.0 - smoothstep(beachTop - 0.6, beachTop + 0.6, h);
  let rock = max(smoothstep(0.42, 0.62, slope + (n2 - 0.5) * 0.25), smoothstep(0.55, 0.7, a));
  let forest = smoothstep(0.52, 0.66, n0 + (n2 - 0.5) * 0.2) * (1.0 - smoothstep(0.35, 0.5, a));
  let green = (1.0 - sand) * (1.0 - rock) * (1.0 - smoothstep(0.55, 0.75, a));
  return vec4f(green * (1.0 - forest), green * forest, sand, rock);
}
`;

// ---- grass and flowers: placement (capacities per level)
const MAXB = [900000, 600000, 260000][LV], MAXF = [60000, 40000, 16000][LV], FFMAX = 3000;
const W_GRASS_CS = /*wgsl*/`
struct Blade { a: vec4f, b: vec4u };
struct Args { n: u32, count: atomic<u32>, first: u32, base: u32 };
@group(3) @binding(0) var<storage, read_write> BL: array<Blade>;
@group(3) @binding(1) var<storage, read_write> ARGS: array<Args, 3>;
@group(3) @binding(2) var<storage, read_write> FL: array<Blade>;
@group(3) @binding(3) var<storage, read_write> FF: array<Blade>;
const MAXB = ${MAXB}u; const MAXF = ${MAXF}u;
@compute @workgroup_size(64) fn main(@builtin(workgroup_id) w: vec3u, @builtin(local_invocation_index) li: u32) {
  let g = ground(w.x + w.y * 65535u, li, u32(LF.k2.w));
  if (!g.ok || g.h < 0.25) { return; }
  let d = length(g.rel);
  let R0 = LF.k.x;
  if (d > R0 || !inView(g.rel, 1.2)) { return; }
  let b = biome(g.h, g.n, g.up, g.rel);
  let grass = b.x + b.y * 0.35;
  // the Delphi distance LOD: all of it up close, then thinning; far blades get wider to keep the cover
  let near = R0 * 0.22;
  let keep = select(1.0, pow(near / d, 1.6), d > near) * smoothstep(R0, R0 * 0.8, d);
  let tall = smoothstep(0.35, 0.7, detail(1u, g.rel, 0.0) * 0.7 + detail(2u, g.rel, 0.0) * 0.3);
  if (rnd(g.hash, 3u) < grass * keep) {
    let i = atomicAdd(&ARGS[0].count, 1u);
    if (i < MAXB) {
      let hgt = mix(0.25, 0.95, tall) * (0.6 + 0.6 * rnd(g.hash, 4u)) * smoothstep(R0, R0 * 0.7, d);
      let wide = 1.0 / sqrt(max(keep, 0.02));
      BL[i].a = vec4f(g.rel, hgt);
      BL[i].b = vec4u(octEnc(g.up), g.hash, pack4x8unorm(vec4f(clamp(wide / 8.0, 0.0, 1.0), tall, b.y, 0.0)), octEnc(g.n));
    }
  }
  // flowers: in drifts across the meadows
  let FR = LF.k.z;
  if (d < FR && rnd(g.hash, 7u) < 0.05 * b.x * smoothstep(0.55, 0.8, detail(2u, g.rel + 31.0, 0.0)) * select(1.0, pow(FR * 0.3 / d, 1.2), d > FR * 0.3)) {
    let i = atomicAdd(&ARGS[1].count, 1u);
    if (i < MAXF) {
      FL[i].a = vec4f(g.rel, (0.25 + 0.45 * rnd(g.hash, 8u)) * mix(0.8, 1.4, tall));
      FL[i].b = vec4u(octEnc(g.up), g.hash, u32(detail(0u, g.rel + 77.0, 0.0) * 5.0 + rnd(g.hash, 9u) * 1.2), 0u);
    }
  }
  // fireflies (shown at dusk only) hover over the meadows
  if (d < 42.0 && rnd(g.hash, 11u) < 0.0035 * b.x) {
    let i = atomicAdd(&ARGS[2].count, 1u);
    if (i < ${FFMAX}u) { FF[i] = Blade(vec4f(g.rel, 1.0), vec4u(octEnc(g.up), g.hash, 0u, 0u)); }
  }
}
@compute @workgroup_size(1) fn fin() {
  atomicStore(&ARGS[0].count, min(atomicLoad(&ARGS[0].count), MAXB));
  atomicStore(&ARGS[1].count, min(atomicLoad(&ARGS[1].count), MAXF));
  atomicStore(&ARGS[2].count, min(atomicLoad(&ARGS[2].count), ${FFMAX}u));
}
`;

// ---- grass blades and flowers: drawing
const W_GRASS_DRAW = /*wgsl*/`
struct Blade { a: vec4f, b: vec4u };
@group(3) @binding(0) var<storage, read> BL: array<Blade>;
override ROWS: u32 = 4u;
struct GO { @builtin(position) clip: vec4f, @location(0) rel: vec3f, @location(1) n: vec3f, @location(2) up: vec3f, @location(3) c: vec4f, @location(4) @interpolate(flat) h: f32 };
fn rootShadow(rel: vec3f, up: vec3f) -> f32 {
  let d = length(rel); if (d > F.shp.y * 0.85) { return 1.0; }
  let c = select(1u, 0u, d < F.shp.x * 0.8);
  let q = F.shm[c] * vec4f(rel + up * 0.15, 1.0); let uv = vec2f(q.x * 0.5 + 0.5, 0.5 - q.y * 0.5);
  if (any(uv < vec2f(0.0)) || any(uv > vec2f(1.0))) { return 1.0; }
  return textureSampleCompareLevel(tShadow, sCmp, uv, c, q.z - 0.0008);
}
// wind: a steady lean plus gusts travelling along the wind (anchored to the ground), and a flutter
fn windBend(rel: vec3f, ph: f32) -> vec3f {
  let w = LF.wind.xyz;
  let x = dot(rel, w) + LF.gust.y;
  let g = 0.5 + 0.5 * sin(x * TAUW - LF.gust.x * 1.7) * sin(x * TAUW * 0.37 + dot(rel, cross(w, normalize(F.cam.xyz))) * 0.05 - LF.gust.x * 0.6);
  let s = LF.wind.w / 8.0;
  return w * s * (0.25 + 0.75 * g) + cross(normalize(F.cam.xyz), w) * sin(LF.gust.x * 3.1 + ph) * 0.06 * s;
}
const TAUW = 6.2831853 / 38.0; // the gust pattern repeats every 76 m (the camera offset is wrapped there)
@vertex fn vsGrass(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> GO {
  let bl = BL[ii];
  let up = octDec(bl.b.x); let h = bl.b.y; let m = unpack4x8unorm(bl.b.z);
  let row = f32(vi / 2u) / f32(ROWS); let side = f32(vi & 1u) * 2.0 - 1.0;
  // a frame across the blade: random yaw around the vertical
  let a = rnd(h, 5u) * 6.2831853;
  var t = normalize(cross(up, vec3f(0.31, 0.83, 0.47))); let bt = cross(up, t);
  let across = t * cos(a) + bt * sin(a); let facing = cross(across, up);
  let hgt = bl.a.w;
  let wid = (0.012 + 0.012 * rnd(h, 6u)) * (1.0 + m.x * 7.0) * (1.0 - row * 0.85);
  // its own curve, leaning one way, plus the wind (more at the tip)
  let lean = (rnd(h, 7u) - 0.3) * 0.5;
  let wb = windBend(bl.a.xyz, rnd(h, 8u) * 6.28);
  let off = up * hgt * row + (facing * lean + wb) * hgt * row * row;
  let p = bl.a.xyz + off + across * wid * side;
  var o: GO;
  o.clip = F.vp * vec4f(p, 1.0); o.rel = p;
  o.n = normalize(facing + up * 0.6 + across * side * 0.3);
  o.up = up;
  o.c = vec4f(row, m.y, m.z, rnd(h, 9u));
  o.h = rootShadow(bl.a.xyz, up);
  return o;
}
@fragment fn fsGrass(i: GO, @builtin(front_facing) ff: bool) -> @location(0) vec4f {
  let up = normalize(i.up); var n = normalize(i.n); if (!ff) { n = normalize(-i.n + up * 1.2); }
  let foot = length(i.rel) * F.misc.x;
  let row = i.c.x;
  // root dark and green, tip light and golden in the tall meadows
  let base = mix(vec3f(0.07, 0.14, 0.03), vec3f(0.05, 0.10, 0.025), i.c.z);
  var tip = mix(vec3f(0.26, 0.38, 0.08), vec3f(0.44, 0.42, 0.13), i.c.y * 0.8);
  tip = mix(tip, tip * vec3f(1.2, 0.95, 0.7), i.c.w * 0.5);
  let alb = mix(base, tip, smoothstep(0.0, 0.9, row)) * (0.85 + 0.3 * detail(2u, i.rel, foot));
  let cs = cloudShadow(i.rel);
  let sun = sunAt(up, 1.0) * cs.x * i.h;
  let sky = skyIrr(up, 1.0) * (0.45 + 0.55 * cs.y);
  let l = F.sun.xyz;
  let ndl = max(dot(n, l), 0.0);
  // light through the blade (back-lit), stronger toward the tip
  let trans = pow(max(dot(normalize(-i.rel), -l), 0.0), 3.0) * 0.6 + max(-dot(n, l), 0.0) * 0.35;
  let ao = mix(0.35, 1.0, row);
  let col = alb * (sun * (ndl + trans * row) / PI + sky / PI * ao);
  return vec4f(col, 1.0);
}
// flowers: a thin stem and a small cross of petals at the top
@vertex fn vsFlower(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> GO {
  let fl = BL[ii];
  let up = octDec(fl.b.x); let h = fl.b.y;
  var t = normalize(cross(up, vec3f(0.31, 0.83, 0.47))); let bt = cross(up, t);
  let a = rnd(h, 5u) * 6.2831853; let ac = t * cos(a) + bt * sin(a); let fc = cross(ac, up);
  let hgt = fl.a.w;
  let wb = windBend(fl.a.xyz, rnd(h, 8u) * 6.28) * 0.7;
  let top = fl.a.xyz + up * hgt + wb * hgt;
  var p: vec3f; var n = up; var c = vec4f(0.0, 0.0, 0.0, 0.0);
  let q = vi % 6u; let corner = array<vec2f, 6>(vec2f(-1, -1), vec2f(1, -1), vec2f(1, 1), vec2f(-1, -1), vec2f(1, 1), vec2f(-1, 1))[q];
  if (vi < 6u) { // stem
    let r = (corner.y * 0.5 + 0.5);
    p = fl.a.xyz + up * hgt * r + wb * hgt * r * r + ac * corner.x * 0.006; n = fc; c = vec4f(0.0, 0.0, 0.0, 0.0);
  } else { // two crossed petal quads
    let s = (0.035 + 0.03 * rnd(h, 6u)) * (1.0 + 0.5 * f32(fl.b.z % 2u));
    let ax = select(ac, fc, vi >= 12u);
    p = top + ax * corner.x * s + cross(ax, up) * corner.y * s * 0.9 + up * 0.01 * (1.0 - dot(corner, corner) * 0.5);
    n = up; c = vec4f(1.0, f32(fl.b.z % 6u), length(corner), rnd(h, 7u));
  }
  var o: GO;
  o.clip = F.vp * vec4f(p, 1.0); o.rel = p; o.n = n; o.up = up; o.c = c; o.h = rootShadow(fl.a.xyz, up);
  return o;
}
const PETALS = array<vec3f, 6>(vec3f(0.92, 0.9, 0.85), vec3f(0.95, 0.75, 0.08), vec3f(0.55, 0.25, 0.75), vec3f(0.9, 0.25, 0.15), vec3f(0.98, 0.55, 0.65), vec3f(0.35, 0.45, 0.95));
@fragment fn fsFlower(i: GO) -> @location(0) vec4f {
  let up = normalize(i.up);
  var alb = vec3f(0.06, 0.13, 0.03);
  if (i.c.x > 0.5) {
    // petal: a rounded shape (discard the corners), a darker heart
    let r = i.c.z; if (r > 1.25) { discard; }
    alb = PETALS[u32(i.c.y)] * (0.85 + 0.3 * i.c.w);
    alb = mix(alb * vec3f(0.6, 0.45, 0.15), alb, smoothstep(0.2, 0.45, r));
  }
  let cs = cloudShadow(i.rel);
  let sun = sunAt(up, 1.0) * cs.x * i.h; let sky = skyIrr(up, 1.0) * (0.45 + 0.55 * cs.y);
  let ndl = abs(dot(normalize(i.n), F.sun.xyz)) * 0.7 + 0.3 * max(dot(up, F.sun.xyz), 0.0);
  return vec4f(alb * (sun * ndl / PI + sky / PI), 1.0);
}
`;

// ---- trees, palms, bushes, rocks: placement into (kind, LOD) buckets, each with its indirect draw
// kinds: 0 broadleaf, 1 conifer, 2 palm, 3 bush, 4 rock
const NKIND = 5, NLOD = 3, BCAP = [[3072, 14336, 49152], [1536, 8192, 24576], [768, 4096, 12288]][LV];
const W_PROPS_CS = /*wgsl*/`
struct Inst { a: vec4f, b: vec4u };
struct DA { n: u32, count: atomic<u32>, first: u32, base: i32, inst: u32 };
@group(3) @binding(0) var<storage, read_write> IN: array<Inst>;
@group(3) @binding(1) var<storage, read_write> DARGS: array<DA, ${NKIND * NLOD}>;
@group(3) @binding(2) var<storage, read> BASE: array<u32, ${NKIND * NLOD}>;
override LAYER: u32 = 0u;
const CAP = array<u32, 3>(${BCAP[0]}u, ${BCAP[1]}u, ${BCAP[2]}u);
fn emit(kind: u32, g: Ground, d: f32, scale: f32, extra: u32) {
  let lodk = select(1.0, 0.75, F.misc.z > 1.5);
  let lod = select(select(2u, 1u, d < 320.0 * lodk), 0u, d < 70.0 * lodk);
  let b = kind * 3u + lod;
  let i = atomicAdd(&DARGS[b].count, 1u);
  if (i >= CAP[lod]) { return; }
  IN[BASE[b] + i] = Inst(vec4f(g.rel, scale), vec4u(octEnc(g.up), g.hash, extra, octEnc(g.n)));
}
@compute @workgroup_size(64) fn main(@builtin(workgroup_id) w: vec3u, @builtin(local_invocation_index) li: u32) {
  let g = ground(w.x + w.y * 65535u, li, u32(LF.k2.w));
  if (!g.ok || g.h < 0.3) { return; }
  let d = length(g.rel);
  let RAD = select(LF.k.w, LF.k2.x, LAYER == 0u);
  if (d > RAD) { return; }
  let b = biome(g.h, g.n, g.up, g.rel);
  let r = rnd(g.hash, 3u);
  let a = g.h / F.pl.z + (detail(0u, g.rel, 0.0) - 0.5) * 0.08;
  let c = clamp(dot(g.n, g.up), 0.0, 1.0);
  // fade the far edge: the farthest ones shrink into the ground (no pop)
  let edge = smoothstep(RAD, RAD * 0.85, d);
  if (LAYER == 0u) {
    let conif = smoothstep(0.2, 0.34, a);
    let pB = (b.y * 0.62 + b.x * 0.03) * (1.0 - conif);
    let pC = (b.y * 0.62 + b.x * 0.02) * conif;
    // palms on the sandy shores and just behind them
    let palmZone = smoothstep(0.7, 1.4, g.h) * (1.0 - smoothstep(5.0, 12.0, g.h)) * smoothstep(0.75, 0.9, c);
    let pP = palmZone * 0.16;
    var kind = 99u; var s = 0.0;
    if (r < pB) { kind = 0u; s = mix(7.0, 13.0, rnd(g.hash, 4u)); }
    else if (r < pB + pC) { kind = 1u; s = mix(8.0, 17.0, rnd(g.hash, 4u)); }
    else if (r < pB + pC + pP) { kind = 2u; s = mix(6.0, 10.5, rnd(g.hash, 4u)); }
    if (kind == 99u || !inView(g.rel + g.up * s * 0.5, s * 0.8 + 30.0)) { return; }
    emit(kind, g, d, s * edge, 0u);
  } else {
    let pBush = b.x * 0.05 + b.y * 0.22;
    let pRock = b.w * 0.3 + b.z * 0.012 + b.x * 0.006;
    var kind = 99u; var s = 0.0;
    if (r < pBush) { kind = 3u; s = mix(0.8, 2.0, rnd(g.hash, 4u)); }
    else if (r < pBush + pRock) { kind = 4u; s = mix(0.35, 1.6, pow(rnd(g.hash, 4u), 2.0)) * (1.0 + 2.2 * b.w * step(0.93, rnd(g.hash, 5u))); }
    if (kind == 99u || !inView(g.rel, s * 1.5)) { return; }
    emit(kind, g, d, s * edge, 0u);
  }
}
@compute @workgroup_size(${NKIND * NLOD}) fn fin(@builtin(local_invocation_index) i: u32) {
  atomicStore(&DARGS[i].count, min(atomicLoad(&DARGS[i].count), CAP[i % 3u]));
}
`;

// ---- drawing them: one vertex format (position, normal + sway, uv, tint + kind), wind, procedural leaf cards
const W_PROPS_DRAW = /*wgsl*/`
struct Inst { a: vec4f, b: vec4u };
@group(3) @binding(0) var<storage, read> IN: array<Inst>;
struct VI { @location(0) p: vec3f, @location(1) n: vec4f, @location(2) uv: vec2f, @location(3) m: vec4f };
struct PO { @builtin(position) clip: vec4f, @location(0) rel: vec3f, @location(1) n: vec3f, @location(2) up: vec3f, @location(3) uv: vec2f, @location(4) m: vec4f, @location(5) @interpolate(flat) h: u32 };
fn wind3(rel: vec3f) -> f32 {
  let x = dot(rel, LF.wind.xyz) + LF.gust.y;
  return 0.5 + 0.5 * sin(x * 6.2831853 / 38.0 - LF.gust.x * 1.7) * sin(x * 6.2831853 / 76.0 - LF.gust.x * 0.6);
}
@vertex fn vs(v: VI, @builtin(instance_index) ii: u32) -> PO { return propVertex(v, ii, F.vp); }
fn propVertex(v: VI, ii: u32, vp: mat4x4f) -> PO {
  let it = IN[ii];
  let up = octDec(it.b.x); let h = it.b.y; let s = it.a.w;
  let yaw = rnd(h, 11u) * 6.2831853;
  let t0 = normalize(cross(up, vec3f(0.31, 0.83, 0.47))); let b0 = cross(up, t0);
  let tx = t0 * cos(yaw) + b0 * sin(yaw); let tz = cross(tx, up);
  let kind = u32(v.m.w * 255.0 + 0.5);
  var lp = v.p;
  // wind: the whole plant bends with the gusts (more at the top), leaves flutter
  let g = wind3(it.a.xyz);
  let sway = v.n.w * v.n.w;
  let ph = rnd(h, 12u) * 6.28 + dot(v.p, vec3f(3.1, 2.3, 4.7));
  let flutter = select(0.0, 0.012, kind == 1u || kind == 2u || kind == 3u) * sin(LF.gust.x * 5.3 + ph);
  let bend = (LF.wind.w / 8.0) * (0.015 + 0.035 * g) * sway;
  var p = it.a.xyz + (tx * lp.x + up * lp.y + tz * lp.z) * s;
  p += (LF.wind.xyz * bend + (tx * cos(ph) + tz * sin(ph)) * flutter) * s;
  var o: PO;
  o.clip = vp * vec4f(p, 1.0); o.rel = p;
  o.n = normalize(tx * v.n.x + up * v.n.y + tz * v.n.z);
  o.up = up; o.uv = v.uv; o.m = v.m; o.h = h;
  return o;
}
// a cluster of leaves on a card (uv 0..1): a few overlapping ellipses
fn leaves(uv: vec2f, h: f32) -> f32 {
  var a = 0.0;
  for (var i = 0; i < 6; i++) {
    let fi = f32(i);
    let c = vec2f(0.5) + vec2f(cos(fi * 2.4 + h), sin(fi * 2.4 + h)) * (0.12 + 0.2 * fract(fi * 0.618 + h));
    let an = fi * 1.7 + h * 3.0;
    var q = uv - c; q = vec2f(q.x * cos(an) - q.y * sin(an), q.x * sin(an) + q.y * cos(an));
    a = max(a, 1.0 - length(q / vec2f(0.2, 0.11)));
  }
  return a;
}
@fragment fn fs(i: PO, @builtin(front_facing) ff: bool) -> @location(0) vec4f {
  let kind = u32(i.m.w * 255.0 + 0.5);
  let up = normalize(i.up);
  var n = normalize(i.n);
  var alpha = 1.0;
  let hv = f32(i.h % 997u) / 997.0;
  var alb = i.m.rgb;
  var trans = 0.0;
  if (kind == 1u || kind == 3u) { // leaf cards (broadleaf, bush)
    alpha = leaves(i.uv, hv * 6.28) * 3.0;
    trans = 0.5;
  } else if (kind == 2u) { // needles: a star of thin strokes
    let q = i.uv - 0.5; let r = length(q) * 2.0; let an = atan2(q.y, q.x);
    alpha = (1.0 - r) * 2.0 * (0.4 + 0.6 * smoothstep(0.3, 0.9, abs(sin(an * 7.0 + hv * 6.0))));
    trans = 0.3;
  } else if (kind == 5u) { // palm frond: a comb of leaflets along the rachis
    let x = i.uv.x; let y = abs(i.uv.y - 0.5) * 2.0;
    let leaflet = smoothstep(0.82, 0.62, fract(x * 34.0 + y * 2.2));
    let wid = sin(min(x, 0.98) * 3.14159) * 0.95 + 0.05;
    alpha = select(leaflet * (1.0 - smoothstep(wid - 0.08, wid, y)) * 3.0, 1.0, y < 0.06) ;
    trans = 0.45;
  }
  if (kind != 0u && kind != 4u && kind != 6u) {
    if (!ff) { n = -n; }
  }
  if (alpha < 0.5) { discard; }
  // tint variation per plant
  alb *= 0.85 + 0.3 * fract(hv * 7.31);
  let foot = length(i.rel) * F.misc.x;
  if (kind == 4u) { alb *= 0.8 + 0.4 * detail(3u, i.rel, foot); }
  let cs = cloudShadow(i.rel);
  let sun = sunAt(up, 2.0) * cs.x * sunShadow(i.rel, n); let sky = skyIrr(up, 2.0) * (0.45 + 0.55 * cs.y);
  let l = F.sun.xyz;
  let ndl = max(dot(n, l), 0.0);
  let back = pow(max(dot(normalize(-i.rel), -l), 0.0), 4.0) * trans + max(-dot(n, l), 0.0) * trans * 0.5;
  let ao = i.m.a * 0.0 + clamp(0.35 + 0.65 * (dot(n, up) * 0.5 + 0.5), 0.0, 1.0);
  let col = alb * (sun * (ndl + back) / PI + sky / PI * ao);
  return vec4f(col, 1.0);
}
`;
