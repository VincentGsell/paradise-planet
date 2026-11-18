// ============================================================================
// WebGPU device, helpers, loading bar
// ============================================================================
const $ = (id) => document.getElementById(id);
const canvas = $('c'), info = $('i'), body = document.body;
// loading bar: each stage glides it to `to` (the share done) over ~`ms` on the compositor, so it moves while this
// thread is busy (Abyssal Garden's trick)
let loaded = 0, dead;
const say = (m, to, ms) => {
  if (!dead) $('s').textContent = m;
  const a = $('b').animate({ transform: [`scaleX(${loaded})`, `scaleX(${to})`] }, { duration: ms, fill: 'forwards', easing: 'cubic-bezier(.3,.5,.5,1)' });
  loaded = to;
  return new Promise((r) => { a.ready.then(() => setTimeout(r)); setTimeout(r, document.hidden ? 0 : 1e3); });
};
const fail = (m) => { throw new Error(m, { cause: 1 }); };
if (!navigator.gpu) fail('This world needs WebGPU. Try a current Chrome or Edge.');
const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
if (!adapter) fail('No WebGPU adapter found.');
$('w').hidden = !!navigator.userAgentData;
const hasTS = adapter.features.has('timestamp-query');
const device = await adapter.requestDevice({
  requiredFeatures: hasTS ? ['timestamp-query'] : [],
  requiredLimits: { maxStorageBufferBindingSize: min(adapter.limits.maxStorageBufferBindingSize, 1 << 30), maxBufferSize: min(adapter.limits.maxBufferSize, 1 << 30),
    maxComputeWorkgroupStorageSize: min(adapter.limits.maxComputeWorkgroupStorageSize, 32768) },
});
device.addEventListener('uncapturederror', (e) => console.error('GPU: ' + e.error.message));
device.lost.then((l) => {
  if (l.reason === 'destroyed') return;
  if (LV < 2) { keep('paradise', [LV + 1, '', DIAM]); location.reload(); }
  dead = body.className = 'l e'; $('s').textContent = 'The graphics device was lost. Reload the page to try again.';
});
const ctx = canvas.getContext('webgpu'), FMT = navigator.gpu.getPreferredCanvasFormat();
const Q = device.queue, HDR = 'rgba16float', DEPTH = 'depth32float';
const TU = GPUTextureUsage, BU = GPUBufferUsage, SS = GPUShaderStage;
const mod = (code) => device.createShaderModule({ code });
const buf = (data, usage) => { const b = device.createBuffer({ size: (data.byteLength + 3) & ~3, usage: usage | BU.COPY_DST }); Q.writeBuffer(b, 0, data.buffer || data, data.byteOffset || 0, data.byteLength); return b; };
const ubuf = (size) => device.createBuffer({ size, usage: BU.UNIFORM | BU.COPY_DST });
const sbuf = (size, extra = 0) => device.createBuffer({ size, usage: BU.STORAGE | BU.COPY_DST | extra });
const tex = (w, h, format, usage, o = {}) => device.createTexture({ size: [w, h, o.d || 1], format, usage, mipLevelCount: o.mips || 1, sampleCount: o.samples || 1, dimension: o.d ? '3d' : '2d' });
const ADD = { color: { srcFactor: 'one', dstFactor: 'one' }, alpha: { srcFactor: 'one', dstFactor: 'one' } };
const OVER = { color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' } };
const colorAtt = (view, clear) => ({ view, loadOp: clear ? 'clear' : 'load', storeOp: 'store', clearValue: [0, 0, 0, 0] });
const VF = SS.VERTEX | SS.FRAGMENT, VFC = VF | SS.COMPUTE;

// ---------------------------------------------------------------- shared resources: group 0 of every pass
const sLin = device.createSampler({ magFilter: 'linear', minFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });
const sRep = device.createSampler({ addressModeU: 'repeat', addressModeV: 'repeat', magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear', maxAnisotropy: LV > 1 ? 1 : 8 });
const FU = new Float32Array(88), uFrame = ubuf(352);
const AU = new Float32Array(28), uAtmo = ubuf(112);
const bPerm = buf(PERM, BU.STORAGE);
const LUTU = TU.STORAGE_BINDING | TU.TEXTURE_BINDING;
const tTrans = tex(TLUT[0], TLUT[1], HDR, LUTU), tMulti = tex(MLUT[0], MLUT[1], HDR, LUTU), tIrr = tex(ELUT[0], ELUT[1], HDR, LUTU), tSkyV = tex(SLUT[0], SLUT[1], HDR, LUTU);
const tBlack = tex(1, 1, HDR, TU.TEXTURE_BINDING | TU.RENDER_ATTACHMENT);
let tCloudSh = tex(1, 1, HDR, TU.TEXTURE_BINDING);
const bgl0 = device.createBindGroupLayout({ entries: [
  { binding: 0, visibility: VFC, buffer: {} }, { binding: 1, visibility: VFC, buffer: { type: 'read-only-storage' } },
  { binding: 2, visibility: VFC, buffer: {} }, { binding: 3, visibility: VFC, sampler: {} },
  { binding: 4, visibility: VFC, texture: {} }, { binding: 5, visibility: VFC, texture: {} }, { binding: 6, visibility: VFC, texture: {} }, { binding: 7, visibility: VFC, texture: {} },
  { binding: 8, visibility: VFC, sampler: {} }, { binding: 9, visibility: VFC, texture: {} }] });
// the LUT passes write one of the textures of group 0: they get a group where that one is replaced by a stand-in
const mkBG0 = (t, m, e, s, c) => device.createBindGroup({ layout: bgl0, entries: [
  { binding: 0, resource: { buffer: uFrame } }, { binding: 1, resource: { buffer: bPerm } }, { binding: 2, resource: { buffer: uAtmo } },
  { binding: 3, resource: sLin }, { binding: 4, resource: t.createView() }, { binding: 5, resource: m.createView() }, { binding: 6, resource: e.createView() },
  { binding: 7, resource: s.createView() }, { binding: 8, resource: sRep }, { binding: 9, resource: c.createView() }] });
let bg0 = mkBG0(tTrans, tMulti, tIrr, tSkyV, tCloudSh);
const bg0Sky = mkBG0(tTrans, tMulti, tIrr, tBlack, tBlack);
const lay = (...g) => device.createPipelineLayout({ bindGroupLayouts: g });
const bglOut = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: SS.COMPUTE, storageTexture: { access: 'write-only', format: HDR } }] });
const outBG = (t) => device.createBindGroup({ layout: bglOut, entries: [{ binding: 0, resource: t.createView() }] });
