// 小狗跳进照片: pick a photo (or a video, e.g. a Live Photo saved as video), tap a spot, and the puppy from the desktop pet runs in,
// jumps up onto it, waves, sits and wags her tail. Tap her = pat, tap twice = kiss, tap elsewhere = she goes there; left alone she runs off.
// Everything is drawn on one canvas, so 录下来 records exactly what is on the screen.
import { LINES } from './lines.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
// ?test: the clock only moves when window.__advance(ms) is called (for checking it without a visible screen)
const TEST = params.has('test');
let fakeNow = 0;
const now = () => (TEST ? fakeNow : performance.now());
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (list) => list[Math.floor(Math.random() * list.length)];
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const line = (kind) => pick(LINES[kind] ?? ['汪!']);

// ---------- the sprites (same sheet as the desktop pet and 和小狗玩) ----------
const CELL_W = 192, CELL_H = 208, SIT_H = 240, FOOT = 202, SIT_FOOT = 230;
const ROW = { idle: [0, 6], right: [1, 8], left: [2, 8], wave: [3, 4], jump: [4, 5] };
// sit.webp: 0 listening, 1 blink, 2 happy, 3 heart eyes (never used), 4 kiss
const SIT = { listen: 0, blink: 1, happy: 2, kiss: 4 };
const sheet = new Image(), sitImg = new Image();
sheet.src = 'assets/sheet.webp'; sitImg.src = 'assets/sit.webp';
// the tail of the sitting pictures, cut out so it can wag about its root (cell pixels)
const TAIL = [[139, 217], [139, 196], [142, 183], [148, 174], [155, 171], [162, 177], [163, 192], [159, 207], [152, 215], [145, 219]], TAIL_ROOT = [142, 212];
const sitParts = {};
sitImg.onload = () => {
  for (const [name, c] of Object.entries(SIT)) {
    const mk = () => { const cv = document.createElement('canvas'); cv.width = CELL_W; cv.height = SIT_H; return cv; };
    const body = mk(), tail = mk(), bg = body.getContext('2d'), tg = tail.getContext('2d');
    const path = (g) => { g.beginPath(); TAIL.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath(); };
    bg.drawImage(sitImg, c * CELL_W, 0, CELL_W, SIT_H, 0, 0, CELL_W, SIT_H); bg.globalCompositeOperation = 'destination-out'; path(bg); bg.fill();
    path(tg); tg.clip(); tg.drawImage(sitImg, c * CELL_W, 0, CELL_W, SIT_H, 0, 0, CELL_W, SIT_H);
    sitParts[name] = { body, tail };
  }
};

// ---------- the canvas and the picture ----------
const cv = $('scene'), ctx = cv.getContext('2d');
let W = 0, H = 0, DPR = 1;
function resize() {
  DPR = Math.min(2, devicePixelRatio || 1); W = innerWidth; H = innerHeight;
  cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR); ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
}
addEventListener('resize', resize); resize();
let media = null; // { el, w, h, video }
// the blurred backdrop: shrink the picture to a few pixels, then let two smooth enlargements spread it
const blur = document.createElement('canvas'), blur2 = document.createElement('canvas'); blur.width = 12; blur.height = 20; blur2.width = 60; blur2.height = 100; const blurG = blur.getContext('2d'), blur2G = blur2.getContext('2d');
const fit = () => { if (!media) return { x: 0, y: 0, w: W, h: H }; const s = Math.min(W / media.w, H / media.h); return { x: (W - media.w * s) / 2, y: (H - media.h * s) / 2, w: media.w * s, h: media.h * s }; };

function loadFile(file) {
  if (!file) return;
  const url = URL.createObjectURL(file);
  if (file.type.startsWith('video/')) {
    const v = document.createElement('video'); v.src = url; v.muted = true; v.loop = true; v.playsInline = true; v.setAttribute('playsinline', '');
    v.onloadeddata = () => { media = { el: v, w: v.videoWidth, h: v.videoHeight, video: true }; v.play().catch(() => {}); ready(); };
  } else {
    const im = new Image(); im.onload = () => { media = { el: im, w: im.naturalWidth, h: im.naturalHeight, video: false }; ready(); }; im.src = url;
  }
}
function ready() {
  $('start').hidden = true; $('bar').hidden = false; dog.state = 'away'; dog.spot = null; bubble = null; hearts.length = 0;
  const r = fit(); size = clamp(Math.min(r.h * 0.27, r.w * 0.38), 110, 260);
  hint('点一下照片里,你想让她待的地方');
}
$('file').addEventListener('change', (e) => { loadFile(e.target.files[0]); e.target.value = ''; });
for (const id of ['pick1', 'bPick']) $(id).addEventListener('click', () => $('file').click());

let hintTimer = 0;
function hint(text, ms = 0) { const h = $('hint'); h.textContent = text; h.classList.remove('off'); clearTimeout(hintTimer); if (ms) hintTimer = setTimeout(() => h.classList.add('off'), ms); }

// ---------- the puppy ----------
let size = 150; // the height of a standing picture on the screen (css px)
const dog = {
  state: 'away', // away | path | wave | sit | leave
  x: 0, y: 0, ground: 0, // feet; ground = the surface under her (for the shadow)
  spot: null, // where she lives in this picture, relative to it (u, v)
  path: [], seg: null, segAt: 0, dir: 1, then: null,
  face: 'happy', faceUntil: 0, nextBlink: 0, hopAt: -9e9, landAt: -9e9, waveAt: 0, waveLoops: 2, idleSince: 0, nextIdea: 0, first: true,
};
const spotPx = () => { const r = fit(); return { x: r.x + dog.spot.u * r.w, y: r.y + dog.spot.v * r.h }; };
const runLine = () => { const r = fit(); return Math.min(H - 8, r.y + r.h * 0.96); };
const RUN_SPEED = () => size * 3.2; // px a second

// a way from a to b: run along a's level, then one jump onto b (or just a hop when they are about level)
function plan(a, b) {
  const dir = Math.sign(b.x - a.x) || 1, dx = Math.abs(b.x - a.x), dy = b.y - a.y, segs = [];
  const big = Math.abs(dy) > size * 0.3;
  const take = big ? Math.min(dx, size * 0.75) : Math.min(dx, size * 0.3);
  const tx = b.x - dir * take;
  if (Math.abs(tx - a.x) > 2) segs.push({ type: 'run', from: { x: a.x, y: a.y }, to: { x: tx, y: big ? a.y : a.y + (b.y - a.y) * (Math.abs(tx - a.x) / Math.max(1, dx)) }, dir });
  const from = segs.length ? segs[segs.length - 1].to : a;
  segs.push({ type: 'jump', from, to: { x: b.x, y: b.y }, dir, h: big ? Math.max(size * 0.45, Math.abs(dy) * 0.35 + size * 0.35) : size * 0.28 });
  return segs;
}
function go(segs, then) { dog.state = 'path'; dog.path = segs; dog.then = then; nextSeg(); }
function nextSeg() {
  const s = dog.path.shift();
  if (!s) { dog.seg = null; const t = dog.then; dog.then = null; t?.(); return; }
  s.ms = s.type === 'run' ? (Math.hypot(s.to.x - s.from.x, s.to.y - s.from.y) / RUN_SPEED()) * 1000 : s.h > size * 0.4 ? 620 : 420;
  dog.seg = s; dog.segAt = now(); dog.dir = s.dir;
}
function arrive() { // landed on the spot: wave, then sit and wag
  dog.landAt = now(); dog.state = 'wave'; dog.waveAt = now() + 120; dog.waveLoops = dog.first ? 2 : 1;
  say(dog.first ? line('来了') : line('搬家')); dog.first = false;
  hint('点她摸摸头,点两下亲一下 · 点别处她会跳过去', 4200);
}
function sitDown() { dog.state = 'sit'; dog.face = 'happy'; dog.faceUntil = 0; dog.idleSince = now(); dog.nextIdea = now() + rand(5000, 8000); }
function come(u, v) { // tapped a spot
  dog.spot = { u, v }; ring = { at: now(), ...spotPx() };
  const b = spotPx();
  if (dog.state === 'away') { // in from the nearer side, on the bottom of the picture
    const side = b.x < W / 2 ? -1 : 1, y = Math.max(runLine(), b.y);
    dog.x = side < 0 ? -size : W + size; dog.y = dog.ground = y; dog.first = true;
    go(plan({ x: dog.x, y }, b), arrive);
  } else go(plan({ x: dog.x, y: dog.y }, b), arrive);
}
function leave() { // waves goodbye, jumps down and runs off to the nearer side
  dog.state = 'leave'; say(line('走了'), 2200); dog.waveAt = now(); dog.waveLoops = 1;
  setTimeoutClock(() => {
    const side = dog.x < W / 2 ? -1 : 1, y = Math.max(runLine(), dog.y), segs = [];
    if (y - dog.y > size * 0.3) segs.push({ type: 'jump', from: { x: dog.x, y: dog.y }, to: { x: dog.x + side * size * 0.7, y }, dir: side, h: size * 0.4 });
    const sx = segs.length ? segs[0].to.x : dog.x;
    segs.push({ type: 'run', from: { x: sx, y }, to: { x: side < 0 ? -size * 1.2 : W + size * 1.2, y }, dir: side });
    go(segs, () => { dog.state = 'away'; hint('她跑走啦,再点一下叫她回来'); });
  }, 1000);
}
// timers on the game clock (so ?test can step them)
const timers = [];
const setTimeoutClock = (fn, ms) => timers.push({ at: now() + ms, fn });

// ---------- what she says, hearts, the tapped spot ----------
let bubble = null, ring = null;
const hearts = [];
function say(text, ms = 2400) { bubble = { text, until: now() + ms }; }
function heartsAt(x, y, n = 4) { for (let i = 0; i < n; i++) hearts.push({ x: x + rand(-0.2, 0.2) * size, y: y + rand(-0.05, 0.05) * size, vx: rand(-30, 30), vy: rand(-110, -70), t: 0, life: rand(0.9, 1.4), s: rand(0.8, 1.2) }); }

// ---------- taps: on her = pat / kiss; elsewhere = she goes there; two fingers = bigger / smaller ----------
const pts = new Map(); let pinch = null, lastDogTap = 0, downAt = null;
const headBox = () => ({ x0: dog.x - size * 0.42, x1: dog.x + size * 0.42, y0: dog.y - size * 1.02, y1: dog.y + 4 });
cv.addEventListener('pointerdown', (e) => {
  pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), size }; downAt = null; return; }
  downAt = { x: e.clientX, y: e.clientY, t: now() };
});
cv.addEventListener('pointermove', (e) => {
  if (!pts.has(e.pointerId)) return; pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pinch && pts.size === 2) { const [a, b] = [...pts.values()]; size = clamp(pinch.size * Math.hypot(a.x - b.x, a.y - b.y) / Math.max(20, pinch.d), 60, 420); }
});
const up = (e) => {
  pts.delete(e.pointerId); if (pts.size < 2 && pinch) { pinch = null; return; }
  if (!downAt || !media) return; const d = downAt; downAt = null;
  if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 12) return;
  tap(e.clientX, e.clientY);
};
cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', (e) => { pts.delete(e.pointerId); pinch = null; downAt = null; });
function tap(x, y) {
  const b = headBox(), onDog = dog.state !== 'away' && x > b.x0 && x < b.x1 && y > b.y0 && y < b.y1;
  if (onDog) {
    if (dog.state !== 'sit' && dog.state !== 'wave') { say('汪!', 900); return; }
    if (dog.state === 'wave') sitDown();
    dog.idleSince = now();
    if (now() - lastDogTap < 330) { dog.face = 'kiss'; dog.faceUntil = now() + 1600; say(line('亲亲')); heartsAt(dog.x, dog.y - size * 0.9, 7); lastDogTap = 0; return; }
    lastDogTap = now(); dog.hopAt = now(); dog.face = 'happy'; dog.faceUntil = now() + 1200; say(line('摸头')); heartsAt(dog.x, dog.y - size * 0.9, 3);
    return;
  }
  const r = fit(); if (x < r.x || x > r.x + r.w || y < r.y || y > r.y + r.h) return;
  if (dog.state === 'path') return; // let her land first
  come((x - r.x) / r.w, (y - r.y) / r.h);
}
$('bSmall').addEventListener('click', () => { size = clamp(size / 1.18, 60, 420); });
$('bBig').addEventListener('click', () => { size = clamp(size * 1.18, 60, 420); });

// ---------- every frame ----------
function frameCell(row, f, x, y, sx = 1, sy = 1) { // a standing picture, feet at (x, y)
  const h = size * sy, w = size * (CELL_W / CELL_H) * sx;
  ctx.drawImage(sheet, f * CELL_W, ROW[row][0] * CELL_H, CELL_W, CELL_H, x - w / 2, y - (FOOT / CELL_H) * h, w, h);
}
function sitCell(name, x, y, tail, sx = 1, sy = 1) { // a sitting picture (tail apart), feet at (x, y)
  const p = sitParts[name]; if (!p) return;
  const k = size / CELL_H, w = CELL_W * k * sx, h = SIT_H * k * sy, left = x - w / 2, top = y - (SIT_FOOT / SIT_H) * h;
  ctx.drawImage(p.body, left, top, w, h);
  const rx = left + TAIL_ROOT[0] * k * sx, ry = top + TAIL_ROOT[1] * k * sy;
  ctx.save(); ctx.translate(rx, ry); ctx.rotate(tail); ctx.translate(-rx, -ry); ctx.drawImage(p.tail, left, top, w, h); ctx.restore();
}
function drawHeart(x, y, s, a) {
  ctx.save(); ctx.globalAlpha = a; ctx.fillStyle = '#ff6b9a'; ctx.translate(x, y); ctx.scale(s, s); ctx.beginPath();
  ctx.moveTo(0, 4); ctx.bezierCurveTo(-10, -4, -6, -12, 0, -7); ctx.bezierCurveTo(6, -12, 10, -4, 0, 4); ctx.fill(); ctx.restore();
}
function drawBubble(text, x, y) {
  const fs = clamp(size * 0.11, 13, 20); ctx.font = `600 ${fs}px -apple-system, "PingFang SC", sans-serif`;
  const tw = ctx.measureText(text).width, pw = tw + fs * 1.4, ph = fs * 2, bx = clamp(x - pw / 2, 8, W - pw - 8), by = Math.max(8, y - ph - 10);
  ctx.fillStyle = '#ffffff'; ctx.strokeStyle = '#f3a9c4'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.roundRect(bx, by, pw, ph, ph / 2.2); ctx.fill(); ctx.stroke();
  const tx = clamp(x, bx + 14, bx + pw - 14); ctx.beginPath(); ctx.moveTo(tx - 6, by + ph - 1); ctx.lineTo(tx, by + ph + 7); ctx.lineTo(tx + 6, by + ph - 1); ctx.fill();
  ctx.fillStyle = '#4a2a38'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, bx + pw / 2, by + ph / 2 + 1);
}
let lastT = now();
function loop() {
  const t = now(), dt = Math.min(0.05, (t - lastT) / 1000); lastT = t;
  for (let i = timers.length - 1; i >= 0; i--) if (t >= timers[i].at) { const f = timers[i].fn; timers.splice(i, 1); f(); }
  ctx.clearRect(0, 0, W, H);
  if (media) {
    // the picture: blurred and dark behind, sharp in front
    blurG.drawImage(media.el, 0, 0, blur.width, blur.height); blur2G.imageSmoothingQuality = 'high'; blur2G.drawImage(blur, 0, 0, blur2.width, blur2.height);
    ctx.save(); ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high'; ctx.drawImage(blur2, -30, -30, W + 60, H + 60); ctx.fillStyle = '#0000004d'; ctx.fillRect(0, 0, W, H); ctx.restore();
    const r = fit(); ctx.drawImage(media.el, r.x, r.y, r.w, r.h);
    if (ring && t - ring.at < 700) { const k = (t - ring.at) / 700; ctx.save(); ctx.strokeStyle = `rgba(255,120,170,${1 - k})`; ctx.lineWidth = 3; ctx.beginPath(); ctx.ellipse(ring.x, ring.y, 14 + k * 30, (14 + k * 30) * 0.4, 0, 0, Math.PI * 2); ctx.stroke(); ctx.restore(); }
    drawDog(t, dt);
  }
  // hearts
  for (let i = hearts.length - 1; i >= 0; i--) { const h = hearts[i]; h.t += dt; h.x += h.vx * dt; h.y += h.vy * dt; if (h.t > h.life) { hearts.splice(i, 1); continue; } drawHeart(h.x, h.y, (size / 150) * 1.3 * h.s, 1 - h.t / h.life); }
  if (bubble && t < bubble.until && dog.state !== 'away') drawBubble(bubble.text, dog.x, dog.y - size * (dog.state === 'sit' ? 1.0 : 1.05));
  if (!TEST) requestAnimationFrame(loop);
}
function drawDog(t) {
  if (dog.state === 'away') return;
  // keep her on her spot when the screen size changes
  if ((dog.state === 'sit' || dog.state === 'wave') && dog.spot) { const p = spotPx(); dog.x = p.x; dog.y = dog.ground = p.y; }
  let lift = 0, row = null, f = 0;
  if (dog.state === 'path' && dog.seg) {
    const s = dog.seg, k = clamp((t - dog.segAt) / s.ms, 0, 1);
    if (s.type === 'run') { dog.x = s.from.x + (s.to.x - s.from.x) * k; dog.y = dog.ground = s.from.y + (s.to.y - s.from.y) * k; row = s.dir < 0 ? 'left' : 'right'; f = Math.floor((t - dog.segAt) / 85) % 8; }
    else { const gy = s.from.y + (s.to.y - s.from.y) * k; dog.x = s.from.x + (s.to.x - s.from.x) * k; lift = 4 * s.h * k * (1 - k); dog.y = gy - lift; dog.ground = k < 0.5 ? s.from.y + (gy - s.from.y) * 0 : gy; dog.ground = gy; row = 'jump'; f = Math.min(4, Math.floor(k * 5)); }
    if (k >= 1) { dog.y = dog.ground = s.to.y; nextSeg(); }
  }
  // the shadow on the surface under her
  const sh = clamp(1 - lift / (size * 1.2), 0.35, 1); ctx.save(); ctx.fillStyle = `rgba(0,0,0,${0.28 * sh})`; ctx.beginPath(); ctx.ellipse(dog.x, dog.ground + 1, size * 0.3 * sh, size * 0.075 * sh, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore();
  const land = (t - dog.landAt) / 140, sq = land >= 0 && land < 1 ? Math.sin(land * Math.PI) * 0.12 : 0, hop = (t - dog.hopAt) / 300, hy = hop >= 0 && hop < 1 ? Math.sin(hop * Math.PI) * size * 0.12 : 0;
  if (dog.state === 'path') { frameCell(row, f, dog.x, dog.y); return; }
  if (dog.state === 'wave' || dog.state === 'leave') {
    const k = (t - dog.waveAt) / 150; if (dog.state === 'wave' && k >= 4 * dog.waveLoops) sitDown();
    else { frameCell(k < 0 ? 'idle' : 'wave', k < 0 ? 0 : Math.floor(k) % 4, dog.x, dog.y, 1 + sq * 0.6, 1 - sq); return; }
  }
  // sitting: blinks, wags, now and then a little idea; left alone long enough she leaves
  if (dog.faceUntil && t > dog.faceUntil) { dog.face = 'happy'; dog.faceUntil = 0; }
  if (!dog.faceUntil && t > dog.nextBlink) { dog.face = 'blink'; dog.faceUntil = t + 150; dog.nextBlink = t + rand(2600, 4800); }
  if (t > dog.nextIdea) { dog.nextIdea = t + rand(5000, 8000); if (Math.random() < 0.5) say(line('平时')); else { dog.face = 'listen'; dog.faceUntil = t + 1800; } }
  if (t - dog.idleSince > 14000) { leave(); return; }
  const wagSpeed = dog.face === 'kiss' || t - dog.hopAt < 1500 ? 14 : 8, tail = Math.sin(t / 1000 * wagSpeed) * 0.26 - 0.05;
  sitCell(dog.face, dog.x, dog.y - hy, tail, 1 + sq * 0.6, 1 - sq);
}
if (TEST) {
  window.__advance = (ms) => { for (let k = 0; k < ms; k += 16) { fakeNow += 16; loop(); } };
  window.__game = { dog, get size() { return size; }, tap, loadUrl: (u, video) => { fetch(u).then((r) => r.blob()).then((b) => loadFile(new File([b], video ? 'v.mp4' : 'p.jpg', { type: video ? 'video/mp4' : 'image/jpeg' }))); } };
} else requestAnimationFrame(loop);

// ---------- 录下来: record the canvas, then save it ----------
let rec = null;
$('bRec').addEventListener('click', () => { if (rec) rec.stop(); else startRec(); });
function startRec() {
  if (!cv.captureStream || !window.MediaRecorder) { hint('这个浏览器录不了,换 Safari 试试', 2500); return; }
  const type = ['video/mp4', 'video/webm;codecs=vp9', 'video/webm'].find((m) => MediaRecorder.isTypeSupported(m)) || '';
  const chunks = []; rec = new MediaRecorder(cv.captureStream(30), type ? { mimeType: type, videoBitsPerSecond: 8e6 } : undefined);
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  rec.onstop = () => {
    const blob = new Blob(chunks, { type: rec.mimeType || type || 'video/mp4' }), ext = blob.type.includes('mp4') ? 'mp4' : 'webm'; rec = null;
    $('bRec').classList.remove('rec'); $('bRec').innerHTML = '<span>⏺</span>录下来';
    const url = URL.createObjectURL(blob), v = $('clipVideo'); v.src = url; v.play().catch(() => {});
    const file = new File([blob], `小狗跳进照片.${ext}`, { type: blob.type }), save = $('clipSave');
    save.href = url; save.download = file.name;
    save.onclick = (e) => { if (navigator.canShare?.({ files: [file] })) { e.preventDefault(); navigator.share({ files: [file] }).catch(() => {}); } };
    $('clip').classList.add('on');
  };
  rec.start(); $('bRec').classList.add('rec'); $('bRec').innerHTML = '<span>⏹</span>停止'; hint('录制中…再点一下停止', 2000);
  setTimeout(() => rec?.state === 'recording' && rec.stop(), 20000);
}
$('clipClose').addEventListener('click', () => { $('clip').classList.remove('on'); $('clipVideo').pause(); });
