// ============================================================================
// WGSL: bloom chain and the final image (exposure, tone mapping, grain)
// ============================================================================
const W_BLIT = /*wgsl*/`
@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var smp: sampler;
struct VO { @builtin(position) p: vec4f, @location(0) uv: vec2f };
@vertex fn vs(@builtin(vertex_index) i: u32) -> VO {
  let q = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  var o: VO; o.p = vec4f(q * 2.0 - 1.0, 0.0, 1.0); o.uv = vec2f(q.x, 1.0 - q.y); return o;
}
// 13-tap downsample (Jimenez 2014); the first one also clamps fireflies (sun glints)
fn down(uv: vec2f) -> vec3f {
  let t = 1.0 / vec2f(textureDimensions(src));
  let a = textureSampleLevel(src, smp, uv + t * vec2f(-2, -2), 0.0).rgb; let b = textureSampleLevel(src, smp, uv + t * vec2f(0, -2), 0.0).rgb;
  let c = textureSampleLevel(src, smp, uv + t * vec2f(2, -2), 0.0).rgb; let d = textureSampleLevel(src, smp, uv + t * vec2f(-2, 0), 0.0).rgb;
  let e = textureSampleLevel(src, smp, uv, 0.0).rgb; let f = textureSampleLevel(src, smp, uv + t * vec2f(2, 0), 0.0).rgb;
  let g = textureSampleLevel(src, smp, uv + t * vec2f(-2, 2), 0.0).rgb; let h = textureSampleLevel(src, smp, uv + t * vec2f(0, 2), 0.0).rgb;
  let i = textureSampleLevel(src, smp, uv + t * vec2f(2, 2), 0.0).rgb; let j = textureSampleLevel(src, smp, uv + t * vec2f(-1, -1), 0.0).rgb;
  let k = textureSampleLevel(src, smp, uv + t * vec2f(1, -1), 0.0).rgb; let l = textureSampleLevel(src, smp, uv + t * vec2f(-1, 1), 0.0).rgb;
  let m = textureSampleLevel(src, smp, uv + t * vec2f(1, 1), 0.0).rgb;
  return e * 0.125 + (a + c + g + i) * 0.03125 + (b + d + f + h) * 0.0625 + (j + k + l + m) * 0.125;
}
@fragment fn fsDown0(i: VO) -> @location(0) vec4f { let c = down(i.uv); return vec4f(c / (1.0 + max(dot(c, vec3f(0.2126, 0.7152, 0.0722)) * 0.05, 0.0)), 1.0); }
@fragment fn fsDown(i: VO) -> @location(0) vec4f { return vec4f(down(i.uv), 1.0); }
@fragment fn fsUp(i: VO) -> @location(0) vec4f {
  let t = 1.0 / vec2f(textureDimensions(src));
  var c = textureSampleLevel(src, smp, i.uv, 0.0).rgb * 4.0;
  c += (textureSampleLevel(src, smp, i.uv + t * vec2f(-1, 0), 0.0).rgb + textureSampleLevel(src, smp, i.uv + t * vec2f(1, 0), 0.0).rgb
     + textureSampleLevel(src, smp, i.uv + t * vec2f(0, -1), 0.0).rgb + textureSampleLevel(src, smp, i.uv + t * vec2f(0, 1), 0.0).rgb) * 2.0;
  c += textureSampleLevel(src, smp, i.uv + t * vec2f(-1, -1), 0.0).rgb + textureSampleLevel(src, smp, i.uv + t * vec2f(1, -1), 0.0).rgb
     + textureSampleLevel(src, smp, i.uv + t * vec2f(-1, 1), 0.0).rgb + textureSampleLevel(src, smp, i.uv + t * vec2f(1, 1), 0.0).rgb;
  return vec4f(c / 16.0, 1.0);
}
`;

const W_POST = W_FRAME + /*wgsl*/`
@group(1) @binding(0) var cIn: texture_2d<f32>;
@group(1) @binding(1) var bloom: texture_2d<f32>;
@group(1) @binding(2) var smp: sampler;
@group(1) @binding(3) var rays: texture_2d<f32>;
@group(1) @binding(4) var<storage, read> E: array<f32, 4>;
struct VO { @builtin(position) p: vec4f, @location(0) uv: vec2f };
@vertex fn vs(@builtin(vertex_index) i: u32) -> VO {
  let q = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  var o: VO; o.p = vec4f(q * 2.0 - 1.0, 0.0, 1.0); o.uv = vec2f(q.x, 1.0 - q.y); return o;
}
// ACES filmic (Hill fit), in linear sRGB
fn aces(x: vec3f) -> vec3f {
  let i = mat3x3f(0.59719, 0.07600, 0.02840, 0.35458, 0.90834, 0.13383, 0.04823, 0.01566, 0.83777);
  let o = mat3x3f(1.60475, -0.10208, -0.00327, -0.53108, 1.10813, -0.07276, -0.07367, -0.00605, 1.07602);
  let v = i * x;
  let a = v * (v + 0.0245786) - 0.000090537; let b = v * (0.983729 * v + 0.4329510) + 0.238081;
  return clamp(o * (a / b), vec3f(0.0), vec3f(1.0));
}
fn toSrgb(c: vec3f) -> vec3f { return select(1.055 * pow(c, vec3f(1.0 / 2.4)) - 0.055, c * 12.92, c <= vec3f(0.0031308)); }
@fragment fn fs(i: VO) -> @location(0) vec4f {
  var c = textureSampleLevel(cIn, smp, i.uv, 0.0).rgb + textureSampleLevel(rays, smp, i.uv, 0.0).rgb;
  c = mix(c, textureSampleLevel(bloom, smp, i.uv, 0.0).rgb, 0.06);
  c *= E[0] * F.misc.y;
  // a light vignette
  let v = i.uv - 0.5; c *= 1.0 - 0.22 * dot(v, v) * 2.0;
  var s = toSrgb(aces(c * 1.25));
  // triangular dither against banding in the gradients of the sky and the water
  let n = fract(sin(dot(i.p.xy + fract(F.misc.w * 0.618) * 37.0, vec2f(12.9898, 78.233))) * 43758.5453)
        + fract(sin(dot(i.p.xy + 3.7, vec2f(39.346, 11.135))) * 24634.6345) - 1.0;
  s += n / 255.0;
  return vec4f(s, 1.0);
}
`;

// Eye adaptation, all on the GPU: the mean log luminance of the smallest bloom level, the exposure eased toward its
// target in a storage buffer that the final pass reads (no read-back). Darkness is kept dark: the target exposure
// rises less than the light falls.
const W_EXPO = W_FRAME + /*wgsl*/`
@group(1) @binding(0) var lowRes: texture_2d<f32>;
@group(1) @binding(1) var<storage, read_write> E: array<f32, 4>;
var<workgroup> acc: array<f32, 256>;
var<workgroup> wacc: array<f32, 256>;
@compute @workgroup_size(256) fn main(@builtin(local_invocation_index) li: u32) {
  let d = textureDimensions(lowRes);
  // exposed for the land more than for the sky: the lower part of the image weighs more
  var s = 0.0; var ws = 0.0;
  for (var i = li; i < d.x * d.y; i += 256u) {
    let q = vec2u(i % d.x, i / d.x);
    let c = textureLoad(lowRes, q, 0).rgb;
    let lum = dot(c, vec3f(0.2126, 0.7152, 0.0722));
    // the black of space does not count (seen from orbit, the planet is what the eye looks at)
    let w = (0.2 + smoothstep(0.2, 0.7, f32(q.y) / f32(d.y))) * select(1.0, 0.02, F.cam.w > F.pl.y && lum < 2e-4);
    s += log2(max(lum, 1e-5)) * w; ws += w;
  }
  acc[li] = s; wacc[li] = ws;
  workgroupBarrier();
  for (var k = 128u; k > 0u; k >>= 1u) { if (li < k) { acc[li] += acc[li + k]; wacc[li] += wacc[li + k]; } workgroupBarrier(); }
  if (li == 0u) {
    let avg = acc[0] / max(wacc[0], 1e-3);
    // target: mid grey for a daylight scene; below, only half of the darkening is compensated
    let lum = exp2(avg);
    // under the sea the eye adapts fully: the garden stays bright as long as light reaches it
    let wet = F.cam.w < F.pl.x;
    // from space the eye adapts to a sunlit planet (the black around it does not count)
    let space = smoothstep(F.pl.y, F.pl.y * 1.4, F.cam.w);
    let tgt0 = select(0.27 / max(lum, 1e-5) * pow(clamp(lum / 0.1, 1e-4, 1.0), 0.45), 0.26 / max(lum, 1e-5), wet);
    let tgt = mix(tgt0, 1.25, space);
    let t = clamp(tgt, 0.25, select(24.0, 60.0, wet));
    if (E[1] == 0.0) { E[0] = t; E[1] = 1.0; }
    else { E[0] = exp2(mix(log2(E[0]), log2(t), 1.0 - exp(-F.sunc.w * 1.6))); }
  }
}
`;
