// ============================================================================
// development tools (dev.html only): test hooks, still shots, scripted flight
// ============================================================================
window.PP = {
  goPose, setHour, POSES, CP, CB,
  pending: () => nReq,
  frames: () => frameN,
  gpu: () => gpuMs,
  draws: () => lastDraw,
  slotsFree: () => nFree,
};
// ?shot: no menu, full resolution, time stopped (the harness drives the frames)
if (URLQ.has('shot')) {
  menu = false; body.className = 'g'; fixedRes = true; pix = 1e9; resize(); timeIdx = 0;
  for (const id of ['t', 'o']) $(id).style.display = 'none';
  document.head.insertAdjacentHTML('beforeend', '<style>*{transition:none!important}</style>');
  if (URLQ.get('hour')) setHour(+URLQ.get('hour'));
}
