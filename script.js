'use strict';
const CG = window.CG = {};
const $ = (id) => document.getElementById(id);
const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const calm = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const ls = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
  del(k) { try { localStorage.removeItem(k); } catch {} },
  json(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
};
const BUZZ = { tap: 8, tick: 5, select: 12, confirm: 22, success: [14, 60, 22], warn: [30, 50, 30], cue: [220, 90, 220] };
let buzzOn = ls.get('cg-haptics') !== '0', buzzAt = 0, iosTick = null;

function setBuzz(on) {
  buzzOn = on;
  ls.set('cg-haptics', on ? '1' : '0');
  buzz('select', true);
}

function buzz(kind = 'tap', force) {
  const now = performance.now();
  if (!buzzOn || (!force && now - buzzAt < 40)) return;
  buzzAt = now;
  if (navigator.vibrate) { try { navigator.vibrate(BUZZ[kind] || BUZZ.tap); } catch {} return; }
  if (!iosTick) {
    iosTick = document.createElement('label');
    iosTick.innerHTML = '<input type="checkbox" switch>';
    iosTick.style.display = 'none';
    document.body.appendChild(iosTick);
  }
  iosTick.click();
}

const BUZZ_ON = [
  ['confirm', '.btn-primary, #pxStart, #startBrewingBtn, #brewFinishBtn, #glEndBtn, #rvApply, #artAgain'],
  ['select', '.px-tabs button, .seg3 button, .rv-tastes button, .lv-pat, [data-g], [data-dose], [data-crumb], .sh-switch'],
  ['tap', 'button, a, select, [data-method], [data-mode], [data-id], #sheetScrim'],
];

const LOG = { list: [].concat(ls.json('cg-testlog') || []), t: 0 };
const logSave = () => ls.set('cg-testlog', JSON.stringify(LOG.list));

function tlog(ev, data) {
  LOG.list = LOG.list.concat(Object.assign({ at: new Date().toISOString(), ev }, data)).slice(-400);
  clearTimeout(LOG.t);
  LOG.t = setTimeout(logSave, 1000);
}
document.addEventListener('visibilitychange', () => { if (document.hidden) logSave(); });

document.addEventListener('click', (e) => {
  if (currentScreen === 'pour') LV.taps += 1;
  if (e.target.closest('#arRoot, #glHud')) return;
  for (const [kind, sel] of BUZZ_ON) {
    const el = e.target.closest(sel);
    if (el) return el.disabled ? undefined : buzz(kind);
  }
}, true);

const TRACK = { lib: './vendor/mindar/mindar-image.prod.js', cdn: 'https://cdn.jsdelivr.net/npm/mind-ar@1.2.5/dist/mindar-image.prod.js', targets: 'targets/targets.mind', warmup: 3, miss: 8, minCF: 0.0003, beta: 100 };
CG.TARGETS = { dedica: 0, pourmat: 1, cupring: 2, cupring8: 3 };
const AR_FIT = { xray: 0.74, cup: 0.6, max: 2.2, ease: 0.15 };
const arScale = (cur, want) => cur ? cur + (want - cur) * AR_FIT.ease : want * 0.88;

const tk = { load: null, mod: null, buf: null, ctl: null, dims: null, video: null, box: [1, 1], index: -1, want: [], pose: null, last: null, onPose: null, halt: null, idle: Promise.resolve(), run: 0, failed: false };

function trackLoad() {
  if (!tk.load) {
    const targets = fetch(TRACK.targets).then((r) => { if (!r.ok) throw new Error('targets ' + r.status); return r.arrayBuffer(); });
    tk.load = Promise.all([import(TRACK.lib).catch(() => import(TRACK.cdn)), targets])
      .then(([mod, buf]) => { tk.mod = mod; tk.buf = buf; return true; })
      .catch((e) => { tk.failed = e.message || 'load'; tlog('tracking-off', { why: tk.failed }); return false; });
  }
  return tk.load;
}

function trackAvailable() {
  return location.protocol !== 'file:' && !tk.failed && !!window.WebGLRenderingContext;
}

function trackWhy(granted) {
  if (!granted) return 'Camera access is off. Allow the camera, then open this screen again.';
  if (location.protocol === 'file:') return 'Open the app from its web address. Tracking cannot load from a file.';
  if (!window.WebGLRenderingContext) return 'This browser has no WebGL, which tracking needs.';
  if (String(tk.failed).startsWith('targets')) return 'targets/targets.mind is missing from the site. Upload the targets folder.';
  if (tk.failed) return 'The tracking library did not load. Upload the vendor folder or check the connection.';
  return 'The camera did not start.';
}

function trackFail(root, granted, onSkip) {
  buzz('warn', true);
  root.classList.add('track-fail');
  root.querySelector('[data-why]').textContent = trackWhy(granted);
  root.querySelector('[data-skip]').onclick = () => { root.classList.remove('track-fail'); onSkip(); };
}

function videoReady(video) {
  return new Promise((ok) => {
    if (video.videoWidth) { ok(true); return; }
    video.addEventListener('loadedmetadata', () => ok(true), { once: true });
    setTimeout(() => ok(!!video.videoWidth), 6000);
  });
}

function trackUpdate(d) {
  if (d.type === 'processDone') {
    if (tk.halt) { setTimeout(tk.halt, 80); tk.halt = null; }
    return;
  }
  if (d.type !== 'updateMatrix' || !tk.want.includes(d.targetIndex) || (!d.worldMatrix && d.targetIndex !== tk.index)) return;
  tk.index = d.targetIndex;
  tk.pose = d.worldMatrix;
  if (tk.pose) tk.last = tk.pose;
  tk.box = [tk.video.clientWidth || 1, tk.video.clientHeight || 1];
  if (tk.onPose) tk.onPose(tk.pose);
}

function trackStop() {
  tk.run += 1;
  tk.onPose = null;
  tk.index = -1;
  tk.want = [];
  tk.pose = tk.last = null;
  if (!tk.ctl || !tk.ctl.processingVideo) return;
  tk.idle = new Promise((ok) => { tk.halt = ok; setTimeout(ok, 400); });
  tk.ctl.stopProcessVideo();
}

async function trackStart(video, index, onPose) {
  trackStop();
  const run = tk.run;
  if (!trackAvailable() || !(await trackLoad()) || !(await videoReady(video))) return false;
  await tk.idle;
  if (run !== tk.run) return false;
  const w = video.videoWidth, h = video.videoHeight;
  video.width = w;
  video.height = h;
  if (!tk.ctl || tk.ctl.inputWidth !== w || tk.ctl.inputHeight !== h) {
    if (tk.ctl) tk.ctl.dispose();
    tk.ctl = new tk.mod.Controller({ inputWidth: w, inputHeight: h, warmupTolerance: TRACK.warmup, missTolerance: TRACK.miss, filterMinCF: TRACK.minCF, filterBeta: TRACK.beta, onUpdate: trackUpdate });
    tk.dims = tk.ctl.addImageTargetsFromBuffer(tk.buf).dimensions;
    const match = tk.ctl._detectAndMatch.bind(tk.ctl);
    tk.ctl._detectAndMatch = (t, list) => match(t, list.filter((i) => tk.want.includes(i)));
    tk.ctl.dummyRun(video);
  }
  if (run !== tk.run) return false;
  const want = [].concat(index);
  Object.assign(tk, { video, index: want[0], want, onPose, pose: null });
  tk.ctl.interestedTargetIndex = -1;
  tk.ctl.processVideo(video);
  return true;
}

function trackClip(s, t, z) {
  const m = tk.pose || tk.last, p = tk.ctl.projectionMatrix, [mw, mh] = tk.dims[tk.index];
  const v = [s * mw, (1 - t) * mh, (z || 0) * mw, 1];
  const e = [0, 1, 2, 3].map((r) => m[r] * v[0] + m[r + 4] * v[1] + m[r + 8] * v[2] + m[r + 12] * v[3]);
  return [0, 1, 3].map((r) => p[r] * e[0] + p[r + 4] * e[1] + p[r + 8] * e[2] + p[r + 12] * e[3]);
}

function trackPx(s, t, z) {
  const c = trackClip(s, t, z);
  return [(1 + c[0] / c[2]) * tk.ctl.inputWidth / 2, (1 - c[1] / c[2]) * tk.ctl.inputHeight / 2];
}

function trackPoint(s, t, z) {
  const c = trackClip(s, t, z);
  const vw = tk.ctl.inputWidth, vh = tk.ctl.inputHeight, [ew, eh] = tk.box;
  const k = Math.max(ew / vw, eh / vh);
  return [ew / 2 + (c[0] / c[2]) * vw * k / 2, eh / 2 - (c[1] / c[2]) * vh * k / 2];
}

function trackFacing() {
  const m = tk.pose || tk.last, d = Math.hypot(m[12], m[13], m[14]) * Math.hypot(m[8], m[9], m[10]) || 1;
  return Math.abs(m[8] * m[12] + m[9] * m[13] + m[10] * m[14]) / d;
}

function trackFit(w, h, map) {
  const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = [[0, 0], [w, 0], [w, h], [0, h]].map(([u, v]) => trackPoint(...map(u, v)));
  const dx1 = x1 - x2, dx2 = x3 - x2, sx = x0 - x1 + x2 - x3;
  const dy1 = y1 - y2, dy2 = y3 - y2, sy = y0 - y1 + y2 - y3;
  const den = dx1 * dy2 - dx2 * dy1;
  const g = (sx * dy2 - dx2 * sy) / den, q = (dx1 * sy - sx * dy1) / den;
  const a = x1 - x0 + g * x1, b = x3 - x0 + q * x3, d = y1 - y0 + g * y1, e = y3 - y0 + q * y3;
  return 'matrix3d(' + [a / w, d / w, 0, g / w, b / h, e / h, 0, q / h, 0, 0, 1, 0, x0, y0, 0, 1].map((n) => n.toFixed(6)).join(',') + ')';
}

function trackHint(el, minW) {
  if (typeof minW === 'object') minW = minW[tk.index];
  const [a, b, c, d] = [[0, 0.5], [1, 0.5], [0.5, 0], [0.5, 1]].map(([u, v]) => trackPoint(u, v)), [mw, mh] = tk.dims[tk.index];
  const w = Math.hypot(a[0] - b[0], a[1] - b[1]) / tk.box[0], h = Math.hypot(c[0] - d[0], c[1] - d[1]) / tk.box[0];
  const tip = w < minW ? 'Move a little closer' : w > 1.2 ? 'Move back a little' : h / w < 0.42 * mh / mw ? 'Tilt the phone down more' : '';
  if (tip) el.textContent = tip;
  el.classList.toggle('show', !!tip);
}

function trackRing(mmOf) {
  const m = tk.pose, wMm = mmOf[tk.index];
  if (!m || !wMm) return null;
  const [mw, mh] = tk.dims[tk.index], k = wMm / mw, nl = Math.hypot(m[8], m[9], m[10]) || 1;
  const e = [0, 1, 2].map((r) => (m[r] * mw / 2 + m[r + 4] * mh / 2 + m[r + 12]) * k);
  return { x: e[0], y: e[1], d: -e[2], n: [m[8] / nl, m[9] / nl, m[10] / nl] };
}

CG.Tracker = { ring: trackRing, index: () => tk.index, px: trackPx, hint: trackHint, facing: trackFacing, load: trackLoad, available: trackAvailable, why: trackWhy, fail: trackFail, start: trackStart, stop: trackStop, point: trackPoint, fit: trackFit, box: () => tk.box };

const TUNE = { sampleHz: 15, basket: { x0: 0.28, x1: 0.72, y0: 0.24, y1: 0.60 }, flowMin: 3.2, steadyFrames: 8, idleFrames: 30, channelRatio: 1.85, channelMinAct: 4, channelHoldMs: 1300, channelClearMs: 700 };
const SW = 48, SH = 32;
const det = { canvas: null, ctx: null, prev: null, hot: -1, hotSince: 0, coolSince: 0, flagged: -1, moving: 0, still: 0, steady: false };

function readThirds(video) {
  const vw = video.videoWidth, vh = video.videoHeight, b = TUNE.basket;
  if (!vw || !vh) return null;
  if (!det.canvas) {
    det.canvas = Object.assign(document.createElement('canvas'), { width: SW, height: SH });
    det.ctx = det.canvas.getContext('2d', { willReadFrequently: true });
  }
  try { det.ctx.drawImage(video, b.x0 * vw, b.y0 * vh, (b.x1 - b.x0) * vw, (b.y1 - b.y0) * vh, 0, 0, SW, SH); } catch { return null; }
  const px = det.ctx.getImageData(0, 0, SW, SH).data, lum = new Float32Array(SW * SH), act = [0, 0, 0];
  for (let i = 0; i < lum.length; i++) {
    lum[i] = 0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2];
    if (det.prev) act[Math.min(2, Math.floor((i % SW) / (SW / 3)))] += Math.abs(lum[i] - det.prev[i]);
  }
  const first = !det.prev;
  det.prev = lum;
  return first ? null : act.map((a) => a / (SW * SH / 3));
}

function detectChannel(video) {
  const th = readThirds(video);
  if (!th) return null;
  const now = performance.now(), top = th.indexOf(Math.max(...th));
  const rest = th.filter((_, i) => i !== top), ratio = th[top] / ((rest[0] + rest[1]) / 2 || 0.0001);
  if (ratio >= TUNE.channelRatio && th[top] >= TUNE.channelMinAct) {
    if (det.hot !== top) { det.hot = top; det.hotSince = now; }
    det.coolSince = 0;
    if (now - det.hotSince >= TUNE.channelHoldMs) det.flagged = top;
  } else {
    det.coolSince = det.coolSince || now;
    if (now - det.coolSince >= TUNE.channelClearMs) { det.hot = -1; det.flagged = -1; }
  }
  return { mean: (th[0] + th[1] + th[2]) / 3, ratio, flagged: det.flagged >= 0, index: det.flagged };
}

function resetDetection() {
  Object.assign(det, { prev: null, hot: -1, hotSince: 0, coolSince: 0, flagged: -1 });
}

function readFlowState(sample) {
  if (sample) {
    const moving = sample.mean >= TUNE.flowMin;
    det.moving = moving ? det.moving + 1 : 0;
    det.still = moving ? 0 : det.still + 1;
    if (det.moving >= TUNE.steadyFrames) det.steady = true;
    if (det.steady && det.still >= TUNE.idleFrames) return 'ended';
  }
  return det.steady ? 'steady' : 'preinfusion';
}

const XR = {
  pre: 8000, firstDrip: 7600, idealEnd: 30000, summaryAt: 1200, finishHold: 7000,
  targetG: 36, doseG: 18, baseFlow: 1.70,
  pivotX: 200, pivotY: 451, basketUnits: 76,
  bedTop: 590, bedBot: 648, bedL: 90, bedR: 190,
  card: { x: 50, y: 100, w: 300, h: 636 },
  baseT: 0.8, standH: 636 / 300, upright: 0.6, flat: 0.75, topPx: 170,
  search: [195, 300, 1.15],
};
const EO_ANCHOR = { pump: [130, 347], block: [200, 335], group: [200, 420], release: [150, 500], cup: [200, 512], puck: [200, 451] };
const EO_SIDE = { pump: 'left', release: 'left', puck: 'left', block: 'right', group: 'right', cup: 'right' };
const STAND_MODES = [['auto', 'Auto'], ['upright', 'Upright'], ['flat', 'Flat']];

let eoRoot = null, eoVideo = null, eoEls = null, eoHost = null, eoResizeObserver = null;
let eoRunning = false, eoRaf = 0, lastSample = 0, lastFrame = 0, onEnd = null;
let basketKind = 'bottomless', aligning = false, drag = null, wide = false, lastCallouts = [];
let flagged = false, flagIndex = 1, hotSince = 0, coolSince = 0;
let grounds = [], jetEls = [], streamEls = [], dropEls = [], flowSegs = [];
let sim = null, prep = null, predicted = { time: 28, drip: 7.6 };
let trace = [], chOn = null, peakQ = 0, maxP = 0;
let pinned = false, found = false, eoRun = 0, xrS = 0, lostTimer = 0, landTimer = 0, swapping = false, xrMap = null, standMode = 'auto', upright = false, hudBox = { x: 0, y: 0, k: 1 };
let phase = 'preinfusion', onTick = null, onDone = null, doneFired = false;

const shot = { t: 0, y: 0, chNow: 0, chDmg: 0, end: null };
const view = { tx: 41, ty: 14, s: 1.30 };
const VIEW_DEFAULT = { phone: { tx: 41, ty: 14, s: 1.30 }, wide: { tx: -5, ty: 100, s: 1.0 } };
const WIDE_DETAIL = { dx: -290, dy: -60 };

let xseed = 7;
function xrnd() { xseed = (xseed * 1103515245 + 12345) % 2147483648; return xseed / 2147483648; }

function svgEl(name, attrs) {
  const e = document.createElementNS('http://www.w3.org/2000/svg', name);
  setAttrs(e, attrs);
  return e;
}

function setAttrs(e, attrs) {
  for (const k in attrs) e.setAttribute(k, attrs[k]);
}

function build(container) {
  eoEls = {};
  container.querySelectorAll('[id^=eo]').forEach((n) => { eoEls[n.id[2].toLowerCase() + n.id.slice(3)] = n; });
  flowSegs = [['fTank', 200, 1400], ['fPump', 1400, 2400], ['fCoil', 2400, 4400], ['fGroup', 4400, 5700], ['fPuck', 5700, 6500]]
    .map(([k, b0, b1]) => ({ el: eoEls[k], b0, b1, t0: b0, t1: b1 }));
  [...flowSegs.map((s) => s.el), eoEls.fSpouts, eoEls.fBottom, eoEls.fRelease].forEach((n) => { n.len = n.getTotalLength(); });
  scaleSegs();
  buildDetail();
  bindAlign();
  eoEls.standBtn.addEventListener('click', cycleStand);
  if (!eoResizeObserver && window.ResizeObserver) (eoResizeObserver = new ResizeObserver(() => layout())).observe(container);
  layout();
}

function scaleSegs() {
  const k = XR.firstDrip / 7600;
  flowSegs.forEach((s) => { s.t0 = s.b0 * k; s.t1 = s.b1 * k; });
}

function buildDetail() {
  const w = XR.bedR - XR.bedL, add = (g, name, attrs) => g.appendChild(svgEl(name, attrs));
  for (let x = 94; x <= 186; x += 8) add(eoEls.holes, 'circle', { class: 'eo-screen-hole', cx: x, cy: 578, r: 1.4 });
  jetEls = [];
  for (let x = 96; x <= 186; x += 12) jetEls.push(add(eoEls.jets, 'line', { class: 'eo-jet', x1: x, y1: 580, x2: x, y2: 590, 'stroke-width': 1.5, stroke: '#FFD79B', opacity: 0 }));
  grounds = [];
  for (let i = 0; i < 170; i++) {
    const x = XR.bedL + 4 + (i % 17) * ((w - 8) / 16) + (xrnd() - 0.5) * 3.6;
    const y = XR.bedTop + 3 + Math.floor(i / 17) * ((XR.bedBot - XR.bedTop - 6) / 9) + (xrnd() - 0.5) * 3;
    const node = add(eoEls.grounds, 'circle', { cx: x.toFixed(1), cy: y.toFixed(1), r: (1.9 + xrnd() * 1.6).toFixed(1), fill: '#6B4A32' });
    grounds.push({ node, y, third: Math.min(2, Math.floor((x - XR.bedL) / (w / 3))), last: '' });
  }
  streamEls = [0, 1, 2, 3].map(() => add(eoEls.streams, 'path', { class: 'eo-jet', d: '', opacity: 0, 'stroke-width': 2.2 }));
  dropEls = [...Array(9)].map(() => add(eoEls.drops, 'ellipse', { class: 'eo-drop', cx: 140, cy: 668, rx: 2.1, ry: 3, opacity: 0 }));
}

function layout() {
  const w = eoRoot.clientWidth, h = eoRoot.clientHeight;
  if (w < 2 || h < 2) return;
  eoEls.machine.setAttribute('transform', 'translate(' + (view.tx + XR.pivotX * (1 - view.s)).toFixed(2) + ',' + (view.ty + XR.pivotY * (1 - view.s)).toFixed(2) + ') scale(' + view.s.toFixed(3) + ')');
  layoutDetail();
  const k = Math.min(w / 390, h / 844), fit = 'translate(' + ((w - 390 * k) / 2).toFixed(1) + 'px,' + ((h - 844 * k) / 2).toFixed(1) + 'px) scale(' + k.toFixed(4) + ')';
  hudBox = { x: (w - 390 * k) / 2, y: (h - 844 * k) / 2, k };
  eoEls.hud.style.transform = wide ? '' : fit;
  const [sx, sy, ss] = XR.search;
  if (pinned && !found) eoEls.xray.style.transform = fit + ' translate(' + sx + 'px,' + sy + 'px) scale(' + ss + ') translate(-140px,-620px)';
  const px = XR.basketUnits * view.s;
  eoEls.alignInfo.textContent = '51 mm = ' + px.toFixed(0) + ' px  ·  ' + (px / 51).toFixed(2) + ' px/mm';
}

function layoutDetail() {
  const phone = !wide || pinned, d = phone ? { dx: 0, dy: 0 } : WIDE_DETAIL;
  const [a, b] = phone ? [toScreen(200, 467), toScreen(232, 462)] : [toScreen(162, 437), toScreen(168, 467)];
  const m = (p, dx) => 'M' + (p.x - dx).toFixed(1) + ',' + (p.y - d.dy).toFixed(1) + ' ';
  if (phone) eoEls.detail.removeAttribute('transform');
  else eoEls.detail.setAttribute('transform', 'translate(' + d.dx + ',' + d.dy + ')');
  eoEls.leadA.setAttribute('d', m(a, phone ? 30 : d.dx) + (phone ? 'L78,570' : 'L188,572'));
  eoEls.leadB.setAttribute('d', m(b, d.dx) + (phone ? 'L202,572' : 'L188,668'));
}

function toScreen(x, y) {
  return { x: view.tx + XR.pivotX * (1 - view.s) + x * view.s, y: view.ty + XR.pivotY * (1 - view.s) + y * view.s };
}

function bindAlign() {
  const surface = eoEls.alignSurface, end = () => { if (drag) { drag = null; saveView(); } };
  eoEls.alignBtn.addEventListener('click', () => setAligning(!aligning));
  eoEls.alignPanel.addEventListener('click', (e) => {
    const b = e.target.closest('[data-scale]');
    if (!b) return;
    view.s = clamp(view.s + Number(b.dataset.scale) * 0.05, 0.7, 2.2);
    layout();
    saveView();
  });
  surface.addEventListener('pointerdown', (e) => {
    drag = { x: e.clientX, y: e.clientY, tx: view.tx, ty: view.ty };
    surface.setPointerCapture(e.pointerId);
  });
  surface.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const r = eoRoot.getBoundingClientRect(), k = Math.min(r.width / 390, r.height / 844) || 1;
    view.tx = drag.tx + (e.clientX - drag.x) / k;
    view.ty = drag.ty + (e.clientY - drag.y) / k;
    layout();
  });
  surface.addEventListener('pointerup', end);
  surface.addEventListener('pointercancel', end);
  window.addEventListener('resize', () => { if (eoEls) layout(); });
}

function setAligning(on) {
  aligning = on;
  if (!eoEls) return;
  eoRoot.classList.toggle('aligning', on);
  eoEls.alignBtn.classList.toggle('on', on);
  paintCallouts(lastCallouts);
}

const viewKey = () => wide ? 'cg-eo-view-gl' : 'cg-eo-view';

function saveView() {
  ls.set(viewKey(), JSON.stringify(view));
}

function loadView() {
  const v = ls.json(viewKey()), def = pinned ? { tx: 0, ty: 0, s: 1 } : VIEW_DEFAULT[wide ? 'wide' : 'phone'];
  Object.assign(view, def, !pinned && v && typeof v.s === 'number' ? { tx: v.tx, ty: v.ty, s: v.s } : {});
}

const flowNow = () => sim ? sim.flow : 0;
const pressureNow = () => sim ? sim.P : 0;

function tempNow() {
  const t = shot.t;
  if (t < 2400) return 93;
  if (t < 8000) return 93 - 0.4 * (t - 2400) / 5600;
  if (t < (shot.end || XR.idealEnd)) return 92.6 - 2 * clamp((t - 8000) / 14000) + Math.sin(t / 1400) * 0.25;
  return 91;
}

function etaMs() {
  if (shot.end) return shot.end;
  if (!sim || sim.drip === null) return predicted.time * 1000;
  return shot.t + ((XR.targetG - shot.y) / Math.max(0.1, sim.flow)) * 1000;
}

function liveChannel(res, live) {
  if (!live || basketKind !== 'bottomless') return undefined;
  return res ? clamp(((res.ratio || 0) - 1.25) / 1.5) : sim.ch;
}

function syncShot() {
  const b = basketKind === 'bottomless';
  Object.assign(shot, { t: sim.t * 1000, y: sim.y, chNow: b ? sim.ch : 0, chDmg: b ? sim.chDmg : 0, end: sim.end !== null ? sim.end * 1000 : null });
  XR.firstDrip = (sim.drip !== null ? sim.drip : predicted.drip) * 1000;
}

function stepShot(dt, liveCh) {
  const was = sim.end;
  CG.Shot.step(sim, dt / 1000, Object.assign({ live: liveCh }, CG.Wizard.mods()));
  syncShot();
  if (sim.end === null || sim.t < sim.end + 1) {
    peakQ = Math.max(peakQ, sim.flow);
    maxP = Math.max(maxP, sim.P);
    if (chOn === null && sim.ch > 0.3) chOn = sim.t;
    if (!trace.length || sim.t - trace[trace.length - 1][0] >= 0.25) trace.push([+sim.t.toFixed(2), +sim.flow.toFixed(2), +sim.P.toFixed(2), +sim.y.toFixed(1)]);
  }
  if (was === null && sim.end !== null && onEnd) onEnd(shot.t);
}

function endSim() {
  if (sim.end === null) sim.end = sim.t;
  syncShot();
  if (onEnd) onEnd(shot.t);
}

function stepBadge(now, res, live) {
  if (basketKind !== 'bottomless') { flagged = false; hotSince = 0; coolSince = 0; return; }
  if (live ? res && res.flagged : shot.chNow > 0.45) {
    hotSince = hotSince || now;
    coolSince = 0;
    if (!flagged && now - hotSince >= TUNE.channelHoldMs) {
      flagged = true;
      flagIndex = live && res && res.index >= 0 ? res.index : channelSide();
    }
  } else {
    coolSince = coolSince || now;
    hotSince = 0;
    if (flagged && now - coolSince >= TUNE.channelClearMs) flagged = false;
  }
}

const channelSide = () => CG.Wizard.on && CG.Wizard.side !== null ? CG.Wizard.side : sim.f.side;

function paintPath(node, fill, moving, now, dash, rush) {
  const s = node.style, len = node.len, run = fill >= 1 && moving;
  s.opacity = String(clamp(fill * 1.5));
  if (fill <= 0) return;
  s.strokeDasharray = fill < 1 ? len * fill + ' ' + len : run ? dash : len + ' ' + len;
  s.strokeDashoffset = run ? String(-(now * 0.055 * (rush || 1)) % 24) : '0';
}

const EO_CALLOUTS = { pump: [150, 167, 'Vibration pump'], block: [150, 167, 'Thermoblock'], group: [150, 167, 'Group head'], release: [150, 167, 'Shot ended'], cup: [150, 300, 'In the cup'], puck: [132, 540, 'Puck'] };

const box = (x, w, y) => 'left:' + x.toFixed(1) + 'px; width:' + w.toFixed(1) + 'px; top:' + y.toFixed(1) + 'px;';

function calloutPos(id, i) {
  const [x, y] = EO_CALLOUTS[id], side = EO_SIDE[id];
  if (wide || aligning) return ['', 'right'];
  if (!pinned) return ['left:' + x + 'px; top:' + y + 'px;', 'right'];
  if (!found || !xrMap) return [box(120, 150, 500 + i * 56), side + ' stack'];
  const [px, py] = CG.Tracker.point(...xrMap(...EO_ANCHOR[id])), hx = (px - hudBox.x) / hudBox.k, hy = (py - hudBox.y) / hudBox.k;
  if (side === 'left') return [box(14, Math.max(150, hx - 10), clamp(hy, 340, 584)), side];
  const l = Math.min(hx - 4, 226);
  return [box(l, 376 - l, clamp(hy, 275, 584)), side];
}

function paintCallouts(list) {
  lastCallouts = list;
  const host = eoEls.callouts, ids = list.map((c) => c.id).join();
  if (host.dataset.ids !== ids) {
    host.dataset.ids = ids;
    host.innerHTML = list.map((c) => '<div class="eo-callout"><span class="dot"></span><span class="lead"></span><div class="box"><div class="k">' + EO_CALLOUTS[c.id][2] + '</div><div class="v"></div></div></div>').join('');
  }
  list.forEach((c, i) => {
    const el = host.children[i], v = el.querySelector('.v'), [pos, side] = calloutPos(c.id, i), html = c.v + (c.est ? '<span class="eo-est">est</span>' : '');
    if (el.getAttribute('style') !== pos) el.setAttribute('style', pos);
    el.className = 'eo-callout ' + side + ' c-' + c.id;
    if (v.innerHTML !== html) v.innerHTML = html;
    v.classList.toggle('warn', !!c.warn);
  });
}

const chStrength = (bottomless) => bottomless ? clamp(shot.chNow * 0.7 + shot.chDmg * 0.5) : 0;

function paintPuck(now, bottomless) {
  const t = shot.t, soak = sim ? sim.sat : 0, strength = chStrength(bottomless), end = shot.end || XR.idealEnd;
  const baseFront = XR.bedTop + soak * (XR.bedBot - XR.bedTop), flowing = t > XR.firstDrip && t < end + 900;
  const spent = clamp(shot.y / XR.targetG), jetOn = t > 5700 && t < end, rush = 1 + 1.6 * strength, third = (XR.bedR - XR.bedL) / 3;
  jetEls.forEach((j, i) => j.setAttribute('opacity', jetOn ? String(0.3 + 0.4 * Math.abs(Math.sin(now / 190 + i))) : '0'));
  grounds.forEach((g) => {
    const hit = g.third === flagIndex, front = baseFront + (strength > 0.05 ? (hit ? 30 : -9) * strength : 0);
    const fill = g.y > front ? '#6B4A32' : strength > 0.35 && hit ? '#A2612F' : spent > 0.35 ? '#2E1B10' : '#3A2416';
    if (fill !== g.last) { g.node.setAttribute('fill', fill); g.last = fill; }
  });
  const wet = soak > 0 && soak < 1;
  setAttrs(eoEls.front, wet ? { y1: baseFront.toFixed(1), y2: baseFront.toFixed(1), opacity: '0.85' } : { opacity: '0' });
  setAttrs(eoEls.band, { x: String(XR.bedL + flagIndex * third + 2), width: String(third - 4) });
  eoEls.band.style.opacity = String(clamp(strength * 1.4));
  eoEls.plate.setAttribute('opacity', bottomless ? '0' : '.9');
  streamEls.forEach((s, i) => {
    if (!bottomless) {
      if (i > 0) { s.setAttribute('opacity', '0'); return; }
      setAttrs(s, { d: 'M140,658 V' + (XR.bedBot + 32), stroke: '#A9713F', 'stroke-width': '3.2', opacity: flowing ? '0.9' : '0' });
      return;
    }
    const x = XR.bedL + 13 + i * 25, inChannel = strength > 0.3 && Math.floor((x - XR.bedL) / third) === flagIndex;
    setAttrs(s, {
      d: 'M' + x + ',' + XR.bedBot + ' Q' + x + ',' + (XR.bedBot + 14) + ' 140,' + (XR.bedBot + 30),
      stroke: inChannel ? '#E0803F' : '#A9713F',
      'stroke-width': String(inChannel ? 2.4 + 1.6 * strength : 2.2 - 0.7 * strength),
      opacity: flowing ? String(0.5 + 0.4 * Math.abs(Math.sin(now / (220 / rush) + i))) : '0',
    });
  });
  dropEls.forEach((d, i) => {
    if (!flowing) { d.setAttribute('opacity', '0'); return; }
    const base = XR.bedBot + 24, y = base + ((now / (3.4 / rush) + i * 42) % 30);
    setAttrs(d, { cy: y.toFixed(1), cx: String(bottomless ? 140 + (i % 3 - 1) * 4 : 140), opacity: String(0.75 * (1 - (y - base) / 30)) });
  });
  return soak;
}

function paint(now) {
  const t = shot.t, bottomless = basketKind === 'bottomless', end = shot.end || XR.idealEnd, pumping = t > 200 && t < end;
  const bar = pressureNow(), temp = tempNow(), flow = flowNow(), strength = chStrength(bottomless), rushing = strength > 0.15;
  const fade = t > end ? clamp(1 - (t - end) / 1400) : 1, outFill = clamp((t - XR.firstDrip) / 1400) * (t > end + 1400 ? 0 : 1);
  flowSegs.forEach((s) => paintPath(s.el, clamp((t - s.t0) / (s.t1 - s.t0)) * fade, pumping, now, '9 13', 1 + strength));
  paintPath(eoEls.fSpouts, bottomless ? 0 : outFill, t < end + 1200, now, '7 11', 1 + strength * 1.6);
  paintPath(eoEls.fBottom, bottomless ? outFill : 0, t < end + 1200, now, '6 9', 1 + strength * 1.6);
  paintPath(eoEls.fRelease, t > end ? clamp((t - end) / 700) * clamp(1 - (t - end - 1500) / 1200) : 0, true, now, '4 6');
  const heating = t > 1800 && t < end;
  eoEls.blockHeat.classList.toggle('on', heating);
  [eoEls.wave1, eoEls.wave2].forEach((w, i) => w.setAttribute('opacity', heating ? String(0.22 + 0.34 * Math.abs(Math.sin(now / 520 + i * 1.6))) : '0'));
  setAttrs(eoEls.pumpArm, { x: String(126 + (pumping ? Math.sin(now / 22) * 2.6 : 0)), opacity: pumping ? '1' : '.35' });
  eoEls.tankWater.setAttribute('y', String(180 + shot.y * 0.06));
  const soak = paintPuck(now, bottomless), cupH = clamp(shot.y / XR.targetG) * 44;
  setAttrs(eoEls.cupFill, { y: String(532 - cupH), height: String(cupH) });
  eoEls.gauge.classList.toggle('show', bar > 0.4);
  eoEls.gaugeFill.style.height = clamp(bar / 15) * 100 + '%';
  eoEls.gaugeVal.textContent = bar.toFixed(1);
  eoEls.gaugeVal.classList.toggle('over', bar > 10.5);
  const choking = !shot.end && flow > 0.05 && flow < 1.2 && bar > 10;
  eoEls.flowmeter.classList.toggle('show', flow > 0.05);
  eoEls.flowVal.textContent = flow.toFixed(2) + ' g/s';
  eoEls.flowBar.style.width = clamp(flow / 3.6) * 100 + '%';
  [eoEls.flowVal, eoEls.flowBar].forEach((n) => { n.classList.toggle('rush', rushing); n.classList.toggle('choke', choking); });
  eoEls.anchor.style.display = aligning ? '' : 'none';
  eoEls.dYield.textContent = Math.round(shot.y);
  eoEls.dTarget.textContent = ' / ' + XR.targetG + ' g';
  eoEls.dBar.style.width = clamp(shot.y / XR.targetG) * 100 + '%';
  eoEls.dTime.textContent = mmss((shot.end || t) / 1000);
  eoEls.dRatio.textContent = '1:' + (shot.y / XR.doseG).toFixed(1);
  eoEls.dTemp.textContent = temp.toFixed(0);
  eoEls.detailLabel.textContent = wide ? 'PUCK SECTION' : bottomless ? 'PUCK · SECTION · BOTTOMLESS' : 'PUCK · SECTION · PRESSURISED';
  const k = XR.firstDrip / 7600, cup = { id: 'cup', v: shot.y.toFixed(0) + ' g', est: true };
  const onCup = (list) => pinned && found && !list.some((c) => c.id === 'cup') ? list.concat(cup) : list;
  paintCallouts(onCup(
    t < 1500 * k ? [{ id: 'pump', v: 'Priming' }]
      : t < 4400 * k ? [{ id: 'block', v: temp.toFixed(0) + '°C', est: true }]
        : t < 5700 * k ? [{ id: 'group', v: 'Water at screen' }]
          : t < XR.firstDrip ? [{ id: 'puck', v: 'Soaking · ' + Math.round(soak * 100) + '%' }]
            : shot.end ? [{ id: 'release', v: 'Pressure to tray' }, cup]
              : [flagged ? { id: 'puck', v: SIDE_NAMES[flagIndex] + ' side fast', warn: true } : choking ? { id: 'puck', v: 'Tight, resisting', warn: true } : { id: 'puck', v: 'Even flow' }, cup]));
  const done = !!shot.end && t - shot.end >= XR.summaryAt;
  if (done !== eoRoot.classList.contains('done')) {
    eoRoot.classList.toggle('done', done);
    if (done) { setAligning(false); paintSummary(); }
  }
  if (done) eoEls.hold.style.width = Math.min(1, (t - shot.end - XR.summaryAt) / (XR.finishHold - XR.summaryAt)) * 100 + '%';
}

const SIDE_NAMES = ['Left', 'Centre', 'Right'];

const VERDICT_TIP = { fast: ' Grind finer or add coffee.', long: ' Grind coarser or use less coffee.', channel: ' Stir with WDT and tamp level.', ok: ' Taste it hot.' };

function shotVerdict() {
  const v = CG.Verdict(shot.end / 1000, shot.chDmg);
  return [v.title, v.cause + VERDICT_TIP[v.kind], v.kind !== 'ok'];
}

function paintSummary() {
  const [big, sub, warn] = shotVerdict();
  eoEls.verdictBig.textContent = big;
  eoEls.verdictSub.textContent = sub;
  eoEls.verdictBig.classList.toggle('warn', warn);
  eoEls.statYield.textContent = Math.round(shot.y) + ' g';
  eoEls.statTime.textContent = mmss(shot.end / 1000);
  eoEls.statRatio.textContent = '1:' + (shot.y / XR.doseG).toFixed(1);
  eoEls.hold.style.width = '0%';
}

function frame() {
  if (!eoRunning) return;
  eoRaf = requestAnimationFrame(frame);
  const now = performance.now(), dt = Math.min(120, now - lastFrame);
  const live = !pinned && eoVideo && !eoVideo.classList.contains('hidden') && eoVideo.readyState >= 2;
  let res = null;
  lastFrame = now;
  if (live && now - lastSample >= 1000 / TUNE.sampleHz) {
    lastSample = now;
    res = detectChannel(eoVideo);
    if (readFlowState(res) === 'ended' && shot.t > XR.firstDrip && !shot.end) endSim();
  }
  stepShot(dt, liveChannel(res, live));
  stepBadge(now, res, live);
  updatePhase();
  paint(now);
}

function updatePhase() {
  const since = shot.t - shot.end;
  phase = shot.end ? 'finish' : shot.t < XR.firstDrip ? 'preinfusion' : 'extraction';
  const [elapsedPhaseSec, segFill] = phase === 'preinfusion' ? [shot.t / 1000, Math.min(1, shot.t / XR.firstDrip)]
    : phase === 'extraction' ? [(shot.t - XR.firstDrip) / 1000, Math.min(0.98, shot.y / XR.targetG)]
      : [since / 1000, Math.min(1, since / XR.finishHold)];
  if (onTick) onTick({ phase, elapsedPhaseSec, segFill, running: eoRunning, totalSec: shot.t / 1000, weightG: shot.y, flowGs: flowNow(), channel: flagged ? SIDE_NAMES[flagIndex] : '' });
  if (phase === 'finish' && !doneFired && since > XR.finishHold) finishDone();
}

function finishDone() {
  doneFired = true;
  if (onDone) onDone(shot.end / 1000);
}

function resetShot() {
  resetDetection();
  CG.Wizard.reset();
  sim = CG.Shot.create(prep);
  trace = []; chOn = null; peakQ = 0; maxP = 0;
  syncShot();
  flagged = false; hotSince = 0; coolSince = 0;
  phase = 'preinfusion'; doneFired = false;
  eoRoot.classList.remove('done');
}

function runShot(on) {
  eoRunning = on;
  eoRoot.classList.toggle('running', on);
  if (!on) { cancelAnimationFrame(eoRaf); return; }
  lastFrame = performance.now();
  eoRaf = requestAnimationFrame(frame);
}

function startShot() {
  if (eoRunning) return;
  resetShot();
  lastSample = 0;
  layout();
  runShot(true);
}

function eoStart(opts) {
  eoRoot = $(opts.container);
  eoVideo = $(opts.video);
  onEnd = opts.onEnd || null;
  onTick = opts.onTick || null;
  onDone = opts.onDone || null;
  if (!eoRoot) return;
  eoHost = eoRoot.parentElement;
  if (opts.basket) basketKind = opts.basket;
  prep = opts.prep || { grind: 1, dose: 18, wdt: true, tamp: 'ideal', level: 'level' };
  predicted = CG.Puck.forecast(prep);
  XR.doseG = prep.dose;
  XR.targetG = prep.dose * 2;
  XR.firstDrip = predicted.drip * 1000;
  if (flowSegs.length) scaleSegs();
  eoRun += 1;
  pinned = !!opts.pinned;
  found = false;
  standMode = ls.get('cg-xray-view') || 'auto';
  loadView();
  if (!eoEls) build(eoRoot);
  eoRoot.classList.toggle('wide', wide);
  eoRoot.classList.toggle('pinned', pinned);
  eoRoot.classList.remove('found', 'track-fail', 'running', 'upright');
  upright = false;
  eoRoot.classList.add('on');
  eoEls.xray.style.transform = '';
  eoEls.xray.getAnimations().forEach((a) => a.cancel());
  swapping = false;
  eoEls.scanText.textContent = 'Point at Plate X-Ray to see inside the machine';
  if (eoHost) eoHost.classList.add('eo-active');
  resetDetection();
  startShot();
}

function setFound(on) {
  tlog(on ? 'plate-found' : 'plate-lost', { t: Math.round(shot.t / 100) / 10 });
  found = on;
  eoRoot.classList.toggle('found', on);
  eoRoot.classList.add('landing');
  clearTimeout(landTimer);
  landTimer = setTimeout(() => eoRoot.classList.remove('landing'), 700);
  swapXray();
}

function swapXray() {
  const x = eoEls.xray;
  x.getAnimations().forEach((a) => a.cancel());
  const out = x.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 180, easing: 'ease-in', fill: 'forwards' });
  swapping = true;
  out.onfinish = () => {
    swapping = false;
    if (!found) layout();
    else if (xrMap) x.style.transform = CG.Tracker.fit(390, 844, xrMap);
    x.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 380, easing: 'cubic-bezier(.2,.8,.2,1)' });
    out.cancel();
  };
}

function cardLost() {
  setFound(false);
  eoEls.hint.classList.remove('show');
  eoEls.scanText.textContent = 'Point back at Plate X-Ray';
  xrS = 0;
}

function onCard(pose) {
  clearTimeout(lostTimer);
  if (!pose) { lostTimer = setTimeout(cardLost, 2500); return; }
  if (!found) { buzz('success', true); setFound(true); }
  CG.Tracker.hint(eoEls.hint, 0.25);
  const facing = CG.Tracker.facing(), up = standMode === 'auto' ? (upright ? facing < XR.flat : facing < XR.upright) : standMode === 'upright';
  if (up !== upright) setUpright(up);
  const c = XR.card, T = XR.baseT, H = XR.standH;
  const [a, b, l, r] = up ? [[0.5, T, 0], [0.5, T, H], [0, T, 0], [1, T, 0]].map((q) => CG.Tracker.point(...q)) : [[0.5, 0], [0.5, 1], [0, 0.5], [1, 0.5]].map((q) => CG.Tracker.point(...q));
  const [bw, bh] = CG.Tracker.box(), fitH = AR_FIT.xray * bh / Math.max(1, Math.hypot(a[0] - b[0], a[1] - b[1])), fitW = 0.9 * bw / Math.max(1, Math.hypot(l[0] - r[0], l[1] - r[1]));
  const fitTop = up && b[1] < a[1] ? (a[1] - XR.topPx) / (a[1] - b[1]) : Infinity;
  xrS = arScale(xrS, clamp(Math.min(fitH, fitW, fitTop), up ? 0.3 : 1, AR_FIT.max));
  xrMap = up
    ? (u, v) => [0.5 + ((u - c.x) / c.w - 0.5) * xrS, T, (c.y + c.h - v) / c.h * H * xrS]
    : (u, v) => [0.5 + ((u - c.x) / c.w - 0.5) * xrS, 0.5 + ((v - c.y) / c.h - 0.5) * xrS, 0];
  if (swapping) return;
  eoEls.xray.style.transform = CG.Tracker.fit(390, 844, xrMap);
  if (up) eoEls.floor.style.transform = CG.Tracker.fit(200, 100, (u, v) => [0.5 + (u / 200 - 0.5) * 1.5 * xrS, T + (v / 100 - 0.5) * 0.36 * xrS, 0]);
}

function setUpright(on) {
  upright = on;
  eoRoot.classList.toggle('upright', on);
  if (!swapping) eoEls.xray.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 350, easing: 'cubic-bezier(.2,.8,.2,1)' });
  eoEls.standBtn.textContent = 'View · ' + (standMode === 'auto' ? 'Auto' : on ? 'Upright' : 'Flat');
}

function cycleStand() {
  standMode = STAND_MODES[(STAND_MODES.findIndex((m) => m[0] === standMode) + 1) % STAND_MODES.length][0];
  ls.set('cg-xray-view', standMode);
  if (standMode !== 'auto') setUpright(standMode === 'upright');
  else setUpright(upright);
}

function unpin() {
  clearTimeout(lostTimer);
  xrMap = null;
  pinned = found = false;
  eoRoot.classList.remove('pinned', 'found');
  eoEls.xray.style.transform = '';
  loadView();
  layout();
}

async function eoTrack(granted) {
  if (!pinned) return;
  const run = eoRun, ok = granted && await CG.Tracker.start(eoVideo, CG.TARGETS.dedica, onCard);
  if (!ok && run === eoRun && pinned) CG.Tracker.fail(eoRoot, granted, unpin);
}

function eoStop() {
  clearTimeout(lostTimer);
  if (eoRunning) runShot(false);
  if (pinned) CG.Tracker.stop();
  pinned = found = aligning = false;
  if (eoRoot) eoRoot.classList.remove('on', 'running', 'aligning', 'done', 'pinned', 'found', 'track-fail');
  if (eoEls) eoEls.hint.classList.remove('show');
  if (eoHost) eoHost.classList.remove('eo-active');
  resetDetection();
  eoVideo = null;
}

function eoTogglePause() {
  if (eoRunning) runShot(false);
  else if (eoRoot) runShot(true);
  return eoRunning;
}

function eoFinishNow() {
  while (!shot.end && sim.t < 90) stepShot(100);
  if (!shot.end) endSim();
  else if (!doneFired) finishDone();
}

function eoSetWide(on) {
  if (wide === on) return;
  wide = on;
  setAligning(false);
  loadView();
  if (!eoEls) return;
  eoRoot.classList.toggle('wide', wide);
  layout();
  paintCallouts(lastCallouts);
}

function eoGetResult() {
  if (!shot.end) return null;
  const t = shot.end / 1000;
  return {
    weightG: Math.round(shot.y), timeSec: t, early: t < CG.SHOT.targetLo, choked: t > CG.SHOT.targetHi, prep: Object.assign({}, prep),
    model: { time: +t.toFixed(1), drip: sim.drip ?? 0, chOn, chDmg: +shot.chDmg.toFixed(2), peak: peakQ, maxP, side: channelSide(), trace: trace.slice() },
  };
}

CG.EspressoOverlay = {
  start: eoStart, stop: eoStop, getResult: eoGetResult, togglePause: eoTogglePause, finishNow: eoFinishNow, setWide: eoSetWide, setAligning, track: eoTrack,
  etaSec: () => eoRunning ? Math.max(0, (etaMs() - shot.t) / 1000) : null,
  isPinned: () => pinned,
};

const METHOD_DATA = {
  espresso: { key: 'espresso', name: 'Espresso', grind: 'Fine, like powdered sugar', dose: '18 g coffee', yield: '36 g in the cup', temp: '93 °C',
    tips: 'Press the coffee flat and level.',
    phases: [
      { name: 'Pre-infusion', duration: 8, cue: 'Water soaks the coffee gently first.' },
      { name: 'Extraction', duration: 22, cue: 'Espresso runs into the cup.' },
      { name: 'Finish', duration: 5, cue: 'The shot stops. Taste it while it is hot.' },
    ] },
  pourover: { key: 'pourover', name: 'V60', grind: 'Medium-fine, like sea salt', dose: '22 g coffee', yield: '360 g water', temp: '94 °C',
    tips: 'Pour slowly in small circles from the centre out.',
    phases: [
      { name: 'Bloom', duration: 30, cue: 'Pour 50 g of water to wet all the coffee. Wait while it bubbles.' },
      { name: 'Main pour', duration: 120, cue: 'Pour slowly in small circles up to 360 g.' },
      { name: 'Draw-down', duration: 45, cue: 'Let the last of the water drip through.' },
    ] },
  immersion: { key: 'immersion', name: 'French Press', grind: 'Coarse, like breadcrumbs', dose: '30 g coffee', yield: '500 g water', temp: '96 °C',
    tips: 'Leave it to steep. Stirring less gives a sweeter cup.',
    phases: [
      { name: 'Steep', duration: 210, cue: 'Pour in all 500 g of water, stir once, then leave it.' },
      { name: 'Break', duration: 30, cue: 'Stir the top and spoon off the foam.' },
      { name: 'Press', duration: 30, cue: 'Press the plunger down slowly.' },
    ] },
  aeropress: { key: 'aeropress', name: 'AeroPress', grind: 'Medium-fine, like sea salt', dose: '16 g coffee', yield: '220 g water', temp: '85 °C',
    tips: 'Press steadily. Stop when you hear a hiss.',
    phases: [
      { name: 'Steep', duration: 80, cue: 'Pour 220 g of water, stir three times, then wait.' },
      { name: 'Press', duration: 25, cue: 'Press down slowly. Stop when you hear a hiss.' },
      { name: 'Finish', duration: 10, cue: 'Add hot water if it tastes too strong.' },
    ] },
  chemex: { key: 'chemex', name: 'Chemex', grind: 'Medium-coarse, like kosher salt', dose: '30 g coffee', yield: '500 g water', temp: '94 °C',
    tips: 'The thick filter needs a slow pour.',
    phases: [
      { name: 'Bloom', duration: 35, cue: 'Pour 60 g of water to wet all the coffee. Wait while it bubbles.' },
      { name: 'Main pour', duration: 150, cue: 'Pour in slow circles up to 500 g.' },
      { name: 'Draw-down', duration: 70, cue: 'The thick filter drips slowly. Give it time.' },
    ] },
  mokapot: { key: 'mokapot', name: 'Moka Pot', grind: 'Fine, just coarser than espresso', dose: '18 g coffee', yield: 'Water to the valve', temp: 'Stove',
    tips: 'Keep the heat medium-low so it does not burn.',
    phases: [
      { name: 'Heat', duration: 180, cue: 'Medium-low heat with the lid open, until coffee starts to rise.' },
      { name: 'Flow', duration: 60, cue: 'Coffee comes up the spout. A gurgle means it is nearly done.' },
      { name: 'Finish', duration: 10, cue: 'Take it off the heat straight away.' },
    ] },
};

function methodOf(k) {
  return METHOD_DATA[k] || METHOD_DATA.pourover;
}

CG.GRIND = {
  scale: [
    { um: 200, like: 'Powder, like flour' },
    { um: 280, like: 'Fine, like powdered sugar' },
    { um: 360, like: 'Just finer than table salt' },
    { um: 450, like: 'Like table salt' },
    { um: 550, like: 'Fine sand' },
    { um: 650, like: 'Sea salt' },
    { um: 750, like: 'Sea salt' },
    { um: 850, like: 'Coarse sand' },
    { um: 950, like: 'Coarse sand' },
    { um: 1050, like: 'Breadcrumbs' },
    { um: 1150, like: 'Breadcrumbs' },
    { um: 1250, like: 'Rock salt' },
  ],
  bands: [['Turk', 'Turkish', 0, 0], ['Espresso', 'espresso', 1, 2], ['Moka', 'moka pot', 3, 3], ['Aero', 'AeroPress', 4, 4],
    ['V60', 'V60', 5, 6], ['Chemex', 'Chemex', 7, 8], ['Press', 'French press', 9, 10], ['Cold', 'cold brew', 11, 11]],
  target: { espresso: 1, mokapot: 3, aeropress: 4, pourover: 5, import: 5, chemex: 7, immersion: 9 },
  band(g) { return CG.GRIND.bands.find((b) => g >= b[2] && g <= b[3]); },
};

CG.BASKET = { depthMm: 20.5, mmPerG: 0.9, swellMm: 2, looseMm: 6 };
CG.TAMP = { light: { kg: 5, r: 0.85 }, ideal: { kg: 15, r: 1 }, tight: { kg: 30, r: 1.1 } };
CG.PUMP = { qMax: 5.5, pMax: 15, opv: 10.5, r0: 6.2 };
CG.SHOT = { targetLo: 25, targetHi: 32, channeled: 0.5 };

CG.Shot = {
  base(p) {
    const B = CG.BASKET, um = CG.GRIND.scale[p.grind].um, perm = Math.pow(um / 280, 2);
    const bed = p.dose * B.mmPerG, head = B.depthMm - bed;
    const crushed = head < B.swellMm, loose = head > B.looseMm;
    const risks = [
      [!p.wdt, 0.3, 'clumps from skipping WDT'],
      [p.level === 'tilted', 0.35, 'the tilted tamp'],
      [p.tamp === 'light', 0.15, 'the light tamp'],
      [loose, 0.2, 'the low dose'],
      [crushed, 0.1, 'the puck pressing on the screen'],
      [perm > 1.4, 0.1, 'the coarse grind'],
    ].filter((r) => r[0]).sort((a, b) => b[1] - a[1]);
    const risk = Math.min(1, 0.05 + risks.reduce((n, r) => n + r[1], 0));
    return {
      um, perm, bed, head, crushed, loose, risk, top: risks.length ? risks[0][2] : '',
      res: (p.dose / 18) * CG.TAMP[p.tamp].r / perm * (crushed ? 1.15 : 1),
      channel: clamp(1.2 * risk - 0.15),
      side: p.level === 'tilted' ? 0 : (p.grind + Math.round(p.dose * 2)) % 3,
      fill: p.dose * 0.7 + Math.max(0, head) * 1.6,
      target: p.dose * 2,
    };
  },
  create(p) {
    return { f: CG.Shot.base(p), t: 0, water: 0, sat: 0, y: 0, P: 0, Q: 0, flow: 0, ch: 0, chDmg: 0, chAt: null, drip: null, end: null };
  },
  step(s, dt, mod) {
    const f = s.f, pump = CG.PUMP, m = mod || {};
    if (s.end !== null) {
      s.P = Math.max(0, s.P - dt * 11);
      s.Q = 0; s.flow = 0; s.t += dt;
      return s;
    }
    const erode = s.drip === null ? 0.08 + 0.92 * s.sat * s.sat : 1 - 0.22 * Math.min(1, s.y / (f.target * 1.1));
    const R = pump.r0 * f.res * erode * (1 - 0.5 * s.ch) * (m.resMul || 1);
    const P = Math.min(pump.opv, pump.qMax / (1 / R + pump.qMax / pump.pMax)) * Math.min(1, s.t / 1.2);
    const k = 1 - Math.exp(-dt / 0.35);
    s.P += (P - s.P) * k;
    s.Q += (P / R - s.Q) * k;
    if (s.drip === null) {
      s.water += s.Q * dt;
      s.sat = Math.min(1, s.water / f.fill);
      if (s.sat >= 1) s.drip = s.t;
    } else {
      s.flow = s.Q * Math.min(1, (s.t - s.drip) / 2);
      s.y = Math.min(f.target, s.y + s.flow * dt);
      if (s.y >= f.target) s.end = s.t;
    }
    if (s.drip === null) s.flow = 0;
    if (s.chAt === null && s.drip !== null && s.P > 6) s.chAt = s.t + 1 + 7 * (1 - f.risk);
    const want = m.force != null ? m.force : m.live != null ? m.live : s.chAt !== null && s.t >= s.chAt ? f.channel : 0;
    s.ch += (want - s.ch) * (1 - Math.exp(-dt / (want > s.ch ? 1.1 : 0.8)));
    if (s.drip !== null) s.chDmg = Math.min(1, s.chDmg + s.ch * dt / 9);
    s.t += dt;
    return s;
  },
};

CG.Shot.model = (r) => ({ time: +r.time.toFixed(1), drip: r.drip, chOn: r.chOn, chDmg: +r.chDmg.toFixed(2), side: r.f.side, peak: r.peak, maxP: r.maxP, trace: r.trace });

CG.Shot.result = (prep) => {
  const r = CG.Shot.run(prep);
  return { prep, timeSec: r.time, weightG: Math.round(r.yield), model: CG.Shot.model(r) };
};

CG.Shot.run = (p) => {
  const s = CG.Shot.create(p), trace = [];
  let peak = 0, maxP = 0, chOn = null;
  for (let i = 0; i < 1800 && (s.end === null || s.t < s.end + 1); i++) {
    CG.Shot.step(s, 0.05);
    peak = Math.max(peak, s.flow);
    maxP = Math.max(maxP, s.P);
    if (chOn === null && s.ch > 0.3) chOn = s.t;
    if (i % 5 === 4) trace.push([+s.t.toFixed(2), +s.flow.toFixed(2), +s.P.toFixed(2), +s.y.toFixed(1)]);
  }
  return { f: s.f, trace, time: s.end ?? 90, drip: s.drip ?? 0, chOn, chDmg: s.chDmg, peak, maxP, yield: s.y };
};

CG.Puck = {
  forecast(p) {
    const r = CG.Shot.run(p), f = r.f, flow = [], bar = [];
    r.trace.forEach((q, i) => { if (i % 4 === 3) { flow.push(q[1]); bar.push(q[2]); } });
    while (flow.length < 60) { flow.push(0); bar.push(Math.max(0, (bar[bar.length - 1] || 0) - 5)); }
    return Object.assign({}, f, {
      time: r.time, drip: r.drip, peak: r.peak, chDmg: r.chDmg,
      flowCurve: flow.slice(0, 60), barCurve: bar.slice(0, 60),
      riskLabel: f.risk < 0.3 ? 'Low' : f.risk < 0.55 ? 'Medium' : 'High',
      taste: CG.Puck.taste(r.time, r.chDmg),
    });
  },
  taste(t, dmg) {
    if (dmg >= CG.SHOT.channeled) return 'Sour and bitter';
    if (t < 20) return 'Sour, thin';
    if (t < CG.SHOT.targetLo) return 'Bright, light';
    if (t <= CG.SHOT.targetHi) return 'Balanced';
    if (t <= 40) return 'Heavy, bitter';
    return 'Bitter, dry';
  },
};

CG.Verdict = function verdict(t, dmg) {
  const lo = CG.SHOT.targetLo, hi = CG.SHOT.targetHi, ch = dmg >= CG.SHOT.channeled;
  if (t < lo && ch) return { kind: 'channel', title: Math.round(lo - t) + ' s too fast', cause: 'A channel let the water through. Expect sour and bitter at once.' };
  if (t < lo) return { kind: 'fast', title: Math.round(lo - t) + ' s too fast', cause: 'Water ran through too easily. Expect sourness.' };
  if (t > hi) return { kind: 'long', title: Math.round(t - hi) + ' s too slow', cause: 'Too much resistance. Expect bitterness.' };
  if (ch) return { kind: 'channel', title: 'One side ran fast', cause: 'The time was right, but water rushed through one side of the coffee.' };
  return { kind: 'ok', title: 'On target', cause: 'The time and the amount in the cup were both right.' };
};

CG.Verdict.plan = (method) => methodOf(method).phases.reduce((a, p) => a + p.duration, 0);

CG.Verdict.of = (r) => {
  if (r.method === 'espresso') return CG.Verdict(r.time, r.model ? r.model.chDmg : 0);
  const plan = CG.Verdict.plan(r.method), d = r.time - plan;
  if (Math.abs(d) <= plan * 0.1) return { kind: 'ok', title: 'On time', cause: mmss(r.time) + ' total against ' + mmss(plan) + ' planned.' };
  if (d < 0) return { kind: 'fast', title: Math.round(-d) + ' s shorter than planned', cause: 'Less contact time. Expect a lighter, brighter cup.' };
  return { kind: 'long', title: Math.round(d) + ' s longer than planned', cause: 'More contact time. Expect a heavier, more bitter cup.' };
};

CG.Taste = {
  predict(r) {
    if (r.method !== 'espresso') return { x: 0, y: 0 };
    const ch = r.model && r.model.chDmg >= CG.SHOT.channeled;
    return { x: ch ? -0.15 : clamp((r.time - 28) / 10, -1), y: clamp((2 - r.yield / r.dose) * 1.5 + (r.dose - 18) * 0.08, -1) };
  },
  label(t) {
    if (!t) return 'Not rated';
    const h = t.x < -0.3 ? 'Sour' : t.x > 0.3 ? 'Bitter' : '', v = t.y > 0.35 ? 'strong' : t.y < -0.35 ? 'weak' : '';
    if (!h && !v) return 'Balanced';
    return h && v ? h + ', ' + v : h || v.charAt(0).toUpperCase() + v.slice(1);
  },
};

CG.Advice = {
  next(r) {
    const p = Object.assign({}, r.prep), espresso = r.method === 'espresso', f0 = espresso ? CG.Puck.forecast(p) : null;
    const mk = (field, to, title, why) => {
      const np = field in p ? Object.assign({}, p, { [field]: to }) : p, f = espresso ? CG.Puck.forecast(np) : null;
      return { field, from: field in p ? p[field] : r[field], to, title, why, prep: np, predicted: f, next: f ? +(r.time + f.time - f0.time).toFixed(1) : null };
    };
    const keep = { field: null, title: 'Keep this recipe', why: espresso ? 'The time and the amount were right. Brew it the same way to check it holds.' : r.taste ? 'It tasted right. Brew it the same way to check it holds.' : 'No taste picked yet, so there is nothing to change. Brew it the same way.', prep: p, predicted: f0, next: espresso ? r.time : null };
    const x = r.taste ? r.taste.x : 0, y = r.taste ? r.taste.y : 0;
    if (espresso) {
      const b = CG.Shot.base(p), lo = CG.SHOT.targetLo, hi = CG.SHOT.targetHi;
      if (r.model && r.model.chDmg >= CG.SHOT.channeled) {
        if (p.level === 'tilted') return mk('level', 'level', 'Tamp level', 'The tilted surface gave water a short path on one side.');
        if (!p.wdt) return mk('wdt', true, 'Stir with WDT', 'Clumps left loose spots that the water pushed through.');
        if (p.tamp === 'light') return mk('tamp', 'ideal', 'Tamp firmer, about 15 kg', 'A soft puck shifted when the water hit it.');
        if (b.loose) return mk('dose', 18, 'Dose up to 18 g', 'The puck sat low in the basket and turned soggy.');
      }
      if (b.crushed) return mk('dose', 19, 'Dose down to 19 g', 'The wet puck pressed into the shower screen and choked the flow.');
      if (r.time < lo || r.time > hi) {
        const dir = r.time < lo ? -1 : 1, said = 'It ran ' + r.time.toFixed(1) + ' s. ';
        let g = p.grind;
        for (let k = p.grind + dir; k >= 0 && k <= 11; k += dir) {
          g = k;
          const nt = r.time + CG.Puck.forecast(Object.assign({}, p, { grind: k })).time - f0.time;
          if (dir < 0 ? nt >= lo : nt <= hi) break;
        }
        if (g !== p.grind) return mk('grind', g, (dir < 0 ? 'Grind finer' : 'Grind coarser') + ', setting ' + (g + 1),
          said + (dir < 0 ? 'Finer grounds slow the water and extract more.' : 'Coarser grounds let water through faster and extract less.'));
        const d = clamp(p.dose - dir, 14, 21);
        if (d !== p.dose) return mk('dose', d, (dir < 0 ? 'Dose up to ' : 'Dose down to ') + d + ' g', said + 'The grind is at its limit. ' + (dir < 0 ? 'More coffee adds resistance.' : 'Less coffee removes resistance.'));
      }
      if (Math.abs(x) > 0.3 && r.temp) {
        const t = clamp(r.temp + (x < 0 ? 2 : -2), 88, 96);
        if (t !== r.temp) return mk('temp', t, (x < 0 ? 'Raise water to ' : 'Lower water to ') + t + ' °C',
          'The time was right but it tasted ' + (x < 0 ? 'sour' : 'bitter') + '. Keep the grind. ' + (x < 0 ? 'Hotter water extracts more.' : 'Cooler water extracts less.'));
      }
      if (Math.abs(y) > 0.3) {
        const d = clamp(p.dose + (y < 0 ? 1 : -1), 14, 21);
        if (d !== p.dose) return mk('dose', d, (y < 0 ? 'Dose up to ' : 'Dose down to ') + d + ' g', y < 0 ? 'It tasted weak. More coffee at the same ratio gives a stronger cup.' : 'It tasted heavy. Less coffee at the same ratio softens it.');
      }
      return keep;
    }
    if (Math.abs(x) > 0.25) {
      const dir = x < 0 ? -1 : 1, g = clamp(p.grind + dir, 0, 11);
      if (g !== p.grind) return mk('grind', g, (dir < 0 ? 'Grind finer' : 'Grind coarser') + ', setting ' + (g + 1), (dir < 0 ? 'It tasted sour. Finer grounds extract more.' : 'It tasted bitter. Coarser grounds extract less.'));
    }
    if (Math.abs(y) > 0.3) return { field: 'note', title: y < 0 ? 'Use a little more coffee' : 'Use a little less coffee', why: y < 0 ? 'It tasted weak. Raise the dose by about 1 g.' : 'It tasted strong. Lower the dose by about 1 g.', prep: p, predicted: null };
    return keep;
  },
  notes(r, a) {
    const out = [], d = r.roastDays;
    if (a.field === 'grind' && r.click != null) out.push('On your ' + r.grinder + ': click ' + r.click + ' → ' + Math.max(1, r.click + a.to - a.from) + '. Lower numbers grind finer.');
    if (d != null && d < 4) out.push('Beans are ' + d + ' days off roast. Gas from fresh beans pushes channels. Rest them to about 7 days.');
    if (d != null && d > 35) out.push('Beans are ' + d + ' days off roast. Older beans run faster and taste flat.');
    const best = r.method === 'espresso' && CG.Store.all().find((o) => o.id !== r.id && o.method === 'espresso' && o.grinder === r.grinder && o.verdict && o.verdict.kind === 'ok');
    if (best && best.click !== r.click) out.push('Your last on-target shot on this grinder used click ' + best.click + '.');
    return out;
  },
};

CG.GRINDERS = ['Timemore S3', '1Zpresso J Ultra', 'Niche Zero', 'DF64', 'Other'];

CG.Store = {
  key: 'cg-brews-v1', gearKey: 'cg-gear-v1', list: null,
  all() {
    const S = CG.Store;
    if (!S.list) S.list = ls.json(S.key);
    if (!Array.isArray(S.list)) S.list = S.seed();
    return S.list;
  },
  save() { ls.set(CG.Store.key, JSON.stringify(CG.Store.list)); },
  add(r) { const S = CG.Store; S.list = S.all().filter((x) => x.id !== r.id); S.list.unshift(r); S.save(); },
  remove(id) { CG.Store.list = CG.Store.all().filter((r) => r.id !== id); CG.Store.save(); },
  get(id) { return CG.Store.all().find((r) => r.id === id); },
  reset() {
    ls.del(CG.Store.key);
    ls.del(CG.Store.gearKey);
    CG.Store.list = CG.Store.seed();
  },
  gear() { return Object.assign({ grinder: 'Timemore S3', click: 8, bean: 'broadway', roastDays: 9, temp: 93 }, ls.json(CG.Store.gearKey)); },
  setGear(g) { ls.set(CG.Store.gearKey, JSON.stringify(Object.assign(CG.Store.gear(), g))); },
  judge(rec) {
    rec.verdict = CG.Verdict.of(rec);
    rec.advice = CG.Advice.next(rec);
    delete rec.advice.predicted;
    return rec;
  },
  espresso(prep, extra, daysAgo) {
    const r = CG.Shot.run(prep);
    return CG.Store.judge(Object.assign({
      id: 'seed-' + daysAgo, at: Date.now() - daysAgo * 86400000, method: 'espresso', bean: 'broadway', roastDays: Math.round(5 + daysAgo), grinder: 'Timemore S3', click: 7 + prep.grind, temp: 93,
      prep, dose: prep.dose, target: prep.dose * 2, time: +r.time.toFixed(1), yield: Math.round(r.yield), model: CG.Shot.model(r),
    }, extra));
  },
  seed() {
    const S = CG.Store, P = (grind, dose, wdt, tamp, level) => ({ grind, dose, wdt, tamp, level });
    return [
      S.espresso(P(1, 18, true, 'ideal', 'level'), { taste: { x: 0.05, y: 0.1 }, rating: 5, notes: 'Toffee and dark chocolate. Syrupy.' }, 0.9),
      S.judge({ id: 'seed-v60', at: Date.now() - 1 * 86400000 - 3600000 * 5, method: 'pourover', bean: 'decaf', roastDays: 12, grinder: 'Timemore S3', click: 18, temp: 94,
        prep: { grind: 5 }, dose: 22, target: 360, time: 195, yield: 360, model: null, taste: { x: 0.1, y: -0.15 }, rating: 4, notes: 'Berries up front, clean finish.' }),
      S.espresso(P(1, 18, false, 'ideal', 'tilted'), { taste: { x: -0.35, y: -0.4 }, rating: 3, notes: 'Thin, sharp edge. Saw a spurt on the left.' }, 3),
      S.espresso(P(2, 18, false, 'ideal', 'level'), { taste: { x: -0.7, y: -0.45 }, rating: 2, notes: 'Sour and watery.' }, 5),
      S.espresso(P(0, 18, false, 'ideal', 'level'), { taste: { x: 0.75, y: 0.5 }, rating: 2, notes: 'Bitter, dry finish. Took forever.' }, 6),
    ];
  },
};

CG.Wizard = {
  on: false, resMul: 1, force: null, side: null,
  reset() { Object.assign(CG.Wizard, { resMul: 1, force: null, side: null }); },
  mods() { return CG.Wizard.on ? { resMul: CG.Wizard.resMul, force: CG.Wizard.force } : {}; },
  cmd(c) {
    const W = CG.Wizard;
    if (!W.on) return;
    if (c === 'faster') W.resMul = Math.max(0.3, W.resMul * 0.8);
    if (c === 'slower') W.resMul = Math.min(3, W.resMul * 1.25);
    if (c === 'left' || c === 'centre' || c === 'right') { W.force = 0.9; W.side = ['left', 'centre', 'right'].indexOf(c); }
    if (c === 'clear') W.force = 0;
    if (c === 'reset') W.reset();
    if (c === 'stop' && CG.EspressoOverlay) CG.EspressoOverlay.finishNow();
  },
};

const mmss = (sec) => {
  sec = Math.max(0, Math.round(sec));
  return Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0');
};

function camSteady(track) {
  const c = track && track.getCapabilities ? track.getCapabilities() : {}, want = {};
  if ((c.focusMode || []).includes('continuous')) want.focusMode = 'continuous';
  if (c.zoom) want.zoom = clamp(1, c.zoom.min, c.zoom.max);
  if (Object.keys(want).length) track.applyConstraints({ advanced: [want] }).catch(() => {});
  const set = track && track.getSettings ? track.getSettings() : {};
  tlog('camera', { w: set.width, h: set.height, zoom: c.zoom ? [c.zoom.min, c.zoom.max] : null, focus: c.focusMode || null });
}

const createCameraController = () => {
  let stream = null, recorder = null, videoEl = null;
  const stopRecording = () => {
    if (recorder && recorder.state !== 'inactive') try { recorder.stop(); } catch {}
    recorder = null;
  };
  return {
    async start(video, facing = 'environment') {
      videoEl = video;
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return { granted: false };
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: facing } }, audio: false });
        camSteady(stream.getVideoTracks()[0]);
        if (videoEl) videoEl.srcObject = stream;
        return { granted: true };
      } catch (e) {
        tlog('camera-error', { name: e.name, msg: e.message });
        return { granted: false, error: e };
      }
    },
    stop() {
      stopRecording();
      if (stream) stream.getTracks().forEach((t) => t.stop());
      stream = null;
      if (videoEl) videoEl.srcObject = null;
      videoEl = null;
    },
    startRecording() {
      if (!stream) return false;
      try { recorder = new MediaRecorder(stream); recorder.start(); return true; } catch { return false; }
    },
    stopRecording,
  };
};

let brewMethod = null, brewIndex = 0, brewSeconds = 0, totalElapsed = 0, brewTimer = null, onCompleteCb = null;

const currentPhase = () => brewMethod.phases[Math.min(brewIndex, brewMethod.phases.length - 1)];

function renderBrew() {
  const phase = currentPhase(), left = mmss(Math.max(0, phase.duration - brewSeconds));
  $('brewPhasePillName').textContent = phase.name;
  $('brewPhasePillTime').textContent = '· ' + left;
  $('btStep').textContent = 'Step ' + (brewIndex + 1) + ' of ' + brewMethod.phases.length + ' · ' + phase.name;
  $('btTime').textContent = left;
  $('btCue').innerHTML = termify(esc(phase.cue));
  $('brewNextBtn').textContent = brewIndex < brewMethod.phases.length - 1 ? 'Next: ' + brewMethod.phases[brewIndex + 1].name.toLowerCase() : 'Finish';
  paintPhases(brewIndex, brewSeconds / phase.duration, brewMethod.phases);
}

function paintPhases(idx, fill, phases) {
  [0, 1, 2].forEach((i) => {
    const seg = $('brewSegment' + i), lab = $('brewLabel' + i), f = i < idx ? 1 : i > idx ? 0 : fill;
    seg.style.background = f >= 1 ? 'var(--teal)' : f > 0 ? `linear-gradient(to right, var(--teal) ${Math.round(f * 100)}%, rgba(244,241,236,.22) ${Math.round(f * 100)}%)` : 'rgba(244,241,236,.22)';
    lab.textContent = phases[i].name;
    lab.style.color = i === idx ? '#F4F1EC' : 'rgba(244,241,236,.45)';
  });
}

function tick() {
  brewSeconds += 1;
  totalElapsed += 1;
  if (brewSeconds >= currentPhase().duration) {
    if (brewIndex >= brewMethod.phases.length - 1) return finishEarly();
    brewIndex += 1;
    brewSeconds = 0;
  }
  renderBrew();
}

function startTimer() {
  clearInterval(brewTimer);
  brewTimer = setInterval(tick, 1000);
}

function stopBrew() {
  clearInterval(brewTimer);
}

function finishEarly() {
  stopBrew();
  if (onCompleteCb) onCompleteCb(totalElapsed);
}

function startBrew(methodKey, onComplete) {
  brewMethod = methodOf(methodKey);
  brewIndex = brewSeconds = totalElapsed = 0;
  onCompleteCb = onComplete;
  startTimer();
  renderBrew();
}

function skipPhase() {
  if (brewIndex >= brewMethod.phases.length - 1) return finishEarly();
  brewIndex += 1;
  brewSeconds = 0;
  renderBrew();
}

const Brew = { startBrew, finishEarly, stopBrew, skipPhase };

const appState = {
  method: null, lastEspressoResult: null,
  grind: 1, grindFor: null, dose: 18, wdt: true, tamp: 'ideal', level: 'level', step: 'grind', glasses: false,
};

const brewCamera = createCameraController();

function showScreen(name) {
  document.querySelectorAll('.screen').forEach((s) => {
    const on = s.dataset.screen === name;
    if (on && !s.classList.contains('active')) s.scrollTop = 0;
    s.classList.toggle('active', on);
  });
  syncTabs(name);
  renderCrumbs(name);
  const bar = $('statusBar');
  if (bar) bar.classList.toggle('dark', name === 'brew' || name === 'coach');
  applyGlasses(name);
}

function updateMethodSelectionUI() {
  document.querySelectorAll('.method-card').forEach((el) => el.classList.toggle('selected', el.dataset.method === appState.method));
}

function initMethod() {
  document.querySelectorAll('.method-card').forEach((el) => el.addEventListener('click', () => quickMethod(el.dataset.method)));
  $('startBrewingBtn').addEventListener('click', brewNow);
  $('pxStart').addEventListener('click', () => (appState.step === 'tamp' ? brewNow() : goStep(STEPS[STEPS.indexOf(appState.step) + 1])));
}

function seeded(n) {
  let x = n * 9301 + 49297;
  return () => { x = (x * 1103515245 + 12345) % 2147483648; return x / 2147483648; };
}

const GRAIN_COLS = ['#5C3D24', '#6B4A30', '#7A5334', '#4A311D', '#8C6242'];

function grain(x, y, r, rnd) {
  const n = 6 + Math.floor(rnd() * 3), pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rnd() * 0.5, k = r * (0.72 + rnd() * 0.38);
    pts.push((x + Math.cos(a) * k).toFixed(1) + ',' + (y + Math.sin(a) * k).toFixed(1));
  }
  return '<path d="M' + pts.join('L') + 'Z" fill="' + GRAIN_COLS[Math.floor(rnd() * GRAIN_COLS.length)] + '"/>';
}

function prepState() {
  return { grind: appState.grind, dose: appState.dose, wdt: appState.wdt, tamp: appState.tamp, level: appState.level };
}

function segOn(id, attr, val) {
  document.querySelectorAll('#' + id + ' [' + attr + ']').forEach((b) => b.classList.toggle('on', b.getAttribute(attr) === String(val)));
}

const STEPS = ['grind', 'dose', 'wdt', 'tamp'];
const STEP_NAME = { grind: 'Grind', dose: 'Dose', wdt: 'WDT', tamp: 'Tamp' };
const STEP_CAPTION = {
  grind: 'Side view · grains drawn larger',
  dose: 'Side view of the basket',
  wdt: 'Side view · clumps in the bed',
  tamp: 'Side view · tamper on the puck',
};
const px = { cur: null, goal: null, raf: 0, last: 0, off: 0, loupeOff: 0, cardOff: 0, loupeSpeed: 40, cardSpeed: 40, clumps: [], cracks: [], sig: '' };

function renderGrind() {
  const m = methodOf(appState.method), espresso = appState.method === 'espresso';
  const target = CG.GRIND.target[appState.method] ?? 5;
  if (appState.grindFor !== appState.method) { appState.grind = target; appState.grindFor = appState.method; appState.step = 'grind'; }
  $('grindMethodName').textContent = m.name;
  $('grindSummary').textContent = `${m.dose} · ${m.yield} · ${m.temp}`;
  $('grindTip').textContent = m.tips;
  ['grindTipRow', 'ppGrindCard', 'startBrewingBtn'].forEach((id) => $(id).classList.toggle('hidden', espresso));
  document.querySelector('[data-screen=grind] .grind-card').classList.toggle('hidden', espresso);
  $('prepCard').classList.toggle('hidden', !espresso);
  const ticks = CG.GRIND.scale.map((_, i) =>
    `<button type="button" data-g="${i}" class="${i === target ? 'target' : ''}" aria-label="Grind setting ${i + 1}"></button>`).join('');
  const bands = CG.GRIND.bands.map((b) => `<span data-band="${b[2]}" style="flex:${b[3] - b[2] + 1}">${b[0]}</span>`).join('');
  $('dialTicks').innerHTML = ticks;
  $('ppBands').innerHTML = bands;
  $('pxDial').innerHTML = ticks;
  $('pxBands').innerHTML = bands;
  px.cur = null;
  renderPrep();
  prepLoop();
}

function grindState() {
  const g = appState.grind, row = CG.GRIND.scale[g], target = CG.GRIND.target[appState.method] ?? 5;
  const here = CG.GRIND.band(g), goal = CG.GRIND.band(target), diff = g - target;
  const name = methodOf(appState.method).name;
  const far = Math.abs(diff) >= 2 && here !== goal ? ` This is ${here[1]} range.` : '';
  const txt = diff === 0
    ? ['ok', `Right for ${name}.`, appState.method === 'espresso' ? 'Enough resistance for a 25 to 30 second shot.' : 'Water moves through at the pace this method needs.']
    : diff < 0
      ? ['warn', `Finer than ${name} needs.`, 'Tighter gaps slow the water and pull out more bitterness.' + far]
      : ['warn', `Coarser than ${name} needs.`, 'Wide gaps let water rush through. The cup tastes sour and thin.' + far];
  return { g, row, target, here, goal, txt, perm: Math.pow(row.um / 280, 2) };
}

function paintDial(dial, bands, gs) {
  document.querySelectorAll('#' + dial + ' [data-g]').forEach((b) => b.classList.toggle('on', +b.dataset.g === gs.g));
  document.querySelectorAll('#' + bands + ' [data-band]').forEach((b) => {
    b.classList.toggle('here', +b.dataset.band === gs.here[2]);
    b.classList.toggle('goal', +b.dataset.band === gs.goal[2] && gs.here !== gs.goal);
  });
}

function setNote(id, cls, head, body) {
  const el = $(id), html = '<b>' + head + '</b> ' + body;
  if (el.innerHTML === html) return;
  el.className = 'pp-note ' + cls;
  el.innerHTML = html;
  el.animate([{ opacity: 0, transform: 'translateY(4px)' }, { opacity: 1, transform: 'none' }], { duration: 280, easing: 'ease-out' });
}

function stepNote(step, f, gs) {
  if (step === 'grind') return gs.txt;
  if (step === 'dose') {
    if (f.crushed) return ['warn', 'Too much coffee.', 'The wet puck presses into the shower screen and chokes the flow.'];
    if (f.loose) return ['warn', 'Too little coffee.', 'The puck sits low, turns soggy and lets water rush through.'];
    return ['ok', 'Good headspace.', 'The puck has room to swell when wet.'];
  }
  if (step === 'wdt') return appState.wdt ? ['ok', 'Even bed.', 'Water has no easy path, so it extracts the whole puck.'] : ['warn', 'Clumps left in.', 'Water finds the loose spots between them first.'];
  if (appState.level === 'tilted') return ['warn', 'Tilted surface.', 'The low side is thinner, so water rushes through it and channels.'];
  return {
    light: ['warn', 'Too soft.', 'Loose grounds shift when water hits and open gaps.'],
    ideal: ['ok', 'Pressed enough.', 'The grounds are locked in place.'],
    tight: ['ok', 'More force, little gain.', 'Past 15 kg the puck barely compresses. Keep it level.'],
  }[appState.tamp];
}

function renderPrep() {
  const gs = grindState();
  paintDial('dialTicks', 'ppBands', gs);
  $('ppGrindLike').textContent = gs.row.like;
  $('ppGrindVal').textContent = `Setting ${gs.g + 1} · ~${gs.row.um} µm`;
  $('ppGrains').style.transform = `scale(${(gs.row.um / 200).toFixed(3)})`;
  px.cardSpeed = 34 * gs.perm;
  setNote('ppGrindNote', ...gs.txt);
  if (appState.method !== 'espresso') return;
  const f = CG.Puck.forecast(prepState());
  renderSteps(f, gs);
  renderHeroArt(f);
  renderForecast(f);
  px.goal = heroGoal(f, gs);
  if (!px.cur) px.cur = Object.assign({}, px.goal);
}

function renderSteps(f, gs) {
  const step = appState.step, i = STEPS.indexOf(step);
  $('pxSvg').dataset.step = step;
  $('pxCaption').textContent = STEP_CAPTION[step];
  paintDial('pxDial', 'pxBands', gs);
  $('pxGrindVal').textContent = `Setting ${gs.g + 1} · ~${gs.row.um} µm`;
  $('pxLike').textContent = gs.row.like;
  $('pxLoupeGrains').style.transform = `scale(${(gs.row.um / 200).toFixed(3)})`;
  px.loupeSpeed = 34 * gs.perm;
  $('pxDoseNum').textContent = appState.dose.toFixed(1) + ' g';
  $('pxRatio').textContent = `${appState.dose.toFixed(1)} g in, ${(appState.dose * 2).toFixed(0)} g out (1:2)`;
  segOn('pxWdtSeg', 'data-wdt', appState.wdt ? 1 : 0);
  segOn('tampSeg', 'data-val', appState.tamp);
  segOn('pxLevelSeg', 'data-level', appState.level);
  $('pxPill').style.transform = `translateX(${i * 100}%)`;
  const status = { grind: gs.g === gs.target, dose: !f.crushed && !f.loose, wdt: appState.wdt, tamp: appState.level === 'level' && appState.tamp !== 'light' };
  document.querySelectorAll('#pxTabs [data-step]').forEach((b) => {
    b.classList.toggle('on', b.dataset.step === step);
    b.querySelector('i').className = status[b.dataset.step] ? 'ok' : 'warn';
  });
  document.querySelectorAll('#pxPanel [data-panel]').forEach((el) => el.classList.toggle('on', el.dataset.panel === step));
  setNote('pxNote', ...stepNote(step, f, gs));
  $('pxStart').textContent = i < 3 ? 'Next: ' + STEP_NAME[STEPS[i + 1]] : 'Start the shot';
}

function renderHeroArt(f) {
  $('pxClumps').style.opacity = appState.wdt ? '0' : '1';
  $('pxTopClumps').style.opacity = appState.wdt ? '0' : '1';
  $('pxTopEven').style.opacity = appState.wdt ? '1' : '.35';
  $('pxSpiral').style.strokeDashoffset = appState.wdt ? '0' : '1400';
  $('pxSpiral').style.opacity = appState.wdt ? '.6' : '0';
  $('pxCracks').style.opacity = appState.tamp === 'light' ? '1' : '0';
  $('pxHot').style.opacity = appState.level === 'tilted' ? '1' : '0';
  $('pxSpurt').style.opacity = f.risk >= 0.55 ? '1' : '0';
}

function renderForecast(f) {
  const t = f.time, tcls = t >= 25 && t <= 32 ? 'ok' : t >= 20 && t <= 40 ? 'mid' : 'warn';
  $('pxFcRisk').textContent = 'Channel risk ' + f.riskLabel.toLowerCase();
  $('pxFcRisk').className = 'px-chip term ' + { Low: 'ok', Medium: 'mid', High: 'warn' }[f.riskLabel];
  $('pxFcTaste').textContent = f.taste;
  $('pxFcTaste').className = 'px-taste ' + (f.taste === 'Balanced' ? 'ok' : f.risk >= 0.55 || t < 20 || t > 40 ? 'warn' : 'mid');
  $('pxFcTime').dataset.cls = tcls;
  const line = (arr, max) => arr.map((v, j) => (j ? 'L' : 'M') + ((j + 1) * 5) + ',' + (43 - Math.min(1, v / max) * 40).toFixed(1)).join(' ');
  [['pxChartQ', f.flowCurve, 4.5], ['pxChartP', f.barCurve, 12]].forEach(([id, arr, max]) => {
    const d = 'M0,43 ' + line(arr, max).slice(1);
    $(id).setAttribute('d', d);
    $(id).style.d = 'path("' + d + '")';
  });
  $('pxChartEnd').style.transform = `translateX(${(Math.min(60, t) * 5).toFixed(1)}px)`;
  const tips = [];
  if (t < 25) tips.push('Runs fast. Grind finer or add coffee.');
  if (t > 32) tips.push('Runs slow. Grind coarser or use less coffee.');
  if (f.risk >= 0.3) tips.push(`Biggest risk: ${f.top}.`);
  $('pxFcTip').textContent = tips.length ? tips.join(' ') : 'On target.';
  const sig = Math.round(t) + f.riskLabel + f.taste;
  if (px.sig && sig !== px.sig) replay(document.querySelector('.px-fc'), 'pulse');
  px.sig = sig;
}

function heroGoal(f, gs) {
  const t = f.time;
  return {
    top: 166 - f.bed * 6 + { light: -3, ideal: 0, tight: 1.5 }[appState.tamp],
    dy: appState.level === 'tilted' ? 6 : 0,
    grain: (2.2 + gs.g * 0.75) / 4,
    kg: CG.TAMP[appState.tamp].kg,
    speed: clamp(60 * 28 / t, 8, 240),
    drip: clamp(3.2 * 28 / t, 1.4, 6),
    hit: f.crushed ? 1 : 0,
    head: f.head,
    time: t,
  };
}

function replay(el, cls) {
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
}

function drawHero(c) {
  const L = c.top + c.dy, R = c.top - c.dy, surf = (x) => L + (R - L) * (x - 20) / 200;
  $('pxBed').setAttribute('d', `M20,${L.toFixed(2)} L220,${R.toFixed(2)} L220,172 L20,172 Z`);
  $('pxGrains').setAttribute('patternTransform', `scale(${c.grain.toFixed(3)})`);
  $('pxHit').setAttribute('height', (Math.max(0, c.top - 40) * c.hit).toFixed(2));
  px.clumps.forEach((k) => {
    const x = 48 + k.u * 144, y = surf(x) + 7 + k.v * Math.max(0, 158 - surf(x));
    k.el.setAttribute('transform', `translate(${x.toFixed(1)} ${y.toFixed(1)})`);
  });
  px.cracks.forEach((k) => {
    const x = 60 + k.u * 120, y = surf(x) + 8 + k.v * 50;
    k.el.setAttribute('transform', `translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${k.a})`);
  });
  document.querySelectorAll('#pxWater line').forEach((l) => {
    const x = +l.getAttribute('x1');
    l.setAttribute('y1', surf(x).toFixed(1));
  });
  document.querySelectorAll('#pxDrips line').forEach((l) => l.setAttribute('stroke-width', (l.classList.contains('hot') ? c.drip * 1.7 : c.drip).toFixed(2)));
  const sw = c.top - 12;
  $('pxSwell').setAttribute('y1', sw.toFixed(1));
  $('pxSwell').setAttribute('y2', sw.toFixed(1));
  $('pxSwellTxt').setAttribute('y', (sw - 4).toFixed(1));
  $('pxSwellTxt').style.opacity = String(1 - c.hit);
  $('pxDim').setAttribute('d', `M214,44 H222 M218,44 V${c.top.toFixed(1)} M214,${c.top.toFixed(1)} H222`);
  $('pxHeadNum').textContent = c.head.toFixed(1) + ' mm';
  $('pxHeadNum').style.fill = c.head < CG.BASKET.swellMm ? '#A8492F' : c.head > CG.BASKET.looseMm ? '#A86A34' : '#12664D';
  const ang = Math.atan2(R - L, 200) * 180 / Math.PI;
  $('pxTamper').setAttribute('transform', `translate(0 ${(c.top - 44).toFixed(2)}) rotate(${ang.toFixed(2)} 120 44)`);
  const h = c.kg / 35 * 118;
  $('pxGauge').setAttribute('y', (118 - h).toFixed(1));
  $('pxGauge').setAttribute('height', h.toFixed(1));
  $('pxGaugeTxt').textContent = Math.round(c.kg) + ' kg';
  const time = $('pxFcTime');
  time.textContent = '~' + Math.round(c.time) + ' s';
  time.style.color = { ok: '#12664D', mid: '#A86A34', warn: '#A8492F' }[time.dataset.cls] || '';
}

function prepLoop() {
  if (px.raf) return;
  px.last = performance.now();
  const tick = (now) => {
    if (!document.querySelector('[data-screen=grind]').classList.contains('active') && px.last) {
      px.raf = 0;
      return;
    }
    const dt = Math.min(64, now - px.last) / 1000, k = 1 - Math.exp(-dt / 0.14);
    px.last = now;
    if (px.cur && px.goal && appState.method === 'espresso') {
      for (const key in px.goal) px.cur[key] += (px.goal[key] - px.cur[key]) * k;
      px.off += px.cur.speed * dt;
      drawHero(px.cur);
      document.querySelectorAll('#pxWater line, #pxDrips line').forEach((l, i) => { l.style.strokeDashoffset = String(-(px.off + i * 7)); });
    }
    px.loupeOff += px.loupeSpeed * dt;
    px.cardOff += px.cardSpeed * dt;
    document.querySelectorAll('#pxLoupeWater line').forEach((l, i) => { l.style.strokeDashoffset = String(-(px.loupeOff + i * 7)); });
    document.querySelectorAll('#ppGrindWater line').forEach((l, i) => { l.style.strokeDashoffset = String(-(px.cardOff + i * 7)); });
    px.raf = requestAnimationFrame(tick);
  };
  px.raf = requestAnimationFrame(tick);
}

function grainField(x0, y0, x1, y1, d, seed) {
  const rnd = seeded(seed);
  let out = '';
  for (let y = y0, r = 0; y < y1; y += d * 0.86, r++) {
    for (let x = x0 + (r % 2) * d * 0.5; x < x1; x += d * 1.02) {
      out += grain(x + (rnd() - 0.5) * d * 0.25, y + (rnd() - 0.5) * d * 0.25, d * (0.4 + rnd() * 0.14), rnd);
      if (rnd() < 0.22) out += grain(x + d * 0.5, y + d * 0.42, d * 0.18, rnd);
    }
  }
  return out;
}

function buildPrepArt() {
  $('ppGrains').innerHTML = grainField(-12, -10, 334, 162, 10, 5);
  $('ppGrindWater').innerHTML = Array.from({ length: 10 }, (_, i) => `<line x1="${16 + i * 32}" y1="-20" x2="${16 + i * 32}" y2="170"/>`).join('');
  $('pxLoupeGrains').innerHTML = grainField(216, 38, 338, 160, 10, 9);
  $('pxLoupeWater').innerHTML = Array.from({ length: 5 }, (_, i) => `<line x1="${238 + i * 19}" y1="40" x2="${238 + i * 19}" y2="156"/>`).join('');
  $('pxGrains').innerHTML = '<rect width="30" height="30" fill="#6B4A30"/>' + grainField(-4, -4, 34, 34, 4, 13).replace(/#6B4A30/g, '#7A5334');
  $('pxWater').innerHTML = [60, 84, 108, 132, 156, 180].map((x) => `<line x1="${x}" y1="60" x2="${x}" y2="168"/>`).join('')
    + '<g id="pxHot">' + [60, 84].map((x) => `<line class="hot" x1="${x}" y1="60" x2="${x}" y2="168" style="stroke-width:4.4"/>`).join('') + '</g>';
  $('pxDrips').innerHTML = [106, 120, 134].map((x) => `<line x1="${x}" y1="174" x2="${x + (x - 120) * 0.2}" y2="212"/>`).join('')
    + `<g id="pxSpurt"><line class="hot" x1="84" y1="174" x2="74" y2="212"/></g>`;
  const rnd = seeded(41);
  px.clumps = [];
  let clumps = '';
  for (let i = 0; i < 12; i++) clumps += `<g data-k="${i}">` + (i < 8 ? grain(0, 0, 4 + rnd() * 5, rnd).replace(/fill="[^"]+"/, 'fill="#3A2517"') : `<circle r="${(2.5 + rnd() * 2.5).toFixed(1)}" fill="#C9A987"/>`) + '</g>';
  $('pxClumps').innerHTML = clumps;
  document.querySelectorAll('#pxClumps [data-k]').forEach((el) => px.clumps.push({ el, u: rnd(), v: rnd() }));
  $('pxCracks').innerHTML = Array.from({ length: 5 }, (_, i) => `<path data-k="${i}" d="M0,0 l6,10"/>`).join('');
  px.cracks = [...document.querySelectorAll('#pxCracks [data-k]')].map((el) => ({ el, u: rnd(), v: rnd(), a: Math.round(rnd() * 60 - 30) }));
  let top = '', even = '';
  for (let i = 0; i < 14; i++) {
    const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * 38;
    top += grain(276 + Math.cos(a) * r, 98 + Math.sin(a) * r, 4 + rnd() * 6, rnd).replace(/fill="[^"]+"/, 'fill="#3A2517"');
  }
  for (let i = 0; i < 8; i++) {
    const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * 38;
    top += `<circle cx="${(276 + Math.cos(a) * r).toFixed(1)}" cy="${(98 + Math.sin(a) * r).toFixed(1)}" r="${(2.5 + rnd() * 3).toFixed(1)}" fill="#C9A987"/>`;
  }
  for (let i = 0; i < 420; i++) {
    const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * 48;
    even += `<circle cx="${(276 + Math.cos(a) * r).toFixed(1)}" cy="${(98 + Math.sin(a) * r).toFixed(1)}" r="${(0.7 + rnd()).toFixed(1)}" fill="${GRAIN_COLS[i % 5]}"/>`;
  }
  $('pxTopClumps').innerHTML = top;
  $('pxTopEven').innerHTML = even;
  let d = '';
  for (let k = 0; k <= 220; k++) {
    const a = k / 220 * Math.PI * 12, r = 3 + k / 220 * 42;
    d += (k ? 'L' : 'M') + (276 + Math.cos(a) * r).toFixed(1) + ',' + (98 + Math.sin(a) * r).toFixed(1);
  }
  $('pxSpiral').setAttribute('d', d);
  $('pxSpiral').style.strokeDasharray = '1400 1400';
}

function goStep(step) {
  const from = STEPS.indexOf(appState.step), to = STEPS.indexOf(step);
  if (from === to) return;
  $('pxPanel').style.setProperty('--dir', (to > from ? 14 : -14) + 'px');
  appState.step = step;
  renderPrep();
}

function initPrep() {
  buildPrepArt();
  initWizard();
  document.querySelectorAll('#dialTicks, #pxDial').forEach((dial) => dial.addEventListener('click', (e) => {
    const b = e.target.closest('[data-g]');
    if (!b) return;
    appState.grind = +b.dataset.g;
    renderPrep();
  }));
  document.querySelectorAll('[data-dose]').forEach((b) => b.addEventListener('click', () => {
    appState.dose = clamp(appState.dose + Number(b.dataset.dose), 14, 22);
    renderPrep();
  }));
  document.querySelectorAll('#pxWdtSeg [data-wdt]').forEach((b) => b.addEventListener('click', () => { appState.wdt = b.dataset.wdt === '1'; renderPrep(); }));
  document.querySelectorAll('#tampSeg [data-val]').forEach((b) => b.addEventListener('click', () => { appState.tamp = b.dataset.val; renderPrep(); }));
  document.querySelectorAll('#pxLevelSeg [data-level]').forEach((b) => b.addEventListener('click', () => { appState.level = b.dataset.level; renderPrep(); }));
  document.querySelectorAll('#pxTabs [data-step]').forEach((b) => b.addEventListener('click', () => goStep(b.dataset.step)));
  let sx = null;
  $('pxHero').addEventListener('pointerdown', (e) => { sx = e.clientX; });
  $('pxHero').addEventListener('pointerup', (e) => {
    if (sx === null) return;
    const dx = e.clientX - sx, i = STEPS.indexOf(appState.step);
    sx = null;
    if (Math.abs(dx) < 50) return;
    buzz('select');
    goStep(STEPS[clamp(i + (dx < 0 ? 1 : -1), 0, 3)]);
  });
}

let espressoDoneFired = false;

function startBrewCamera(then) {
  camOn(brewCamera, 'brew').then((granted) => { if (then) then(granted); });
}

function startEspressoLiveBrew() {
  const m = METHOD_DATA.espresso;
  espressoDoneFired = false;
  $('eoCause').textContent = shotCause(CG.Puck.forecast(prepState()));
  m.phases.forEach((ph, i) => { const lab = $('brewLabel' + i); if (lab) lab.textContent = ph.name; });
  CG.EspressoOverlay.start({
    container: 'espressoOverlay',
    video: 'brewVideo',
    basket: 'bottomless',
    pinned: true,
    prep: prepState(),
    onTick: renderEspressoTick,
    onDone: (elapsedSec) => {
      if (espressoDoneFired) return;
      espressoDoneFired = true;
      appState.lastEspressoResult = CG.EspressoOverlay.getResult();
      toReview(elapsedSec);
    },
  });
  startBrewCamera((granted) => CG.EspressoOverlay.track(granted));
}

function renderEspressoTick(info) {
  const idx = { preinfusion: 0, extraction: 1, finish: 2 }[info.phase] ?? 0, phases = METHOD_DATA.espresso.phases;
  $('brewPhasePillName').textContent = phases[idx].name;
  $('brewPhasePillTime').textContent = '· ' + mmss(info.elapsedPhaseSec);
  if (info.channel) $('eoCause').textContent = 'Water is rushing through the ' + info.channel.toLowerCase() + ' side. That spot was packed loosely.';
  paintPhases(idx, info.segFill, phases);
  glRender(info);
}

function startLiveBrew() {
  const esp = appState.method === 'espresso';
  $('brewStage').classList.toggle('timer', !esp);
  $('glassesBtn').classList.toggle('hidden', !esp);
  $('brewTitle').textContent = esp ? 'Espresso' : methodName(appState.method);
  $('brewFinishBtn').textContent = esp ? 'Skip to end' : 'Stop';
  if (esp) return startEspressoLiveBrew();
  Brew.startBrew(appState.method, (elapsed) => {
    appState.lastEspressoResult = null;
    toReview(elapsed);
  });
}

function initLiveBrew() {
  $('brewFinishBtn').addEventListener('click', () => appState.method === 'espresso' ? CG.EspressoOverlay.finishNow() : Brew.finishEarly());
  $('brewNextBtn').addEventListener('click', () => Brew.skipPhase());
}

function stopLiveBrew() {
  Brew.stopBrew();
  CG.EspressoOverlay.stop();
  brewCamera.stop();
}

function toReview(sec) {
  renderReview(sec);
  go('review');
}

const GL_ZONE = [1.3, 2.3];
let glInfo = null, glAudio = null, glWake = null, glWasFinish = false, glWait = Promise.resolve();

function glActive() {
  return document.body.classList.contains('glasses');
}

function applyGlasses(name) {
  const on = !!appState.glasses, hud = on && name === 'brew' && appState.method === 'espresso';
  const was = glActive();
  document.body.classList.toggle('glasses', on);
  $('brewStage').classList.toggle('gl-on', hud);
  CG.EspressoOverlay.setWide(hud);
  if (!hud) {
    $('brewStage').classList.remove('gl-xr');
    $('glViewBtn').textContent = 'Camera X-Ray';
  }
  if (CG.AR) CG.AR.show(on ? name : null);
  if (hud && glInfo) glRender(glInfo);
  if (was === on) return;
  if (on) document.activeElement.blur();
  fitPhoneToViewport();
  glWait = on ? glClaim() : glRelease();
}

function setGlasses(on) {
  appState.glasses = on;
  const apply = () => applyGlasses(document.querySelector('.screen.active').dataset.screen);
  if (calm()) { apply(); return; }
  const veil = $('glVeil'), phone = $('phoneEl'), ease = 'cubic-bezier(.2, .8, .2, 1)';
  AR.morph = true;
  phone.animate([{ scale: 1, filter: 'blur(0)' }, { scale: 0.96, filter: 'blur(4px)' }], { duration: 280, easing: 'ease-in' });
  veil.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 280, easing: 'ease-in', fill: 'forwards' }).finished
    .then(() => { apply(); return Promise.race([glWait, new Promise((r) => setTimeout(r, 700))]); })
    .then(() => new Promise((r) => setTimeout(r, 120)))
    .then(() => {
      AR.morph = false;
      phone.animate([{ scale: 1.03, filter: 'blur(4px)' }, { scale: 1, filter: 'blur(0)' }], { duration: 480, easing: ease });
      veil.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 480, easing: ease, fill: 'forwards' });
    });
}

function glClaim() {
  if (!glAudio) { try { glAudio = new (window.AudioContext || window.webkitAudioContext)(); } catch {} }
  const el = document.documentElement;
  if (!glWake && navigator.wakeLock) navigator.wakeLock.request('screen').then((w) => { glWake = w; }).catch(() => {});
  if (document.fullscreenElement || !el.requestFullscreen) return Promise.resolve();
  return el.requestFullscreen().then(() => screen.orientation.lock('landscape')).catch(() => {});
}

function glRelease() {
  try { screen.orientation.unlock(); } catch {}
  if (glWake) glWake.release().catch(() => {});
  glWake = null;
  return document.fullscreenElement && document.exitFullscreen ? document.exitFullscreen().catch(() => {}) : Promise.resolve();
}

function glCue() {
  buzz('cue', true);
  if (!glAudio) return;
  const o = glAudio.createOscillator(), g = glAudio.createGain(), t = glAudio.currentTime;
  o.frequency.value = 880;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.25, t + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
  o.connect(g).connect(glAudio.destination);
  o.start(t);
  o.stop(t + 0.3);
}

function glSet(key, text, s) {
  document.querySelectorAll('[data-gl="' + key + '"]').forEach((el) => {
    el.textContent = text;
    if (s !== undefined) el.dataset.s = s;
  });
}

function glMessage(info) {
  if (!info.running) return info.totalSec < 0.1 ? ['Ready', 'Tap to start the shot', ''] : ['Paused', 'Tap to resume', ''];
  if (info.phase === 'preinfusion') return ['Pre-infusion', 'Soaking the puck', ''];
  if (info.phase === 'finish') {
    if (info.elapsedPhaseSec < 1.2) return ['Stop', 'Stop the shot now', 'stop'];
    const r = CG.EspressoOverlay.getResult();
    if (!r) return ['Done', '', ''];
    const head = r.weightG + ' g in ' + mmss(r.timeSec);
    if (r.early) return ['Done', head + ', ran early', 'warn'];
    if (r.choked) return ['Done', head + ', ran long', 'warn'];
    return ['Done', head + ', on target', 'ok'];
  }
  if (info.weightG >= XR.targetG - 4) return ['Extracting', 'Get ready to stop', 'warn'];
  if (info.channel) return ['Extracting', info.channel + ' side running fast', 'warn'];
  if (info.flowGs > GL_ZONE[1]) return ['Extracting', 'Running fast, grind finer next shot', 'warn'];
  if (info.flowGs < GL_ZONE[0] && info.elapsedPhaseSec > 3) return ['Extracting', 'Running slow, grind coarser next shot', 'warn'];
  return ['Extracting', 'Steady flow, hold', 'ok'];
}

function glRender(info) {
  glInfo = info;
  if (!glActive()) return;
  const [phaseName, msg, s] = glMessage(info);
  const w = info.weightG, flow = info.flowGs, extracting = info.phase === 'extraction';
  const inZone = flow >= GL_ZONE[0] && flow <= GL_ZONE[1];
  glSet('phase', phaseName);
  glSet('msg', msg, s);
  glSet('weight', w.toFixed(1));
  glSet('time', String(Math.floor(info.phase === 'finish' ? info.totalSec - info.elapsedPhaseSec : info.totalSec)));
  glSet('flow', flow.toFixed(1));
  glSet('target', '/ ' + XR.targetG + ' g');
  glSet('src', CG.Wizard.on ? 'Wizard control' : CG.EspressoOverlay.isPinned() ? 'Card tracking' : $('brewVideo').classList.contains('hidden') ? 'Demo data' : 'Camera sensing');
  $('glWeight').style.setProperty('--p', Math.min(100, w / XR.targetG * 100) + '%');
  $('glMark').style.left = Math.min(1, flow / 3.6) * 100 + '%';
  $('glMark').dataset.s = extracting ? (inZone ? 'ok' : 'warn') : '';
  $('glPuck').classList.toggle('on', info.phase !== 'finish');
  $('glStream').classList.toggle('on', extracting);
  const h = Math.min(1, w / XR.targetG) * 20;
  $('glCup').setAttribute('y', String(150 - h));
  $('glCup').setAttribute('height', String(h));
  $('glHud').classList.toggle('gl-stop', s === 'stop');
  if (info.phase === 'finish' && !glWasFinish) glCue();
  glWasFinish = info.phase === 'finish';
}

function glToggleView() {
  const xr = $('brewStage').classList.toggle('gl-xr');
  if (!xr) CG.EspressoOverlay.setAligning(false);
  $('glViewBtn').textContent = xr ? 'Back to HUD' : 'Camera X-Ray';
}

function initGlasses() {
  ls.del('cg-glasses');
  $('glassesBtn').addEventListener('click', () => setGlasses(true));
  $('glExitBtn').addEventListener('click', () => setGlasses(false));
  $('arDeviceBtn').addEventListener('click', () => setGlasses(true));
  $('glViewBtn').addEventListener('click', glToggleView);
  $('glEndBtn').addEventListener('click', () => CG.EspressoOverlay.finishNow());
  $('glBackBtn').addEventListener('click', back);
}

const KIND_LABEL = { ok: 'On target', fast: 'Ran fast', long: 'Ran long', channel: 'Channeled' };
const KIND_BREW = { ok: 'On time', fast: 'Ran short', long: 'Ran long', channel: 'Channeled' };
const FIELD_NAME = { grind: 'Grind', dose: 'Dose', wdt: 'WDT', tamp: 'Tamp force', level: 'Tamp surface', temp: 'Water temperature' };
const FIELD_STEP = { grind: 'grind', dose: 'dose', wdt: 'wdt', tamp: 'tamp', level: 'tamp' };
const TAMP_NAME = { light: 'Light, 5 kg', ideal: 'Ideal, 15 kg', tight: 'Firm, 30 kg' };
const SIDES = ['left', 'centre', 'right'];
const RV = { rec: null, pane: 0, t: 0 };
const BD = { id: null };
const RP = { x0: 10, x1: 310, y0: 12, y1: 118 };
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const methodName = (k) => methodOf(k).name;
const chipText = (r) => (r.method === 'espresso' ? KIND_LABEL : KIND_BREW)[r.verdict.kind];
const timeText = (r) => r.method === 'espresso' ? r.time.toFixed(1) + ' s' : mmss(r.time);
const shotLine = (r) => r.dose + ' g → ' + r.yield + ' g · 1:' + (r.yield / r.dose).toFixed(1);
const shortDate = (d) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
function fmtDay(at, short) {
  const d = new Date(at), days = Math.round((new Date(new Date().toDateString()) - new Date(d.toDateString())) / 86400000);
  const hm = short ? '' : ', ' + d.toTimeString().slice(0, 5);
  if (days === 0) return 'Today' + hm;
  if (days === 1) return 'Yesterday' + hm;
  if (days < 7) return d.toLocaleDateString('en-GB', { weekday: short ? 'short' : 'long' }) + hm;
  return shortDate(d);
}

function fieldText(f, v) {
  if (f === 'grind') return 'Setting ' + (v + 1) + ' · ' + CG.GRIND.scale[v].um + ' µm';
  if (f === 'dose') return v + ' g';
  if (f === 'wdt') return v ? 'Stir' : 'Skipped';
  if (f === 'tamp') return TAMP_NAME[v];
  if (f === 'level') return v === 'level' ? 'Level' : 'Tilted';
  if (f === 'temp') return v + ' °C';
  return String(v);
}

function countTo(el, to, fmt) {
  const from = el._v ?? to * 0.6, t0 = performance.now();
  el._v = to;
  cancelAnimationFrame(el._raf);
  const tick = (now) => {
    const k = Math.min(1, (now - t0) / 650), e = 1 - Math.pow(1 - k, 3);
    el.textContent = fmt(from + (to - from) * e);
    if (k < 1) el._raf = requestAnimationFrame(tick);
  };
  el._raf = requestAnimationFrame(tick);
}

function sample(tr, t) {
  let i = 1;
  while (i < tr.length - 1 && tr[i][0] < t) i++;
  const a = tr[i - 1], b = tr[i], k = b[0] > a[0] ? clamp((t - a[0]) / (b[0] - a[0])) : 1;
  return a.map((v, j) => v + (b[j] - v) * k);
}

function replayCaption(m, t, v) {
  const q = v[1].toFixed(1) + ' g/s', p = v[2].toFixed(1) + ' bar';
  if (t >= m.time - 0.05) return 'Stopped at ' + Math.round(v[3]) + ' g after ' + m.time.toFixed(1) + ' s.';
  if (t < m.drip) return 'Pre-infusion. Water soaks the puck. Pressure at ' + p + '.';
  if (m.chOn != null && t >= m.chOn) return 'Channel on the ' + SIDES[m.side ?? 1] + '. Flow at ' + q + ', pressure down to ' + p + '.';
  return 'Extraction. ' + q + ' at ' + p + '. ' + Math.round(v[3]) + ' g in the cup.';
}

function drawReplay(host, rec) {
  cancelAnimationFrame(host._raf);
  if (!rec.model || !rec.model.trace || !rec.model.trace.length) { drawPhases(host, rec); return; }
  const m = rec.model, id = host.dataset.replay, T = Math.max(40, Math.ceil((m.time + 3) / 10) * 10);
  const x = (t) => RP.x0 + (RP.x1 - RP.x0) * t / T, h = RP.y1 - RP.y0;
  const yq = (v) => RP.y1 - h * Math.min(v, 3.2) / 3.2, yp = (v) => RP.y1 - h * Math.min(v, 12) / 12;
  const tr = [[0, 0, 0, 0]].concat(m.trace), line = (rows, col, fy) => rows.map((r, i) => (i ? 'L' : 'M') + x(r[0]).toFixed(1) + ' ' + fy(r[col]).toFixed(1)).join('');
  const fc = CG.Shot.run(rec.prep), off = Math.abs(fc.time - m.time) > 0.5;
  const lo = CG.SHOT.targetLo, hi = CG.SHOT.targetHi, ticks = [];
  for (let t = 0; t <= T; t += 10) ticks.push(`<text class="rp-tk" x="${x(t)}" y="132">${t}s</text>`);
  host.innerHTML = `
    <div class="rv-head"><div class="rv-title">Shot replay</div><button type="button" class="rv-link" data-r="play">Replay</button></div>
    <svg class="rp" viewBox="0 0 320 138">
      <defs><clipPath id="rpClip-${id}"><rect data-r="clip" x="0" y="0" width="0" height="138"/></clipPath></defs>
      <rect class="rp-zone" x="${x(lo)}" y="${RP.y0}" width="${x(hi) - x(lo)}" height="${h}"/>
      <text class="rp-zl" x="${(x(lo) + x(hi)) / 2}" y="${RP.y0 + 9}">${lo}–${hi} s</text>
      ${[1, 2, 3].map((v) => `<line class="rp-grid" x1="${RP.x0}" x2="${RP.x1}" y1="${yq(v)}" y2="${yq(v)}"/>`).join('')}
      ${m.chOn != null ? `<rect class="rp-ch" x="${x(m.chOn)}" y="${RP.y0}" width="${Math.max(2, x(m.time) - x(m.chOn))}" height="${h}"/><text class="rp-chl" x="${x(m.chOn) + 3}" y="${RP.y1 - 4}">Channel · ${SIDES[m.side ?? 1]}</text>` : ''}
      ${off ? `<path class="rp-f" d="${line([[0, 0, 0, 0]].concat(fc.trace), 1, yq)}"/>` : ''}
      <g clip-path="url(#rpClip-${id})"><path class="rp-p" d="${line(tr, 2, yp)}"/><path class="rp-q" d="${line(tr, 1, yq)}"/></g>
      <line class="rp-mk" x1="${x(m.drip)}" x2="${x(m.drip)}" y1="${RP.y0}" y2="${RP.y1}"/><text class="rp-ml" x="${x(m.drip) + 3}" y="${RP.y0 + 8}">First drip</text>
      <line class="rp-mk" x1="${x(m.time)}" x2="${x(m.time)}" y1="${RP.y0}" y2="${RP.y1}"/>
      <g data-r="head"><line class="rp-hl" x1="0" x2="0" y1="${RP.y0}" y2="${RP.y1}"/><circle class="rp-hp" data-r="hp" cx="0" cy="${RP.y1}" r="3"/><circle class="rp-hq" data-r="hq" cx="0" cy="${RP.y1}" r="4.5"/></g>
      ${ticks.join('')}
    </svg>
    <div class="rp-read"><div><span>Time</span><b data-r="t"></b></div><div><span>Flow</span><b data-r="q"></b></div><div><span>Pressure</span><b data-r="p"></b></div><div><span>In cup</span><b data-r="y"></b></div></div>
    <div class="rp-cap" data-r="cap"></div>
    <div class="px-legend"><span><i></i>Flow</span><span><i class="p"></i>Pressure</span>${off ? '<span><i class="f"></i>Forecast</span>' : ''}<span class="z">${off ? 'Forecast was ' + fc.time.toFixed(1) + ' s' : 'Matched the forecast'}</span></div>`;
  const q = (k) => host.querySelector(`[data-r="${k}"]`), svg = host.querySelector('svg');
  const set = (t) => {
    const v = sample(tr, t), px = x(t).toFixed(1);
    q('clip').setAttribute('width', px);
    q('head').setAttribute('transform', `translate(${px} 0)`);
    q('hq').setAttribute('cy', yq(v[1]).toFixed(1));
    q('hp').setAttribute('cy', yp(v[2]).toFixed(1));
    q('t').textContent = t.toFixed(1) + ' s';
    q('q').textContent = v[1].toFixed(1) + ' g/s';
    q('p').textContent = v[2].toFixed(1) + ' bar';
    q('y').textContent = Math.round(v[3]) + ' g';
    q('cap').textContent = replayCaption(m, t, v);
  };
  const play = () => {
    cancelAnimationFrame(host._raf);
    const t0 = performance.now(), dur = 1400 + m.time * 20;
    const tick = (now) => {
      const k = Math.min(1, (now - t0) / dur);
      set(m.time * (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2));
      if (k < 1) host._raf = requestAnimationFrame(tick);
    };
    host._raf = requestAnimationFrame(tick);
  };
  const scrub = (e) => {
    const r = svg.getBoundingClientRect(), vx = (e.clientX - r.left) / r.width * 320;
    set(clamp((vx - RP.x0) / (RP.x1 - RP.x0) * T, 0, m.time));
  };
  svg.addEventListener('pointerdown', (e) => { buzz('tick'); cancelAnimationFrame(host._raf); svg.setPointerCapture(e.pointerId); scrub(e); });
  svg.addEventListener('pointermove', (e) => { if (svg.hasPointerCapture(e.pointerId)) scrub(e); });
  q('play').addEventListener('click', play);
  set(0);
  play();
}

function drawPhases(host, rec) {
  const ph = methodOf(rec.method).phases, plan = CG.Verdict.plan(rec.method);
  const T = Math.max(plan, rec.time) * 1.08, pct = (t) => (t / T * 100).toFixed(1) + '%';
  host.innerHTML = `
    <div class="rv-head"><div class="rv-title">Your brew</div><div class="rv-hint">Planned vs actual</div></div>
    <div class="ph">
      <div class="ph-bar" style="width:${pct(plan)}">${ph.map((p) => `<span style="flex:${p.duration}">${p.name}</span>`).join('')}</div>
      <div class="ph-mark" data-r="mark" style="left:0%"><b>${mmss(rec.time)}</b></div>
    </div>
    <div class="ph-scale"><span>0:00</span><span>Planned ${mmss(plan)}</span></div>`;
  requestAnimationFrame(() => requestAnimationFrame(() => { host.querySelector('[data-r=mark]').style.left = pct(rec.time); }));
}

function verdictTiles(r) {
  if (r.method === 'espresso') {
    const ratio = r.yield / r.dose;
    return [
      { lab: 'Time', v: r.time, lo: CG.SHOT.targetLo, hi: CG.SHOT.targetHi, min: 15, max: 50, fmt: (v) => v.toFixed(1) + ' s', sub: 'Target 25–32 s' },
      { lab: 'Yield', v: r.yield, lo: r.target - 2, hi: r.target + 2, min: r.target - 12, max: r.target + 12, fmt: (v) => Math.round(v) + ' g', sub: 'Target ' + r.target + ' g' },
      { lab: 'Ratio', v: ratio, lo: 1.8, hi: 2.2, min: 1.2, max: 3, fmt: (v) => '1:' + v.toFixed(1), sub: 'Target 1:2' },
    ];
  }
  const plan = CG.Verdict.plan(r.method), r0 = r.target && r.dose ? r.target / r.dose : null;
  return [
    { lab: 'Time', v: r.time, lo: plan * 0.9, hi: plan * 1.1, min: 0, max: plan * 1.6, fmt: mmss, sub: 'Planned ' + mmss(plan) },
    r.target && r.yield ? { lab: 'Water', v: r.yield, lo: r.target * 0.95, hi: r.target * 1.05, min: r.target * 0.5, max: r.target * 1.5, fmt: (v) => Math.round(v) + ' g', sub: 'Recipe ' + r.target + ' g' } : null,
    r0 && r.yield ? { lab: 'Ratio', v: r.yield / r.dose, lo: r0 * 0.93, hi: r0 * 1.07, min: r0 * 0.5, max: r0 * 1.5, fmt: (v) => '1:' + v.toFixed(1), sub: 'Recipe 1:' + r0.toFixed(1) } : null,
  ];
}

function drawVerdict(host, rec) {
  if (!host.firstChild) {
    host.innerHTML = `<div class="rv-head"><span class="rv-chip" data-v="chip"></span><span class="rv-hint" data-v="when"></span></div>
      <div class="rv-vtitle" data-v="title"></div><div class="rv-vsub" data-v="cause"></div>
      <div class="rv-tiles">${[0, 1, 2].map((i) => `<div class="rv-tile" data-tile="${i}"><span data-t="lab"></span><b data-t="val"></b><div class="rv-g"><i class="rv-gb"></i><i class="rv-gm"></i></div><em data-t="sub"></em></div>`).join('')}</div>`;
  }
  const v = rec.verdict, q = (k) => host.querySelector(`[data-v="${k}"]`);
  q('chip').className = 'rv-chip k-' + v.kind;
  q('chip').textContent = chipText(rec);
  q('when').textContent = fmtDay(rec.at);
  q('title').textContent = v.title;
  q('cause').innerHTML = termify(esc(v.cause));
  verdictTiles(rec).forEach((t, i) => {
    const el = host.querySelector(`[data-tile="${i}"]`);
    el.classList.toggle('hidden', !t);
    if (!t) return;
    const pos = (x) => clamp((x - t.min) / (t.max - t.min)) * 100;
    el.querySelector('[data-t=lab]').textContent = t.lab;
    el.querySelector('[data-t=sub]').textContent = t.sub;
    countTo(el.querySelector('[data-t=val]'), t.v, t.fmt);
    el.querySelector('.rv-gb').style.cssText = `left:${pos(t.lo)}%;width:${pos(t.hi) - pos(t.lo)}%`;
    const mk = el.querySelector('.rv-gm');
    mk.style.left = pos(t.v) + '%';
    mk.classList.toggle('off', t.v < t.lo || t.v > t.hi);
  });
}

function sparkline(r) {
  if (r.model && r.model.trace) {
    const tr = r.model.trace, T = Math.max(40, r.model.time + 2), x = (t) => 2 + 84 * t / T, y = (v) => 30 - 26 * Math.min(v, 4) / 4;
    const d = tr.map((q, i) => (i ? 'L' : 'M') + x(q[0]).toFixed(1) + ' ' + y(q[1]).toFixed(1)).join('');
    return `<svg class="hs-sp" viewBox="0 0 88 32"><rect class="hs-spz" x="${x(CG.SHOT.targetLo)}" y="2" width="${x(CG.SHOT.targetHi) - x(CG.SHOT.targetLo)}" height="28"/><path class="k-${r.verdict.kind}" d="${d}"/></svg>`;
  }
  const plan = CG.Verdict.plan(r.method), T = Math.max(plan, r.time) * 1.1, w = (t) => (84 * t / T).toFixed(1);
  return `<svg class="hs-sp" viewBox="0 0 88 32"><rect class="hs-spb" x="2" y="12" width="${w(plan)}" height="8" rx="4"/><line class="hs-spm" x1="${2 + +w(r.time)}" x2="${2 + +w(r.time)}" y1="6" y2="26"/></svg>`;
}

function whyHtml(rec, a) {
  const notes = CG.Advice.notes(rec, a);
  return termify(esc(a.why)) + (notes.length ? '<ul class="rv-also">' + notes.map((n) => '<li>' + esc(n) + '</li>').join('') + '</ul>' : '');
}

function drawAdvice(rec) {
  const a = rec.advice, espresso = rec.method === 'espresso', changed = $('rvAdvice').textContent !== a.title;
  $('rvChange').innerHTML = a.field && a.field !== 'note'
    ? `<div class="rv-cf">${FIELD_NAME[a.field]}</div><div class="rv-cv"><span class="rv-from">${fieldText(a.field, a.from)}</span><i class="fa-solid fa-arrow-right icon-fa ic-12"></i><span class="rv-to">${fieldText(a.field, a.to)}</span></div>`
    : a.field ? '' : '<div class="rv-cv"><span class="rv-to">Same recipe</span></div>';
  $('rvAdvice').textContent = a.title;
  $('rvWhy').innerHTML = whyHtml(rec, a);
  const cmp = $('rvCmp');
  cmp.classList.toggle('hidden', !espresso || !a.predicted);
  if (espresso && a.predicted) {
    if (!cmp.firstChild) {
      cmp.innerHTML = `<div class="rv-tl"><i class="rv-tlb"></i><span class="rv-tm now"><em></em></span><span class="rv-tm next"><em></em></span></div>
        <div class="rv-tls"><span>15 s</span><span class="z">Target 25–32 s</span><span>50 s</span></div>`;
    }
    const pos = (t) => (clamp((t - 15) / 35) * 100).toFixed(1) + '%', nx = a.next;
    cmp.querySelector('.rv-tlb').style.cssText = `left:${pos(CG.SHOT.targetLo)};width:calc(${pos(CG.SHOT.targetHi)} - ${pos(CG.SHOT.targetLo)})`;
    const now = cmp.querySelector('.now'), next = cmp.querySelector('.next');
    now.style.left = pos(rec.time);
    next.style.left = pos(nx);
    now.querySelector('em').textContent = 'This shot ' + rec.time.toFixed(1) + ' s';
    next.querySelector('em').textContent = (a.field && Math.abs(nx - rec.time) > 0.4 ? 'Next ≈ ' : 'Stays ≈ ') + nx.toFixed(1) + ' s';
    [[now, rec.time], [next, nx]].forEach(([m, t]) => { const f = clamp((t - 15) / 35); m.dataset.edge = f < 0.18 ? 'l' : f > 0.82 ? 'r' : ''; });
  }
  if (changed) $('rvNext').animate([{ opacity: 0.35, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], { duration: 380, easing: 'cubic-bezier(.2,.8,.2,1)' });
}

function applyRecipe(method, prep, field, temp, msg) {
  appState.method = method;
  appState.grindFor = method;
  ['grind', 'dose', 'wdt', 'tamp', 'level'].forEach((k) => { if (prep[k] !== undefined) appState[k] = prep[k]; });
  appState.step = FIELD_STEP[field] || 'grind';
  if (temp) CG.Store.setGear({ temp });
  updateMethodSelectionUI();
  go('grind');
  document.querySelector('[data-screen=grind]').scrollTop = 0;
  const toast = $('applyToast');
  toast.textContent = msg;
  toast.classList.add('on');
  clearTimeout(applyRecipe._t);
  applyRecipe._t = setTimeout(() => toast.classList.remove('on'), 5000);
  const hit = method === 'espresso' ? document.querySelector(`#pxTabs [data-step="${appState.step}"]`) : $('ppGrindCard');
  if (hit) replay(hit, 'flash');
}

function applyAdvice(r, lead = 'Advice applied.') {
  const a = r.advice;
  applyRecipe(r.method, a.prep, a.field, a.field === 'temp' ? a.to : null, changeMsg(a, lead));
}

function repeatRecipe(r, msg = 'Loaded your last recipe.') {
  applyRecipe(r.method, r.prep, null, r.method === 'espresso' ? r.temp : null, msg);
}

function changeMsg(a, lead) {
  if (!a.field || a.field === 'note') return lead + ' ' + (a.field ? a.title + '.' : 'Same recipe loaded.');
  return lead + ' ' + FIELD_NAME[a.field] + ': ' + fieldText(a.field, a.from) + ' → ' + fieldText(a.field, a.to) + '.';
}

function twoTap(btn, ask, fn) {
  const label = btn.textContent, disarm = () => {
    clearTimeout(btn._t);
    btn.classList.remove('armed');
    btn.textContent = label;
  };
  btn.addEventListener('click', () => {
    if (btn.classList.contains('armed')) return disarm(), buzz('confirm', true), fn();
    buzz('warn', true);
    btn.classList.add('armed');
    btn.textContent = ask;
    clearTimeout(btn._t);
    btn._t = setTimeout(disarm, 3000);
  });
}

const QUICK = ['espresso', 'pourover', 'aeropress', 'immersion', 'chemex', 'mokapot'];
const mi = (k, c) => k === 'import' ? '<i class="fa-solid fa-file-import' + (c ? ' ' + c : '') + '"></i>' : '<i class="mi' + (c ? ' ' + c : '') + '"><svg><use href="#mi-' + k + '"/></svg></i>';

function syncTabs(name) {
  const on = TAB_SCREENS.includes(name), bar = $('tabbar');
  if (!bar) return;
  bar.classList.toggle('off', !on);
  if (!on) { closeSheet(); return; }
  const b = bar.querySelector(`[data-tab="${name}"]`);
  bar.querySelectorAll('[data-tab]').forEach((x) => x.classList.toggle('on', x === b));
  $('tabLens').classList.toggle('off', !b);
  if (b) $('tabLens').style.transform = `translateX(${b.offsetLeft + b.offsetWidth / 2 - 29}px)`;
}

function openSheet(html, dir = 0) {
  const s = $('sheet'), body = $('sheetBody'), swap = +getComputedStyle(s).opacity > 0.5 && !calm(), h = s.offsetHeight;
  const ghost = swap && body.cloneNode(true);
  body.innerHTML = html;
  s.classList.add('on');
  $('sheetScrim').classList.add('on');
  if (swap) sheetSwap(s, body, ghost, h, dir);
}

function sheetSwap(s, body, ghost, h, dir) {
  s.getAnimations().forEach((a) => a.id === 'grow' && a.cancel());
  const ease = 'cubic-bezier(.2, .8, .2, 1)', to = s.offsetHeight;
  ghost.removeAttribute('id');
  ghost.querySelectorAll('[id]').forEach((el) => el.removeAttribute('id'));
  ghost.className = 'sheet-ghost';
  ghost.setAttribute('aria-hidden', 'true');
  Object.assign(ghost.style, { top: body.offsetTop + 'px', left: body.offsetLeft + 'px', width: body.offsetWidth + 'px' });
  s.append(ghost);
  s.style.overflow = 'hidden';
  ghost.animate({ opacity: [1, 0], transform: ['none', `translate(${-dir * 24}px, ${dir ? 0 : -6}px)`] }, { duration: 180, easing: 'ease-in', fill: 'forwards' }).onfinish = () => ghost.remove();
  body.animate({ opacity: [0, 0, 1], transform: [`translate(${dir * 24}px, ${dir ? 0 : 8}px)`, `translate(${dir * 24}px, ${dir ? 0 : 8}px)`, 'none'], offset: [0, 0.3, 1] }, { duration: 420, easing: ease });
  s.animate({ height: [h + 'px', to + 'px'] }, { id: 'grow', duration: 380, easing: ease }).onfinish = () => { s.style.overflow = ''; };
}

function closeSheet() {
  if (!$('sheet')) return;
  $('sheet').classList.remove('on');
  $('sheetScrim').classList.remove('on');
}

const TERMS = {
  espresso: ['Espresso', 'A small, strong coffee. Hot water is pushed through finely ground coffee at high pressure.'],
  shot: ['Shot', 'One espresso. It takes about 25 to 30 seconds.', 'shots?'],
  grind: ['Grind size', 'How fine the coffee is ground. Finer slows the water down, coarser lets it run faster.', 'grind size|particles'],
  dose: ['Dose', 'How much ground coffee goes in the basket. 18 g is common.'],
  ratio: ['Ratio', 'Coffee out compared with coffee in. 1:2 means 18 g in, 36 g out.'],
  wdt: ['WDT', 'Stirring the grounds with thin needles to break up clumps, so water flows evenly.'],
  tamp: ['Tamp', 'Pressing the grounds flat and firm before brewing.', 'tamp(?:ing)?'],
  puck: ['Puck', 'The pressed bed of coffee in the basket.'],
  extraction: ['Extraction', 'Water pulling flavour out of the coffee. Too little tastes sour, too much tastes bitter.', 'extract(?:s|ion)?'],
  channel: ['Channelling', 'Water finds a weak spot in the puck and rushes through it, so the rest is under-brewed.', 'channel(?:s|ling)?'],
  preinfusion: ['Pre-infusion', 'A gentle first soak at low pressure, so the puck gets wet evenly.', 'pre-infusion'],
  pressure: ['Pressure', 'How hard the pump pushes the water, in bar. Espresso runs at about 9 bar.'],
  flow: ['Flow', 'How fast espresso drips into the cup, in grams per second.'],
  crema: ['Crema', 'The golden foam on top of an espresso.'],
  latteart: ['Latte art', 'Pouring steamed milk into espresso so it draws a pattern on top.'],
  microfoam: ['Microfoam', 'Steamed milk with tiny, silky bubbles. It’s what lets you draw on the crema.'],
  fill: ['Fill', 'The first pour, high and thin. The milk sinks under the crema and nothing shows yet.'],
  bloom: ['Bloom', 'Bringing the jug close so white milk spreads across the top.'],
  wiggle: ['Wiggle', 'Rocking the jug side to side as you pour. It draws the leaves of a rosetta.', 'wiggle|rocking'],
  cut: ['Cut', 'Lifting the jug and pulling a thin line through the pattern to finish it.'],
};
const GLOSSARY = [['Espresso', ['espresso', 'shot', 'grind', 'dose', 'ratio', 'wdt', 'tamp', 'puck', 'preinfusion', 'extraction', 'channel', 'pressure', 'flow', 'crema']], ['Latte art', ['latteart', 'microfoam', 'fill', 'bloom', 'wiggle', 'cut']]];
const TERM_RE = Object.entries(TERMS).filter(([k]) => k !== 'espresso' && k !== 'shot').map(([k, t]) => [k, new RegExp('\\b(' + (t[2] || t[0]) + ')\\b', 'i')]);

function termify(text, only) {
  return TERM_RE.reduce((html, [k, re]) => (only && !only.includes(k)) || html.includes('data-term="' + k) ? html : html.replace(re, '<span class="term" role="button" tabindex="0" data-term="' + k + '">$1</span>'), text);
}

const swatch = (svg) => '<svg viewBox="0 0 28 28" aria-hidden="true">' + svg + '</svg>';
const SEEN = new Set();
const seen = (k) => SEEN.has(k);
const markSeen = (k) => SEEN.add(k);

const legendRows = (g) => g.legend.map(([sw, k, v]) => `<div class="gd-row"><i class="gd-sw">${sw}</i><div><b>${k}</b><span>${v}</span></div></div>`).join('');

function termSheet(k) {
  openSheet(`<div class="sh-title">${TERMS[k][0]}</div><p class="sh-def">${TERMS[k][1]}</p><button type="button" class="btn-ghost sh-reset" data-glossary="1">All coffee words</button>`);
}

function glossarySheet() {
  openSheet(`<div class="sh-title">Coffee words</div><div class="sh-scroll">${GLOSSARY.map(([h, keys]) => `<div class="sh-k">${h}</div><dl class="sh-terms">${keys.map((k) => `<dt>${TERMS[k][0]}</dt><dd>${TERMS[k][1]}</dd>`).join('')}</dl>`).join('')}</div>`);
}

const camOn = (cam, id) => cam.start($(id + 'Video')).then((res) => {
  $(id + 'Video').classList.toggle('hidden', !res.granted);
  $(id + 'Fallback').classList.toggle('hidden', res.granted);
  return res.granted;
});

function fitPhoneToViewport() {
  const phone = $('phoneEl');
  if (!phone) return;
  const scale = document.body.classList.contains('glasses') ? 1 : Math.min(1, (window.innerWidth - 24) / 390, (window.innerHeight - 24) / 844);
  const next = scale.toFixed(4);
  if (phone.dataset.scale === next) return;
  phone.dataset.scale = next;
  phone.style.transform = scale < 1 ? `scale(${next})` : '';
  $('page').style.padding = scale < 1 ? '0' : '';
}
const rosettaWiggle = (u, t) => ({
  x: 50 + (25 - 16 * u) * Math.sin(2 * Math.PI * 2.4 * t),
  y: 72 - 46 * u,
});

CG.PATTERNS = {
  heart: {
    name: 'Heart', dur: 11, level: 1,
    blurb: 'One pour, then one line through the middle. Every other pattern starts here.',
    steps: [
      { key: 'fill',  label: 'Fill',   t0: 0,   t1: 4.0,  h: [45, 65], f: [3, 5],   hz: 0, cue: 'Pour high and thin',
        pos: (u) => ({ x: 50, y: 58 + 6 * u }),
        why: 'Pour high with a thin stream. The milk sinks under the crema and fills the cup.' },
      { key: 'bloom', label: 'Bloom',  t0: 4.0, t1: 8.2,  h: [8, 14],  f: [8, 11],  hz: 0, cue: 'Come close and hold still',
        pos: () => ({ x: 50, y: 66 }),
        why: 'Bring the jug close to the surface and hold still. A white circle spreads out.' },
      { key: 'cut',   label: 'Cut',    t0: 8.2, t1: 11,   h: [22, 32], f: [2, 4],   hz: 0, cue: 'Lift and pull through',
        pos: (u) => ({ x: 50, y: 22 + 60 * u }),
        why: 'Lift a little and pull a thin line through the circle, away from you.' },
    ],
  },

  tulip: {
    name: 'Tulip', dur: 13, level: 2,
    blurb: 'Three small pours stacked on top of each other. You learn when to stop and start.',
    steps: [
      { key: 'fill',  label: 'Fill',   t0: 0,    t1: 3.4,  h: [45, 65], f: [3, 5],  hz: 0, cue: 'Pour high and thin',
        pos: (u) => ({ x: 50, y: 58 + 8 * u }),
        why: 'Same high, thin pour as the heart. Nothing shows on top yet.' },
      { key: 'push1', label: 'Push 1', t0: 3.4,  t1: 5.6,  h: [8, 14],  f: [8, 11], hz: 0, cue: 'Come close and pour',
        pos: () => ({ x: 50, y: 70 }),
        why: 'Come down close and pour. This first blob is the biggest.' },
      { key: 'stop1', label: 'Stop',   t0: 5.6,  t1: 6.4,  h: [22, 30], f: [0, 1],  hz: 0, cue: 'Lift and stop', join: true,
        pos: () => ({ x: 50, y: 62 }),
        why: 'Lift the jug and stop pouring. The pause keeps the petals apart.' },
      { key: 'push2', label: 'Push 2', t0: 6.4,  t1: 8.4,  h: [8, 14],  f: [7, 10], hz: 0, cue: 'Pour again, a bit further up', join: true,
        pos: () => ({ x: 50, y: 56 }),
        why: 'Pour again a little further up the cup. It pushes the first blob forward.' },
      { key: 'stop2', label: 'Stop',   t0: 8.4,  t1: 9.1,  h: [22, 30], f: [0, 1],  hz: 0, cue: 'Lift and stop', join: true,
        pos: () => ({ x: 50, y: 50 }),
        why: 'Stop again, a bit shorter this time.' },
      { key: 'push3', label: 'Push 3', t0: 9.1,  t1: 10.6, h: [8, 13],  f: [6, 9],  hz: 0, cue: 'One small last pour', join: true,
        pos: () => ({ x: 50, y: 42 }),
        why: 'One small last pour near the far edge.' },
      { key: 'cut',   label: 'Cut',    t0: 10.6, t1: 13,   h: [22, 32], f: [2, 4],  hz: 0, cue: 'Lift and pull through',
        pos: (u) => ({ x: 50, y: 26 + 56 * u }),
        why: 'Draw one line down through all three. That is the stem.' },
    ],
  },

  rosetta: {
    name: 'Rosetta', dur: 14, level: 3,
    blurb: 'Rock the jug side to side while you move back. Keep the rhythm even.',
    steps: [
      { key: 'fill',   label: 'Fill',   t0: 0,    t1: 3.6,  h: [45, 65], f: [3, 5],   hz: 0, cue: 'Pour high and thin',
        pos: (u) => ({ x: 50, y: 60 + 10 * u }),
        why: 'Pour high and thin into the near half. Keep the top clean for now.' },
      { key: 'bloom',  label: 'Bloom',  t0: 3.6,  t1: 5.5,  h: [8, 14],  f: [7, 10],  hz: 2.4, cue: 'Come close and start rocking',
        pos: (u, t) => ({ x: 50 + 25 * Math.sin(2 * Math.PI * 2.4 * t), y: 72 }),
        why: 'Drop close and start rocking the jug side to side on the spot.' },
      { key: 'wiggle', label: 'Wiggle', t0: 5.5,  t1: 10.5, h: [8, 14],  f: [6, 9],   hz: 2.4, cue: 'Keep rocking, move back', join: true,
        pos: rosettaWiggle,
        why: 'Keep the same rhythm as you move back to the far edge. Let the swings get smaller.' },
      { key: 'cap',    label: 'Cap',    t0: 10.5, t1: 11.5, h: [8, 14],  f: [8, 11],  hz: 0, cue: 'Stop rocking, one small blob', join: true,
        pos: () => ({ x: 50, y: 24 }),
        why: 'Stop rocking and pour one small blob at the top.' },
      { key: 'cut',    label: 'Cut',    t0: 11.5, t1: 14,   h: [22, 32], f: [2, 4],   hz: 0, cue: 'Lift and pull through',
        pos: (u) => ({ x: 50, y: 20 + 64 * u }),
        why: 'Lift up and pull a thin line down through the leaves.' },
    ],
  },
};

CG.target = (key, t) => {
  const pat = CG.PATTERNS[key], steps = pat.steps;
  t = clamp(t, 0, pat.dur - 0.001);
  const i = steps.findIndex((x, k) => t < x.t1 || k === steps.length - 1), step = steps[i];
  const u = clamp((t - step.t0) / (step.t1 - step.t0)), p = step.pos(u, t);
  const xs = step.hz > 0 ? Array.from({ length: 12 }, (_, k) => step.pos(u, t + (k / 12) / step.hz).x) : null;
  return {
    step, stepIndex: i, u, x: p.x, y: p.y, hz: step.hz,
    amp: xs ? (Math.max(0, ...xs) - Math.min(100, ...xs)) / 2 : 0,
    heightMm: (step.h[0] + step.h[1]) / 2,
    flow: (step.f[0] + step.f[1]) / 2,
  };
};

function spineAt(key, t) {
  const g = CG.target(key, t);
  if (g.hz <= 0) return { x: g.x, y: g.y, amp: 0 };
  let sx = 0;
  for (let k = 0; k < 10; k++) sx += g.step.pos(g.u, t + (k / 10) / g.hz).x;
  return { x: sx / 10, y: g.y, amp: g.amp };
}

const AR = { fit: new ResizeObserver(() => arFit()), name: null, sub: null, view: null, i: 0, pos: {}, timer: 0, hold: 0, press: null, sig: '', lent: [], want: [], ask: null, askT: 0, hud: false, morph: false, done: Promise.resolve(), top: false };
const AR_TAMP = ['light', 'ideal', 'tight'];
const AR_HINT = '<b>Swipe</b> to move · <b>Tap</b> to choose · <b>Swipe up</b> for phone view · <b>Hold</b> to go back';
const AR_HINT_TOP = '<b>Tap</b> to switch to phone view · <b>Swipe down</b> to go back to the cards';
const AR_HINT_ADJ = '<b>Swipe up or down</b> to change · <b>Swipe sideways</b> to move · <b>Hold</b> to go back';
const AR_HINT_INFO = '<b>Swipe</b> to move · <b>Swipe up</b> for phone view · <b>Hold</b> to go back';
const arRoot = () => $('arRoot');
const arPage = () => AR.name + (AR.sub ? ':' + AR.sub : '');
const arFa = (n) => '<i class="fa-solid fa-' + n + '"></i>';
const arChip = (t, c) => t && t !== '—' ? '<span class="ar-chip' + (c ? ' ' + c : '') + '">' + esc(t) + '</span>' : '';
const arDiv = (cls, html) => '<div class="' + cls + '">' + html + '</div>';
const arField = (key, cls) => '<div class="' + cls + '" data-arf="' + key + '"></div>';
const arClick = (sel) => () => { const el = typeof sel === 'string' ? document.querySelector(sel) : sel; if (el) el.click(); };
const arKind = (k) => k === 'ok' ? 'ok' : k === 'channel' ? 'stop' : 'warn';
const arText = (id) => ($(id) ? $(id).textContent.trim() : '');
const arTone = (ok) => ok ? 'ok' : 'warn';
const arCalm = () => !document.startViewTransition || calm();
const arOpen = (k, ic, t, v, s, d) => ({ ic: arFa(ic), t, v, s, d, act: () => arSub(k) });
const AR_DONE = { ic: arFa('check'), t: 'Done', d: 'Back to the last screen.', act: () => arSub(null) };
const arHintOf = (it) => !it ? AR_HINT : it.adj ? AR_HINT_ADJ : it.act ? AR_HINT : AR_HINT_INFO;

function arLend(el, w, inv, cls) {
  if (!el) return '';
  AR.want.push(el);
  return '<div class="ar-slot' + (inv ? ' inv' : '') + (cls ? ' ' + cls : '') + '" data-lend="' + (AR.want.length - 1) + '" style="--w:' + w + 'px"></div>';
}

function arReturn() {
  AR.lent.forEach(([el, mark]) => { el.style.zoom = ''; if (mark.parentNode) mark.replaceWith(el); });
  AR.lent = [];
}

function arFit() {
  arRoot().querySelectorAll('.ar-slot').forEach((s) => {
    const el = s.firstElementChild;
    if (!el || !s.clientWidth) return;
    el.style.zoom = 1;
    el.style.zoom = Math.min(s.clientWidth / el.offsetWidth, s.clientHeight / el.offsetHeight).toFixed(3);
  });
}

function arAsk(key, o, ask, fn) {
  const armed = AR.ask === key;
  return Object.assign({}, o, { t: armed ? ask : o.t, tone: armed ? 'stop' : o.tone, act: () => {
    clearTimeout(AR.askT);
    if (armed) { AR.ask = null; buzz('confirm', true); fn(); return; }
    buzz('warn', true);
    AR.ask = key;
    AR.askT = setTimeout(() => { AR.ask = null; arPatch(); }, 3000);
  } });
}

function arTiles(list) {
  return '<div class="ar-tiles">' + list.map((t) => '<div class="ar-tile ' + (t.tone || '') + '"><span>' + esc(t.k) + '</span><b>' + esc(t.v) + '</b>'
    + (t.bar != null ? '<div class="ar-bar"><i style="width:' + t.bar + '%"></i></div>' : '')
    + (t.s ? '<em>' + esc(t.s) + '</em>' : '') + '</div>').join('') + '</div>';
}

function arCard(o, i) {
  return '<button type="button" class="ar-card' + (o.tone ? ' ' + o.tone : '') + (o.sel ? ' sel' : '') + (o.act || o.adj ? '' : ' info') + '" data-i="' + i + '">'
    + (o.ic ? '<span class="ar-ic">' + o.ic + '</span>' : '')
    + (o.k ? '<span class="ar-k">' + esc(o.k) + '</span>' : '')
    + '<b class="ar-t">' + esc(o.t) + '</b>'
    + (o.v != null && o.v !== '' ? '<span class="ar-v">' + esc(o.v) + '</span>' : '')
    + (o.s ? '<span class="ar-s">' + esc(o.s) + '</span>' : '')
    + (o.adj ? '<span class="ar-adj">' + arFa('chevron-up') + arFa('chevron-down') + '</span>' : '')
    + '</button>';
}

function arSet(key, val) {
  const el = arRoot().querySelector('[data-arf="' + key + '"]');
  if (el && el.innerHTML !== val) el.innerHTML = val;
}

function arVerdict(r) {
  const tiles = verdictTiles(r).filter(Boolean).map((t) => ({ k: t.lab, v: t.fmt(t.v), s: t.sub, tone: arTone(t.v >= t.lo && t.v <= t.hi) }));
  return arDiv('ar-col grow', arDiv('ar-lead', arChip(chipText(r), arKind(r.verdict.kind)) + arChip(fmtDay(r.at), 'plain'))
    + arDiv('ar-mid', esc(r.verdict.title)) + arDiv('ar-sub', esc(r.verdict.cause)) + arTiles(tiles));
}

function arChange(a) {
  if (!a.field) return 'Same recipe';
  return a.field === 'note' ? '' : FIELD_NAME[a.field] + ': ' + fieldText(a.field, a.from) + ' → ' + fieldText(a.field, a.to);
}

function arAdvice(r, head) {
  const a = r.advice, notes = CG.Advice.notes(r, a), cmp = r.method === 'espresso' && a.predicted && a.next != null
    ? 'This shot ' + r.time.toFixed(1) + ' s · ' + (a.field && Math.abs(a.next - r.time) > 0.4 ? 'next ≈ ' : 'stays ≈ ') + a.next.toFixed(1) + ' s' : '';
  return arDiv('ar-col side', arDiv('ar-sub', head) + arDiv('ar-mid sm ar-crema', esc(a.title))
    + (arChange(a) ? arDiv('ar-txt strong', esc(arChange(a))) : '') + arDiv('ar-txt', esc(a.why || ''))
    + (notes.length ? '<ul class="ar-list">' + notes.map((n) => '<li>' + esc(n) + '</li>').join('') + '</ul>' : '')
    + (cmp ? arDiv('ar-sub', esc(cmp)) : ''));
}

function arReplay(id, kicker, rec) {
  const host = document.querySelector('[data-replay=' + id + ']');
  return {
    layout: 'sum', kicker, title: rec.model ? 'Shot replay' : 'Planned vs actual', lead: arChip(rec.model ? 'Flow and pressure through the shot. The shaded band is the time to aim for.' : 'The time you planned against the time it took.', 'plain'),
    panel: arLend(host, 330, true, 'big'),
    items: [host.querySelector('[data-r=play]') && { ic: arFa('play'), t: 'Play again', d: 'Plays the replay from the start.', act: arClick('[data-replay=' + id + '] [data-r=play]') }, AR_DONE].filter(Boolean),
  };
}

const AR_VIEWS = {
  home() {
    const p = lastPour();
    return {
      layout: 'deck', kicker: 'Common Ground', title: 'What do you want to practise?', lead: arChip('Swipe to choose. Tap to open.', 'plain'),
      items: [
        ...QUICK.map((k) => ({ ic: mi(k), k: 'Make a coffee', t: methodName(k), s: k === 'espresso' ? 'See the water move through your coffee with Plate X-Ray.' : METHOD_DATA[k].dose + ' · ' + METHOD_DATA[k].yield, act: () => quickMethod(k) })),
        { ic: mi('liveart'), k: 'LiveARt', t: 'Practise latte art', s: 'No milk needed. Your phone is the cup and the ring is the jug.' + (p ? ' Last: ' + LV_PATS[p.key].name + '.' : ''), act: () => openMode('liveart') },
        { ic: arFa('clock-rotate-left'), k: 'History', t: 'Your brews', s: CG.Store.all().length + ' saved', act: () => go('history') },
        { ic: arFa('sliders'), k: 'Settings', t: 'Settings and help', s: 'How the app works, coffee words, vibration', act: () => arSub('settings') },
      ],
    };
  },

  'home:settings'() {
    const g = CG.Store.gear();
    return {
      layout: 'deck', kicker: 'Settings', title: 'Settings and help',
      items: [
        { ic: arFa('gear'), k: 'Grinder', t: g.grinder, s: 'Used for grind advice', adj: (d) => CG.Store.setGear({ grinder: CG.GRINDERS[(CG.GRINDERS.indexOf(g.grinder) + d + CG.GRINDERS.length) % CG.GRINDERS.length] }) },
        { ic: arFa('mobile-screen'), k: 'Vibration', t: buzzOn ? 'On' : 'Off', s: 'A small buzz on every tap', act: () => setBuzz(!buzzOn) },
        { ic: arFa('circle-info'), k: 'Help', t: 'How the app works', s: 'The start page, again', act: () => openIntro('app') },
        { ic: arFa('book-open'), k: 'Help', t: 'Coffee words', s: 'What each coffee word means', act: () => arSub('words') },
        AR_DONE,
      ],
    };
  },

  'home:words'() {
    return {
      layout: 'deck', kicker: 'Settings · Help', title: 'Coffee words',
      items: GLOSSARY.flatMap(([group, keys]) => keys.map((k) => ({ ic: arFa(group === 'Espresso' ? 'mug-hot' : 'leaf'), k: group, t: TERMS[k][0], s: TERMS[k][1] }))).concat(AR_DONE),
    };
  },

  intro() {
    const d = INTRO[NAV.intro];
    return {
      layout: 'deck', kicker: d.kicker, title: d.title, lead: arChip(d.lede, 'plain'),
      items: d.steps.map(([t, s], i) => ({ ic: '<span class="ar-av">' + (i + 1) + '</span>', t, s })).concat({ ic: arFa('play'), t: d.go, s: 'Carry on', act: introDone }),
      start: d.steps.length,
    };
  },

  grind() {
    const m = methodOf(appState.method), gs = grindState();
    const grindCard = { ic: arFa('circle-dot'), t: 'Grind', v: 'Setting ' + (gs.g + 1), d: 'How fine the coffee is ground. Finer slows the water down.', tone: arTone(gs.g === gs.target), adj: (d) => { appState.grind = clamp(appState.grind + d, 0, CG.GRIND.scale.length - 1); renderPrep(); }, focus: () => appState.method === 'espresso' && goStep('grind') };
    const start = { ic: arFa('play'), t: appState.method === 'espresso' ? 'Start the shot' : 'Start brewing', d: appState.method === 'espresso' ? 'Point the phone at Plate X-Ray to see inside the machine.' : 'Starts the step timer.', act: brewNow };
    if (appState.method !== 'espresso') {
      return {
        layout: 'sum', kicker: 'Make a coffee · Step 1 of 3', title: m.name, lead: arChip(m.dose) + arChip(m.yield) + arChip(m.temp),
        panel: arLend($('ppGrindCard'), 340, true) + arDiv('ar-col grow', arField('val', 'ar-mid') + arField('note', 'ar-txt ar-note-txt')),
        items: [grindCard, start, arHelpCard()],
        live() {
          arSet('val', esc(arText('ppGrindLike')) + '<span class="ar-sub"> · ' + esc(arText('ppGrindVal')) + '</span>');
          arSet('note', $('ppGrindNote').innerHTML);
        },
      };
    }
    const f = CG.Puck.forecast(prepState()), note = (step) => stepNote(step, f, gs)[0] === 'ok';
    return {
      layout: 'sum', kicker: 'Espresso · Step 1 of 3', title: 'Set up the shot',
      panel: arLend($('pxHero'), 340, true) + arDiv('ar-col grow', arField('step', 'ar-sub') + arField('note', 'ar-txt ar-note-txt') + arLend(document.querySelector('.px-fc'), 330, true, 'fill')),
      items: [
        grindCard,
        { ic: arFa('weight-scale'), t: 'Dose', v: appState.dose.toFixed(1) + ' g', d: 'How much coffee goes in the basket. 18 g is normal.', tone: arTone(note('dose')), adj: (d) => { appState.dose = clamp(appState.dose + d * 0.5, 14, 22); renderPrep(); }, focus: () => goStep('dose') },
        { ic: arFa('wand-magic-sparkles'), t: 'WDT', v: appState.wdt ? 'Stirred' : 'Skipped', d: 'Stirring the grounds with a needle tool to break up lumps.', tone: arTone(appState.wdt), adj: (d) => { appState.wdt = d > 0; renderPrep(); }, focus: () => goStep('wdt') },
        { ic: arFa('compress'), t: 'Tamp', v: TAMP_NAME[appState.tamp], d: 'How hard you press the coffee down. About 15 kg is enough.', tone: arTone(appState.tamp !== 'light'), adj: (d) => { appState.tamp = AR_TAMP[clamp(AR_TAMP.indexOf(appState.tamp) + d, 0, 2)]; renderPrep(); }, focus: () => goStep('tamp') },
        { ic: arFa('ruler-horizontal'), t: 'Surface', v: appState.level === 'level' ? 'Level' : 'Tilted', d: 'Whether the coffee is pressed flat. A tilt lets water rush through one side.', tone: arTone(appState.level === 'level'), adj: (d) => { appState.level = d > 0 ? 'level' : 'tilted'; renderPrep(); }, focus: () => goStep('tamp') },
        start,
        arHelpCard(),
      ],
      live() {
        const step = appState.step;
        arSet('step', esc(STEP_NAME[step]) + (step === 'grind' ? ' · ' + esc(arText('pxGrindVal')) : step === 'dose' ? ' · ' + esc(arText('pxRatio')) : ''));
        arSet('note', $('pxNote').innerHTML);
      },
    };
  },

  brew() {
    if (appState.method === 'espresso') return { layout: 'native' };
    const m = brewMethod || METHOD_DATA.pourover;
    return {
      layout: 'sum', kicker: m.name + ' · Step 2 of 3', title: 'Brewing', lead: arChip('Pour along with the timer. Each step says what to do.', 'plain'),
      panel: arDiv('ar-col grow', arField('phase', 'ar-sub') + arField('time', 'ar-big') + arField('cue', 'ar-txt') + arDiv('ar-segs', m.phases.map((p) => '<div class="ar-seg"><i></i>' + esc(p.name) + '</div>').join(''))),
      items: [
        { ic: arFa('flag-checkered'), t: 'Finish', d: 'Ends the brew and shows the result.', act: arClick('#brewFinishBtn') },
        arHelpCard(),
      ],
      live() {
        const p = currentPhase();
        arSet('phase', esc(p.name));
        arSet('time', esc(arText('btTime')));
        arSet('cue', esc(p.cue));
        arRoot().querySelectorAll('.ar-seg').forEach((s, i) => { s.classList.toggle('on', i === brewIndex); s.classList.toggle('done', i < brewIndex); });
      },
    };
  },

  review() {
    const rec = RV.rec;
    if (!rec) return AR_VIEWS.fallback();
    const tk = tasteKey(rec.taste), keys = Object.keys(TASTE), name = { sour: 'Sour', ok: 'Just right', bitter: 'Bitter' };
    return {
      layout: 'sum', kicker: 'Result · ' + methodName(rec.method), title: timeText(rec) + (rec.method === 'espresso' ? ' · ' + rec.yield + ' g' : ''),
      panel: arVerdict(rec) + arAdvice(rec, 'Next time · one change'),
      items: [
        { ic: arFa('mug-hot'), t: 'How did it taste?', v: tk ? name[tk] : 'Not set', d: 'Swipe up or down to choose. The advice follows your answer.', adj: (d) => { rec.taste = TASTE[keys[clamp((tk ? keys.indexOf(tk) : 1) + d, 0, 2)]]; rvUpdate(); } },
        { ic: arFa('arrow-trend-up'), t: 'Try again', d: 'Sets the change and opens the setup.', act: arClick('#rvApply') },
        { ic: arFa('house'), t: 'Done', d: 'Back to the start.', act: arClick('#rvDone') },
        arOpen('replay', 'chart-area', rec.model ? 'Shot replay' : 'Planned vs actual', '', '', 'Watch the brew again against the time to aim for.'),
        arHelpCard(),
      ],
    };
  },

  'review:replay': () => arReplay('rv', 'Result', RV.rec),

  history() {
    const all = CG.Store.all(), esp = all.filter((r) => r.method === 'espresso');
    return {
      layout: 'deck', kicker: 'History', title: 'Your brews',
      items: [arOpen('trend', 'chart-line', 'Espresso shot times', esp.length ? 'Last ' + Math.min(10, esp.length) + ' shots' : 'No shots yet', 'Your recent shot times against the target')]
        .concat(all.length ? all.map((r) => ({ ic: mi(r.method), k: fmtDay(r.at), t: methodName(r.method), v: timeText(r), tone: arTone(r.verdict.kind === 'ok'), s: chipText(r), act: () => openBrew(r.id) }))
          : [{ ic: arFa('mug-hot'), t: 'No brews yet', s: 'Finish a brew and it shows up here.' }]),
      start: all.length ? 1 : 0,
    };
  },

  'history:trend'() {
    const shots = CG.Store.all().filter((r) => r.method === 'espresso').slice(0, 10);
    return {
      layout: 'sum', kicker: 'History · Band 25 to 32 s', title: 'Espresso shot times', lead: arChip('Each dot is a shot. Inside the green band means it ran on time.', 'plain'),
      panel: arLend(document.querySelector('.hs-trend'), 340, true, 'big'),
      items: shots.map((r) => ({ ic: mi('espresso'), t: fmtDay(r.at, true), v: r.time.toFixed(1) + ' s', d: 'Opens this shot.', tone: arTone(r.verdict.kind === 'ok'), act: () => openBrew(r.id) })).concat(AR_DONE),
    };
  },

  brewdetail() {
    const r = CG.Store.get(BD.id);
    if (!r) return AR_VIEWS.fallback();
    const act = r.advice.field && r.advice.field !== 'note';
    return {
      layout: 'sum', kicker: 'Brew · ' + fmtDay(r.at), title: methodName(r.method) + ' · ' + timeText(r),
      panel: arVerdict(r) + arAdvice(r, 'Next time'),
      items: [
        act && { ic: arFa('arrow-trend-up'), t: 'Try the change', d: 'Sets the change and opens the setup.', act: arClick('#bdApply') },
        { ic: arFa('rotate-right'), t: 'Brew this again', d: 'Loads this exact recipe.', act: arClick('#bdAgain') },
        arOpen('recipe', 'list', 'Recipe', '', '', 'The recipe saved with this brew.'),
        arOpen('replay', 'chart-area', r.model ? 'Shot replay' : 'Planned vs actual', '', '', 'Watch the brew again.'),
        arAsk('del', { ic: arFa('trash'), t: 'Delete', d: 'Removes this brew. Tap twice to confirm.' }, 'Tap again to delete', () => { CG.Store.remove(BD.id); renderHome(); back(); }),
      ].filter(Boolean),
    };
  },

  'brewdetail:recipe'() {
    const rows = [...$('bdRecipe').children].map((row) => ({ k: row.children[0].textContent, v: row.children[1].textContent }));
    return {
      layout: 'sum', kicker: 'Brew · ' + arText('bdWhen'), title: 'Recipe',
      panel: arDiv('ar-col grow', arDiv('ar-grid wide', rows.map((x) => '<div><span>' + esc(x.k) + '</span><b>' + esc(x.v) + '</b></div>').join(''))),
      items: [AR_DONE],
    };
  },

  'brewdetail:replay': () => arReplay('bd', 'Brew · ' + arText('bdWhen'), CG.Store.get(BD.id)),

  pick() {
    const keys = Object.keys(LV_PATS);
    return {
      layout: 'sum', kicker: 'LiveARt · Choose a pattern', title: LV_PATS[LV.key].name,
      panel: arLend($('lvModelCard'), 300, false) + arDiv('ar-col grow', arField('why', 'ar-txt')),
      items: keys.map((k) => ({ ic: mi('liveart'), t: LV_PATS[k].name, v: LV_PATS[k].skill, d: LV_PATS[k].blurb, sel: k === LV.key, focus: () => { if (LV.key !== k) pickPattern(k); } }))
        .concat({ ic: arFa('play'), t: 'Pour', d: 'Opens the cup. Hold the ring above your phone.', act: () => go('pour') }, arHelpCard()),
      start: keys.indexOf(LV.key),
      live() {
        arSet('why', esc(arText('lvWhy')));
      },
    };
  },

  pour() {
    return {
      layout: 'sum', kicker: 'LiveARt · ' + LV_PATS[LV.key].name, title: 'Pour',
      panel: arLend($('poCup'), 300, false) + arDiv('ar-col grow', arField('step', 'ar-sub') + arField('cue', 'ar-mid sm')),
      items: [{ ic: arFa('chevron-left'), t: 'Back', d: 'Back to the patterns.', act: back }, arHelpCard()],
      live() {
        arSet('step', esc(arText('poStep')));
        arSet('cue', esc(arText('poCueText') || arText('poWaitHead')));
      },
    };
  },

  art() {
    const res = LV.result || {};
    return {
      layout: 'sum', kicker: 'LiveARt · Result', title: LV_PATS[LV.key].name,
      panel: arLend($('artCmp'), 330, false) + arDiv('ar-col grow', arDiv('ar-sub', esc(arText('artTipHead'))) + arDiv('ar-mid sm', esc(res.head || '')) + arDiv('ar-txt', esc(res.why || ''))),
      items: [
        { ic: arFa('rotate-right'), t: arText('artAgain'), d: 'Pours again.', act: arClick('#artAgain') },
        { ic: arFa('house'), t: 'Done', d: 'Back to the start.', act: arClick('#artDone') },
        arHelpCard(),
      ],
    };
  },

  help() {
    const [title, points] = arHelp(), h = document.querySelector('.screen.active .header-title, .screen.active .po-title'), screen = h ? h.textContent.trim() : title;
    return {
      layout: 'sum', kicker: screen + ' · How it works', title,
      panel: arDiv('ar-col grow', '<ul class="ar-list ar-help">' + points.map((p) => '<li>' + esc(p).replace(/^([^:.]{2,24}): /, '<b>$1:</b> ') + '</li>').join('') + '</ul>'),
      items: [{ ic: arFa('check'), t: 'Got it', d: 'Back to the screen.', act: () => arSub(null) }],
    };
  },

  fallback() {
    const h = document.querySelector('.screen.active .header-title');
    return { layout: 'deck', kicker: 'Common Ground', title: h ? h.textContent : 'Common Ground', items: [{ ic: arFa('house'), t: 'Home', s: 'Back to the start', act: () => go('home') }] };
  },
};

function arHelp() {
  const n = AR.name;
  if (n === 'brew') {
    const esp = appState.method === 'espresso';
    return [esp ? 'What the X-Ray shows' : 'The timer', LEGEND[esp ? 'espresso' : 'brew'].map(([, k, v]) => k + ': ' + v)];
  }
  return HELP[n === 'grind' && appState.method !== 'espresso' ? 'pourover' : n] || ['How it works', ['Swipe to move, tap to choose, swipe down to go back.']];
}

function arHelpCard() {
  return { ic: arFa('circle-question'), t: 'How it works', d: 'What each part of this screen means.', act: () => arSub('help') };
}

function arBuild() {
  AR.want = [];
  const help = AR.sub === 'help' && arHelp();
  const v = (AR_VIEWS[arPage()] || (help && AR_VIEWS.help) || AR_VIEWS[AR.name] || AR_VIEWS.fallback)();
  if (AR.sub && !AR_VIEWS[arPage()] && !help) AR.sub = null;
  AR.sig = v.sig ? v.sig() : '';
  return v;
}

function arRender() {
  const v = AR.view, root = arRoot();
  arReturn();
  AR.hud = v.layout === 'native';
  if (AR.hud) { root.className = 'ar'; root.innerHTML = ''; arFocus(AR.pos[arPage()] ?? arHudStart()); return; }
  root.className = 'ar on ar-' + v.layout + (arCalm() && !AR.morph ? ' enter' : '');
  root.innerHTML = '<div class="ar-safe"><div class="ar-head"><div class="ar-head-txt"><div class="ar-kicker">' + esc(v.kicker || '') + '</div><h1 class="ar-title">' + esc(v.title) + '</h1></div><div class="ar-step" data-arf="pager"></div>'
    + '<button type="button" class="ar-phone" aria-label="Phone view">' + arFa('mobile-screen-button') + '<span>Phone view</span></button></div>'
    + (v.lead ? '<div class="ar-lead">' + v.lead + '</div>' : '')
    + '<div class="ar-body">' + (v.panel ? '<div class="ar-panel">' + v.panel + '</div>' : '')
    + '<div class="ar-row ' + (v.layout === 'deck' ? 'big' : 'small') + '"><div class="ar-track">' + v.items.map(arCard).join('') + '</div></div></div>'
    + '<div class="ar-about" data-arf="about"></div><div class="ar-hint" data-arf="hint"></div><div class="ar-toast" data-arf="toast"></div></div>';
  AR.lent = AR.want.map((el, i) => {
    const mark = document.createComment('ar');
    el.before(mark);
    root.querySelector('[data-lend="' + i + '"]').appendChild(el);
    return [el, mark];
  });
  arFocus(AR.pos[arPage()] ?? v.start ?? 0);
  if (v.live) v.live();
  arToast();
  arFit();
  AR.fit.disconnect();
  root.querySelectorAll('.ar-slot').forEach((el) => AR.fit.observe(el));
}

function arHudButtons() {
  return [...document.querySelectorAll('#glHud .gl-bar button')].filter((b) => b.offsetParent);
}

function arHudStart() {
  return Math.max(0, arHudButtons().indexOf($('glEndBtn')));
}

function arFocus(i) {
  if (AR.hud) {
    const btns = arHudButtons();
    AR.i = clamp(i, 0, btns.length - 1);
    AR.pos[arPage()] = AR.i;
    btns.forEach((b, k) => b.classList.toggle('ar-on', k === AR.i));
    return;
  }
  const v = AR.view, root = arRoot(), cards = root.querySelectorAll('.ar-card');
  if (!v || !cards.length) return;
  arTop(false);
  AR.i = clamp(i, 0, cards.length - 1);
  AR.pos[arPage()] = AR.i;
  cards.forEach((c, k) => c.classList.toggle('on', k === AR.i));
  const row = root.querySelector('.ar-row'), track = row.firstChild, c = cards[AR.i];
  const x = clamp(c.offsetLeft + c.offsetWidth / 2 - row.clientWidth / 2, 0, Math.max(0, track.scrollWidth - row.clientWidth));
  track.style.transform = 'translateX(' + (-x).toFixed(1) + 'px)';
  const it = v.items[AR.i];
  arSet('pager', cards.length > 3 ? (AR.i + 1) + ' / ' + cards.length : '');
  arSet('about', esc(it.d || ''));
  arSet('hint', arHintOf(it));
  if (it.focus) it.focus();
}

function arMove(i) {
  const was = AR.i;
  arFocus(i);
  if (AR.i !== was) buzz('tick');
}

function arTop(on) {
  AR.top = on;
  arRoot().classList.toggle('top', on);
  const b = arRoot().querySelector('.ar-phone');
  if (b) b.classList.toggle('on', on);
  const it = AR.view && AR.view.items[AR.i];
  arSet('about', on ? 'Go back to the phone screen.' : esc((it && it.d) || ''));
  arSet('hint', on ? AR_HINT_TOP : arHintOf(it));
}

function arToast() {
  const t = $('applyToast'), on = t.classList.contains('on');
  arSet('toast', on ? arFa('check') + ' ' + esc(t.textContent) : '');
  const el = arRoot().querySelector('.ar-toast');
  if (el) el.classList.toggle('on', on);
}

function arMorph(kind, fn) {
  if (AR.morph || arCalm()) { fn(); return; }
  AR.morph = true;
  document.documentElement.dataset.vt = kind;
  const t = document.startViewTransition(fn);
  AR.done = t.finished;
  t.finished.finally(() => { AR.morph = false; delete document.documentElement.dataset.vt; });
}

function arShow(name) {
  clearInterval(AR.timer);
  if (!name) {
    Object.assign(AR, { name: null, sub: null, hud: false });
    arReturn();
    arRoot().className = 'ar';
    arRoot().innerHTML = '';
    return arHudButtons().forEach((b) => b.classList.remove('ar-on'));
  }
  if (name !== AR.name) { AR.sub = null; AR.ask = null; }
  const kind = AR.name ? 'step' : 'in';
  AR.name = name;
  arMorph(kind, arRedraw);
  AR.timer = setInterval(arLive, 250);
}

function arRedraw() {
  AR.view = arBuild();
  arRender();
}

function arRefresh() {
  if (AR.name) arRedraw();
}

function arPatch() {
  if (!AR.name) return;
  const old = AR.view, v = arBuild(), root = arRoot(), cards = root.querySelectorAll('.ar-card'), tmp = document.createElement('div');
  if (!old || AR.hud || v.layout !== old.layout || v.panel !== old.panel || v.lead !== old.lead || v.items.length !== cards.length) { AR.view = v; arRender(); return; }
  AR.view = v;
  v.items.forEach((it, i) => {
    tmp.innerHTML = arCard(it, i);
    const n = tmp.firstChild, c = cards[i], cls = n.className + (c.classList.contains('on') ? ' on' : '');
    if (c.innerHTML !== n.innerHTML) c.innerHTML = n.innerHTML;
    if (c.className !== cls) c.className = cls;
  });
  const t = root.querySelector('.ar-title');
  if (t.textContent !== v.title) t.textContent = v.title;
  arFocus(AR.i);
  if (v.live) v.live();
}

function arLive() {
  const v = AR.view;
  if (!v || AR.hud) return;
  if (v.sig && v.sig() !== AR.sig) { arRefresh(); return; }
  if (v.live) v.live();
  arToast();
}

function arSub(k) {
  AR.sub = k;
  AR.ask = null;
  arMorph('step', arRedraw);
}

function arAct() {
  if (AR.hud) { const b = arHudButtons()[AR.i]; if (b) { buzz('tap'); b.click(); } return; }
  if (AR.top) { buzz('tap'); setGlasses(false); return; }
  const it = AR.view && AR.view.items[AR.i], before = arPage();
  if (!it || !(it.act || it.adj)) return;
  buzz('tap');
  if (it.act) it.act(); else it.adj(1);
  setTimeout(() => { if (arPage() === before && AR.view && !AR.hud) arPatch(); }, 60);
}

function arAdj(d) {
  const it = !AR.hud && AR.view && AR.view.items[AR.i];
  if (AR.top) { if (d < 0) arTop(false); return; }
  if (it && !it.adj && d > 0) { buzz('tick'); arTop(true); return; }
  if (!it || !it.adj) return;
  buzz('select');
  it.adj(d);
  arPatch();
}

function arBack() {
  buzz('select');
  if (AR.sub) { arSub(null); return; }
  const b = document.querySelector('.screen.active .back-circle[data-nav]');
  if (b) b.click();
}

function arOnKey(e) {
  if (!AR.name || !(AR.hud || arRoot().classList.contains('on'))) return;
  const k = e.key, field = e.target.closest('input, select, textarea');
  if (field) {
    if (k === 'Escape') { field.blur(); arBack(); e.preventDefault(); }
    return;
  }
  if (AR.hud && k === 'x') glToggleView();
  else if (k === 'p') setGlasses(false);
  else if (k === 'ArrowRight') arMove(AR.i + 1);
  else if (k === 'ArrowLeft') arMove(AR.i - 1);
  else if (k === 'ArrowUp') arAdj(1);
  else if (k === 'ArrowDown') arAdj(-1);
  else if (k === 'Enter' || k === ' ') arAct();
  else if (k === 'Escape' || k === 'Backspace' || k === 'GoBack' || k === 'BrowserBack') arBack();
  else return;
  e.preventDefault();
}

const AR_WHEEL = { x: 0, y: 0, low: 0, at: 0, prev: 0, dir: 0, lock: false, t: 0 };

function arWheel(e) {
  if (!AR.name || e.ctrlKey || e.target.closest('textarea') || !(AR.hud || arRoot().classList.contains('on'))) return;
  e.preventDefault();
  const w = AR_WHEEL, k = e.deltaMode ? 40 : 1, dx = e.deltaX * k, dy = e.deltaY * k, now = performance.now();
  const gap = now - w.prev, rate = Math.hypot(dx, dy) / Math.max(8, gap), dir = Math.abs(dx) > Math.abs(dy) ? Math.sign(dx) : 2 * Math.sign(dy);
  w.prev = now;
  clearTimeout(w.t);
  w.t = setTimeout(() => Object.assign(w, { x: 0, y: 0, lock: false }), 160);
  if (w.lock) {
    const steady = gap < 40, turned = dir !== w.dir && rate > 0.2, push = steady && rate >= Math.max(w.low * 2, w.low + 0.35) && now - w.at > 200;
    if (steady) w.low = Math.min(w.low, rate);
    if (!turned && !push) return;
    Object.assign(w, { x: 0, y: 0, lock: false });
  }
  w.x += dx;
  w.y += dy;
  if (Math.max(Math.abs(w.x), Math.abs(w.y)) < 33) return;
  Object.assign(w, { lock: true, at: now, low: rate, dir: Math.abs(w.x) > Math.abs(w.y) ? Math.sign(w.x) : 2 * Math.sign(w.y) });
  if (Math.abs(w.x) > Math.abs(w.y)) arMove(AR.i + (w.x > 0 ? 1 : -1));
  else arAdj(w.y > 0 ? 1 : -1);
}

function arPointer(el) {
  const end = () => { AR.press = null; clearTimeout(AR.hold); };
  el.addEventListener('pointerdown', (e) => {
    if (!AR.name || e.target.closest('textarea')) return;
    AR.press = { x: e.clientX, y: e.clientY, moved: false, done: false, mouse: e.pointerType === 'mouse', card: e.target.closest('.ar-card'), btn: e.target.closest('.gl-bar button'), phone: e.target.closest('.ar-phone') };
    clearTimeout(AR.hold);
    AR.hold = setTimeout(() => { if (AR.press && !AR.press.moved) { AR.press.done = true; arBack(); } }, 600);
  });
  el.addEventListener('pointermove', (e) => {
    const p = AR.press;
    if (p && Math.hypot(e.clientX - p.x, e.clientY - p.y) > 14) { p.moved = true; clearTimeout(AR.hold); }
  });
  el.addEventListener('pointerup', (e) => {
    const p = AR.press;
    end();
    if (!p || p.done) return;
    if (p.phone) { buzz('tap'); setGlasses(false); return; }
    const dx = e.clientX - p.x, dy = e.clientY - p.y, s = el.clientHeight * 0.06;
    if (Math.abs(dx) > s && Math.abs(dx) > Math.abs(dy)) arMove(AR.i + (dx < 0 ? 1 : -1));
    else if (Math.abs(dy) > s) arAdj(dy < 0 ? 1 : -1);
    else if (p.btn) buzz('tap');
    else if (p.mouse && p.card) { arFocus(+p.card.dataset.i); arAct(); }
    else arAct();
  });
  el.addEventListener('pointercancel', end);
  el.addEventListener('contextmenu', (e) => e.preventDefault());
}

function arInit() {
  arPointer(arRoot());
  arPointer($('glHud'));
  document.addEventListener('keydown', arOnKey);
  window.addEventListener('wheel', arWheel, { passive: false });
  window.addEventListener('resize', () => { if (AR.name) arFit(); });
  CG.AR = { show: arShow };
}

const LEGEND = {
  espresso: [
    [swatch('<rect x="11" y="4" width="6" height="20" rx="3" fill="rgba(244,241,236,.2)"/><rect x="11" y="12" width="6" height="12" rx="3" fill="#1D9E75"/>'), 'Pressure', 'How hard the pump pushes, in bar. Aim for about 9.'],
    [swatch('<path d="M14 4v8M14 15v3M14 21v3" stroke="#5FA8CE" stroke-width="3" stroke-linecap="round"/>'), 'Flow', 'How fast espresso drips, in grams a second'],
    [swatch('<path d="M7 9h14l-2 13H9z" fill="#C08552"/>'), 'In the cup', 'Espresso so far. Aim for about twice your dose.'],
    [swatch('<circle cx="14" cy="15" r="8" fill="none" stroke="#F4F1EC" stroke-width="2.2"/><path d="M14 15V10" stroke="#F4F1EC" stroke-width="2.2" stroke-linecap="round"/>'), 'Shot time', 'Most good shots take 25 to 32 seconds'],
    [swatch('<path d="M9 5v18M14 5v18" stroke="#A9713F" stroke-width="2" stroke-linecap="round"/><path d="M19 5v18" stroke="#E0803F" stroke-width="3.6" stroke-linecap="round"/>'), 'Orange stream', 'Water rushing through one side of the coffee'],
  ],
  brew: [
    [swatch('<rect x="3" y="9" width="22" height="10" rx="5" fill="rgba(244,241,236,.18)"/><circle cx="8" cy="14" r="2" fill="#1D9E75"/>'), 'Step and time', 'The step you are on, and the time left in it'],
    [swatch('<path d="M3 14h7M12 14h6M20 14h5" stroke="rgba(244,241,236,.35)" stroke-width="3" stroke-linecap="round"/><path d="M3 14h7" stroke="#1D9E75" stroke-width="3" stroke-linecap="round"/>'), 'Step bar', 'Every step of the recipe in order. It fills as you go.'],
  ],
};

const HELP = {
  grind: ['Setting up the shot', [
    'The picture is the basket seen from the side. It changes as you change each step.',
    'Grind: how fine the coffee is. Finer slows the water down.',
    'Dose: how much coffee goes in. 18 g is normal.',
    'WDT: stirring the grounds with thin needles to break up lumps.',
    'Tamp: pressing the coffee flat. Level matters more than force.',
    'The chart at the bottom guesses how the shot will run. Aim for the green band.',
    'Every step starts at a setting that works. Next takes you to the following step.',
  ]],
  pourover: ['Setting up', [
    'Set your grinder to the setting shown. The picture shows how big the grains should be.',
    'Weigh the coffee and the water in the recipe.',
    'Start brewing when you are ready. A timer walks you through each step.',
  ]],
  review: ['Your result', [
    'The top card says how it ran against the time to aim for.',
    'The chart replays it. The shaded band is the target.',
    'Tell the app how it tasted. The change for next time follows your answer.',
    'Try again sets that one change for you.',
  ]],
  pick: ['Choosing a pattern', [
    'Each pattern adds one new hand movement.',
    'Free pour: get used to the ring. Nothing to follow.',
    'Heart: pour high, then come close and hold still.',
    'Tulip: lift the ring to stop, then pour again.',
    'Rosetta: rock the ring from side to side.',
    'The small cup plays the pour before you try it.',
  ]],
  pour: ['Pouring with the ring', [
    'The milk lands under the ring. Move the ring to draw.',
    'Tilt the ring to pour. Hold it flat to stop.',
    'Lift it high and the milk sinks under the coffee. Bring it close and white shows on top.',
    'The bar on the right shows how high you are. Keep the marker in the green band.',
    'Follow the dot. It waits for you.',
    'The line round the cup fills as you pour.',
  ]],
  art: ['Your result', [
    'Yours is what you poured. Target is the same pattern poured cleanly.',
    'The tip is the one change that would help most.',
    'Try again marks that part of the pour for you.',
  ]],
};

const INTRO = {
  app: {
    kicker: 'Common Ground', title: 'Get better at coffee, one try at a time', lede: 'Two things to practise. Both work the same way.', go: 'Start',
    steps: [['Try it', 'Brew a coffee, or pour latte art with the ring.'], ['See why', 'The app shows what happened and why.'], ['Change one thing', 'Try again with that change already set.']],
    need: '<b>Good to know</b>Tap a word with a dotted line to see what it means. The ? button explains the screen you are on.',
  },
  brew: {
    kicker: 'Make a coffee', title: 'See why a coffee runs fast or slow', lede: 'Set up, brew, then see what to change.', go: 'Set up',
    steps: [['Set up', 'Grind, dose and tamp. Each step starts at a setting that works.'], ['Brew', 'For espresso, point the phone at Plate X-Ray. A see-through machine shows the water moving through your coffee.'], ['Change one thing', 'The result says why it ran fast or slow, and sets one change for next time.']],
    need: '<b>You need</b>Plate X-Ray for espresso. Other methods need nothing extra. There is no machine here, so the shot is simulated from your setup.',
  },
  liveart: {
    kicker: 'LiveARt', title: 'Practise latte art without milk', lede: 'Your phone is the cup. The ring is your milk jug.', go: 'Choose a pattern',
    steps: [['Lay the phone flat', 'Screen up, with the bottom edge toward you.'], ['Hold the ring above it', 'Engraved side down, about a hand’s length above the screen.'], ['Pour', 'Tilt the ring to pour and move it to draw. Lift it and the milk sinks.']],
    need: '<b>You need</b>The Cup Ring. No ring? You can pour with your finger.',
  },
};

const INTRO_ART = {
  app: () => '<div class="in-icons">' + mi('espresso') + mi('liveart') + '</div>',
  brew: () => '<div class="in-icons">' + mi('espresso') + mi('pourover') + mi('aeropress') + '</div>',
  liveart: () => '<svg viewBox="0 0 120 80"><rect x="30" y="58" width="60" height="12" rx="4" class="in-phone"/><ellipse cx="60" cy="26" rx="26" ry="9" class="in-ring"/><path d="M60 37v17" class="in-drip"/></svg>',
};

const TAB_SCREENS = ['home', 'history'];
const PASS = ['brew', 'pour', 'intro'];
const NAV = { trail: [], intro: 'app' };
const ENTER = { home: renderHome, grind: renderGrind, brew: startLiveBrew, history: renderHistory, intro: renderIntro, pick: renderPick, pour: startPour };
const LEAVE = { brew: stopLiveBrew, pour: stopPour, pick: stopDemo };
let currentScreen = 'home';

function go(target) {
  if (LEAVE[currentScreen]) LEAVE[currentScreen]();
  const i = NAV.trail.indexOf(target);
  if (TAB_SCREENS.includes(target)) NAV.trail = [];
  else if (i >= 0) NAV.trail = NAV.trail.slice(0, i);
  else if (!PASS.includes(currentScreen) && currentScreen !== target) NAV.trail.push(currentScreen);
  currentScreen = target;
  if (ENTER[target]) ENTER[target]();
  showScreen(target);
}

function back() {
  go(NAV.trail.length ? NAV.trail[NAV.trail.length - 1] : 'home');
}

function initNav() {
  document.addEventListener('click', (e) => { if (e.target.closest('[data-back]')) back(); });
  document.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && !glActive() && e.target.matches('[role=button]:not(button)')) { e.preventDefault(); e.target.click(); }
  });
}

function openIntro(kind) {
  NAV.intro = kind;
  go('intro');
}

function renderIntro() {
  const k = NAV.intro, d = INTRO[k];
  $('inArt').innerHTML = INTRO_ART[k]();
  $('inKicker').textContent = d.kicker;
  $('inTitle').textContent = d.title;
  $('inLede').textContent = d.lede;
  $('inSteps').innerHTML = d.steps.map(([t, v]) => `<li><b>${t}</b><span>${termify(v)}</span></li>`).join('');
  $('inNeed').innerHTML = d.need;
  $('inGo').textContent = d.go;
  $('inBack').classList.toggle('hidden', k === 'app');
  document.querySelector('[data-screen=intro]').scrollTop = 0;
}

function introDone() {
  const k = NAV.intro;
  markSeen('intro-' + k);
  if (k === 'app') go('home');
  else go(k === 'brew' ? 'grind' : 'pick');
}

function openMode(k) {
  if (!seen('intro-' + k)) openIntro(k);
  else go(k === 'brew' ? 'grind' : 'pick');
}

function quickMethod(k) {
  appState.method = k;
  updateMethodSelectionUI();
  openMode('brew');
}

function shotCause(f) {
  const p = prepState(), g = CG.GRIND.target.espresso;
  if (f.time < CG.SHOT.targetLo) return 'Running fast. ' + (p.grind > g ? 'The grind is coarse, so the water finds wide gaps.' : p.dose < 18 ? 'There is not much coffee to hold the water back.' : 'The water finds an easy path through the coffee.');
  if (f.time > CG.SHOT.targetHi) return 'Running slow. ' + (p.grind < g ? 'The grind is fine, so the gaps between grains are tiny.' : 'A lot of coffee holds the water back.');
  if (f.risk >= 0.55) return 'On pace, but one side may run fast. ' + (p.level === 'tilted' ? 'The tilted tamp leaves a thin side.' : !p.wdt ? 'Lumps leave loose spots.' : 'A soft tamp lets the coffee shift.');
  return 'On pace. The grind and dose hold the water back about right.';
}

function dedupeTerms(root) {
  const seenTerm = new Set();
  root.querySelectorAll('.term[data-term]').forEach((el) => {
    if (!seenTerm.has(el.dataset.term)) { seenTerm.add(el.dataset.term); return; }
    el.replaceWith(document.createTextNode(el.textContent));
  });
}

function initTerms() {
  let raf = 0;
  new MutationObserver(() => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => document.querySelectorAll('.screen.active, #sheetBody').forEach(dedupeTerms));
  }).observe(document.querySelector('.app'), { childList: true, subtree: true });
}

function lastPour() {
  return (ls.json('cg-pours') || [])[0];
}

function renderHome() {
  const p = lastPour();
  $('hmLastArt').textContent = p ? 'Last: ' + LV_PATS[p.key].name + ' · ' + fmtDay(p.at, true) : '';
  renderHero(CG.Store.all()[0]);
}

function renderHero(r) {
  const el = $('hmHero');
  el.classList.toggle('hidden', !r);
  if (!r) return;
  const a = r.advice || {}, act = a.field && a.field !== 'note', fresh = Date.now() - r.at < 2 * 3600000;
  const sub = r.method === 'espresso' ? shotLine(r) : (r.dose ? r.dose + ' g coffee' : '') + (r.yield ? ' · ' + r.yield + ' g water' : '');
  const change = act ? fieldText(a.field, a.from) + ' → ' + fieldText(a.field, a.to) : a.why || '';
  el.classList.toggle('fresh', fresh);
  el.innerHTML = `
    <div class="hm-hero-top"><span class="hm-kicker">${fresh ? '<i class="hm-live"></i>Just brewed' : 'Last brew · ' + fmtDay(r.at)}</span><span class="rv-chip k-${r.verdict.kind}">${chipText(r)}</span></div>
    <button type="button" class="hm-hero-main" data-open="${r.id}">
      <div class="hm-hero-nums"><div class="hm-hero-m">${mi(r.method)}${methodName(r.method)}</div><div class="hm-hero-t">${timeText(r)}</div><div class="hm-hero-s">${sub}</div></div>
      ${sparkline(r)}
    </button>
    <div class="hm-next"><i class="fa-solid fa-arrow-trend-up icon-fa ic-14"></i><div><b>Next: ${esc(a.title || 'Keep this recipe')}</b><span>${esc(change)}</span></div></div>
    <div class="hm-hero-act">
      <button type="button" class="btn-primary" id="hmApply">${act ? 'Try the change' : 'Brew it again'}</button>
      <button type="button" class="btn-glass" data-open="${r.id}">Details</button>
    </div>`;
  $('hmApply').onclick = () => act ? applyAdvice(r, 'Change set.') : repeatRecipe(r);
}

function initHome() {
  document.querySelector('[data-screen=home]').addEventListener('click', (e) => {
    const o = e.target.closest('[data-open]');
    if (o) { openBrew(o.dataset.open); return; }
    const b = e.target.closest('[data-mode],[data-method]');
    if (b) b.dataset.method ? quickMethod(b.dataset.method) : openMode(b.dataset.mode);
  });
  $('settingsBtn').addEventListener('click', settingsSheet);
  $('sheetScrim').addEventListener('click', closeSheet);
  $('tabbar').addEventListener('click', (e) => { const b = e.target.closest('[data-tab]'); if (b) go(b.dataset.tab); });
  $('inGo').addEventListener('click', introDone);
  const brands = (navigator.userAgentData && navigator.userAgentData.brands) || [];
  document.documentElement.classList.toggle('lg-refract', brands.some((b) => b.brand === 'Chromium'));
  syncTabs('home');
}

function setSource(wizard) {
  CG.Wizard.on = wizard;
  CG.Wizard.reset();
}

function initWizard() {
  try { new BroadcastChannel('espresso-wizard').onmessage = (e) => CG.Wizard.cmd(e.data && e.data.cmd); } catch {}
  const keys = { f: 'faster', s: 'slower', 1: 'left', 2: 'centre', 3: 'right', 0: 'clear', e: 'stop', r: 'reset' };
  document.addEventListener('keydown', (e) => {
    if (!keys[e.key] || !CG.Wizard.on || currentScreen !== 'brew') return;
    CG.Wizard.cmd(keys[e.key]);
  });
}

const segRow = (id, opts, on) => `<div class="seg3 sh-seg" id="${id}">${opts.map(([v, t]) => `<button type="button" data-v="${v}" class="${String(v) === String(on) ? 'on' : ''}">${t}</button>`).join('')}</div>`;

function settingsSheet() {
  const g = CG.Store.gear();
  openSheet(`<div class="sh-title">Settings</div>
    <div class="sh-set"><span>Grinder</span><select id="setGrinder">${CG.GRINDERS.map((x) => `<option${x === g.grinder ? ' selected' : ''}>${x}</option>`).join('')}</select></div>
    <div class="sh-set"><span>Vibration</span><button type="button" class="sh-switch${buzzOn ? ' on' : ''}" id="setBuzz" role="switch" aria-checked="${buzzOn}" aria-label="Vibration"><i></i></button></div>
    <button type="button" class="btn-ghost sh-reset" id="setIntro"><i class="fa-solid fa-circle-info"></i> How the app works</button>
    <button type="button" class="btn-ghost sh-reset" data-glossary="1"><i class="fa-solid fa-book-open"></i> Coffee words</button>
    <button type="button" class="btn-ghost sh-reset" id="setAr"><i class="fa-solid fa-glasses"></i> AR glasses view</button>
    <details class="sh-test"><summary>For testing</summary>
      <div class="sh-set"><span>Shot data</span>${segRow('setShot', [[0, 'Demo'], [1, 'Wizard']], CG.Wizard.on ? 1 : 0)}</div>
      <div class="sh-set"><span>Pour with</span>${segRow('setInput', [['ring', 'Ring'], ['finger', 'Finger'], ['demo', 'Demo']], LV.input)}</div>
      <div class="sh-set"><span>Ring direction</span>${segRow('setFlip', [['x', 'Flip left-right'], ['y', 'Flip up-down']], '')}</div>
      <div class="sh-set"><span>Ring readout</span><button type="button" class="sh-switch${LV.debug ? ' on' : ''}" id="setDebug" role="switch" aria-checked="${LV.debug}" aria-label="Ring readout"><i></i></button></div>
      <div class="sh-set"><span>Tracking</span><em class="sh-note">${CG.Tracker.available() ? 'Ready.' : CG.Tracker.why(true)}</em></div>
      <div class="sh-set"><span>Test log</span><em class="sh-note" id="setLogN"></em></div>
      <button type="button" class="btn-ghost sh-reset" id="setLog"><i class="fa-solid fa-copy"></i> Copy test log</button>
      <button type="button" class="btn-ghost sh-reset" id="setLogClear">Clear test log</button>
      <button type="button" class="btn-ghost sh-reset" id="setReset">Reset demo data</button>
    </details>`);
  const count = () => { $('setLogN').textContent = LOG.list.length + ' events on this phone'; };
  count();
  const flips = () => $('setFlip').querySelectorAll('[data-v]').forEach((b) => b.classList.toggle('on', LV['flip' + b.dataset.v.toUpperCase()]));
  flips();
  $('setLog').onclick = () => navigator.clipboard.writeText(JSON.stringify(LOG.list)).then(() => { $('setLogN').textContent = 'Copied. Paste it into your notes.'; }, count);
  twoTap($('setLogClear'), 'Tap again to clear', () => { LOG.list = []; ls.del('cg-testlog'); count(); });
  twoTap($('setReset'), 'Tap again to reset', () => { CG.Store.reset(); ls.del('cg-pours'); renderHome(); closeSheet(); });
  $('setIntro').onclick = () => { closeSheet(); openIntro('app'); };
  $('setAr').onclick = () => { closeSheet(); setGlasses(true); };
  $('setGrinder').onchange = () => CG.Store.setGear({ grinder: $('setGrinder').value });
  $('setBuzz').onclick = () => {
    setBuzz(!buzzOn);
    $('setBuzz').classList.toggle('on', buzzOn);
    $('setBuzz').setAttribute('aria-checked', buzzOn);
  };
  $('setDebug').onclick = () => {
    LV.debug = !LV.debug;
    $('setDebug').classList.toggle('on', LV.debug);
    $('setDebug').setAttribute('aria-checked', LV.debug);
  };
  $('setShot').onclick = (e) => { const b = e.target.closest('[data-v]'); if (!b) return; setSource(b.dataset.v === '1'); segOn('setShot', 'data-v', b.dataset.v); };
  $('setInput').onclick = (e) => { const b = e.target.closest('[data-v]'); if (!b) return; LV.input = b.dataset.v; segOn('setInput', 'data-v', b.dataset.v); };
  $('setFlip').onclick = (e) => { const b = e.target.closest('[data-v]'); if (!b) return; const k = 'flip' + b.dataset.v.toUpperCase(); LV[k] = !LV[k]; ls.set('cg-' + k, LV[k] ? '1' : '0'); flips(); };
}

function helpSheet(k) {
  if (k === 'brew') {
    const esp = appState.method === 'espresso';
    openSheet(`<div class="sh-title">${esp ? 'What the X-Ray shows' : 'The timer'}</div><div class="gd-legend dark">${legendRows(LEGEND[esp ? 'espresso' : 'brew'])}</div>
      <div class="gd-real"><b>Good to know</b>${esp ? 'Point the phone at Plate X-Ray and a see-through machine stands on it. There is no machine here, so the shot is simulated from your setup.' : 'The timer follows the recipe. Pour along with your own kettle and scale.'}</div>`);
    return;
  }
  const [t, points] = HELP[k === 'grind' && appState.method !== 'espresso' ? 'pourover' : k];
  openSheet(`<div class="sh-title">${t}</div><ul class="sh-points">${points.map((x) => `<li>${termify(x).replace(/^(\w+): /, '<b>$1:</b> ')}</li>`).join('')}</ul><button type="button" class="btn-primary" data-close="1">Got it</button>`);
}

function initHelp() {
  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-term],[data-glossary],[data-help],[data-close]');
    if (!t) return;
    e.stopPropagation();
    e.preventDefault();
    const d = t.dataset;
    if (d.term) termSheet(d.term);
    else if (d.glossary) glossarySheet();
    else if (d.help) helpSheet(d.help);
    else closeSheet();
  }, true);
}

const TASTE = { sour: { x: -0.7, y: 0 }, ok: { x: 0, y: 0 }, bitter: { x: 0.7, y: 0 } };
const CP = { cx: 150, cy: 104, rx: 124, ry: 84 };
const cpAt = (t) => [CP.cx + t.x * CP.rx, CP.cy - t.y * CP.ry];

function drawCompass(host, rec, onTaste) {
  if (!host.firstChild) {
    host.innerHTML = `<svg class="cp edit" viewBox="0 0 300 208">
      <defs>
        <linearGradient id="cpH"><stop offset="0" stop-color="#F4E2A6"/><stop offset=".5" stop-color="#FBF8F2"/><stop offset="1" stop-color="#DCC3AC"/></linearGradient>
        <linearGradient id="cpV" x2="0" y2="1"><stop offset="0" stop-color="#2B1B12" stop-opacity=".1"/><stop offset=".5" stop-color="#2B1B12" stop-opacity="0"/><stop offset="1" stop-color="#FFFFFF" stop-opacity=".45"/></linearGradient>
      </defs>
      <rect x="0" y="0" width="300" height="208" rx="12" fill="url(#cpH)"/>
      <rect x="0" y="0" width="300" height="208" rx="12" fill="url(#cpV)"/>
      <line class="cp-axis" x1="${CP.cx}" x2="${CP.cx}" y1="14" y2="194"/><line class="cp-axis" x1="14" x2="286" y1="${CP.cy}" y2="${CP.cy}"/>
      <ellipse class="cp-ok" cx="${CP.cx}" cy="${CP.cy}" rx="30" ry="22"/>
      <text class="cp-lab" x="12" y="${CP.cy - 6}" text-anchor="start">Sour</text>
      <text class="cp-lab" x="288" y="${CP.cy - 6}" text-anchor="end">Bitter</text>
      <text class="cp-lab" x="${CP.cx}" y="13" text-anchor="middle">Strong</text>
      <text class="cp-lab" x="${CP.cx}" y="203" text-anchor="middle">Weak</text>
      <text class="cp-bal" x="${CP.cx}" y="${CP.cy + 36}">Just right</text>
      <path class="cp-fix" d="M${CP.cx} ${CP.cy}L${CP.cx} ${CP.cy}"/>
      <g class="cp-ghost"><circle r="8"/><text y="-13">Shot suggests</text></g>
      <g class="cp-dot"><circle class="cp-halo" r="17"/><circle class="cp-core" r="9"/></g>
    </svg>`;
    const svg = host.querySelector('svg'), pick = (e) => {
      const r = svg.getBoundingClientRect();
      const x = clamp(((e.clientX - r.left) / r.width * 300 - CP.cx) / CP.rx, -1);
      const y = clamp((CP.cy - (e.clientY - r.top) / r.height * 208) / CP.ry, -1);
      host._rec.taste = { x: +x.toFixed(2), y: +y.toFixed(2) };
      drawCompass(host, host._rec);
    };
    svg.addEventListener('pointerdown', (e) => { svg.setPointerCapture(e.pointerId); pick(e); requestAnimationFrame(() => svg.classList.add('drag')); });
    svg.addEventListener('pointermove', (e) => { if (svg.hasPointerCapture(e.pointerId)) pick(e); });
    svg.addEventListener('pointerup', () => { buzz('select'); svg.classList.remove('drag'); host._on(); });
  }
  host._on = onTaste || host._on;
  host._rec = rec;
  const pr = CG.Taste.predict(rec), ghost = rec.method === 'espresso', t = rec.taste || pr;
  const [gx, gy] = cpAt(pr), [dx, dy] = cpAt(t);
  const g = host.querySelector('.cp-ghost'), d = host.querySelector('.cp-dot'), fix = host.querySelector('.cp-fix');
  g.style.transform = `translate(${gx}px, ${gy}px)`;
  g.style.opacity = ghost && rec.taste && Math.hypot(rec.taste.x - pr.x, rec.taste.y - pr.y) > 0.15 ? 1 : 0;
  d.style.transform = `translate(${dx}px, ${dy}px)`;
  d.classList.toggle('unset', !rec.taste);
  fix.style.d = `path("M${CP.cx} ${CP.cy}L${dx.toFixed(1)} ${dy.toFixed(1)}")`;
  fix.style.opacity = rec.taste ? 1 : 0;
}
const tasteKey = (t) => !t ? '' : t.x < -0.3 ? 'sour' : t.x > 0.3 ? 'bitter' : 'ok';

const FLOWS = { coffee: [['grind', 'Set up'], ['brew', 'Brew'], ['review', 'Result']], art: [['pick', 'Pattern'], ['pour', 'Pour'], ['art', 'Result']] };
const FLOW_OF = { grind: 'coffee', brew: 'coffee', review: 'coffee', pick: 'art', pour: 'art', art: 'art' };

function renderCrumbs(name) {
  const f = FLOW_OF[name], el = document.querySelector(`[data-screen="${name}"] .crumbs`);
  if (!f || !el) return;
  const steps = FLOWS[f].map(([k, t]) => [k, k === 'pick' && name !== 'pick' ? LV_PATS[LV.key].name : t]), i = steps.findIndex((x) => x[0] === name), lead = f === 'coffee' ? methodName(appState.method) : 'LiveARt';
  el.innerHTML = '<button type="button" data-crumb="home" aria-label="Home"><i class="fa-solid fa-house"></i></button><b>' + esc(lead) + '</b>'
    + steps.map(([k, t], j) => `<button type="button" data-crumb="${k}" class="${j < i ? 'done' : j === i ? 'on' : ''}"${j >= i ? ' disabled' : ''}>${t}</button>`).join('');
}

const RV_MAIN = ['Next: how did it taste?', 'Next: what to change', 'Try again'];

function rvLabel() {
  const a = RV.rec.advice;
  $('rvApply').textContent = RV.pane < 2 ? RV_MAIN[RV.pane] : a.field && a.field !== 'note' ? 'Try again with this change' : 'Brew it again';
}

function rvPane(i) {
  RV.pane = i;
  document.querySelectorAll('[data-screen=review] .rv-pane').forEach((el) => el.classList.toggle('on', +el.dataset.pane === i));
  $('rvTabs').querySelectorAll('[data-pane]').forEach((b) => b.classList.toggle('on', +b.dataset.pane === i));
  $('rvPill').style.transform = `translateX(${i * 100}%)`;
  rvLabel();
  $('rvDone').classList.toggle('hidden', i < 2);
  document.querySelector('[data-screen=review]').scrollTop = 0;
}

function rvUpdate() {
  const rec = RV.rec;
  rec.verdict = CG.Verdict.of(rec);
  rec.advice = CG.Advice.next(rec);
  drawVerdict(document.querySelector('[data-verdict=rv]'), rec);
  drawCompass(document.querySelector('[data-compass=rv]'), rec, rvUpdate);
  $('rvTasteLab').textContent = rec.taste ? CG.Taste.label(rec.taste) : 'Drag the dot';
  const pr = CG.Taste.predict(rec);
  if (rec.taste && (rec.method !== 'espresso' || Math.hypot(rec.taste.x - pr.x, rec.taste.y - pr.y) > 0.15)) $('rvTasteHint').textContent = 'You put it at ' + CG.Taste.label(rec.taste).toLowerCase() + '. The change for next time follows your answer.';
  drawAdvice(rec);
  if (RV.pane != null) rvLabel();
  CG.Store.add(JSON.parse(JSON.stringify(Object.assign({}, rec, { advice: Object.assign({}, rec.advice, { predicted: null }) }))));
}

function renderReview(elapsedSec) {
  const g = CG.Store.gear(), method = appState.method || 'pourover', m = methodOf(method);
  let rec;
  if (method === 'espresso') {
    const r = appState.lastEspressoResult || CG.Shot.result(prepState());
    rec = { prep: r.prep, dose: r.prep.dose, target: r.prep.dose * 2, time: +r.timeSec.toFixed(1), yield: r.weightG, model: r.model, temp: g.temp };
  } else {
    const water = parseFloat(m.yield) || null;
    rec = { prep: { grind: appState.grind }, dose: parseFloat(m.dose) || null, target: water, time: Math.round(elapsedSec), yield: water, model: null, temp: parseFloat(m.temp) || g.temp };
  }
  RV.rec = Object.assign({ id: 'b' + Date.now(), at: Date.now(), method, bean: g.bean, roastDays: g.roastDays, grinder: g.grinder, click: g.click, taste: null }, rec);
  const guess = method === 'espresso' ? CG.Taste.predict(RV.rec) : null;
  if (guess) RV.rec.taste = { x: +guess.x.toFixed(2), y: +guess.y.toFixed(2) };
  $('rvTasteHint').textContent = guess ? 'The dot starts where the shot says: ' + CG.Taste.label(guess).toLowerCase() + '. Drag it if yours tasted different.' : 'Taste it, then drag the dot to where it landed.';
  document.querySelector('[data-screen=review]').scrollTop = 0;
  drawReplay(document.querySelector('[data-replay=rv]'), RV.rec);
  rvUpdate();
  rvPane(0);
  renderHome();
  buzz(RV.rec.verdict.kind === 'ok' ? 'success' : 'warn', true);
}

function initReview() {
  $('rvTabs').addEventListener('click', (e) => { const b = e.target.closest('[data-pane]'); if (b) rvPane(+b.dataset.pane); });
  $('rvApply').addEventListener('click', () => (RV.pane < 2 ? rvPane(RV.pane + 1) : applyAdvice(RV.rec, 'Change set.')));
  document.addEventListener('click', (e) => { const b = e.target.closest('[data-crumb]'); if (b && !b.disabled) go(b.dataset.crumb); });
  $('rvDone').addEventListener('click', () => go('home'));
  ['hsList', 'hsChart'].forEach((id) => $(id).addEventListener('click', (e) => {
    const c = e.target.closest('[data-id]');
    if (c) openBrew(c.dataset.id);
  }));
  twoTap($('bdDelete'), 'Tap again to delete', () => { CG.Store.remove(BD.id); renderHome(); back(); });
  $('bdAgain').addEventListener('click', () => {
    const r = CG.Store.get(BD.id);
    repeatRecipe(r, 'Loaded the recipe from ' + fmtDay(r.at) + '.');
  });
  $('bdApply').addEventListener('click', () => applyAdvice(CG.Store.get(BD.id)));
}

function renderHistory() {
  const all = CG.Store.all(), shots = all.filter((r) => r.method === 'espresso').slice(0, 10).reverse(), n = shots.length;
  const x = (i) => n < 2 ? 160 : 26 + 280 * i / (n - 1), y = (t) => 112 - 100 * (clamp(t, 15, 55) - 15) / 40;
  const d = shots.map((r, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(r.time).toFixed(1)).join('');
  const last = shots[n - 1];
  $('hsTrendHint').textContent = n ? 'Last ' + n + ' shots' : '';
  $('hsChart').innerHTML = `
    <rect class="hs-band" x="18" y="${y(CG.SHOT.targetHi)}" width="296" height="${y(CG.SHOT.targetLo) - y(CG.SHOT.targetHi)}"/>
    <text class="hs-ax" x="2" y="${y(CG.SHOT.targetHi) + 3}">${CG.SHOT.targetHi}</text><text class="hs-ax" x="2" y="${y(CG.SHOT.targetLo) + 3}">${CG.SHOT.targetLo}</text>
    <text class="hs-ax" x="2" y="${y(55) + 3}">55</text><text class="hs-ax" x="2" y="${y(15) + 3}">15</text>
    ${n > 1 ? `<path class="hs-line" pathLength="1" d="${d}"/>` : ''}
    ${shots.map((r, i) => `<circle class="hs-dot k-${r.verdict.kind}" data-id="${r.id}" cx="${x(i).toFixed(1)}" cy="${y(r.time).toFixed(1)}" r="${r === last ? 6.5 : 5}" style="animation-delay:${200 + i * 70}ms"/>`).join('')}
    ${last ? `<text class="hs-last" x="${x(n - 1) - 8}" y="${y(last.time) - 11}">${last.time.toFixed(1)} s</text>` : ''}
    ${n ? '' : '<text class="hs-ax" x="160" y="66" text-anchor="middle">No espresso shots yet</text>'}`;
  requestAnimationFrame(() => requestAnimationFrame(() => { const l = $('hsChart').querySelector('.hs-line'); if (l) l.classList.add('on'); }));
  $('hsList').innerHTML = all.length ? all.map((r, i) => `
    <button type="button" class="hs-card" data-id="${r.id}" style="--i:${i}">
      <div class="hs-top"><span class="hs-m">${mi(r.method)}${methodName(r.method)}</span><span class="hs-d">${fmtDay(r.at)}</span></div>
      <div class="hs-mid">${sparkline(r)}<div class="hs-nums"><b>${timeText(r)}</b><span>${r.method === 'espresso' ? shotLine(r) : (r.dose ? r.dose + ' g coffee' : '') + (r.yield ? ' · ' + r.yield + ' g water' : '')}</span></div></div>
      <div class="hs-bot"><span class="rv-chip k-${r.verdict.kind}">${chipText(r)}</span>${r.taste ? '<span class="hs-bean">Tasted ' + CG.Taste.label(r.taste).toLowerCase() + '</span>' : ''}</div>
    </button>`).join('') : '<div class="hs-empty">No brews yet. Finish a brew and it shows up here.</div>';
}

function openBrew(id) {
  const r = CG.Store.get(id);
  if (!r) return;
  BD.id = id;
  $('bdTitle').textContent = methodName(r.method);
  go('brewdetail');
  document.querySelector('[data-screen=brewdetail]').scrollTop = 0;
  drawReplay(document.querySelector('[data-replay=bd]'), r);
  drawVerdict(document.querySelector('[data-verdict=bd]'), r);
  $('bdWhen').textContent = fmtDay(r.at);
  const p = r.prep, rows = r.method === 'espresso'
    ? [['Grind', fieldText('grind', p.grind)], ['Dose', r.dose + ' g'], ['In the cup', r.yield + ' g of ' + r.target + ' g'], ['WDT', fieldText('wdt', p.wdt)], ['Tamp', TAMP_NAME[p.tamp] + ', ' + fieldText('level', p.level).toLowerCase()]]
    : [['Grind', fieldText('grind', p.grind)], ['Coffee', r.dose ? r.dose + ' g' : '–'], ['Water', r.yield ? r.yield + ' g' : '–']];
  if (r.taste) rows.push(['Taste', CG.Taste.label(r.taste)]);
  $('bdRecipe').innerHTML = rows.map(([k, v]) => `<div class="bd-row"><span>${k}</span><b>${esc(v)}</b></div>`).join('');
  const a = r.advice;
  $('bdAdvice').textContent = a.title;
  $('bdWhy').innerHTML = whyHtml(r, a);
  $('bdApply').classList.toggle('hidden', !a.field || a.field === 'note');
}

function brewNow() {
  go('brew');
}

const MILK = { N: 120, R: 46, area: 34, r0: 2.2, drag: 0.9, dragR: 5, vmax: 70, sharp: 7, mixK: 0.012, mixR: 13, punch: 0.6 };
const floatOf = (h) => clamp((38 - h) / 22);

function milkNew(cap) {
  const n = MILK.N * MILK.N;
  return { foam: new Float32Array(n), tmp: new Float32Array(n), age: new Float32Array(n), atmp: new Float32Array(n), mix: new Float32Array(n), vol: 0, cap, prev: null, jv: [0, 0], seg: 0, off: 9, dir: 0 };
}

function milkSample(f, x, y) {
  const N = MILK.N;
  x = clamp(x, 0, N - 1.001);
  y = clamp(y, 0, N - 1.001);
  const i = x | 0, j = y | 0, a = x - i, b = y - j, c = j * N + i;
  return f[c] * (1 - a) * (1 - b) + f[c + 1] * a * (1 - b) + f[c + N] * (1 - a) * b + f[c + N + 1] * a * b;
}

function milkSampleW(L, f, x, y) {
  const N = MILK.N;
  x = clamp(x, 0, N - 1.001);
  y = clamp(y, 0, N - 1.001);
  const i = x | 0, j = y | 0, a = x - i, b = y - j, c = j * N + i;
  const w0 = (1 - a) * (1 - b) * f[c], w1 = a * (1 - b) * f[c + 1], w2 = (1 - a) * b * f[c + N], w3 = a * b * f[c + N + 1], W = w0 + w1 + w2 + w3;
  return W > 1e-4 ? (w0 * L[c] + w1 * L[c + 1] + w2 * L[c + N] + w3 * L[c + N + 1]) / W : L[c];
}

function milkSharpen(m, dt) {
  const F = m.foam, L = m.age, k = MILK.sharp * dt;
  for (let c = 0; c < F.length; c++) {
    const v = F[c];
    if (v > 0.01 && v < 0.99) F[c] = clamp(v + k * v * (1 - v) * (v - 0.5) * 4);
    if (v > 0.2) L[c] += (Math.round(L[c]) - L[c]) * k;
  }
}

function milkStep(m, inp, dt) {
  const N = MILK.N, k = 100 / N, f = m.foam, t = m.tmp;
  const on = inp && inp.flow > 0.3 && m.vol < m.cap;
  if (inp && m.prev) {
    const jx = (inp.x - m.prev[0]) / dt, jy = (inp.y - m.prev[1]) / dt, sp = Math.hypot(jx, jy), c = sp > MILK.vmax ? MILK.vmax / sp : 1;
    m.jv[0] += (jx * c - m.jv[0]) * 0.5;
    m.jv[1] += (jy * c - m.jv[1]) * 0.5;
  }
  m.prev = inp ? [inp.x, inp.y] : null;
  if (!on) { m.off += dt; milkSharpen(m, dt); return; }
  const s = floatOf(inp.h), q = inp.flow, Q = s * q * MILK.area, px = inp.x, py = inp.y;
  const dir = Math.abs(m.jv[0]) > 8 ? Math.sign(m.jv[0]) : m.dir;
  if (s > 0.3 && q > 1) {
    if (m.off > 0.25 || (dir > 0 && m.dir < 0)) m.seg += 1;
    m.off = 0;
  } else m.off += dt;
  m.dir = dir;
  m.vol += q * dt;
  const r0 = MILK.r0 + q * 0.12;
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const x = (i + 0.5) * k, y = (j + 0.5) * k, dx = x - px, dy = y - py, d = Math.hypot(dx, dy) || 1e-6;
      const vr = d > r0 ? Q / (2 * Math.PI * d) : Q * d / (2 * Math.PI * r0 * r0);
      const g = Math.exp(-(d * d) / (2 * MILK.dragR * MILK.dragR)) * (0.25 + s);
      let vx = vr * dx / d + MILK.drag * m.jv[0] * g, vy = vr * dy / d + MILK.drag * m.jv[1] * g;
      const rc = Math.hypot(x - 50, y - 50);
      if (rc > MILK.R - 1) { const out = (vx * (x - 50) + vy * (y - 50)) / rc; if (out > 0) { vx -= out * (x - 50) / rc; vy -= out * (y - 50) / rc; } }
      const sx = (x - vx * dt) / k - 0.5, sy = (y - vy * dt) / k - 0.5;
      t[j * N + i] = milkSample(f, sx, sy);
      m.atmp[j * N + i] = milkSampleW(m.age, f, sx, sy);
    }
  }
  m.foam = t;
  m.tmp = f;
  [m.age, m.atmp] = [m.atmp, m.age];
  const F = m.foam, rin = r0 * 0.9, mixR2 = 2 * MILK.mixR * MILK.mixR;
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const x = (i + 0.5) * k, y = (j + 0.5) * k, d2 = (x - px) ** 2 + (y - py) ** 2, c = j * N + i;
      if (s > 0.02) {
        const add = s * Math.exp(-d2 / (2 * rin * rin)) * clamp(q / 3);
        if (add > 0.5) m.age[c] = m.seg;
        F[c] = Math.max(F[c], add);
      }
      if (s < 0.98) {
        F[c] *= 1 - (1 - s) * MILK.punch * q * dt * Math.exp(-d2 / 8);
        m.mix[c] = Math.min(1, m.mix[c] + (1 - s) * q * dt * MILK.mixK * Math.exp(-d2 / mixR2));
      }
    }
  }
  milkSharpen(m, dt);
}

const CREMA = { tex: null };

function cremaTex() {
  if (CREMA.tex) return CREMA.tex;
  const N = MILK.N, t = new Float32Array(N * N);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const r = Math.hypot(i - N / 2, j - N / 2) / (N / 2);
    t[j * N + i] = 0.12 * Math.sin(i * 0.9 + Math.sin(j * 0.37) * 3) * Math.sin(j * 0.7) + 0.35 * r * r;
  }
  return (CREMA.tex = t);
}

function milkDraw(cv, m) {
  const N = MILK.N, ctx = cv.getContext('2d'), img = ctx.createImageData(N, N), d = img.data, tex = cremaTex(), F = m.foam, A = m.age, k = 100 / N;
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const c = j * N + i, o = c * 4, x = (i + 0.5) * k - 50, y = (j + 0.5) * k - 50;
      const edge = clamp((MILK.R - Math.hypot(x, y)) / k + 0.5);
      if (!edge) { d[o + 3] = 0; continue; }
      let a = clamp((F[c] - 0.36) / 0.28);
      a = a * a * (3 - 2 * a);
      const mx = m.mix[c], tx = tex[c];
      const br = 88 + 80 * mx + 30 * tx, bg = 50 + 62 * mx + 18 * tx, bb = 27 + 39 * mx + 10 * tx;
      const gx = i < N - 1 ? Math.abs(A[c + 1] - A[c]) : 0, gy = j < N - 1 ? Math.abs(A[c + N] - A[c]) : 0, ln = clamp((Math.max(gx, gy) - 0.15) / 0.3) * a * 0.55;
      d[o] = (br * (1 - a) + 246 * a) * (1 - ln) + br * ln;
      d[o + 1] = (bg * (1 - a) + 239 * a) * (1 - ln) + bg * ln;
      d[o + 2] = (bb * (1 - a) + 226 * a) * (1 - ln) + bb * ln;
      d[o + 3] = 255 * edge;
    }
  }
  if (cv.width !== N) { cv.width = N; cv.height = N; }
  ctx.putImageData(img, 0, 0);
}

const LV_PATS = {
  free: { name: 'Free pour', skill: 'Get the feel', blurb: 'No pattern to follow. Tilt the ring to pour, lift it to sink the milk, bring it close to draw.', demo: 'heart' },
  heart: { name: 'Heart', skill: 'High, then close', blurb: 'One pour, then one line through the middle. Every other pattern starts here.' },
  tulip: { name: 'Tulip', skill: 'Lift to stop', blurb: 'Three small pours stacked up. You learn when to stop and start.' },
  rosetta: { name: 'Rosetta', skill: 'Rock side to side', blurb: 'Rock the ring while you move back. Keep the rhythm even.' },
};
const LV_RING_MM = { [CG.TARGETS.cupring]: 150, [CG.TARGETS.cupring8]: 133.3 };
const LV = {
  key: 'free', input: 'ring', flipX: ls.get('cg-flipX') === '1', flipY: ls.get('cg-flipY') === '1', debug: false, focus: null, taps: 0,
  m: null, inp: null, raf: 0, last: 0, p: 0, t: 0, cal: null, steady: 0, seenAt: 0, startAt: 0, poured: false, done: false, log: [], camOn: false, finger: null,
  demo: { m: null, raf: 0, t: 0, key: null }, goals: {}, result: null,
};
const pourCamera = createCameraController();

const patPt = (g) => ({ x: g.x, y: 100 - g.y });
const capOf = (key) => key === 'free' ? 190 : CG.PATTERNS[key].steps.reduce((a, s) => a + (s.f[0] + s.f[1]) / 2 * (s.t1 - s.t0), 0) * 1.25;

function scriptInput(key, t) {
  const g = CG.target(key, t), p = patPt(g);
  return { x: p.x, y: p.y, h: g.heightMm, flow: g.flow };
}

function lvGoal(key, slice) {
  if (key === 'free') return null;
  const g = LV.goals[key] || (LV.goals[key] = { m: milkNew(1e9), t: 0 }), dur = CG.PATTERNS[key].dur;
  for (let n = 0; g.t < dur && (!slice || n < slice); n++, g.t += 1 / 30) milkStep(g.m, scriptInput(key, g.t), 1 / 30);
  if (slice && g.t < dur) setTimeout(() => lvGoal(key, slice), 30);
  return g.m;
}

function renderPick() {
  $('lvPatterns').innerHTML = Object.entries(LV_PATS).map(([k, p]) => `<button type="button" class="lv-pat${k === LV.key ? ' on' : ''}" data-pat="${k}"><b>${p.name}</b><span>${p.skill}</span></button>`).join('');
  pickPattern(LV.key);
}

function pickPattern(key) {
  LV.key = key;
  LV.focus = null;
  const p = LV_PATS[key], free = key === 'free';
  document.querySelectorAll('#lvPatterns [data-pat]').forEach((b) => b.classList.toggle('on', b.dataset.pat === key));
  $('lvWhy').textContent = p.blurb;
  $('lvGo').textContent = free ? 'Start pouring' : 'Pour the ' + p.name.toLowerCase();
  renderCrumbs('pick');
  if (!free && !LV.goals[key]) lvGoal(key, 6);
  playDemo();
}

function playDemo() {
  stopDemo();
  const key = LV_PATS[LV.key].demo || LV.key, dur = CG.PATTERNS[key].dur, D = LV.demo;
  Object.assign(D, { m: milkNew(1e9), t: 0, key, last: performance.now() });
  $('lvModelHint').textContent = '';
  const frame = (now) => {
    const dt = Math.min(0.05, (now - D.last) / 1000);
    D.last = now;
    if (D.t < dur) {
      const inp = scriptInput(key, D.t);
      milkStep(D.m, inp, dt);
      D.t += dt;
      milkDraw($('lvDemoCanvas'), D.m);
      demoRing(inp, CG.target(key, D.t));
    } else {
      $('lvDemoRing').classList.add('hidden');
      $('lvModelHint').textContent = 'Tap to watch again';
      return;
    }
    D.raf = requestAnimationFrame(frame);
  };
  D.raf = requestAnimationFrame(frame);
}

function demoRing(inp, g) {
  const el = $('lvDemoRing'), r = 5 + inp.h * 0.18;
  el.classList.remove('hidden');
  el.setAttribute('cx', inp.x.toFixed(1));
  el.setAttribute('cy', inp.y.toFixed(1));
  el.setAttribute('r', r.toFixed(1));
  el.classList.toggle('pouring', inp.flow > 1);
  $('lvDemoCue').textContent = g.step.cue;
}

function stopDemo() {
  cancelAnimationFrame(LV.demo.raf);
}

function initPick() {
  $('lvPatterns').addEventListener('click', (e) => { const b = e.target.closest('[data-pat]'); if (b) pickPattern(b.dataset.pat); });
  $('lvModelCard').addEventListener('click', playDemo);
  $('lvGo').addEventListener('click', () => go('pour'));
  $('artDone').addEventListener('click', () => go('home'));
  $('poFinger').addEventListener('click', () => { LV.input = 'finger'; startPour(); });
  const cup = $('poCup'), at = (e) => { const r = cup.getBoundingClientRect(); return { x: (e.clientX - r.left) / r.width * 100, y: (e.clientY - r.top) / r.height * 100 }; };
  cup.addEventListener('pointerdown', (e) => { if (LV.input !== 'finger') return; cup.setPointerCapture(e.pointerId); LV.finger = at(e); });
  cup.addEventListener('pointermove', (e) => { if (LV.finger) LV.finger = at(e); });
  ['pointerup', 'pointercancel'].forEach((n) => cup.addEventListener(n, () => { LV.finger = null; }));
}

function startPour() {
  stopPour();
  const key = LV.key, free = key === 'free';
  Object.assign(LV, { m: milkNew(capOf(key)), inp: null, p: 0, t: 0, cal: null, steady: 0, seenAt: 0, startAt: 0, lostAt: 0, ringPrev: null, poured: false, done: false, log: [], finger: null, taps: 0 });
  $('poTitle').textContent = LV_PATS[key].name;
  $('po').className = 'po po-' + LV.input + (free ? ' free' : '');
  $('poRoute').setAttribute('d', free ? '' : routeD(key, 0, CG.PATTERNS[key].dur));
  $('poSteps').innerHTML = free ? '' : CG.PATTERNS[key].steps.map(() => '<i></i>').join('');
  milkDraw($('poCanvas'), LV.m);
  pourWait(LV.input === 'finger' ? ['Pour with your finger', 'Touch the cup and drag. Lift your finger to stop.'] : LV.input === 'demo' ? ['Demo pour', 'The pour plays by itself.'] : ['Hold the ring above your phone', 'Engraved side down, about a hand’s length above the middle of the screen.']);
  tlog('pour-start', { key, input: LV.input });
  if (LV.input === 'ring') ringStart();
  LV.last = performance.now();
  LV.raf = requestAnimationFrame(pourFrame);
}

function pourWait(t) {
  $('po').classList.toggle('waiting', !!t);
  if (!t) return;
  $('poWaitHead').textContent = t[0];
  $('poWaitText').textContent = t[1];
}

function ringStart() {
  const run = (LV.camRun = (LV.camRun || 0) + 1);
  pourCamera.start($('pourVideo'), 'user').then((r) => {
    if (run !== LV.camRun || currentScreen !== 'pour') return;
    if (!r.granted) { $('po').classList.add('nocam'); pourWait(['The camera is off', 'Allow the camera, or pour with your finger.']); return; }
    CG.Tracker.start($('pourVideo'), [CG.TARGETS.cupring, CG.TARGETS.cupring8], () => { LV.seenAt = performance.now(); }).then((ok) => {
      if (!ok && run === LV.camRun) { $('po').classList.add('nocam'); pourWait(['Tracking did not start', CG.Tracker.why(true) + ' You can pour with your finger.']); }
    });
  });
}

function ringInput(now) {
  const ring = CG.Tracker.ring(LV_RING_MM), seen = ring && now - LV.seenAt < 350;
  if (!seen) {
    LV.steady = 0;
    return LV.inp ? Object.assign({}, LV.inp, { flow: 0, seen: false }) : null;
  }
  if (!LV.cal) {
    const prev = LV.ringPrev, still = prev && Math.hypot(ring.x - prev.x, ring.y - prev.y, ring.d - prev.d) < 6;
    LV.ringPrev = ring;
    LV.steady = still ? LV.steady + 1 : 0;
    pourWait(['Hold still', 'Finding the middle of your cup.']);
    if (LV.steady < 12) return null;
    LV.cal = ring;
    pourWait(null);
    buzz('confirm', true);
    tlog('ring-cal', { d: Math.round(ring.d) });
  }
  const c = LV.cal, K = 100 / 70, sx = LV.flipX ? 1 : -1, sy = LV.flipY ? 1 : -1;
  const tilt = Math.acos(clamp(Math.abs(ring.n[0] * c.n[0] + ring.n[1] * c.n[1] + ring.n[2] * c.n[2]))) * 180 / Math.PI;
  return {
    x: clamp(50 + sx * (ring.x - c.x) * K, 2, 98), y: clamp(50 + sy * (ring.y - c.y) * K, 2, 98),
    h: clamp((ring.d / c.d - 0.85) / 0.75) * 80, flow: clamp((tilt - 6) / 24) * 12, seen: true, raw: { d: ring.d, tilt },
  };
}

function fingerInput() {
  const f = LV.finger, g = LV.key === 'free' ? null : CG.target(LV.key, LV.p);
  if (!f) return LV.inp ? Object.assign({}, LV.inp, { flow: 0, seen: false }) : null;
  pourWait(null);
  return { x: f.x, y: f.y, h: g ? g.heightMm : 12, flow: g ? Math.max(4, g.flow) : 9, seen: true };
}

function smooth(a, b, k) {
  if (!a) return b;
  return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, h: a.h + (b.h - a.h) * k * 0.6, flow: a.flow + (b.flow - a.flow) * k * 0.6, seen: b.seen, raw: b.raw };
}

function pourFrame(now) {
  const dt = Math.min(0.05, (now - LV.last) / 1000), key = LV.key, free = key === 'free';
  LV.last = now;
  LV.t += dt;
  const raw = LV.input === 'demo' ? scriptInput(free ? 'heart' : key, free ? LV.t : Math.min(CG.PATTERNS[key].dur, LV.p + 0.06)) : LV.input === 'finger' ? fingerInput() : ringInput(now);
  if (LV.input === 'demo') { pourWait(null); raw.seen = true; }
  LV.inp = raw ? (LV.input === 'ring' ? smooth(LV.inp, raw, 0.5) : raw) : null;
  const inp = LV.inp, g = free ? null : CG.target(key, LV.p);
  if (inp) {
    milkStep(LV.m, inp, dt);
    if (inp.flow > 1 && !LV.poured) { LV.poured = true; LV.startAt = LV.t; }
    if (g) LV.p = traceStep(inp, dt);
    LV.log.push({ t: LV.t, p: LV.p, s: g ? g.stepIndex : -1, x: inp.x, y: inp.y, h: inp.h, f: inp.flow, seen: inp.seen });
  }
  milkDraw($('poCanvas'), LV.m);
  pourHud(inp, free ? null : CG.target(key, LV.p));
  if (inp && inp.seen) LV.lostAt = 0;
  else if (LV.poured && !LV.lostAt) LV.lostAt = LV.t;
  const lost = LV.poured && LV.lostAt && LV.t - LV.lostAt > 2.5;
  if (!LV.done && (lost || LV.m.vol >= LV.m.cap || (!free && LV.p >= CG.PATTERNS[key].dur - 0.01))) {
    LV.done = true;
    setTimeout(() => { if (currentScreen === 'pour') finishPour(); }, 700);
  }
  LV.raf = requestAnimationFrame(pourFrame);
}

function traceStep(inp, dt) {
  const okAt = (t) => {
    const q = CG.target(LV.key, t), c = patPt(spineAt(LV.key, t));
    return q.step.f[1] > 1 ? inp.flow > 1 && Math.hypot(inp.x - c.x, inp.y - c.y) < (q.hz ? q.amp + 12 : 12) : inp.flow < 2.5;
  };
  return inp.seen && (okAt(LV.p) || okAt(LV.p + 0.25)) ? Math.min(CG.PATTERNS[LV.key].dur, LV.p + dt) : LV.p;
}

function routeD(key, a, b) {
  const pts = [];
  for (let t = a; t <= b; t += 0.05) { const q = patPt(spineAt(key, t)); pts.push(q.x.toFixed(1) + ' ' + q.y.toFixed(1)); }
  return pts.length ? 'M' + pts.join(' L') : '';
}

function pourHud(inp, g) {
  const spout = $('poSpout');
  spout.classList.toggle('hidden', !inp);
  if (inp) {
    spout.setAttribute('cx', inp.x.toFixed(1));
    spout.setAttribute('cy', inp.y.toFixed(1));
    spout.setAttribute('r', (3 + inp.h * 0.12).toFixed(1));
    spout.classList.toggle('pouring', inp.flow > 1);
    spout.classList.toggle('lost', !inp.seen);
  }
  const vol = LV.m.vol / LV.m.cap, a = Math.min(0.999, vol) * 2 * Math.PI;
  $('poFill').setAttribute('d', vol > 0.002 ? `M50 2 A48 48 0 ${a > Math.PI ? 1 : 0} 1 ${(50 + 48 * Math.sin(a)).toFixed(2)} ${(50 - 48 * Math.cos(a)).toFixed(2)}` : '');
  const band = g ? g.step.h : [8, 16], hy = (h) => clamp(1 - h / 80) * 100;
  $('poBand').style.cssText = `top:${hy(band[1] + 4)}%;bottom:${100 - hy(Math.max(0, band[0] - 4))}%`;
  $('poBand').classList.toggle('hidden', !g);
  if (inp) $('poMark').style.top = hy(inp.h) + '%';
  const off = inp && inp.seen && g ? (inp.h > band[1] + 6 ? 'Closer' : inp.h < band[0] - 6 ? 'Higher' : '') : '';
  $('poHeight').dataset.off = off;
  if (g) {
    const tp = patPt(g.hz ? spineAt(LV.key, LV.p) : g), st = g.step, i = g.stepIndex, pat = CG.PATTERNS[LV.key];
    $('poTarget').setAttribute('cx', tp.x.toFixed(1));
    $('poTarget').setAttribute('cy', tp.y.toFixed(1));
    $('poNow').setAttribute('d', routeD(LV.key, st.t0, st.t1));
    $('poStep').textContent = st.label + ' · ' + (i + 1) + ' of ' + pat.steps.length + ' · cup ' + Math.round(Math.min(1, vol) * 100) + '% full';
    $('poCueText').textContent = inp && !inp.seen && LV.input === 'ring' ? 'Hold the ring above the screen' : off || st.cue;
    $('poSteps').querySelectorAll('i').forEach((el, k) => { el.className = k < i ? 'done' : k === i ? 'on' : ''; el.classList.toggle('focus', LV.focus === k); });
    $('poCue').classList.toggle('focus', LV.focus === i);
  } else {
    $('poStep').textContent = LV.poured ? 'Cup ' + Math.round(Math.min(1, vol) * 100) + '% full' : 'Free pour';
    $('poCueText').textContent = !inp ? '' : inp.flow > 1 ? (inp.h > 38 ? 'High: the milk sinks under the coffee' : inp.h < 16 ? 'Close: white spreads on top' : 'Halfway: try higher or closer') : 'Tilt the ring to pour';
  }
  const dbg = LV.debug && inp && inp.raw;
  $('poDebug').textContent = dbg ? `D ${inp.raw.d.toFixed(0)} mm (start ${LV.cal.d.toFixed(0)}) · tilt ${inp.raw.tilt.toFixed(0)}° · x ${inp.x.toFixed(0)} y ${inp.y.toFixed(0)} · flow ${inp.flow.toFixed(1)}` : '';
}

function stopPour() {
  cancelAnimationFrame(LV.raf);
  LV.camRun = (LV.camRun || 0) + 1;
  CG.Tracker.stop();
  pourCamera.stop();
}

function finishPour() {
  const key = LV.key, res = pourTip(key, LV.log);
  LV.result = res;
  const list = [{ key, at: Date.now(), tip: res.code }].concat(ls.json('cg-pours') || []).slice(0, 20);
  ls.set('cg-pours', JSON.stringify(list));
  tlog('pour-end', { key, input: LV.input, secs: +LV.t.toFixed(1), ml: Math.round(LV.m.vol), tip: res.code, taps: LV.taps });
  go('art');
  renderArt();
}

function renderArt() {
  const key = LV.key, res = LV.result, free = key === 'free';
  $('artTitle').textContent = LV_PATS[key].name;
  milkDraw($('artMine'), LV.m);
  $('artGoalFig').classList.toggle('hidden', free);
  $('artCmp').classList.toggle('solo', free);
  if (!free) milkDraw($('artGoal'), lvGoal(key));
  $('artTipHead').textContent = res.ok ? 'Nice' : 'Next time';
  $('artTipStep').textContent = res.step != null ? CG.PATTERNS[key].steps[res.step].label : '';
  $('artTip').textContent = res.head;
  $('artWhy').textContent = res.why;
  $('artAgain').onclick = () => { LV.focus = res.step ?? null; go('pour'); };
  buzz(res.ok ? 'success' : 'tap', true);
}

const PAT_NEXT = { free: 'heart', heart: 'tulip', tulip: 'rosetta' };

function pourTip(key, log) {
  const live = log.filter((s) => s.seen), auto = LV.input !== 'ring';
  if (key === 'free') {
    const pour = live.filter((s) => s.f > 1), hi = pour.filter((s) => s.h > 38).length / (pour.length || 1), lo = pour.filter((s) => s.h < 16).length / (pour.length || 1);
    if (!pour.length) return { code: 'none', head: 'Tilt the ring to pour', why: 'The milk only flows while the ring is tilted, like a jug.' };
    if (auto) return { code: 'free-finger', ok: true, head: 'Now try it with the ring', why: 'A finger always pours close to the cup. With the ring you can start high, so the milk sinks first.', next: 'heart' };
    if (lo > 0.75) return { code: 'free-close', head: 'Start higher next time', why: 'You poured close the whole time, so white covered the top. Every pattern starts high, so the milk sinks first.' };
    if (hi > 0.75) return { code: 'free-high', head: 'Bring the ring closer at the end', why: 'From high up the milk sank and the top stayed brown. Close to the screen, white shows.' };
    return { code: 'free-ok', ok: true, head: 'High, then close. That is how every pattern starts.', why: 'Try the heart next. It adds one line through the middle.', next: 'heart' };
  }
  const steps = CG.PATTERNS[key].steps, found = [];
  steps.forEach((st, i) => {
    const s = live.filter((x) => x.s === i);
    if (s.length < 5) return;
    const pour = st.f[1] > 1, frac = (fn) => s.filter(fn).length / s.length;
    const high = frac((x) => x.h > st.h[1] + 8), low = frac((x) => x.h < st.h[0] - 8);
    if (!auto && st.h[0] < 20 && high > 0.4) found.push({ step: i, w: high, code: 'high', head: 'Come closer during ' + st.label.toLowerCase(), why: 'Close to the screen is where the white shows.' });
    if (!auto && st.h[0] >= 40 && low > 0.4) found.push({ step: i, w: low, code: 'low', head: 'Start higher', why: 'From high up the milk sinks under the coffee first. Close too early and white spreads everywhere.' });
    if (!auto && st.key === 'cut' && low > 0.4) found.push({ step: i, w: low, code: 'cut-low', head: 'Lift a little for the last line', why: 'A lifted, thin stream cuts a clean line.' });
    if (pour && frac((x) => x.f < st.f[0] * 0.5) > 0.4) found.push({ step: i, w: frac((x) => x.f < st.f[0] * 0.5), code: 'flow', head: 'Keep tilting during ' + st.label.toLowerCase(), why: 'The milk stops as soon as the ring is flat.' });
    if (!pour && frac((x) => x.f > 2.5) > 0.5) found.push({ step: i, w: frac((x) => x.f > 2.5), code: 'stop', head: 'Hold the ring flat to stop', why: st.why });
    if (st.hz > 0 && s.length > 20) {
      let turns = 0;
      for (let k = 2; k < s.length; k++) if (Math.sign(s[k].x - s[k - 1].x) !== Math.sign(s[k - 1].x - s[k - 2].x)) turns++;
      const hz = turns / 2 / Math.max(0.5, s[s.length - 1].t - s[0].t), xs = s.map((x) => x.x).sort((a, b) => a - b), amp = (xs[Math.floor(xs.length * 0.9)] - xs[Math.floor(xs.length * 0.1)]) / 2;
      if (amp < 4) found.push({ step: i, w: 0.9, code: 'rock-none', head: 'Rock the ring from side to side', why: 'The swinging is what draws the leaves.' });
      else if (hz < st.hz * 0.6) found.push({ step: i, w: 0.8, code: 'rock-slow', head: 'Rock faster', why: 'About two swings a second makes the leaves.' });
      else if (amp < 8) found.push({ step: i, w: 0.7, code: 'rock-small', head: 'Rock wider', why: 'Small swings give thin, crowded leaves.' });
    }
  });
  found.sort((a, b) => b.w - a.w);
  if (found.length) return found[0];
  const next = PAT_NEXT[key];
  return { code: 'ok', ok: true, head: 'Close to the target', why: next ? 'Try the ' + LV_PATS[next].name.toLowerCase() + ' next. ' + LV_PATS[next].skill + '.' : 'Try it again a little faster.', next };
}

window.addEventListener('resize', fitPhoneToViewport);
fitPhoneToViewport();
initGlasses();
initHome();
initHelp();
initTerms();
initMethod();
initLiveBrew();
initReview();
initPick();
initNav();
initPrep();
updateMethodSelectionUI();
if (CG.Tracker.available()) CG.Tracker.load();
renderHome();
arInit();

const DEEP = { ring: () => openMode('liveart'), plate: () => quickMethod('espresso') };
const deepKey = location.hash.slice(1);
if (DEEP[deepKey]) {
  history.replaceState(null, '', location.pathname + location.search);
  tlog('qr', { prop: deepKey });
  DEEP[deepKey]();
} else openIntro('app');
