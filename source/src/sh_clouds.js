// ============================================================================
// WGSL: volumetric clouds and their shadow map (lot L4)
// ============================================================================
// cloudShadowMap(rel): (sun transmittance through the clouds, openness of the sky) at a camera-relative point
const W_CLOUDSH = /*wgsl*/`
fn cloudShadowMap(rel: vec3f) -> vec2f { return vec2f(1.0); }
`;

// lighting of a surface point: the sun through the atmosphere and the clouds, the sky's irradiance
const W_LIGHT = W_CLOUDSH + /*wgsl*/`
// clouds: (sun transmittance, sky openness) at a camera-relative point (L4 fills the map; 1, 1 without clouds)
fn cloudShadow(rel: vec3f) -> vec2f {
  let d = textureDimensions(tCloudSh);
  if (d.x < 2u) { return vec2f(1.0); }
  return cloudShadowMap(rel);
}
// a lit Lambert surface: sun, sky (more from above than from the side), a little bounce light
fn surfaceLight(alb: vec3f, n: vec3f, up: vec3f, rel: vec3f, h: f32) -> vec3f {
  let cs = cloudShadow(rel);
  let sun = sunAt(up, h) * cs.x;
  let sky = skyIrr(up, h) * (0.55 + 0.45 * cs.y);
  let c = dot(n, up);
  return alb * (sun * max(dot(n, F.sun.xyz), 0.0) / PI + sky / PI * (0.62 + 0.38 * c));
}
`;
