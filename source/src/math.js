// ============================================================================
// math helpers (load-time only unless noted)
// ============================================================================
const { sin, cos, tan, sqrt, min, max, abs, floor, ceil, PI, pow, atan2, asin, acos, hypot, exp, log, log2, round, sign } = Math;
const TAU = PI * 2;
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const mix = (a, b, t) => a + (b - a) * t;
const sstep = (a, b, x) => { x = clamp((x - a) / (b - a), 0, 1); return x * x * (3 - 2 * x); };
// seeded random stream (mulberry32): each generator system starts its own, so the systems stay independent
let _seed = 1;
const rseed = (s) => { _seed = (0x2545F491 ^ Math.imul(s, 0x9E3779B1)) | 0; };
const rnd = () => {
  _seed = (_seed + 0x6D2B79F5) | 0;
  let t = Math.imul(_seed ^ (_seed >>> 15), 1 | _seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const rr = (a, b) => a + (b - a) * rnd();

// 3-vectors as plain indices into Float64Arrays: the frame loop never allocates
const v3len = (a, i) => sqrt(a[i] * a[i] + a[i + 1] * a[i + 1] + a[i + 2] * a[i + 2]);
const v3norm = (a, i) => { const l = v3len(a, i) || 1; a[i] /= l; a[i + 1] /= l; a[i + 2] /= l; return l; };
const v3dot = (a, i, b, j) => a[i] * b[j] + a[i + 1] * b[j + 1] + a[i + 2] * b[j + 2];
// o[k] = a[i] x b[j]
const v3cross = (o, k, a, i, b, j) => {
  const x = a[i + 1] * b[j + 2] - a[i + 2] * b[j + 1], y = a[i + 2] * b[j] - a[i] * b[j + 2], z = a[i] * b[j + 1] - a[i + 1] * b[j];
  o[k] = x; o[k + 1] = y; o[k + 2] = z;
};
// rotate a[i] around the unit axis b[j] by angle t (Rodrigues)
const v3rot = (a, i, b, j, t) => {
  const c = cos(t), s = sin(t), d = v3dot(a, i, b, j) * (1 - c);
  const x = a[i], y = a[i + 1], z = a[i + 2], kx = b[j], ky = b[j + 1], kz = b[j + 2];
  a[i] = x * c + (ky * z - kz * y) * s + kx * d;
  a[i + 1] = y * c + (kz * x - kx * z) * s + ky * d;
  a[i + 2] = z * c + (kx * y - ky * x) * s + kz * d;
};

// ---------------------------------------------------------------- cube-sphere (OpenG / Planets V4)
// Naive cube-sphere: a cube point normalized. Face frames: A = (up.y, up.z, up.x), B = up x A, so A x B = up on
// every face. dir(face, s, t) = normalize(up + A s + B t), s, t in [-1, 1].
const FACE = new Float64Array(54); // per face: up, A, B
for (let f = 0; f < 6; f++) {
  const o = f * 9, ax = f >> 1, sg = f & 1 ? -1 : 1;
  FACE[o + ax] = sg;
  FACE[o + 3] = FACE[o + 1]; FACE[o + 4] = FACE[o + 2]; FACE[o + 5] = FACE[o];
  v3cross(FACE, o + 6, FACE, o, FACE, o + 3);
}
// writes the unit direction of (face, s, t) to o[k]
const cubeDir = (o, k, f, s, t) => {
  const b = f * 9;
  o[k] = FACE[b] + FACE[b + 3] * s + FACE[b + 6] * t;
  o[k + 1] = FACE[b + 1] + FACE[b + 4] * s + FACE[b + 7] * t;
  o[k + 2] = FACE[b + 2] + FACE[b + 5] * s + FACE[b + 8] * t;
  v3norm(o, k);
};
// the face and the (s, t) of a direction
const cubeFace = (x, y, z, o) => {
  const X = abs(x), Y = abs(y), Z = abs(z);
  const f = X >= Y && X >= Z ? (x > 0 ? 0 : 1) : Y >= Z ? (y > 0 ? 2 : 3) : (z > 0 ? 4 : 5);
  const b = f * 9, d = x * FACE[b] + y * FACE[b + 1] + z * FACE[b + 2];
  o[0] = f; o[1] = (x * FACE[b + 3] + y * FACE[b + 4] + z * FACE[b + 5]) / d; o[2] = (x * FACE[b + 6] + y * FACE[b + 7] + z * FACE[b + 8]) / d;
  return f;
};

// Fibonacci spiral direction i of n
const fibDir = (o, k, i, n) => {
  const phi = PI * (3 - sqrt(5)), y = 1 - 2 * (i + 0.5) / n, r = sqrt(max(0, 1 - y * y)), a = phi * i;
  o[k] = cos(a) * r; o[k + 1] = y; o[k + 2] = sin(a) * r;
};
