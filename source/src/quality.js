// ============================================================================
// quality level and planet size, chosen before anything is built
// ============================================================================
// LV: 0 High, 1 Medium, 2 Low. localStorage.paradise = "level,pixels,diameter". paradiseLoad is set while the
// world is built: still set on the next visit means that load crashed the tab, so this one runs a level lower.
const mob = matchMedia('(pointer:coarse)').matches, mem = navigator.deviceMemory;
const keep = (k, v) => { try { localStorage[k] = v; } catch {} };
let SV = [], LV, bad;
try { SV = (localStorage.paradise || '').split(','); bad = localStorage.paradiseLoad; } catch {}
LV = SV[0] ? +SV[0] : mob ? (mem > 7 ? 1 : 2) : mem <= 4 ? 2 : 0;
if (bad && LV < 2) { SV = [++LV]; keep('paradise', LV); }
// planet diameter (km), from the menu; ?km= in the address wins (tests, links)
const URLQ = new URLSearchParams(location.search);
let DIAM = +URLQ.get('km') || +SV[2] || 30;
DIAM = DIAM < 10 ? 10 : DIAM > 50 ? 50 : DIAM | 0;
if (URLQ.get('q')) LV = +URLQ.get('q');
// what each level spends
const AA = LV > 1 ? 1 : 4;                    // MSAA samples
const SLOTS = +URLQ.get('slots') || [1536, 1024, 640][LV]; // terrain patches kept on the GPU
const LODQ = [2.4, 1.9, 1.4][LV];             // split when closer than LODQ x patch size
const BUILDS = [24, 16, 10][LV];              // patches generated per frame
const NCASC = LV > 1 ? 2 : 3, SHN = [2048, 1536, 1024][LV], SHR = [28, 200, 1800]; // sun shadow cascades (radius, m)
