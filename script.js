'use strict';

// ── LANDMARK NAMES ──────────────────────────────────────────────────────
const LM_NAMES = [
  'Wrist',
  'Thumb CMC','Thumb MCP','Thumb IP','Thumb Tip',
  'Index MCP','Index PIP','Index DIP','Index Tip',
  'Middle MCP','Middle PIP','Middle DIP','Middle Tip',
  'Ring MCP','Ring PIP','Ring DIP','Ring Tip',
  'Pinky MCP','Pinky PIP','Pinky DIP','Pinky Tip'
];

// ── FINGER COLORS ───────────────────────────────────────────────────────
const FC = {
  thumb:'#f9c846', index:'#2277ff', middle:'#8855ee',
  ring:'#ff3cac', pinky:'#3cff8f', palm:'#4a7aff'
};

// ── SKELETON CONNECTIONS ────────────────────────────────────────────────
const BONES = [
  [0,1],[1,2],[2,3],[3,4],
  [0,5],[5,6],[6,7],[7,8],
  [0,9],[9,10],[10,11],[11,12],
  [0,13],[13,14],[14,15],[15,16],
  [0,17],[17,18],[18,19],[19,20],
  [5,9],[9,13],[13,17]
];

function boneColor(a, b) {
  const hi = Math.max(a, b);
  if (hi <= 4)  return FC.thumb;
  if (hi <= 8)  return FC.index;
  if (hi <= 12) return FC.middle;
  if (hi <= 16) return FC.ring;
  if (hi <= 20) return FC.pinky;
  return FC.palm;
}

function nodeColor() { return '#00ffe7'; }

// ── STATE ────────────────────────────────────────────────────────────────
let mpHands = null, stream = null, running = false;
let lastLM  = null;
let fpsT = performance.now(), fpsC = 0;
let VW = 640, VH = 480;

// ── DOM REFS ─────────────────────────────────────────────────────────────
const ge = id => document.getElementById(id);
const vidEl      = ge('input_video');
const vidCanvas  = ge('vid_canvas');
const skelCanvas = ge('skel_canvas');
const vCtx       = vidCanvas.getContext('2d');
const sCtx       = skelCanvas.getContext('2d');
const offCanvas  = document.createElement('canvas');
const offCtx     = offCanvas.getContext('2d');

// ── HELPERS ───────────────────────────────────────────────────────────────
function setStatus(msg, s = 'idle') {
  ge('status-text').textContent = msg;
  ge('status-dot').className = s === 'active' ? 'active' : s === 'error' ? 'error' : '';
}
function toast(txt, t = 'ok') {
  const c = ge('toast-container'), el = document.createElement('div');
  el.className = 'toast' + (t === 'error' ? ' error' : t === 'warn' ? ' warn' : '');
  el.textContent = '[SYS] ' + txt;
  c.appendChild(el);
  setTimeout(() => el.remove(), 4200);
}

// ── AUDIO SYNTH ─────────────────────────────────────────────────────────
const Synth = {
  ctx: null,
  init() { if (this.ctx) return; this.ctx = new (window.AudioContext || window.webkitAudioContext)(); },
  beep(f, t, d) {
    if (!ge('soundEffects').checked) return;
    this.init();
    if (this.ctx.state === 'suspended') this.ctx.resume();
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.connect(g); g.connect(this.ctx.destination);
    o.type = t; o.frequency.value = f;
    g.gain.setValueAtTime(0.055, this.ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + d);
    o.start(); o.stop(this.ctx.currentTime + d);
  },
  click() { this.beep(900, 'sine', 0.05); },
  ok()    { this.beep(523, 'triangle', 0.09); setTimeout(() => this.beep(659, 'triangle', 0.14), 65); },
  err()   { this.beep(180, 'sawtooth', 0.22); },
};

// ── PALM MESH TRIANGLES (video overlay) ──────────────────────────────────
const MESH_TRIANGLES = [
  [0,1,5],[0,5,9],[0,9,13],[0,13,17],[0,17,5],
  [5,9,13],[9,13,17],[5,13,17],
  [1,2,5],[2,3,5],[3,4,5],
  [5,6,9],[6,7,9],[7,8,9],
  [9,10,13],[10,11,13],[11,12,13],
  [13,14,17],[14,15,17],[15,16,17],
  [17,18,0],[18,19,0],[19,20,0],
  [4,8,5],[8,12,9],[12,16,13],[16,20,17],
  [4,8,12],[8,12,16],[4,12,20],
];

// ── SKELETON RENDERER — FLICKER-FREE OFFSCREEN BLIT ──────────────────────
function drawSkeleton(lm) {
  if (!skelCanvas) return;
  const W = skelCanvas.width, H = skelCanvas.height;
  offCtx.clearRect(0, 0, W, H);
  const px = p => ({ x: (1 - p.x) * W, y: p.y * H });

  offCtx.save(); offCtx.lineWidth = 10; offCtx.globalAlpha = 0.18; offCtx.lineCap = 'round';
  BONES.forEach(([a, b]) => {
    const pa = px(lm[a]), pb = px(lm[b]), col = boneColor(a, b);
    offCtx.beginPath(); offCtx.moveTo(pa.x, pa.y); offCtx.lineTo(pb.x, pb.y);
    offCtx.strokeStyle = col; offCtx.stroke();
  });
  offCtx.restore();

  offCtx.save(); offCtx.lineWidth = 2.2; offCtx.lineCap = 'round'; offCtx.globalAlpha = 1;
  BONES.forEach(([a, b]) => {
    const pa = px(lm[a]), pb = px(lm[b]), col = boneColor(a, b);
    offCtx.beginPath(); offCtx.moveTo(pa.x, pa.y); offCtx.lineTo(pb.x, pb.y);
    offCtx.strokeStyle = col; offCtx.stroke();
  });
  offCtx.restore();

  lm.forEach((lmk, i) => {
    const p = px(lmk), col = nodeColor(), tip = [4,8,12,16,20].includes(i), r = tip ? 6 : 3.5;
    offCtx.beginPath(); offCtx.arc(p.x, p.y, r + 5, 0, Math.PI * 2);
    offCtx.fillStyle = col; offCtx.globalAlpha = 0.14; offCtx.fill(); offCtx.globalAlpha = 1;
    offCtx.beginPath(); offCtx.arc(p.x, p.y, r, 0, Math.PI * 2);
    offCtx.fillStyle = col; offCtx.fill();
    if (tip) {
      offCtx.beginPath(); offCtx.arc(p.x, p.y, r + 3.5, 0, Math.PI * 2);
      offCtx.strokeStyle = col; offCtx.lineWidth = 1; offCtx.globalAlpha = 0.45;
      offCtx.stroke(); offCtx.globalAlpha = 1;
    }
  });

  sCtx.clearRect(0, 0, W, H);
  sCtx.drawImage(offCanvas, 0, 0);
}

// ── VIDEO RENDERER ────────────────────────────────────────────────────────
function drawVideo(lm) {
  const W = vidCanvas.width, H = vidCanvas.height;
  const mirror = ge('mirrorMode').checked;
  vCtx.save();
  if (mirror) { vCtx.scale(-1, 1); vCtx.translate(-W, 0); }
  vCtx.drawImage(vidEl, 0, 0, W, H);
  vCtx.restore();
  if (!lm) return;
  const px = p => mirror ? { x: (1 - p.x) * W, y: p.y * H } : { x: p.x * W, y: p.y * H };
  const pts = lm.map(p => px(p));

  vCtx.save(); vCtx.globalAlpha = 0.22; vCtx.strokeStyle = 'rgba(180,200,255,0.7)'; vCtx.lineWidth = 0.7;
  MESH_TRIANGLES.forEach(([a, b, c]) => {
    vCtx.beginPath(); vCtx.moveTo(pts[a].x, pts[a].y);
    vCtx.lineTo(pts[b].x, pts[b].y); vCtx.lineTo(pts[c].x, pts[c].y);
    vCtx.closePath(); vCtx.stroke();
  });
  vCtx.restore();

  vCtx.save(); vCtx.globalAlpha = 0.75; vCtx.strokeStyle = '#00ffe7'; vCtx.lineWidth = 1.8; vCtx.lineCap = 'round';
  BONES.forEach(([a, b]) => {
    vCtx.beginPath(); vCtx.moveTo(pts[a].x, pts[a].y); vCtx.lineTo(pts[b].x, pts[b].y); vCtx.stroke();
  });
  vCtx.restore();

  lm.forEach((lmk, i) => {
    const p = pts[i];
    vCtx.save();
    vCtx.beginPath(); vCtx.arc(p.x, p.y, 4.5, 0, Math.PI * 2); vCtx.fillStyle = '#00ffe7'; vCtx.globalAlpha = 1; vCtx.fill();
    vCtx.beginPath(); vCtx.arc(p.x, p.y, 7, 0, Math.PI * 2); vCtx.strokeStyle = '#00ffe7'; vCtx.lineWidth = 1; vCtx.globalAlpha = 0.45; vCtx.stroke();
    vCtx.restore();
  });
  vCtx.globalAlpha = 1;
}

// ═══════════════════════════════════════════════════════════════════════════
// 21-POINT 3D MEDIA PIPELINE — Panel 07
// Pure Canvas 2D perspective projection.
// Drag to orbit. Depth-sorted bones & joints. Centered on hand centroid.
// ═══════════════════════════════════════════════════════════════════════════

const arCanvas = ge('ar_canvas');
const arCtx    = arCanvas.getContext('2d');

// Style modes: 0=Perspective  1=Orthographic  2=Wireframe-only
let arStyle   = 0;
let arDepthOn = true;
const AR_STYLE_NAMES = ['Perspective', 'Orthographic', 'Wireframe'];

// Orbit state
let orbitX = 0.18, orbitY = 0.0;
let dragActive = false, dragSX = 0, dragSY = 0;

const FOCAL       = 3.2;
const WORLD_SCALE = 7.0;
const Z_SCALE     = 3.5;

function rotatePoint(x, y, z, rx, ry) {
  const cosX = Math.cos(rx), sinX = Math.sin(rx);
  const y1 = cosX * y - sinX * z;
  const z1 = sinX * y + cosX * z;
  const cosY = Math.cos(ry), sinY = Math.sin(ry);
  const x2 =  cosY * x + sinY * z1;
  const z2 = -sinY * x + cosY * z1;
  return { x: x2, y: y1, z: z2 };
}

function project(pt, W, H, perspective) {
  const camZ = 5.5;
  if (perspective) {
    const dz = camZ - pt.z;
    const scale = FOCAL / (dz < 0.1 ? 0.1 : dz);
    return { x: W * 0.5 + pt.x * scale * W * 0.5, y: H * 0.5 - pt.y * scale * H * 0.5, depth: pt.z };
  }
  return { x: W * 0.5 + pt.x * W * 0.38, y: H * 0.5 - pt.y * H * 0.38, depth: pt.z };
}

/* Centers hand on its own centroid so it always fills the canvas */
function buildWorldPts(lm) {
  let cx = 0, cy = 0, cz = 0;
  lm.forEach(p => { cx += p.x; cy += p.y; cz += (p.z || 0); });
  cx /= 21; cy /= 21; cz /= 21;
  return lm.map(p => ({
    x:  (cx - p.x)  * WORLD_SCALE,
    y:  (cy - p.y)  * WORLD_SCALE,
    z:  -((p.z || 0) - cz) * Z_SCALE
  }));
}

function draw3DPipeline(lm) {
  const W = arCanvas.clientWidth  || 640;
  const H = arCanvas.clientHeight || 480;
  arCanvas.width  = W;
  arCanvas.height = H;

  const isDark = document.documentElement.classList.contains('dark');
  arCtx.fillStyle = isDark ? '#050810' : '#f0f4fa';
  arCtx.fillRect(0, 0, W, H);

  if (!lm) {
    ge('no-ar-msg').style.opacity = '1';
    return;
  }
  ge('no-ar-msg').style.opacity = '0';

  const perspective = (arStyle !== 1);
  const rawPts = buildWorldPts(lm);
  const pts3d  = rawPts.map(p => rotatePoint(p.x, p.y, p.z, orbitX, orbitY));
  const pts2d  = pts3d.map(p => project(p, W, H, perspective));

  // Depth-sort bones (painter's algorithm — back to front)
  const boneList = BONES.map(([a, b]) => ({
    a, b,
    avgDepth: (pts3d[a].z + pts3d[b].z) * 0.5,
    col: boneColor(a, b)
  })).sort((x, y) => x.avgDepth - y.avgDepth);

  // Pass 1 — glow halos
  if (arStyle !== 2) {
    boneList.forEach(bone => {
      const pa = pts2d[bone.a], pb = pts2d[bone.b];
      const alpha = arDepthOn ? Math.max(0.04, 0.18 + bone.avgDepth * 0.08) : 0.12;
      arCtx.save();
      arCtx.globalAlpha = alpha; arCtx.lineWidth = 14; arCtx.lineCap = 'round';
      arCtx.strokeStyle = bone.col; arCtx.shadowColor = bone.col; arCtx.shadowBlur = 18;
      arCtx.beginPath(); arCtx.moveTo(pa.x, pa.y); arCtx.lineTo(pb.x, pb.y); arCtx.stroke();
      arCtx.restore();
    });
  }

  // Pass 2 — core bones
  boneList.forEach(bone => {
    const pa = pts2d[bone.a], pb = pts2d[bone.b];
    const alpha = arDepthOn ? Math.max(0.25, 0.85 + bone.avgDepth * 0.18) : 0.82;
    const lw    = arDepthOn ? Math.max(1.2, 2.8 + bone.avgDepth * 0.6) : 2.2;
    arCtx.save();
    arCtx.globalAlpha = Math.min(1, alpha); arCtx.lineWidth = lw; arCtx.lineCap = 'round';
    arCtx.strokeStyle = bone.col; arCtx.shadowColor = bone.col;
    arCtx.shadowBlur = arStyle === 2 ? 10 : 5;
    arCtx.beginPath(); arCtx.moveTo(pa.x, pa.y); arCtx.lineTo(pb.x, pb.y); arCtx.stroke();
    arCtx.restore();
  });

  // Pass 3 — palm mesh wireframe
  const PALM_TRIS = [
    [0,1,5],[0,5,9],[0,9,13],[0,13,17],[5,9,13],[9,13,17]
  ];
  arCtx.save();
  arCtx.globalAlpha = arDepthOn ? 0.12 : 0.08;
  arCtx.strokeStyle = '#4a7aff'; arCtx.lineWidth = 0.8;
  PALM_TRIS.forEach(([a, b, c]) => {
    arCtx.beginPath();
    arCtx.moveTo(pts2d[a].x, pts2d[a].y);
    arCtx.lineTo(pts2d[b].x, pts2d[b].y);
    arCtx.lineTo(pts2d[c].x, pts2d[c].y);
    arCtx.closePath(); arCtx.stroke();
  });
  arCtx.restore();

  // Pass 4 — depth-sorted joints
  [...Array(21).keys()]
    .sort((a, b) => pts3d[a].z - pts3d[b].z)
    .forEach(i => {
      const p = pts2d[i], depth = pts3d[i].z;
      const isTip = [4,8,12,16,20].includes(i);
      const baseR  = isTip ? 7 : 4;
      const r      = arDepthOn ? Math.max(1.5, baseR + depth * 1.4) : baseR;
      const alpha  = arDepthOn ? Math.max(0.3, 0.9 + depth * 0.15) : 0.9;

      arCtx.save();
      arCtx.globalAlpha = alpha * 0.18;
      arCtx.beginPath(); arCtx.arc(p.x, p.y, r + 6, 0, Math.PI * 2);
      arCtx.fillStyle = '#00ffe7'; arCtx.fill();
      arCtx.restore();

      arCtx.save();
      arCtx.globalAlpha = Math.min(1, alpha);
      arCtx.shadowColor = '#00ffe7'; arCtx.shadowBlur = isTip ? 16 : 8;
      arCtx.beginPath(); arCtx.arc(p.x, p.y, r, 0, Math.PI * 2);
      arCtx.fillStyle = '#00ffe7'; arCtx.fill();
      arCtx.restore();

      if (isTip) {
        arCtx.save();
        arCtx.globalAlpha = alpha * 0.45;
        arCtx.beginPath(); arCtx.arc(p.x, p.y, r + 4, 0, Math.PI * 2);
        arCtx.strokeStyle = '#00ffe7'; arCtx.lineWidth = 1.2; arCtx.stroke();
        arCtx.restore();
      }
    });

  // Pass 5 — index labels (wireframe mode only)
  if (arStyle === 2) {
    arCtx.save();
    arCtx.font = '8px Share Tech Mono';
    arCtx.fillStyle = '#00ffe7'; arCtx.globalAlpha = 0.55;
    pts2d.forEach((p, i) => arCtx.fillText(i, p.x + 5, p.y - 3));
    arCtx.restore();
  }
}

// ── Orbit drag — mouse ────────────────────────────────────────────────────
arCanvas.addEventListener('mousedown', e => {
  dragActive = true; dragSX = e.clientX; dragSY = e.clientY;
  arCanvas.style.cursor = 'grabbing';
});
window.addEventListener('mousemove', e => {
  if (!dragActive) return;
  orbitY += (e.clientX - dragSX) * 0.006;
  orbitX += (e.clientY - dragSY) * 0.006;
  dragSX = e.clientX; dragSY = e.clientY;
  if (lastLM) draw3DPipeline(lastLM);
});
window.addEventListener('mouseup', () => { dragActive = false; arCanvas.style.cursor = 'grab'; });

// ── Orbit drag — touch ────────────────────────────────────────────────────
arCanvas.addEventListener('touchstart', e => {
  if (e.touches.length === 1) {
    dragActive = true;
    dragSX = e.touches[0].clientX; dragSY = e.touches[0].clientY;
  }
}, { passive: true });
window.addEventListener('touchmove', e => {
  if (!dragActive || e.touches.length !== 1) return;
  orbitY += (e.touches[0].clientX - dragSX) * 0.008;
  orbitX += (e.touches[0].clientY - dragSY) * 0.008;
  dragSX = e.touches[0].clientX; dragSY = e.touches[0].clientY;
  if (lastLM) draw3DPipeline(lastLM);
}, { passive: true });
window.addEventListener('touchend', () => { dragActive = false; });

// ── Resize sync ───────────────────────────────────────────────────────────
window.addEventListener('resize', () => {
  lastLM ? draw3DPipeline(lastLM) : draw3DPipeline(null);
});

// ── Style / Depth buttons ─────────────────────────────────────────────────
ge('meshStyleBtn').addEventListener('click', () => {
  arStyle = (arStyle + 1) % 3;
  ge('meshStyleBtn').textContent = 'Style: ' + AR_STYLE_NAMES[arStyle];
  ge('ar-style-label').textContent = AR_STYLE_NAMES[arStyle].toUpperCase();
  if (lastLM) draw3DPipeline(lastLM);
});
ge('meshDepthBtn').addEventListener('click', () => {
  arDepthOn = !arDepthOn;
  ge('meshDepthBtn').textContent = 'Depth: ' + (arDepthOn ? 'ON' : 'OFF');
  if (lastLM) draw3DPipeline(lastLM);
});

// ── LANDMARK COORDS TABLE ─────────────────────────────────────────────────
function updateCoords(lm) {
  const cmap = [
    'palm',
    'thumb','thumb','thumb','thumb',
    'index','index','index','index',
    'middle','middle','middle','middle',
    'ring','ring','ring','ring',
    'pinky','pinky','pinky','pinky'
  ];
  ge('coords-tbody').innerHTML = lm.map((p, i) => {
    const c = FC[cmap[i]] || '#fff';
    return `<tr>
      <td>${i}</td>
      <td><span class="lm-dot" style="background:${c}"></span>${LM_NAMES[i]}</td>
      <td>${p.x.toFixed(3)}</td>
      <td>${p.y.toFixed(3)}</td>
      <td>${(p.z || 0).toFixed(3)}</td>
    </tr>`;
  }).join('');
}

// ── RESET UI ──────────────────────────────────────────────────────────────
function resetUI() {
  ge('fps-badge').textContent = '-- FPS';
  const noHandMsg = ge('no-hand-msg');
  if (noHandMsg) noHandMsg.style.opacity = '1';
  ge('coords-tbody').innerHTML =
    '<tr><td colspan="5" style="color:var(--text-dim);padding:6px 0">No data</td></tr>';
}

// ── MEDIAPIPE HANDS — MANUAL RAF LOOP ────────────────────────────────────
let rafHandle = null, mpReady = false;

async function initMediaPipe() {
  setStatus('Initialising MediaPipe...', 'idle');
  try {
    mpHands = new Hands({
      locateFile: f => `https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1646424915/${f}`
    });
    mpHands.setOptions({
      maxNumHands: 1, modelComplexity: 1,
      minDetectionConfidence: 0.70, minTrackingConfidence: 0.65,
    });
    mpHands.onResults(onResults);
    await mpHands.initialize();
    mpReady = true;
    setStatus('Model ready — click Start Camera', 'idle');
    ge('startBtn').disabled = false;
    toast('MediaPipe Hands model loaded.');
  } catch (e) {
    // initialize() sometimes rejects even when model works fine — try anyway
    mpReady = true;
    setStatus('Model ready — click Start Camera', 'idle');
    ge('startBtn').disabled = false;
  }
}

function onResults(results) {
  fpsC++;
  const now = performance.now();
  if (now - fpsT >= 1000) { ge('fps-badge').textContent = fpsC + ' FPS'; fpsC = 0; fpsT = now; }

  const noHandMsg = ge('no-hand-msg');
  const noArMsg   = ge('no-ar-msg');

  if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
    const lm = results.multiHandLandmarks[0];
    lastLM = lm;
    drawVideo(lm);
    drawSkeleton(lm);
    draw3DPipeline(lm);
    updateCoords(lm);
    if (noHandMsg) noHandMsg.style.opacity = '0';
    if (noArMsg)   noArMsg.style.opacity   = '0';
  } else {
    lastLM = null;
    drawVideo(null);
    if (skelCanvas && sCtx) sCtx.clearRect(0, 0, skelCanvas.width, skelCanvas.height);
    draw3DPipeline(null);
    if (noHandMsg) noHandMsg.style.opacity = '1';
    if (noArMsg)   noArMsg.style.opacity   = '1';
    resetUI();
  }
}

async function rafLoop() {
  if (!running) return;
  if (vidEl.readyState >= 2) await mpHands.send({ image: vidEl });
  rafHandle = requestAnimationFrame(rafLoop);
}

// ── CAMERA START / STOP ───────────────────────────────────────────────────
const CAM_CONSTRAINTS = [
  { video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 } } },
  { video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 } } },
  { video: true },
  { video: { facingMode: 'environment' } },
];

function camErrorMsg(e) {
  const n = e.name || '';
  if (n === 'NotAllowedError' || n === 'PermissionDeniedError') {
    if (location.protocol !== 'https:' && location.hostname !== 'localhost')
      return 'Camera blocked — page must be served over HTTPS.';
    return 'Camera permission denied. Tap 🔒 → Site settings → Camera → Allow.';
  }
  if (n === 'NotFoundError' || n === 'DevicesNotFoundError') return 'No camera found on this device.';
  if (n === 'NotReadableError' || n === 'TrackStartError')   return 'Camera in use by another app.';
  if (n === 'OverconstrainedError')  return 'Camera resolution unsupported — retrying...';
  if (n === 'SecurityError')         return 'Camera blocked by browser security policy. Use HTTPS.';
  return 'Camera error: ' + (e.message || n || 'Unknown');
}

async function startCamera() {
  if (running) return;
  Synth.init(); Synth.click();

  if (location.protocol !== 'https:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1')
    toast('⚠ Not on HTTPS — camera may be blocked.', 'warn');

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    setStatus('Camera API unavailable — use HTTPS in Chrome', 'error');
    toast('getUserMedia not available. Open page over HTTPS.', 'error'); return;
  }

  setStatus('Requesting camera...', 'idle');
  let acquired = false;
  for (let lvl = 0; lvl < CAM_CONSTRAINTS.length; lvl++) {
    try {
      setStatus(`Trying camera (attempt ${lvl + 1}/${CAM_CONSTRAINTS.length})...`, 'idle');
      stream = await navigator.mediaDevices.getUserMedia(CAM_CONSTRAINTS[lvl]);
      acquired = true;
      if (lvl > 0) toast(`Camera started with fallback level ${lvl + 1}.`, 'warn');
      break;
    } catch (e) {
      const msg = camErrorMsg(e);
      if (e.name === 'NotAllowedError' || e.name === 'PermissionDeniedError' || e.name === 'SecurityError') {
        setStatus(msg, 'error'); toast(msg, 'error'); return;
      }
      if (e.name === 'NotFoundError' || e.name === 'DevicesNotFoundError') {
        setStatus(msg, 'error'); toast(msg, 'error'); return;
      }
      toast(msg + (lvl < CAM_CONSTRAINTS.length - 1 ? ' Retrying...' : ''), 'warn');
    }
  }

  if (!acquired) {
    setStatus('All camera attempts failed. Check permissions and HTTPS.', 'error');
    toast('Could not access camera after all attempts.', 'error'); return;
  }

  try {
    vidEl.srcObject = stream;
    await Promise.race([
      new Promise(r => { vidEl.onloadedmetadata = r; }),
      new Promise(r => setTimeout(r, 4000))
    ]);
    try { await vidEl.play(); } catch (_) {}

    VW = vidEl.videoWidth  || 640;
    VH = vidEl.videoHeight || 480;
    vidCanvas.width  = VW; vidCanvas.height  = VH;
    skelCanvas.width = VW; skelCanvas.height = VH;
    offCanvas.width  = VW; offCanvas.height  = VH;

    running = true;
    ge('startBtn').disabled = true;
    ge('stopBtn').disabled  = false;
    setStatus('MediaPipe Detection Active', 'active');
    toast('Pipeline active — show your hand!');
    rafLoop();
  } catch (e) {
    setStatus('Video setup error: ' + e.message, 'error');
    toast('Video init failed: ' + e.message, 'error');
    if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
  }
}

function stopCamera() {
  Synth.err();
  running = false;
  if (rafHandle) { cancelAnimationFrame(rafHandle); rafHandle = null; }
  if (stream)    { stream.getTracks().forEach(t => t.stop()); stream = null; }
  vidEl.srcObject = null;
  vCtx.clearRect(0, 0, vidCanvas.width, vidCanvas.height);
  if (skelCanvas && sCtx) sCtx.clearRect(0, 0, skelCanvas.width, skelCanvas.height);
  draw3DPipeline(null);
  lastLM = null;
  ge('startBtn').disabled = false;
  ge('stopBtn').disabled  = true;
  setStatus('Detection stopped.', 'idle');
  resetUI();
  toast('Pipeline stopped.');
}

// ── BOOT ──────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  document.body.addEventListener('pointerdown', () => Synth.init(), { once: true });
  ge('startBtn').addEventListener('click', startCamera);
  ge('stopBtn').addEventListener('click',  stopCamera);

  // MediaPipe loads synchronously before this script, but guard just in case
  if (typeof Hands !== 'undefined') {
    initMediaPipe();
  } else {
    setStatus('MediaPipe failed to load — check connection', 'error');
    toast('Could not load MediaPipe Hands. Reload the page.', 'error');
  }
});

// ── DARK MODE TOGGLE ──────────────────────────────────────────────────────
(function () {
  const darkToggle = document.getElementById('darkToggle');
  const toggleIcon = document.getElementById('toggle-icon-label');
  const html       = document.documentElement;

  if (localStorage.getItem('darkMode') === 'true') {
    html.classList.add('dark');
    toggleIcon.textContent = '☀️';
  }

  darkToggle.addEventListener('click', () => {
    const isDark = html.classList.toggle('dark');
    toggleIcon.textContent = isDark ? '☀️' : '🌙';
    localStorage.setItem('darkMode', isDark);
    lastLM ? draw3DPipeline(lastLM) : draw3DPipeline(null);
  });
})();
