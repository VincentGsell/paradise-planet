// ============================================================================
// the planet's relief (OpenG / Planets): ridged multi-octave simplex on the unit sphere
// ============================================================================
// The same function runs here (camera height, LOD bounds, viewpoints) and on the GPU (sh_common.js, the patches).
// Simplex 3D with the "continuous" kernel of OpenG: every lattice corner within reach contributes, so the field has
// none of the steps of the 4-corner sum. Gradients from a seeded permutation table (shared with the GPU).
const SEED = 1337;
const PERM = new Uint32Array(512);
{
  rseed(SEED);
  const p = new Uint32Array(256); for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) { const j = floor(rnd() * (i + 1)), t = p[i]; p[i] = p[j]; p[j] = t; }
  for (let i = 0; i < 512; i++) PERM[i] = p[i & 255];
}
const GX = [1, -1, 1, -1, 1, -1, 1, -1, 0, 0, 0, 0], GY = [1, 1, -1, -1, 0, 0, 0, 0, 1, -1, 1, -1], GZ = [0, 0, 0, 0, 1, 1, -1, -1, 1, 1, -1, -1];
const RX = [-1, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 2], RY = [0, -1, 0, 0, 0, 1, 1, 0, 0, 1, 1, 1, 2, 1], RZ = [0, 0, -1, 0, 1, 0, 1, 0, 1, 0, 1, 2, 1, 1];
function snoise(x, y, z) {
  const s = (x + y + z) / 3, i = floor(x + s), j = floor(y + s), k = floor(z + s);
  let n = 0;
  for (let c = 0; c < 14; c++) {
    const ci = i + RX[c], cj = j + RY[c], ck = k + RZ[c], t = (ci + cj + ck) / 6;
    const dx = x - (ci - t), dy = y - (cj - t), dz = z - (ck - t);
    let w = 0.6 - dx * dx - dy * dy - dz * dz;
    if (w > 0) { w *= w; const g = PERM[(ci & 255) + PERM[(cj & 255) + PERM[ck & 255]]] % 12; n += w * w * (GX[g] * dx + GY[g] * dy + GZ[g] * dz); }
  }
  return n * 32;
}

// Planet parameters. OpenG calibrates lambda0 = 60 km and A0 = 1800 m for a 50 km radius; a tiny planet keeps the
// proportions of its relief to its radius: lambda0 = 1.2 R, A0 = 0.028 R, gain 0.52, ridges from octave 2, octaves
// down to ~1.5 m wavelength.
const R = DIAM * 500;
const PL = { R, L0: 1.2 * R, A0: 0.028 * R, G: 0.52, OCT: 0, SEA: 0, DS: 0, CST: 2.5 };
PL.OCT = min(18, floor(log2(PL.L0 / 1.5)) + 1);
PL.DS = 0.09 * PL.A0;
// relief range bound (m): the sum of the amplitudes
let AMAX = 0; for (let i = 0, a = PL.A0; i < PL.OCT; i++, a *= PL.G) AMAX += a;

// the shape given to the raw noise: low coastal plains and beaches above the sea, and below it a wide shelf
// 20 to 55 m deep (the garden lives there) before the drop to the deep sea
const SHELF = 55;
function shape(h) {
  if (h >= 0) return h * h / (h + PL.CST);
  const d = -h, s = d < PL.DS ? d / PL.DS : 1, u = 1 - s;
  return -(SHELF * (1 - u * u * u) + max(d - PL.DS, 0) * 1.6);
}
// raw ridged sum minus the sea offset; `mw`: the smallest wavelength wanted (0 = all of them)
function relief(x, y, z, mw) {
  let sum = 0, amp = PL.A0, wave = PL.L0, w = 1;
  for (let i = 0; i < PL.OCT; i++) {
    if (mw > 0 && wave < mw * 2) break;
    const f = PL.R / wave; let n = snoise(x * f, y * f, z * f);
    if (i >= 2) { const r = (1 - abs(n)) * (1 - abs(n)); n = (r * 2 - 1) * w; w = r < 0 ? 0 : r > 1 ? 1 : r; }
    sum += n * amp; amp *= PL.G; wave *= 0.5;
  }
  return sum - PL.SEA;
}
// height above the sea (m) at unit direction (x, y, z)
const height = (x, y, z, mw) => shape(relief(x, y, z, mw));
// amplitude of the octaves a cut at `mw` leaves out (bound of what they can add)
function restAmp(mw) {
  let r = 0, amp = PL.A0, wave = PL.L0;
  for (let i = 0; i < PL.OCT; i++) { if (mw > 0 && wave < mw * 2) r += amp; amp *= PL.G; wave *= 0.5; }
  return r;
}

// The sea level: 58 % of the planet under water (measured on the large shapes)
{
  const N = 4096, hs = new Float64Array(N), d = new Float64Array(3);
  for (let i = 0; i < N; i++) { fibDir(d, 0, i, N); hs[i] = relief(d[0], d[1], d[2], PL.L0 / 64); }
  hs.sort(); PL.SEA = hs[floor(N * 0.58)];
}
