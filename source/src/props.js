// ============================================================================
// trees, palms, bushes and rocks: procedural meshes (unit height, 3 LODs), GPU placement into buckets
// ============================================================================
// Vertex: position, normal + sway (how much the wind moves it), uv, tint + material. Materials: 0 bark, 1 leaf card,
// 2 needle card, 3 bush leaf card, 4 rock, 5 palm frond, 6 coconut. Crowns are leaf cards whose normals point out of
// the crown (soft, volumetric light), with the shade of the inside baked into their tint.
const PV = [], PIX = []; let pvN = 0;
const pv = (x, y, z, nx, ny, nz, sw, u, v, r, g, b, k) => { PV.push(x, y, z, nx, ny, nz, sw, u, v, r, g, b, k); return pvN++; };
const pquad = (a, b, c, d) => PIX.push(a, b, c, a, c, d);
const MESH = []; // [kind][lod] = [firstIndex, count, baseVertex]
// a tube through the points pts with radii rads
function tube(pts, rads, sides, col, k, sw0, sw1) {
  const ring = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[min(i + 1, pts.length - 1)], o = pts[max(i - 1, 0)];
    let tx = q[0] - o[0], ty = q[1] - o[1], tz = q[2] - o[2]; const tl = hypot(tx, ty, tz) || 1; tx /= tl; ty /= tl; tz /= tl;
    let ax = 0, ay = 0, az = 1; if (abs(tz) > 0.9) { ax = 1; az = 0; }
    let bx = ty * az - tz * ay, by = tz * ax - tx * az, bz = tx * ay - ty * ax; const bl = hypot(bx, by, bz); bx /= bl; by /= bl; bz /= bl;
    const cx = ty * bz - tz * by, cy = tz * bx - tx * bz, cz = tx * by - ty * bx;
    const r = [], sw = mix(sw0, sw1, i / (pts.length - 1));
    for (let s = 0; s < sides; s++) {
      const a = s / sides * TAU, ca = cos(a), sa = sin(a), nx = bx * ca + cx * sa, ny = by * ca + cy * sa, nz = bz * ca + cz * sa;
      r.push(pv(p[0] + nx * rads[i], p[1] + ny * rads[i], p[2] + nz * rads[i], nx, ny, nz, sw, s / sides, i / pts.length, col[0], col[1], col[2], k));
    }
    ring.push(r);
  }
  for (let i = 0; i + 1 < ring.length; i++) for (let s = 0; s < sides; s++) pquad(ring[i][s], ring[i][(s + 1) % sides], ring[i + 1][(s + 1) % sides], ring[i + 1][s]);
}
// a leaf card at (x, y, z) facing (fx, fy, fz), half size s, light normal (lx, ly, lz)
function card(x, y, z, fx, fy, fz, s, lx, ly, lz, col, k, sw) {
  const fl = hypot(fx, fy, fz) || 1; fx /= fl; fy /= fl; fz /= fl;
  let ax = fy * 0.3 - fz * 0.9, ay = fz * 0.2 - fx * 0.3, az = fx * 0.9 - fy * 0.2; const al = hypot(ax, ay, az) || 1; ax /= al; ay /= al; az /= al;
  const bx = fy * az - fz * ay, by = fz * ax - fx * az, bz = fx * ay - fy * ax;
  const ll = hypot(lx, ly, lz) || 1; lx /= ll; ly /= ll; lz /= ll;
  const c = (u, v) => pv(x + (ax * (u * 2 - 1) + bx * (v * 2 - 1)) * s, y + (ay * (u * 2 - 1) + by * (v * 2 - 1)) * s, z + (az * (u * 2 - 1) + bz * (v * 2 - 1)) * s, lx, ly, lz, sw, u, v, col[0], col[1], col[2], k);
  pquad(c(0, 0), c(1, 0), c(1, 1), c(0, 1));
}
// cards over an ellipsoid cluster (centre c, radii r), lit as part of a crown of centre cc
function cluster(c, r, n, s, cc, col, k, swk) {
  for (let i = 0; i < n; i++) {
    const u = rnd() * 2 - 1, a = rnd() * TAU, q = sqrt(1 - u * u), d = 0.55 + 0.45 * sqrt(rnd());
    const ox = q * cos(a) * r[0] * d, oy = u * r[1] * d, oz = q * sin(a) * r[2] * d;
    const x = c[0] + ox, y = c[1] + oy, z = c[2] + oz;
    // shade: darker inside the crown and underneath
    const inner = clamp(hypot(ox / r[0], oy / r[1], oz / r[2]), 0, 1), sh = (0.5 + 0.5 * inner) * (0.75 + 0.25 * clamp(u + 0.5, 0, 1)), v = 0.85 + 0.3 * rnd();
    card(x, y, z, ox + (rnd() - 0.5) * r[0], oy + (rnd() - 0.5) * r[1], oz + (rnd() - 0.5) * r[2], s * (0.8 + 0.4 * rnd()),
      x - cc[0], y - cc[1] + 0.15, z - cc[2], [col[0] * sh * v, col[1] * sh * v, col[2] * sh * v], k, swk(y));
  }
}
const endMesh = (kind, lod, i0) => { (MESH[kind] ||= [])[lod] = [i0, PIX.length - i0, 0]; };
{
  const BARK = [0.16, 0.11, 0.07], LEAF = [0.11, 0.21, 0.045], NEEDLE = [0.05, 0.11, 0.04], FROND = [0.15, 0.26, 0.05], BUSH = [0.09, 0.19, 0.04], ROCK = [0.33, 0.30, 0.27];
  for (let lod = 0; lod < 3; lod++) {
    const sd = [8, 5, 3][lod];
    // broadleaf: a leaning trunk forking into branches, a crown of leaf clusters
    rseed(101); let i0 = PIX.length, v0 = pvN;
    tube([[0, -0.05, 0], [0.01, 0.2, 0.005], [0.02, 0.38, -0.01], [0.015, 0.5, 0]], [0.04, 0.032, 0.026, 0.02], sd, BARK, 0, 0, 0.35);
    const CL = [[0, 0.72, 0, 0.24], [0.17, 0.62, 0.06, 0.17], [-0.15, 0.64, -0.08, 0.18], [0.05, 0.6, -0.18, 0.16], [-0.06, 0.62, 0.17, 0.16], [0.1, 0.86, 0.08, 0.15], [-0.08, 0.84, -0.06, 0.15]];
    for (let c = 0; c < (lod === 2 ? 3 : CL.length); c++) {
      const [x, y, z, r] = CL[c];
      if (lod < 2 && c > 0) tube([[0.015, 0.45, 0], [x * 0.6, y * 0.85, z * 0.6], [x, y, z]], [0.016, 0.011, 0.006], max(3, sd - 3), BARK, 0, 0.35, 0.6);
      const rr = lod === 2 ? r * 1.35 : r;
      cluster([x, y, z], [rr, rr * 0.75, rr], [46, 16, 7][lod], [0.07, 0.11, 0.17][lod], [0, 0.7, 0], LEAF, 1, (y) => clamp(y, 0, 1));
    }
    for (let i = v0; i < pvN; i++) PV[i * 13 + 6] = clamp(PV[i * 13 + 1] * 1.1, 0, 1);
    endMesh(0, lod, i0);
    // conifer: a straight trunk, tiers of drooping needle cards
    rseed(202); i0 = PIX.length;
    tube([[0, -0.05, 0], [0, 0.5, 0], [0, 0.97, 0]], [0.028, 0.018, 0.004], max(3, sd - 2), BARK, 0, 0, 0.8);
    const tiers = [10, 6, 3][lod];
    for (let t = 0; t < tiers; t++) {
      const f = t / tiers, y = 0.2 + 0.78 * f, rad = 0.3 * pow(1 - f * 0.95, 1.1) + 0.02, m = [16, 9, 6][lod];
      for (let i = 0; i < m; i++) {
        const a = (i + rnd() * 0.6 + t * 0.37) / m * TAU, d = rad * (0.55 + 0.25 * rnd());
        const x = cos(a) * d, z = sin(a) * d, yy = y - d * 0.35, sh = 0.6 + 0.4 * f;
        card(x, yy, z, cos(a) * 0.4, 1, sin(a) * 0.4, [0.1, 0.15, 0.24][lod] * (rad / 0.3 + 0.25), cos(a), 0.6, sin(a), [NEEDLE[0] * sh, NEEDLE[1] * sh, NEEDLE[2] * sh], 2, clamp(yy, 0, 1));
      }
    }
    endMesh(1, lod, i0);
    // palm: a curved ringed trunk, drooping fronds folded along their rachis, coconuts
    rseed(303); i0 = PIX.length;
    const seg = [10, 6, 4][lod], pts = [], rads = [];
    for (let i = 0; i <= seg; i++) { const t = i / seg; pts.push([0.16 * t * t, t * 0.92, 0]); rads.push((0.028 - 0.008 * t) * (1 + (lod ? 0 : 0.12 * (i & 1)))); }
    tube(pts, rads, max(4, sd - 1), [0.24, 0.19, 0.13], 0, 0, 0.7);
    const top = pts[seg], nf = [10, 8, 6][lod], ns = [9, 5, 3][lod];
    for (let f = 0; f < nf; f++) {
      const a = (f + rnd() * 0.4) / nf * TAU, el = 0.35 + 0.5 * rnd(), L = 0.36 + 0.1 * rnd();
      const dx = cos(a), dz = sin(a), sx = -dz, sz = dx;
      let prev = null;
      for (let i = 0; i <= ns; i++) {
        const t = i / ns, w = 0.1 * sin(PI * min(t * 1.1, 1)) + 0.01;
        const x = top[0] + dx * t * L, z = top[2] + dz * t * L, y = top[1] + (el * t - t * t * 0.55) * L, fold = w * 0.35;
        const row = [pv(x + sx * w, y - fold, z + sz * w, 0, 1, 0, 1, t, 0, FROND[0], FROND[1], FROND[2], 5), pv(x, y, z, 0, 1, 0, 1, t, 0.5, FROND[0], FROND[1], FROND[2], 5),
          pv(x - sx * w, y - fold, z - sz * w, 0, 1, 0, 1, t, 1, FROND[0], FROND[1], FROND[2], 5)];
        if (prev) { pquad(prev[0], prev[1], row[1], row[0]); pquad(prev[1], prev[2], row[2], row[1]); }
        prev = row;
      }
    }
    if (lod < 2) for (let c = 0; c < 3; c++) { const a = c * 2.1; tube([[top[0] + cos(a) * 0.025, top[1] - 0.03, top[2] + sin(a) * 0.025], [top[0] + cos(a) * 0.03, top[1] - 0.065, top[2] + sin(a) * 0.03]], [0.018, 0.016], 5, [0.2, 0.13, 0.06], 6, 0.7, 0.7); }
    endMesh(2, lod, i0);
    // bush: a few leafy clusters on the ground
    rseed(404); i0 = PIX.length;
    for (let c = 0; c < 4; c++) {
      const a = c * 1.9, x = cos(a) * 0.25 * (c ? 1 : 0), z = sin(a) * 0.25 * (c ? 1 : 0), y = c ? 0.32 : 0.45;
      cluster([x, y, z], [0.42, 0.34, 0.42], [26, 10, 5][lod], [0.17, 0.26, 0.4][lod], [0, 0.3, 0], BUSH, 3, (y) => clamp(y * 0.8, 0, 1));
    }
    endMesh(3, lod, i0);
    // rock: a noise-displaced sphere, flattened, sunk a little in the ground
    i0 = PIX.length; v0 = pvN;
    let vs = [[0, 1, 0], [0, -1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]], fs = [[0, 2, 4], [0, 4, 3], [0, 3, 5], [0, 5, 2], [1, 4, 2], [1, 3, 4], [1, 5, 3], [1, 2, 5]];
    for (let s = 0; s < [3, 2, 1][lod]; s++) {
      const mid = new Map(), m = (a, b) => {
        const k = a < b ? a * 9999 + b : b * 9999 + a;
        if (!mid.has(k)) { const p = [vs[a][0] + vs[b][0], vs[a][1] + vs[b][1], vs[a][2] + vs[b][2]], l = hypot(p[0], p[1], p[2]); vs.push([p[0] / l, p[1] / l, p[2] / l]); mid.set(k, vs.length - 1); }
        return mid.get(k);
      };
      const nf2 = []; for (const [a, b, c] of fs) { const ab = m(a, b), bc = m(b, c), ca = m(c, a); nf2.push([a, ab, ca], [ab, b, bc], [ca, bc, c], [ab, bc, ca]); } fs = nf2;
    }
    const P3 = vs.map(([x, y, z]) => { const r = 1 + 0.28 * snoise(x * 1.3 + 5, y * 1.3, z * 1.3) + 0.1 * snoise(x * 3.1, y * 3.1 + 2, z * 3.1); return [x * r * 0.55, y * r * 0.36 + 0.12, z * r * 0.5]; });
    const N3 = P3.map(() => [0, 0, 0]);
    for (const [a, b, c] of fs) {
      const u = [P3[b][0] - P3[a][0], P3[b][1] - P3[a][1], P3[b][2] - P3[a][2]], w = [P3[c][0] - P3[a][0], P3[c][1] - P3[a][1], P3[c][2] - P3[a][2]];
      const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
      for (const q of [a, b, c]) { N3[q][0] += n[0]; N3[q][1] += n[1]; N3[q][2] += n[2]; }
    }
    for (let i = 0; i < P3.length; i++) {
      const n = N3[i], l = hypot(n[0], n[1], n[2]) || 1, sh = 0.75 + 0.25 * clamp(n[1] / l + 0.5, 0, 1);
      pv(P3[i][0], P3[i][1], P3[i][2], n[0] / l, n[1] / l, n[2] / l, 0, 0, 0, ROCK[0] * sh, ROCK[1] * sh, ROCK[2] * sh, 4);
    }
    for (const [a, b, c] of fs) PIX.push(v0 + a, v0 + c, v0 + b);
    endMesh(4, lod, i0);
    // brain coral: a round, flattened colony with meandering ridges
    i0 = PIX.length; v0 = pvN;
    const P5 = vs.map(([x, y, z]) => { const r = 1 + 0.07 * abs(snoise(x * 6, y * 6 + 3, z * 6)) - 0.035 + 0.12 * snoise(x * 1.6 + 9, y * 1.6, z * 1.6); return [x * r * 0.5, max(y * r * 0.42, -0.05) + 0.05, z * r * 0.5]; });
    const N5 = P5.map(() => [0, 0, 0]);
    for (const [a, b, c] of fs) {
      const u = [P5[b][0] - P5[a][0], P5[b][1] - P5[a][1], P5[b][2] - P5[a][2]], w = [P5[c][0] - P5[a][0], P5[c][1] - P5[a][1], P5[c][2] - P5[a][2]];
      const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
      for (const q of [a, b, c]) { N5[q][0] += n[0]; N5[q][1] += n[1]; N5[q][2] += n[2]; }
    }
    for (let i = 0; i < P5.length; i++) { const n = N5[i], l = hypot(n[0], n[1], n[2]) || 1, sh = 0.6 + 0.4 * clamp(P5[i][1] * 2.2, 0, 1); pv(P5[i][0], P5[i][1], P5[i][2], n[0] / l, n[1] / l, n[2] / l, 0.1, 0, 0, sh, sh, sh, 7); }
    for (const [a, b, c] of fs) PIX.push(v0 + a, v0 + c, v0 + b);
    endMesh(5, lod, i0);
    // branching coral: a trunk splitting twice into tapering branches
    rseed(606); i0 = PIX.length;
    const grow = (p, d, len, rad, depth) => {
      const q = [p[0] + d[0] * len, p[1] + d[1] * len, p[2] + d[2] * len], m = [(p[0] + q[0]) / 2 + (rnd() - 0.5) * len * 0.2, (p[1] + q[1]) / 2, (p[2] + q[2]) / 2 + (rnd() - 0.5) * len * 0.2];
      const sh = 0.6 + 0.4 * depth / 2;
      tube([p, m, q], [rad, rad * 0.85, rad * 0.7], [7, 5, 4][lod], [sh, sh, sh], 7, 0.2, 0.4);
      if (depth >= (lod === 2 ? 1 : 2)) return;
      const n = depth ? 2 : 3;
      for (let k = 0; k < n; k++) {
        const a = k / n * TAU + rnd() * 0.8, t = 0.45 + 0.25 * rnd();
        const nd = [d[0] * 0.6 + cos(a) * t, d[1] * 0.6 + 0.35, d[2] * 0.6 + sin(a) * t], l = hypot(...nd);
        grow(q, [nd[0] / l, nd[1] / l, nd[2] / l], len * 0.75, rad * 0.62, depth + 1);
      }
    };
    grow([0, -0.05, 0], [0, 1, 0], 0.32, 0.06, 0);
    endMesh(6, lod, i0);
    // barrel sponge: a thick tube flaring open at the top
    i0 = PIX.length;
    const bp = [], br = [];
    for (let i = 0; i <= 6; i++) { const t = i / 6; bp.push([0, -0.05 + t * 0.9, 0]); br.push(0.2 + 0.12 * t + 0.03 * sin(t * 9)); }
    tube(bp, br, [12, 8, 6][lod], [0.85, 0.85, 0.85], 8, 0, 0.2);
    const ip = bp.slice().reverse(), ir = br.slice().reverse().map((r) => r * 0.78);
    ip[ip.length - 1] = [0, 0.35, 0];
    tube(ip, ir, [12, 8, 6][lod], [0.35, 0.35, 0.35], 8, 0.2, 0);
    endMesh(7, lod, i0);
  }
}
// pack: 24 bytes a vertex (indices are absolute: baseVertex 0)
const vbProps = (() => {
  const n = pvN, ab = new ArrayBuffer(n * 24), f = new Float32Array(ab), s8 = new Int8Array(ab), u16 = new Uint16Array(ab), u8 = new Uint8Array(ab);
  for (let i = 0; i < n; i++) {
    const o = i * 13, b = i * 24;
    f[b / 4] = PV[o]; f[b / 4 + 1] = PV[o + 1]; f[b / 4 + 2] = PV[o + 2];
    s8[b + 12] = round(PV[o + 3] * 127); s8[b + 13] = round(PV[o + 4] * 127); s8[b + 14] = round(PV[o + 5] * 127); s8[b + 15] = round(clamp(PV[o + 6], 0, 1) * 127);
    u16[b / 2 + 8] = round(clamp(PV[o + 7], 0, 1) * 65535); u16[b / 2 + 9] = round(clamp(PV[o + 8], 0, 1) * 65535);
    u8[b + 20] = round(clamp(PV[o + 9], 0, 1) * 255); u8[b + 21] = round(clamp(PV[o + 10], 0, 1) * 255); u8[b + 22] = round(clamp(PV[o + 11], 0, 1) * 255); u8[b + 23] = PV[o + 12];
  }
  return buf(new Uint8Array(ab), BU.VERTEX);
})();
const ibProps = buf(new Uint32Array(PIX), BU.INDEX);
const vlProps = { arrayStride: 24, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }, { shaderLocation: 1, offset: 12, format: 'snorm8x4' },
  { shaderLocation: 2, offset: 16, format: 'unorm16x2' }, { shaderLocation: 3, offset: 20, format: 'unorm8x4' }] };
PV.length = 0;

// ---------------------------------------------------------------- placement passes
const NBK = NKIND * NLOD, BOFF = [];
let bTot = 0; for (let b = 0; b < NBK; b++) { BOFF.push(bTot); bTot += BCAP[b % 3]; }
const bProps = device.createBuffer({ size: bTot * 32, usage: BU.STORAGE });
const bPArgs = device.createBuffer({ size: NBK * 20, usage: BU.STORAGE | BU.INDIRECT | BU.COPY_DST });
const PARGS = new Uint32Array(NBK * 5);
// firstInstance stays 0 (no indirect-first-instance needed): the compute pass writes each bucket at its offset (its
// 5th word), each draw binds the instance buffer at that offset
for (let k = 0; k < NKIND; k++) for (let l = 0; l < NLOD; l++) { const b = k * 3 + l, m = MESH[k][l]; PARGS.set([m[1], 0, m[0], m[2], 0], b * 5); }
const bglPOut = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: SS.COMPUTE, buffer: { type: 'storage' } }, { binding: 1, visibility: SS.COMPUTE, buffer: { type: 'storage' } }, { binding: 2, visibility: SS.COMPUTE, buffer: { type: 'read-only-storage' } }] });
const mPropsCS = mod(W_LIFE + W_PROPS_CS);
const pPropsCS = [0, 1].map((L) => device.createComputePipeline({ layout: lay(bgl0, bglTerrC, bglLife, bglPOut), compute: { module: mPropsCS, entryPoint: 'main', constants: { LAYER: L } } }));
const pPropsFin = device.createComputePipeline({ layout: lay(bgl0, bglTerrC, bglLife, bglPOut), compute: { module: mPropsCS, entryPoint: 'fin' } });
const layGrass = lay(bgl0, bglTerr, bglLife, bglRead);
const bgPropsR = BOFF.map((o, b) => device.createBindGroup({ layout: bglRead, entries: [{ binding: 0, resource: { buffer: bProps, offset: o * 32, size: BCAP[b % 3] * 32 } }] }));
const bBase = buf(new Uint32Array(BOFF), BU.STORAGE);
const bgPOut = device.createBindGroup({ layout: bglPOut, entries: [{ binding: 0, resource: { buffer: bProps } }, { binding: 1, resource: { buffer: bPArgs } }, { binding: 2, resource: { buffer: bBase } }] });
const TREE_R = [2200, 1500, 900][LV], SMALL_R = [320, 240, 150][LV], TREE_DG = latDepth(6.5), SMALL_DG = latDepth(2.6);
// each lattice has its own uniform and jobs (written before the pass runs)
const lifeSet = () => { const u = ubuf(128), j = sbuf(MAXJOB * 48); return [u, j, device.createBindGroup({ layout: bglLife, entries: [{ binding: 0, resource: { buffer: u } }, { binding: 1, resource: { buffer: j } }] })]; };
const LS_TREE = lifeSet(), LS_SMALL = lifeSet();
function propsPass(e) {
  Q.writeBuffer(bPArgs, 0, PARGS);
  const c = e.beginComputePass();
  c.setBindGroup(0, bg0); c.setBindGroup(1, bgTerrC); c.setBindGroup(3, bgPOut);
  for (let L = 0; L < 2; L++) {
    const [u, j, g] = L ? LS_SMALL : LS_TREE, dg = L ? SMALL_DG : TREE_DG;
    const tiles = latticeJobs(dg, L ? SMALL_R : TREE_R); lifeUniform(tiles, dg, L ? 999 : 777); LFU[28] = TREE_R; LFU[27] = SMALL_R;
    Q.writeBuffer(u, 0, LFU); Q.writeBuffer(j, 0, JOBB, 0, nJob * 48);
    if (tiles) { c.setPipeline(pPropsCS[L]); c.setBindGroup(2, g); c.dispatchWorkgroups(min(tiles, 65535), ceil(tiles / 65535)); }
  }
  c.setPipeline(pPropsFin); c.setBindGroup(2, LS_SMALL[2]); c.dispatchWorkgroups(1);
  c.end();
}
