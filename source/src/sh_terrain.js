// ============================================================================
// WGSL: terrain patches (generated on the GPU) and their rendering
// ============================================================================
// A patch is a quadtree node of a cube face: 33 x 33 vertices plus a ring of skirt vertices (35 x 35 in all).
// Per vertex: position relative to the patch centre and height, the CDLOD morph target (the parent's surface at
// the vertex snapped to the lower even index, OpenG / Planets V5), the normal and the parent's normal.
const NV = 35 * 35;
const W_PATCH = /*wgsl*/`
struct Vtx { p: vec4f, d: vec4f, n: vec4u };
const UPS = array<vec3f, 6>(vec3f(1, 0, 0), vec3f(-1, 0, 0), vec3f(0, 1, 0), vec3f(0, -1, 0), vec3f(0, 0, 1), vec3f(0, 0, -1));
fn faceDir(f: u32, s: f32, t: f32) -> vec3f {
  let u = UPS[f]; let a = vec3f(u.y, u.z, u.x); let b = cross(u, a);
  return normalize(u + a * s + b * t);
}
`;

const W_BUILD = W_FRAME + W_NOISE + W_PATCH + /*wgsl*/`
struct Job { f: u32, lv: u32, ix: u32, iy: u32, slot: u32, p0: u32, p1: u32, p2: u32, c: vec4f };
@group(1) @binding(0) var<storage, read> JOBS: array<Job>;
@group(1) @binding(1) var<storage, read_write> V: array<Vtx>;
var<workgroup> hc: array<f32, 1369>; // heights at the patch's cell size, grid -2..34
var<workgroup> hp: array<f32, 361>;  // heights at the parent's cell size, even grid -2..34
var<private> J: Job;
// the grid coordinate is exact: (ix * 32 + g) / (32 << lv) is a dyadic fraction, so two patches sharing an edge
// compute the very same direction there
fn gdir(gx: i32, gy: i32) -> vec3f {
  let k = 2.0 / f32(32u << J.lv);
  return faceDir(J.f, f32(i32(J.ix * 32u) + gx) * k - 1.0, f32(i32(J.iy * 32u) + gy) * k - 1.0);
}
fn P(gx: i32, gy: i32) -> vec3f { return gdir(gx, gy) * (F.pl.x + hc[(gy + 2) * 37 + gx + 2]); }
fn Pp(gx: i32, gy: i32) -> vec3f { return gdir(gx, gy) * (F.pl.x + hp[((gy + 2) / 2) * 19 + (gx + 2) / 2]); }
@compute @workgroup_size(256)
fn build(@builtin(workgroup_id) wg: vec3u, @builtin(local_invocation_index) li: u32) {
  J = JOBS[wg.x];
  let cell = J.c.w;
  for (var i = li; i < 1369u; i += 256u) { hc[i] = height(gdir(i32(i % 37u) - 2, i32(i / 37u) - 2), cell); }
  for (var i = li; i < 361u; i += 256u) { hp[i] = height(gdir(i32(i % 19u) * 2 - 2, i32(i / 19u) * 2 - 2), cell * 2.0); }
  workgroupBarrier();
  for (var i = li; i < ${NV}u; i += 256u) {
    let vx = i32(i % 35u) - 1; let vy = i32(i / 35u) - 1;
    let gx = clamp(vx, 0, 32); let gy = clamp(vy, 0, 32);
    let p = P(gx, gy);
    let n = normalize(cross(P(gx + 1, gy) - P(gx - 1, gy), P(gx, gy + 1) - P(gx, gy - 1)));
    let ex = gx & ~1; let ey = gy & ~1;
    let pp = Pp(ex, ey);
    let np = normalize(cross(Pp(ex + 2, ey) - Pp(ex - 2, ey), Pp(ex, ey + 2) - Pp(ex, ey - 2)));
    let h = hc[(gy + 2) * 37 + gx + 2];
    let hq = hp[((ey + 2) / 2) * 19 + (ex + 2) / 2];
    var v: Vtx;
    v.p = vec4f(p - J.c.xyz, h);
    v.d = vec4f(pp - p, hq - h);
    v.n = vec4u(octEnc(n), octEnc(np), select(0u, 1u, vx != gx || vy != gy), 0u);
    V[J.slot * ${NV}u + i] = v;
  }
}
`;

// the patch as drawn: camera-relative centre and the parent's split distance, body-relative centre, slot / level /
// cell / skirt depth
const W_TERRAIN_VS = /*wgsl*/`
struct Patch { crel: vec4f, cbody: vec4f, info: vec4f };
@group(1) @binding(0) var<storage, read> V: array<Vtx>;
@group(1) @binding(1) var<storage, read> PT: array<Patch>;
// Planets V5 morph from the vertex distance against the parent's split distance
fn morph(d: f32, split: f32, mr: f32) -> f32 {
  if (split <= 0.0) { return 0.0; }
  let u = clamp((d - split * 0.5) / (split * 0.5), 0.0, 1.0);
  return clamp((u - (1.0 - mr)) / mr, 0.0, 1.0);
}
struct TV { pos: vec3f, nrm: vec3f, up: vec3f, h: f32, m: f32 };
fn terrainVertex(vi: u32, ii: u32) -> TV {
  let pt = PT[ii];
  let v = V[u32(pt.info.x) * ${NV}u + vi];
  let m = morph(length(pt.crel.xyz + v.p.xyz), pt.crel.w, F.nz2.w);
  var loc = v.p.xyz + v.d.xyz * m;
  let up = normalize(pt.cbody.xyz + loc);
  if (v.n.z == 1u) { loc -= up * pt.info.w; }
  var o: TV;
  o.pos = pt.crel.xyz + loc;
  o.nrm = normalize(mix(octDec(v.n.x), octDec(v.n.y), m));
  o.up = up; o.h = v.p.w + v.d.w * m; o.m = m;
  return o;
}
`;

// ground colour (linear albedo) from height above the sea, slope and the detail noise; shared with the vegetation
// so plants sit on matching ground
const W_GROUND = /*wgsl*/`
fn groundAlbedo(h: f32, n: vec3f, up: vec3f, rel: vec3f, foot: f32) -> vec3f {
  let c = clamp(dot(n, up), 0.0, 1.0);
  let slope = sqrt(max(1.0 - c * c, 0.0));
  let n0 = detail(0u, rel, foot); let n1 = detail(1u, rel, foot); let n2 = detail(2u, rel, foot); let n3 = detail(3u, rel, foot);
  let top = F.pl.z;
  let a = h / top + (n0 - 0.5) * 0.08 + (n1 - 0.5) * 0.03;
  // seabed: pale sand in the shallows, greener and darker silt deeper
  let sand = vec3f(0.62, 0.55, 0.40) * (0.9 + 0.2 * n2);
  let silt = vec3f(0.26, 0.29, 0.22);
  var col = mix(sand, silt, smoothstep(4.0, 45.0, -h + (n1 - 0.5) * 20.0));
  // beach
  let beachTop = 1.6 + n1 * 2.2;
  // meadow and forest floor
  // the colour of the grass seen from afar; up close, the soil between the blades
  var meadow = mix(vec3f(0.085, 0.15, 0.035), vec3f(0.15, 0.19, 0.05), smoothstep(0.4, 0.75, n1));
  meadow = mix(vec3f(0.06, 0.07, 0.03), meadow, smoothstep(6.0, 40.0, length(rel)));
  let forest = vec3f(0.045, 0.085, 0.025);
  var land = mix(meadow, forest, smoothstep(0.52, 0.66, n0 + (n2 - 0.5) * 0.2) * (1.0 - smoothstep(0.35, 0.5, a)));
  let alpine = vec3f(0.17, 0.19, 0.09);
  land = mix(land, alpine, smoothstep(0.32, 0.48, a));
  let rock = mix(vec3f(0.17, 0.155, 0.14), vec3f(0.26, 0.245, 0.23), n2) * (0.8 + 0.35 * n3);
  land = mix(land, rock, smoothstep(0.45, 0.7, slope + (n2 - 0.5) * 0.25));
  land = mix(land, rock, smoothstep(0.55, 0.7, a));
  let snow = vec3f(0.85, 0.88, 0.92);
  land = mix(land, snow, smoothstep(0.78, 0.84, a + c * 0.06 - 0.06) * smoothstep(0.75, 0.9, c));
  land *= 0.86 + 0.28 * n3;
  let beach = vec3f(0.78, 0.70, 0.52) * (0.92 + 0.16 * n3);
  col = select(col, mix(beach, land, smoothstep(beachTop - 0.6, beachTop + 0.6, h)), h > -0.2);
  col = mix(col, rock * 0.8, smoothstep(0.55, 0.75, slope) * step(h, -0.2));
  return col;
}
`;

const W_TERRAIN = /*wgsl*/`
struct VO { @builtin(position) clip: vec4f, @location(0) rel: vec3f, @location(1) nrm: vec3f, @location(2) up: vec3f, @location(3) h: f32 };
@vertex fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VO {
  let t = terrainVertex(vi, ii);
  var o: VO;
  o.clip = F.vp * vec4f(t.pos, 1.0); o.rel = t.pos; o.nrm = t.nrm; o.up = t.up; o.h = t.h;
  return o;
}
@fragment fn fs(i: VO) -> @location(0) vec4f {
  let n = normalize(i.nrm); let up = normalize(i.up);
  let foot = length(i.rel) * F.misc.x;
  var alb = groundAlbedo(i.h, n, up, i.rel, foot);
  if (i.h < 0.0) { return vec4f(seabed(alb, n, up, i.rel, -i.h, foot), 1.0); }
  // wet sand where the waves run up the beach
  let wet = 1.0 - smoothstep(0.0, 0.35 + 0.9 * detail(2u, i.rel, foot), i.h);
  alb *= mix(1.0, 0.55, wet);
  return vec4f(surfaceLight(alb, n, up, i.rel, i.h), 1.0);
}
`;
