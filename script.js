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

const mmss = (sec) => {
  sec = Math.max(0, Math.round(sec));
  return Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0');
};

function segOn(id, attr, val) {
  document.querySelectorAll('#' + id + ' [' + attr + ']').forEach((b) => b.classList.toggle('on', b.getAttribute(attr) === String(val)));
}
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

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
const SEEN = new Set();
const seen = (k) => SEEN.has(k);
const markSeen = (k) => SEEN.add(k);

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

const segRow = (id, opts, on) => `<div class="seg3 sh-seg" id="${id}">${opts.map(([v, t]) => `<button type="button" data-v="${v}" class="${String(v) === String(on) ? 'on' : ''}">${t}</button>`).join('')}</div>`;

const METHOD_DATA = {
  espresso: { key: 'espresso', name: 'Espresso', grind: 'Fine, like powdered sugar', dose: '18 g coffee', yield: '36 g in the cup', temp: '93 °C',
    tips: 'Press the coffee flat and level.',
    phases: [
      { name: 'Pre-infusion', duration: 8, cue: 'Water soaks the coffee gently first.' },
      { name: 'Extraction', duration: 22, cue: 'Espresso runs into the cup.' },
      { name: 'Finish', duration: 5, cue: 'The shot stops. Taste it while it is hot.' },
    ] },
  pourover: { key: 'pourover', name: 'V60', grind: 'Medium-fine, like sea salt', dose: '22 g coffee', yield: '360 g water', temp: '94 °C',
    tips: 'Put the ground coffee in the V60, set it on your cup on a scale, then zero the scale.',
    window: [165, 210],
    phases: [
      { name: 'Bloom', duration: 30, pour: [3, 13, 0, 50], cue: 'Pour gently to wet all the coffee.', wait: 'Stop at 50 g. Pour again in #.' },
      { name: 'Main pour', duration: 90, pour: [0, 90, 50, 360], cue: 'Pour slowly in small circles.' },
      { name: 'Draw-down', duration: 60, open: true, cue: 'Tap Done dripping when the water has drained and the drips slow.' },
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
    tips: 'Put the ground coffee in the Chemex, set it on a scale, then zero the scale.',
    window: [240, 300],
    phases: [
      { name: 'Bloom', duration: 35, pour: [3, 13, 0, 60], cue: 'Pour gently to wet all the coffee.', wait: 'Stop at 60 g. Pour again in #.' },
      { name: 'Main pour', duration: 150, pour: [0, 150, 60, 500], cue: 'Pour slowly in small circles.' },
      { name: 'Draw-down', duration: 70, open: true, cue: 'The thick filter drips slowly. Tap Done dripping when the water has drained.' },
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

CG.Verdict.pourEnd = (method) => methodOf(method).phases.reduce((a, p) => a + (p.open ? 0 : p.duration), 0);

CG.Verdict.of = (r) => {
  if (r.method === 'espresso') return CG.Verdict(r.time, r.model ? r.model.chDmg : 0);
  const w = methodOf(r.method).window;
  if (w) {
    if (r.time < w[0]) return { kind: 'fast', title: Math.round(w[0] - r.time) + ' s too fast', cause: 'The water drained quickly. Expect a light, sour cup.' };
    if (r.time > w[1]) return { kind: 'long', title: Math.round(r.time - w[1]) + ' s too slow', cause: 'The water drained slowly. Expect a heavy, bitter cup.' };
    return { kind: 'ok', title: 'Done in ' + mmss(r.time), cause: 'Inside the ' + mmss(w[0]) + ' to ' + mmss(w[1]) + ' window, so the grind suits this recipe.' };
  }
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
    const w = espresso ? null : methodOf(r.method).window, late = w ? (r.time < w[0] ? -1 : r.time > w[1] ? 1 : 0) : 0;
    const keep = { field: null, title: 'Keep this recipe', why: espresso ? 'The time and the amount were right. Brew it the same way to check it holds.' : late ? 'The grind is already at its limit. Check that your scale kept up with the numbers.' : w && !r.taste ? 'The time was right. Taste it, then brew it the same way to check it holds.' : r.taste ? 'It tasted right. Brew it the same way to check it holds.' : 'No taste picked yet, so there is nothing to change. Brew it the same way.', prep: p, predicted: f0, next: espresso ? r.time : null };
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
    if (late) {
      const g = clamp(p.grind + late, 0, 11);
      if (g !== p.grind) return mk('grind', g, (late < 0 ? 'Grind finer' : 'Grind coarser') + ', setting ' + (g + 1),
        'It finished in ' + mmss(r.time) + (late < 0 ? ', before ' + mmss(w[0]) + '. Finer grounds slow the water down.' : ', after ' + mmss(w[1]) + '. Coarser grounds let the water through faster.'));
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
    if (!S.list) {
      S.list = ls.json(S.key);
      if (Array.isArray(S.list)) S.list.forEach((r) => { if (r.method !== 'espresso' && methodOf(r.method).window) r.verdict = CG.Verdict.of(r); });
    }
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
const FILL = { esp: 0.15, half: 0.5, room: 2.6, r: 13, turn: 2 };
const fillPos = (u, t) => ({ x: 50 + FILL.r * Math.sin(2 * Math.PI * t / FILL.turn), y: 50 + FILL.r * Math.cos(2 * Math.PI * t / FILL.turn) });
const rosettaWiggle = (u, t) => ({
  x: 50 + (25 - 16 * u) * Math.sin(2 * Math.PI * 2.4 * t),
  y: 28 + 46 * u,
});

CG.PATTERNS = {
  heart: {
    name: 'Heart', dur: 11, level: 1,
    blurb: 'One pour, then one line through the middle. Every other pattern starts here.',
    steps: [
      { key: 'fill', label: 'Circle high', t0: 0, t1: 4.0, h: [45, 65], f: [0, 0], hz: 0, pos: fillPos,
        why: 'Pour high and move in circles until the cup is half full. The milk mixes into the espresso and makes an even brown base.' },
      { key: 'bloom', label: 'Hold close',  t0: 4.0, t1: 8.2,  h: [8, 14],  f: [8, 11],  hz: 0, fcue: 'Hold still on the dot',
        pos: () => ({ x: 50, y: 66 }),
        why: 'Bring the jug close to the surface and hold still. A white circle spreads out.' },
      { key: 'cut',   label: 'Pull through',    t0: 8.2, t1: 11,   h: [22, 32], f: [2, 4],   hz: 0, fcue: 'Pull a line through',
        pos: (u) => ({ x: 50, y: 22 + 60 * u }),
        why: 'Lift a little and pull a thin line through the circle, away from you.' },
    ],
  },

  tulip: {
    name: 'Tulip', dur: 13, level: 2,
    blurb: 'Three small pours stacked on top of each other. You learn when to stop and start.',
    steps: [
      { key: 'fill', label: 'Circle high', t0: 0, t1: 3.4, h: [45, 65], f: [0, 0], hz: 0, pos: fillPos,
        why: 'Pour high and move in circles until the cup is half full. The milk mixes into the espresso and makes an even brown base.' },
      { key: 'push1', label: 'Pour close', t0: 3.4,  t1: 5.6,  h: [8, 14],  f: [8, 11], hz: 0, fcue: 'Press on the dot',
        pos: () => ({ x: 50, y: 70 }),
        why: 'Come down close and pour. This first blob is the biggest.' },
      { key: 'stop1', label: 'Lift and stop',   t0: 5.6,  t1: 6.4,  h: [22, 30], f: [0, 1],  hz: 0, fcue: 'Lift your finger', join: true,
        pos: () => ({ x: 50, y: 62 }),
        why: 'Lift the jug and stop pouring. The pause keeps the petals apart.' },
      { key: 'push2', label: 'Pour again', t0: 6.4,  t1: 8.4,  h: [8, 14],  f: [7, 10], hz: 0, fcue: 'Press again on the dot', join: true,
        pos: () => ({ x: 50, y: 56 }),
        why: 'Pour again a little further up the cup. It pushes the first blob forward.' },
      { key: 'stop2', label: 'Lift and stop',   t0: 8.4,  t1: 9.1,  h: [22, 30], f: [0, 1],  hz: 0, fcue: 'Lift your finger', join: true,
        pos: () => ({ x: 50, y: 50 }),
        why: 'Stop again, a bit shorter this time.' },
      { key: 'push3', label: 'Small pour', t0: 9.1,  t1: 10.6, h: [8, 13],  f: [6, 9],  hz: 0, fcue: 'One short press', join: true,
        pos: () => ({ x: 50, y: 42 }),
        why: 'One small last pour near the far edge.' },
      { key: 'cut',   label: 'Pull through',    t0: 10.6, t1: 13,   h: [22, 32], f: [2, 4],  hz: 0, fcue: 'Pull a line through',
        pos: (u) => ({ x: 50, y: 26 + 56 * u }),
        why: 'Draw one line down through all three. That is the stem.' },
    ],
  },

  rosetta: {
    name: 'Rosetta', dur: 14, level: 3,
    blurb: 'Wiggle the jug side to side while you move up the cup. Keep the rhythm even.',
    steps: [
      { key: 'fill', label: 'Circle high', t0: 0, t1: 3.6, h: [45, 65], f: [0, 0], hz: 0, pos: fillPos,
        why: 'Pour high and move in circles until the cup is half full. The milk mixes into the espresso and makes an even brown base.' },
      { key: 'bloom',  label: 'Close and wiggle',  t0: 3.6,  t1: 5.5,  h: [8, 14],  f: [7, 10],  hz: 2.4, fcue: 'Wiggle to the sides',
        pos: (u, t) => ({ x: 50 + 25 * Math.sin(2 * Math.PI * 2.4 * t), y: 28 }),
        why: 'Drop close and start wiggling the jug side to side on the spot.' },
      { key: 'wiggle', label: 'Wiggle up', t0: 5.5,  t1: 10.5, h: [8, 14],  f: [6, 9],   hz: 2.4, fcue: 'Keep wiggling, move up', join: true,
        pos: rosettaWiggle,
        why: 'Keep the same rhythm while you move up the cup, away from you. Let the wiggles get smaller.' },
      { key: 'cap',    label: 'Small pour',    t0: 10.5, t1: 11.5, h: [8, 14],  f: [8, 11],  hz: 0, fcue: 'Stop wiggling, hold on the dot', join: true,
        pos: () => ({ x: 50, y: 76 }),
        why: 'Stop wiggling and pour one small blob at the top.' },
      { key: 'cut',    label: 'Pull through',    t0: 11.5, t1: 14,   h: [22, 32], f: [2, 4],   hz: 0, fcue: 'Pull a line through',
        pos: (u) => ({ x: 50, y: 80 - 64 * u }),
        why: 'Lift up and pull a thin line down through the leaves.' },
    ],
  },
};

Object.values(CG.PATTERNS).forEach((p) => {
  const fill = p.steps[0], draw = p.steps.slice(1).reduce((v, x) => v + (x.f[0] + x.f[1]) / 2 * (x.t1 - x.t0), 0), q = draw * FILL.room * (FILL.half - FILL.esp) / (fill.t1 - fill.t0);
  p.cap = draw * FILL.room;
  fill.f = [q * 0.9, q * 1.1];
});

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

const camOn = (cam, id) => cam.start($(id + 'Video')).then((res) => {
  $(id + 'Video').classList.toggle('hidden', !res.granted);
  $(id + 'Fallback').classList.toggle('hidden', res.granted);
  return res.granted;
});

const KIND_LABEL = { ok: 'On target', fast: 'Ran fast', long: 'Ran long', channel: 'Channeled' };
const KIND_BREW = { ok: 'On time', fast: 'Ran short', long: 'Ran long', channel: 'Channeled' };
const FIELD_NAME = { grind: 'Grind', dose: 'Dose', wdt: 'WDT', tamp: 'Tamp force', level: 'Tamp surface', temp: 'Water temperature' };
const FIELD_STEP = { grind: 'grind', dose: 'dose', wdt: 'wdt', tamp: 'tamp', level: 'tamp' };
const TAMP_NAME = { light: 'Light, 5 kg', ideal: 'Ideal, 15 kg', tight: 'Firm, 30 kg' };
const SIDES = ['left', 'centre', 'right'];
const methodName = (k) => methodOf(k).name;
const chipText = (r) => (r.method === 'espresso' || methodOf(r.method).window ? KIND_LABEL : KIND_BREW)[r.verdict.kind];
const timeText = (r) => r.method === 'espresso' ? r.time.toFixed(1) + ' s' : mmss(r.time);
const replayName = (r) => r.model ? 'Shot replay' : methodOf(r.method).window ? 'Time vs target' : 'Planned vs actual';
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
const mi = (k, c) => k === 'import' ? '<i class="fa-solid fa-file-import' + (c ? ' ' + c : '') + '"></i>' : '<i class="mi' + (c ? ' ' + c : '') + '"><svg><use href="#mi-' + k + '"/></svg></i>';

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
  fill: ['Fill', 'The first pour, high and in circles, until the cup is half full. The milk mixes into the espresso and makes an even brown base to draw on.'],
  bloom: ['Bloom', 'Bringing the jug close so white milk spreads across the top.'],
  wiggle: ['Wiggle', 'Moving the jug quickly to the sides as you pour. It draws the leaves of a rosetta.', 'wiggl(?:e|ing)'],
  cut: ['Cut', 'Lifting the jug and pulling a thin line through the pattern to finish it.'],
};
const GLOSSARY = [['Espresso', ['espresso', 'shot', 'grind', 'dose', 'ratio', 'wdt', 'tamp', 'puck', 'preinfusion', 'extraction', 'channel', 'pressure', 'flow', 'crema']], ['Latte art', ['latteart', 'microfoam', 'fill', 'bloom', 'wiggle', 'cut']]];
const TERM_RE = Object.entries(TERMS).filter(([k]) => k !== 'espresso' && k !== 'shot').map(([k, t]) => [k, new RegExp('\\b(' + (t[2] || t[0]) + ')\\b', 'i')]);

function termify(text, only) {
  return TERM_RE.reduce((html, [k, re]) => (only && !only.includes(k)) || html.includes('data-term="' + k) ? html : html.replace(re, '<span class="term" role="button" tabindex="0" data-term="' + k + '">$1</span>'), text);
}

const swatch = (svg) => '<svg viewBox="0 0 28 28" aria-hidden="true">' + svg + '</svg>';

const legendRows = (rows) => rows.map(([sw, k, v]) => `<div class="gd-row"><i class="gd-sw">${sw}</i><div><b>${k}</b><span>${v}</span></div></div>`).join('');

function termSheet(k) {
  openSheet(`<div class="sh-title">${TERMS[k][0]}</div><p class="sh-def">${TERMS[k][1]}</p><button type="button" class="btn-ghost sh-reset" data-glossary="1">All coffee words</button>`);
}

function glossarySheet() {
  openSheet(`<div class="sh-title">Coffee words</div><div class="sh-scroll">${GLOSSARY.map(([h, keys]) => `<div class="sh-k">${h}</div><dl class="sh-terms">${keys.map((k) => `<dt>${TERMS[k][0]}</dt><dd>${TERMS[k][1]}</dd>`).join('')}</dl>`).join('')}</div>`);
}

const LEGEND = {
  espresso: [
    [swatch('<rect x="11" y="4" width="6" height="20" rx="3" fill="rgba(244,241,236,.2)"/><rect x="11" y="12" width="6" height="12" rx="3" fill="#1D9E75"/>'), 'Pressure', 'How hard the pump pushes, in bar. Aim for about 9.'],
    [swatch('<path d="M14 4v8M14 15v3M14 21v3" stroke="#5FA8CE" stroke-width="3" stroke-linecap="round"/>'), 'Flow', 'How fast espresso drips, in grams a second'],
    [swatch('<path d="M7 9h14l-2 13H9z" fill="#C08552"/>'), 'In the cup', 'Espresso so far. Aim for about twice your dose.'],
    [swatch('<circle cx="14" cy="15" r="8" fill="none" stroke="#F4F1EC" stroke-width="2.2"/><path d="M14 15V10" stroke="#F4F1EC" stroke-width="2.2" stroke-linecap="round"/>'), 'Shot time', 'Most good shots take 25 to 32 seconds'],
    [swatch('<path d="M9 5v18M14 5v18" stroke="#A9713F" stroke-width="2" stroke-linecap="round"/><path d="M19 5v18" stroke="#E0803F" stroke-width="3.6" stroke-linecap="round"/>'), 'Orange stream', 'Water rushing through one side of the coffee'],
  ],
  pour: [
    [swatch('<path d="M8 4 13 24" stroke="#E9C29A" stroke-width="3" stroke-linecap="round"/>'), 'Kettle stream', 'Pour while it shows. It sways to remind you to pour in circles.'],
    [swatch('<text x="14" y="19" text-anchor="middle" font-size="12" font-weight="700" fill="#F4F1EC">g</text>'), 'Scale should read', 'The number climbs with the clock. Keep your scale close to it.'],
    [swatch('<path d="M6 7h16l-6 9h-4z" fill="none" stroke="rgba(244,241,236,.6)" stroke-width="2"/><rect x="9" y="18" width="10" height="7" rx="2" fill="#6B3F1F"/>'), 'Cone and cup', 'Water sits in the cone and drips into the cup below.'],
    [swatch('<path d="M3 14h7M12 14h6M20 14h5" stroke="rgba(244,241,236,.35)" stroke-width="3" stroke-linecap="round"/><path d="M3 14h7" stroke="#1D9E75" stroke-width="3" stroke-linecap="round"/>'), 'Step bar', 'Every step of the recipe in order. It fills as you go.'],
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
    'Every pour starts the same way: fill the cup to half, pouring high in circles.',
    'Each pattern then adds one new hand movement.',
    'Free pour: get used to the ring. Nothing to follow.',
    'Heart: pour high, then come close and hold still.',
    'Tulip: lift the ring to stop, then pour again.',
    'Rosetta: wiggle the ring to the sides.',
    'The small cup plays the pour before you try it.',
  ]],
  pour: ['Pouring with the ring', [
    'Fill first: pour high and move in circles until the coffee reaches the dashed line. That is half full.',
    'Then start on the dot and follow it. It waits for you.',
    'Tilt the ring to pour. Hold it flat to stop.',
    'Lift it high and the milk sinks under the coffee. Bring it close and white shows on top.',
    'Under the cup are two side views. Do this is the right pour. You is your ring as the camera sees it: its tilt, its height and which side it is on.',
    'You turns green when your tilt matches Do this, and gold when it does not. The bar beside the cup is your height: green inside the band, gold outside it.',
    'The camera loses the ring below about 20 cm above the phone, so about 22 cm counts as close.',
    'Arrows to the sides mean wiggle.',
  ]],
  art: ['Your result', [
    'Yours is what you poured. Target is the same pattern poured cleanly.',
    'The tip is the one change that would help most.',
    'Try again marks that part of the pour for you.',
  ]],
};

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

function helpSheet(k) {
  if (k === 'brew') {
    const esp = appState.method === 'espresso', guide = !!methodOf(appState.method).window;
    openSheet(`<div class="sh-title">${esp ? 'What the X-Ray shows' : guide ? 'The pour guide' : 'The timer'}</div><div class="gd-legend dark">${legendRows(LEGEND[esp ? 'espresso' : guide ? 'pour' : 'brew'])}</div>
      <div class="gd-real"><b>Good to know</b>${esp ? 'Point the phone at Plate X-Ray and a see-through machine stands on it. There is no machine here, so the shot is simulated from your setup.' : guide ? 'Zero the scale once the coffee is in the brewer. The clock stops when you tap Done dripping, and that time shows whether the grind was right.' : 'The timer follows the recipe. Pour along with your own kettle and scale.'}</div>`);
    return;
  }
  const [t, points] = HELP[k === 'grind' && appState.method !== 'espresso' ? 'pourover' : k], prop = k === 'pick' ? 'liveart' : k === 'grind' && appState.method === 'espresso' ? 'brew' : '';
  openSheet(`<div class="sh-title">${t}</div><ul class="sh-points">${points.map((x) => `<li>${termify(x).replace(/^(\w+): /, '<b>$1:</b> ')}</li>`).join('')}</ul><button type="button" class="btn-primary" data-close="1">Got it</button>${prop ? `<button type="button" class="btn-ghost sh-reset" data-prop="${prop}">About ${prop === 'liveart' ? 'the Cup Ring' : 'Plate X-Ray'}</button>` : ''}`);
}

function initHelp() {
  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-term],[data-glossary],[data-help],[data-close],[data-prop]');
    if (!t) return;
    e.stopPropagation();
    e.preventDefault();
    const d = t.dataset;
    if (d.term) termSheet(d.term);
    else if (d.glossary) glossarySheet();
    else if (d.help) helpSheet(d.help);
    else if (d.prop) { closeSheet(); openGuide(d.prop, 2, true); }
    else closeSheet();
  }, true);
}

const appState = {
  method: null, lastEspressoResult: null,
  grind: 1, grindFor: null, dose: 18, wdt: true, tamp: 'ideal', level: 'level', step: 'grind', glasses: false,
};

function showScreen(name) {
  document.querySelectorAll('.screen').forEach((s) => {
    const on = s.dataset.screen === name;
    if (on && !s.classList.contains('active')) s.scrollTop = 0;
    s.classList.toggle('active', on);
  });
  syncTabs(name);
  renderCrumbs(name);
  const bar = $('statusBar');
  if (bar) bar.classList.toggle('dark', ['brew', 'pour', 'tutor'].includes(name));
  applyGlasses(name);
}

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

const GUIDE = {
  app: [{
    kicker: 'Common Ground', title: 'Get better at coffee, one try at a time', lede: 'Two things to practise. Both work the same way.', go: 'Start',
    steps: [['shot', 'Try it', 'Brew a coffee, or pour latte art with the ring.'], ['why', 'See why', 'The app shows what happened and why.'], ['change', 'Change one thing', 'Try again with that change already set.']],
    need: '<b>Good to know</b>Tap a word with a dotted line to see what it means. The ? button explains the screen you are on.',
  }],
  brew: [{
    kicker: 'Make a coffee', title: 'See why a coffee runs fast or slow', lede: 'Set up, brew, then see what to change.', go: 'Set up', next: 'Next: Plate X-Ray',
    steps: () => ({
      espresso: [['grind', 'Set up', 'Grind, dose and tamp. Each step starts at a setting that works.'], ['pull', 'Brew', 'Watch it run. For espresso you watch through Plate X-Ray.'], ['result', 'Change one thing', 'The result says why it ran fast or slow, and sets one change for next time.']],
      pourover: [['grind', 'Set up', 'Grind to the setting shown. Put the coffee in the brewer on the scale, then zero it.'], ['pour', 'Brew', 'Pour until your scale matches the number. Tap Done dripping when the water has drained.'], ['result', 'Change one thing', 'The result says why it ran fast or slow, and sets one change for next time.']],
      timer: [['grind', 'Set up', 'Grind to the setting shown. Each step starts at a setting that works.'], ['timer', 'Brew', 'Follow the timer. Each step says what to do and counts down.'], ['result', 'Change one thing', 'The result says how it went and sets one change for next time.']],
    })[tutorKind('brew')],
    need: '<b>You need</b>Plate X-Ray for espresso. Other methods need nothing extra. There is no machine here, so the shot is simulated from your setup.',
  }, {
    kicker: 'Plate X-Ray', title: 'See inside the machine', go: 'Set up',
    lede: 'A board with an espresso machine drawn on it. Through your phone, it becomes a see-through machine.',
    why: '<b>What it helps with</b>You watch the water move through your coffee, so you can see why a shot runs fast or slow.',
    steps: [['plateflat', 'Lay the plate flat', 'On the table, drawing side up, where the light is even.'], ['plate', 'Point the phone at it', 'From about 30 cm away. The machine appears on the plate.'], ['water', 'Watch the water', 'Blue lines show the water. An orange stream means it is rushing through one side.']],
    need: '<b>No plate?</b>The shot still runs, without the see-through view.',
  }],
  liveart: [{
    kicker: 'LiveARt', title: 'Practise latte art without milk', lede: 'Your phone is the cup. The ring is your milk jug.', go: 'Choose a pattern', next: 'Next: the Cup Ring',
    steps: [['patterns', 'Choose a pattern', 'Start with a free pour. Heart, tulip and rosetta each add one move.'], ['pourart', 'Fill, then draw', 'Fill the cup to half, pouring in circles. Then draw the pattern from the dot.'], ['compare', 'See how close you got', 'Your art next to the target, with one tip for next time.']],
    need: '<b>You need</b>The Cup Ring. No ring? You can pour with your finger.',
  }, {
    kicker: 'Cup Ring', title: 'The ring is your milk jug', go: 'Choose a pattern',
    lede: 'A wooden ring with shapes engraved on one side. The front camera reads the shapes, so it knows where the ring is, how high and how tilted.',
    why: '<b>What it helps with</b>You practise the real pouring moves with your hand, without milk or mess.',
    steps: [['flat', 'Lay the phone flat', 'Screen up, bottom edge toward you. The screen is the cup.'], ['hold', 'Hold the ring above it', 'Engraved side down, about 25 cm up. Hold still for a second while it finds the ring.'], ['tilt', 'Tilt it like a jug', 'Tilt to pour, hold it flat to stop. Pour high to fill the cup, come close to draw.']],
    need: '<b>No ring?</b>You can pour with your finger.',
  }],
};

const hasProp = (k) => k === 'liveart' || (k === 'brew' && appState.method === 'espresso');

const TAB_SCREENS = ['home', 'history'];
const PASS = ['brew', 'pour', 'tutor'];
const NAV = { trail: [], dir: '', tutor: 'app', help: false };
const ENTER = { home: renderHome, grind: renderGrind, brew: startLiveBrew, history: renderHistory, tutor: enterTutor, pick: renderPick, pour: startPour };
const LEAVE = { tutor: stopTutor, brew: stopLiveBrew, pour: () => { LV.measure = false; stopPour(); }, pick: stopDemo };
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
  NAV.dir = 'back';
  go(NAV.trail.length ? NAV.trail[NAV.trail.length - 1] : 'home');
  NAV.dir = '';
}

function initNav() {
  document.addEventListener('click', (e) => { if (e.target.closest('[data-back]')) back(); });
  document.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && !glActive() && e.target.matches('[role=button]:not(button)')) { e.preventDefault(); e.target.click(); }
  });
}

const modeStart = (k) => go(k === 'app' ? 'home' : k === 'brew' ? 'grind' : 'pick');

const sg = (u, a, b) => clamp((u - a) / (b - a));
const ez = (x) => x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2;
const tuAt = (el, at) => Object.entries(at).forEach(([k, v]) => el.setAttribute(k, typeof v === 'number' ? v.toFixed(1) : v));
const tuOn = (el, on) => el.classList.toggle('off', !on);

function tuGrains(x0, y0, x1, y1, gap, r, seed) {
  const rnd = seeded(seed);
  let out = '';
  for (let y = y0; y <= y1; y += gap) for (let x = x0 + ((y / gap) % 2) * gap / 2; x <= x1; x += gap) out += grain(x + (rnd() - 0.5) * gap * 0.3, y + (rnd() - 0.5) * gap * 0.3, r, rnd);
  return out;
}

const tuDial = (y) => '<g class="tu-dial">' + Array.from({ length: 12 }, (_, i) => `<rect x="${30 + i * 22}" y="${y}" width="18" height="10" rx="3"/>`).join('') + `</g><rect class="tu-knob" data-k="knob" x="30" y="${y - 2}" width="18" height="14" rx="4"/>`;
const tuCup = (x, y, w, h) => `<path class="tu-ln" d="M${x} ${y} H${x + w} L${x + w - 5} ${y + h} H${x + 5} Z"/>`;
const tuPhone = (cx, cy, w) => `<path class="tu-flat" d="M${cx - w / 2 + 14} ${cy - 10} H${cx + w / 2 - 14} L${cx + w / 2} ${cy + 10} H${cx - w / 2} Z"/>`;

const SCENES = {
  shot: {
    svg: () => `<svg viewBox="16 0 288 220">
      <path class="tu-faint" d="M160 24 V196"/>
      <rect class="tu-solid" x="44" y="28" width="82" height="16" rx="4"/>
      <path class="tu-ln" d="M50 44 H120 L113 64 H57 Z M120 54 H146"/>
      <path class="tu-water" data-k="s1" d="M78 64 V150"/><path class="tu-water" data-k="s2" d="M92 64 V150"/>
      <clipPath id="tuCupA"><path d="M60 140 H110 L105 186 H65 Z"/></clipPath>
      <rect class="tu-coffee" data-k="liq" x="55" y="186" width="60" height="50" clip-path="url(#tuCupA)"/>
      ${tuCup(60, 140, 50, 46)}
      <text class="tu-lab" x="85" y="212">Espresso</text>
      ${tuPhone(240, 178, 120)}
      <g data-k="ring"><ellipse class="tu-ring" cx="240" cy="78" rx="38" ry="10"/></g>
      <path class="tu-milk" data-k="ms" d="M240 88 V170"/>
      <text class="tu-lab" x="240" y="212">Latte art</text>
    </svg>`,
    frame(e, u, st) {
      const on = sg(u, 0.08, 0.16);
      ['s1', 's2'].forEach((k) => { e[k].style.opacity = on; e[k].style.strokeDashoffset = -st.t * 40; });
      e.liq.setAttribute('y', (186 - 34 * ez(sg(u, 0.12, 0.9))).toFixed(1));
      const tilt = 20 * ez(sg(u, 0.3, 0.5)) * (1 - ez(sg(u, 0.82, 0.95))), bob = 4 * Math.sin(st.t * 2.2);
      e.ring.setAttribute('transform', `translate(0 ${bob.toFixed(1)}) rotate(${(-tilt).toFixed(1)} 240 78)`);
      e.ms.style.opacity = tilt > 8 ? 1 : 0;
    },
  },
  why: {
    svg: () => `<svg viewBox="16 0 288 220">
      <clipPath id="tuWhy"><rect x="40" y="42" width="240" height="122" rx="14"/></clipPath>
      <rect class="tu-bed" x="40" y="42" width="240" height="122" rx="14"/>
      <g clip-path="url(#tuWhy)">${tuGrains(52, 52, 280, 164, 44, 17, 7)}
        ${[62, 106, 150, 194, 238].map((x, i) => `<path class="tu-water fast" data-k="w${i}" d="M${x + 22} 30 V176"/>`).join('')}</g>
      <rect class="tu-ln" x="40" y="42" width="240" height="122" rx="14"/>
      <g data-k="chip"><rect class="tu-chip warn" x="110" y="12" width="100" height="22" rx="11"/><text class="tu-chipt" x="160" y="27">14 s · ran fast</text></g>
      <text class="tu-lab big" data-k="why" x="160" y="196">Big gaps let the water rush through</text>
    </svg>`,
    frame(e, u, st) {
      for (let i = 0; i < 5; i++) e['w' + i].style.strokeDashoffset = -st.t * 120;
      tuOn(e.chip, u > 0.2);
      tuOn(e.why, u > 0.45);
    },
  },
  change: {
    svg: () => `<svg viewBox="16 0 288 220">
      <text class="tu-lab mint" data-k="set" x="160" y="44">Setting 6</text>
      ${tuDial(58)}
      <text class="tu-lab sm" x="30" y="88" text-anchor="start">Finer</text><text class="tu-lab sm" x="290" y="88" text-anchor="end">Coarser</text>
      <rect class="tu-track" x="30" y="132" width="260" height="12" rx="6"/>
      <rect class="tu-band" x="${30 + 260 * 25 / 45}" y="128" width="${260 * 7 / 45}" height="20" rx="4"/>
      <rect class="tu-fill" data-k="bar" x="30" y="132" width="0" height="12" rx="6"/>
      <text class="tu-lab" data-k="sec" x="30" y="172" text-anchor="start">0 s</text>
      <text class="tu-lab sm" x="${30 + 260 * 28.5 / 45}" y="122">25–32 s</text>
      <g data-k="chip"><rect class="tu-chip ok" x="200" y="158" width="90" height="22" rx="11"/><text class="tu-chipt ok" x="245" y="173">On target</text></g>
    </svg>`,
    frame(e, u) {
      const s = 5 - ez(sg(u, 0.08, 0.3));
      e.knob.setAttribute('x', (30 + s * 22).toFixed(1));
      e.set.textContent = u > 0.2 ? 'Setting 5 · finer' : 'Setting 6';
      const sec = 28 * ez(sg(u, 0.38, 0.88));
      e.bar.setAttribute('width', (260 * sec / 45).toFixed(1));
      e.sec.textContent = Math.round(sec) + ' s';
      tuOn(e.chip, u > 0.9);
    },
  },
  grind: {
    svg: () => `<svg viewBox="16 0 288 220">
      <text class="tu-lab mint" data-k="set" x="160" y="22">Setting 10</text>
      <g data-k="flow"><clipPath id="tuBasket"><path d="M34 44 H146 L134 140 H46 Z"/></clipPath>
      <path class="tu-bed" d="M34 44 H146 L134 140 H46 Z"/>
      <g clip-path="url(#tuBasket)">${[52, 72, 92, 112, 132].map((x, i) => `<path class="tu-water" data-k="w${i}" d="M${x - 4} 36 V150"/>`).join('')}</g>
      <path class="tu-ln" d="M34 44 H146 L134 140 H46 Z"/>
      <text class="tu-lab" x="90" y="160">Water flow</text></g>
      <g data-k="lp"><clipPath id="tuLoupe"><circle cx="232" cy="92" r="54"/></clipPath>
      <circle class="tu-paper" cx="232" cy="92" r="54"/>
      <g clip-path="url(#tuLoupe)"><g data-k="gr">${tuGrains(170, 30, 296, 156, 13, 5.4, 3)}</g></g>
      <circle class="tu-ln" cx="232" cy="92" r="54"/>
      <text class="tu-lab" x="232" y="160">Grain size</text></g>
      ${tuDial(176)}
      <text class="tu-lab sm" x="30" y="206" text-anchor="start">Finer</text><text class="tu-lab sm" x="290" y="206" text-anchor="end">Coarser</text>
    </svg>`,
    init(st) {
      st.goal = CG.GRIND.target[appState.method] ?? 5;
      st.from = Math.min(11, st.goal + 4);
      st.off = 0;
      st.flow = TU.kind !== 'timer';
    },
    frame(e, u, st) {
      const s = st.from - ez(sg(u, 0.15, 0.75)) * (st.from - st.goal), k = 0.7 + s * 0.13;
      st.off += st.dt * (16 + s * 13);
      e.knob.setAttribute('x', (30 + s * 22).toFixed(1));
      e.set.textContent = 'Setting ' + (Math.round(s) + 1) + (u > 0.75 ? ' · right for ' + methodName(appState.method) : '');
      e.gr.setAttribute('transform', `translate(232 92) scale(${k.toFixed(3)}) translate(-232 -92)`);
      e.flow.style.display = st.flow ? '' : 'none';
      e.lp.setAttribute('transform', st.flow ? '' : 'translate(-72 0)');
      for (let i = 0; i < 5; i++) e['w' + i].style.strokeDashoffset = -st.off;
    },
  },
  plate: {
    svg: () => `<svg viewBox="16 0 288 220">
      <path class="tu-flat light" d="M70 168 H230 L262 204 H38 Z"/>
      <path class="tu-ink" d="M118 176 H150 M120 184 H148 M128 192 H142 M162 176 H190 L186 196 H166 Z"/>
      <text class="tu-lab sm" x="150" y="216">Plate X-Ray, flat on the table</text>
      <path class="tu-faint" data-k="dim" d="M150 128 V166"/><text class="tu-lab sm" data-k="dimt" x="158" y="152" text-anchor="start">about 30 cm</text>
      <g data-k="ph"><rect class="tu-solid" x="104" y="16" width="92" height="108" rx="12"/><rect class="tu-screen" x="110" y="22" width="80" height="96" rx="7"/>
        <g data-k="mach"><path class="tu-ghost" d="M126 34 H174 V58 H126 Z M130 66 H162 V72 H130 Z M162 69 H176 M138 82 H156 L153 100 H141 Z"/><path class="tu-water" d="M138 38 V54 M146 38 V54 M154 38 V54 M162 38 V54"/></g></g>
    </svg>`,
    frame(e, u) {
      const a = ez(sg(u, 0, 0.4));
      e.ph.setAttribute('transform', `translate(${(90 * (1 - a)).toFixed(1)} ${(-20 * (1 - a)).toFixed(1)})`);
      e.ph.style.opacity = sg(u, 0, 0.15);
      e.mach.style.opacity = ez(sg(u, 0.45, 0.7));
      tuOn(e.dim, u > 0.4);
      tuOn(e.dimt, u > 0.4);
    },
  },
  water: {
    svg: () => `<svg viewBox="16 0 288 220">
      <clipPath id="tuPuck"><path d="M60 50 H260 L244 168 H76 Z"/></clipPath>
      <path class="tu-bed" d="M60 50 H260 L244 168 H76 Z"/>
      <g clip-path="url(#tuPuck)">${tuGrains(64, 56, 258, 166, 16, 6, 11)}${[92, 122, 152, 182, 212].map((x, i) => `<path class="tu-water" data-k="w${i}" d="M${x} 40 V180"/>`).join('')}<path class="tu-rush" data-k="rush" d="M238 40 V180"/></g>
      <path class="tu-ln" d="M60 50 H260 L244 168 H76 Z"/>
      <text class="tu-lab" data-k="l0" x="160" y="30">Blue lines are the water</text>
      <text class="tu-lab orange" data-k="l1" x="160" y="200">Orange: rushing through one side</text>
    </svg>`,
    init(st) { st.off = 0; st.fast = 0; },
    frame(e, u, st) {
      const r = sg(u, 0.5, 0.62);
      st.off += st.dt * 34;
      st.fast += st.dt * (34 + 120 * r);
      for (let i = 0; i < 5; i++) e['w' + i].style.strokeDashoffset = -st.off;
      e.rush.style.strokeDashoffset = -st.fast;
      e.rush.style.opacity = r;
      tuOn(e.l1, u > 0.55);
    },
  },
  result: {
    svg: () => `<svg viewBox="16 0 288 220">
      <g data-k="a"><rect class="tu-card2" x="30" y="16" width="260" height="84" rx="14"/>
        <rect class="tu-chip warn" x="44" y="28" width="76" height="18" rx="9"/><text class="tu-chipt" data-k="chip" x="82" y="41">Ran fast</text>
        <text class="tu-h" data-k="head" x="44" y="72">8 s too fast</text><text class="tu-lab sm" data-k="why" x="44" y="90" text-anchor="start">Water ran through too easily.</text></g>
      <path class="tu-faint" data-k="ar" d="M160 104 V122 M154 116 L160 122 L166 116"/>
      <g data-k="b"><rect class="tu-card2" x="30" y="126" width="260" height="56" rx="14"/>
        <text class="tu-lab sm" x="44" y="146" text-anchor="start">Next time</text><text class="tu-h mint" x="44" y="170">Grind one setting finer</text></g>
      <g data-k="btn"><rect class="tu-btn" x="100" y="190" width="120" height="26" rx="13"/><text class="tu-btnt" x="160" y="207">Try again</text></g>
      <circle class="tu-tap" data-k="tap" cx="160" cy="203" r="6"/>
    </svg>`,
    init(st) {
      st.taste = TU.kind === 'timer';
    },
    frame(e, u, st) {
      const a = ez(sg(u, 0, 0.22)), b = ez(sg(u, 0.32, 0.52));
      e.chip.textContent = st.taste ? 'Tasted sour' : 'Ran fast';
      e.head.textContent = st.taste ? 'A little sour' : '8 s too fast';
      e.why.textContent = st.taste ? 'Not enough came out of the coffee.' : 'Water ran through too easily.';
      e.a.style.opacity = a;
      e.a.setAttribute('transform', `translate(0 ${(12 * (1 - a)).toFixed(1)})`);
      e.ar.style.opacity = b;
      e.b.style.opacity = b;
      e.b.setAttribute('transform', `translate(0 ${(12 * (1 - b)).toFixed(1)})`);
      e.btn.style.opacity = sg(u, 0.55, 0.65);
      const p = sg(u, 0.72, 0.9);
      e.tap.style.opacity = p > 0 && p < 1 ? 1 - p : 0;
      e.tap.setAttribute('r', (6 + 22 * p).toFixed(1));
    },
  },
  pour: {
    svg: () => `<svg viewBox="16 0 288 220">
      <text class="tu-lab sm" x="66" y="56">Scale should read</text>
      <text class="tu-big mint" data-k="want" x="66" y="92">0 g</text>
      <text class="tu-lab sm" x="66" y="124">Your scale</text>
      <text class="tu-big" data-k="have" x="66" y="158">0 g</text>
      <path class="tu-solid" d="M200 30 C226 30 232 52 232 66 H174 C174 48 184 30 200 30 Z"/>
      <path class="tu-spout" d="M176 52 C160 52 156 34 144 30"/>
      <path class="tu-milk wob" data-k="st" d="M146 32 V100"/>
      <path class="tu-ln" d="M110 92 H230 L182 140 H158 Z"/>
      <clipPath id="tuCone2"><path d="M110 92 H230 L182 140 H158 Z"/></clipPath>
      <g clip-path="url(#tuCone2)"><rect class="tu-coffee" x="100" y="124" width="140" height="20"/><rect class="tu-brew" data-k="lvl" x="100" y="124" width="140" height="30"/></g>
      ${tuCup(134, 146, 72, 34)}
      <rect class="tu-solid" x="120" y="182" width="100" height="12" rx="4"/>
      <text class="tu-lab mint" data-k="ok" x="66" y="190">✓ Match</text>
    </svg>`,
    frame(e, u, st) {
      const g = Math.round(150 * ez(sg(u, 0.05, 0.85))), lag = Math.round(150 * ez(sg(u, 0.05, 0.92)) * 0.97);
      e.want.textContent = g + ' g';
      e.have.textContent = (u > 0.92 ? g : lag) + ' g';
      e.st.style.opacity = u > 0.04 && u < 0.88 ? 1 : 0;
      e.st.setAttribute('transform', `rotate(${(4 * Math.sin(st.t * 4)).toFixed(1)} 146 32)`);
      e.lvl.setAttribute('y', (124 - 26 * ez(sg(u, 0.05, 0.6))).toFixed(1));
      tuOn(e.ok, u > 0.92);
    },
  },
  timer: {
    svg: () => `<svg viewBox="16 0 288 220">
      <circle class="tu-track2" cx="160" cy="96" r="62"/>
      <circle class="tu-arc" data-k="arc" cx="160" cy="96" r="62" pathLength="1" transform="rotate(-90 160 96)"/>
      <text class="tu-lab mint" data-k="name" x="160" y="76">Steep</text>
      <text class="tu-big" data-k="time" x="160" y="112">3:30</text>
      <g data-k="btn"><rect class="tu-btn" x="110" y="176" width="100" height="26" rx="13"/><text class="tu-btnt" x="160" y="193">Next step</text></g>
    </svg>`,
    init(st) {
      st.ph = methodOf(appState.method).phases;
    },
    frame(e, u, st) {
      const d = st.ph[0].duration, left = d * (1 - sg(u, 0.05, 0.95));
      e.arc.style.strokeDashoffset = 1 - left / d;
      e.time.textContent = mmss(u < 0.97 ? Math.round(left) : st.ph[1].duration);
      e.name.textContent = u < 0.97 ? st.ph[0].name : st.ph[1].name;
      e.btn.style.opacity = sg(u, 0.4, 0.5);
    },
  },
  flat: {
    svg: () => `<svg viewBox="16 0 288 220">
      <path class="tu-faint" d="M20 150 H300"/>
      <g data-k="ph"><path class="tu-solid" d="M96 112 H224 L258 172 H62 Z"/><path class="tu-screen" d="M104 116 H216 L246 168 H74 Z"/><ellipse class="tu-coffee" cx="160" cy="142" rx="48" ry="16"/></g>
      <path class="tu-arrow" data-k="ar" d="M160 182 V206 M152 198 L160 206 L168 198"/>
      <text class="tu-lab sm" data-k="you" x="196" y="202" text-anchor="start">You</text>
      <text class="tu-lab" x="160" y="40">Screen up</text><text class="tu-lab sm" x="160" y="60">The screen is the cup</text>
    </svg>`,
    frame(e, u) {
      const a = ez(sg(u, 0, 0.4));
      e.ph.setAttribute('transform', `translate(0 ${(-40 * (1 - a)).toFixed(1)})`);
      e.ph.style.opacity = sg(u, 0, 0.2);
      tuOn(e.ar, u > 0.45);
      tuOn(e.you, u > 0.45);
    },
  },
  hold: {
    svg: () => `<svg viewBox="16 0 288 220">
      ${tuPhone(160, 186, 200)}
      <g data-k="ring"><ellipse class="tu-ring" cx="160" cy="0" rx="58" ry="15"/><ellipse class="tu-pulse" data-k="p" cx="160" cy="0" rx="58" ry="15"/></g>
      <path class="tu-faint" data-k="dim" d="M250 92 V172 M244 92 H256 M244 172 H256"/>
      <text class="tu-lab sm" data-k="dimt" x="258" y="136" text-anchor="start">25 cm</text>
      <text class="tu-lab" data-k="hs" x="160" y="40">Hold still</text>
      <text class="tu-lab mint" data-k="ok" x="160" y="40">✓ Found the ring</text>
    </svg>`,
    frame(e, u, st) {
      const y = 20 + 72 * ez(sg(u, 0, 0.4));
      e.ring.setAttribute('transform', `translate(0 ${y.toFixed(1)})`);
      const p = sg(u, 0.45, 0.82), w = (st.t * 1.4) % 1;
      e.p.style.opacity = p > 0 && p < 1 ? 1 - w : 0;
      tuAt(e.p, { rx: 58 + 18 * w, ry: 15 + 5 * w });
      tuOn(e.dim, u > 0.4);
      tuOn(e.dimt, u > 0.4);
      tuOn(e.hs, u > 0.42 && u <= 0.84);
      tuOn(e.ok, u > 0.84);
    },
  },
  tilt: {
    svg: () => `<svg viewBox="16 0 288 220">
      ${tuPhone(160, 186, 200)}
      <ellipse class="tu-coffee" data-k="cup" cx="160" cy="186" rx="44" ry="7"/>
      <ellipse class="tu-milkpool" data-k="pool" cx="160" cy="186" rx="0" ry="0"/>
      <path class="tu-milk" data-k="ms" d="M160 104 V182"/>
      <g data-k="ring"><ellipse class="tu-ring" cx="160" cy="92" rx="58" ry="15"/></g>
      <text class="tu-lab" data-k="a" x="160" y="40">Tilt to pour</text>
      <text class="tu-lab" data-k="b" x="160" y="40">Flat to stop</text>
    </svg>`,
    frame(e, u) {
      const tilt = 25 * ez(sg(u, 0.1, 0.3)) * (1 - ez(sg(u, 0.62, 0.78)));
      e.ring.setAttribute('transform', `rotate(${(-tilt).toFixed(1)} 160 92)`);
      e.ms.style.opacity = tilt > 8 ? 1 : 0;
      const pool = ez(sg(u, 0.25, 0.65));
      tuAt(e.pool, { rx: 30 * pool, ry: 5 * pool });
      tuOn(e.a, u <= 0.62);
      tuOn(e.b, u > 0.62);
    },
  },
  pourart: {
    dur: 10,
    sim: 11,
    svg: () => '<div class="tu-cup lv-demo"><canvas data-k="cv" width="120" height="120"></canvas><svg viewBox="0 0 100 100"><circle class="tu-target off" data-k="dot" cx="50" cy="50" r="3.2"/><circle class="lv-demo-ring" data-k="ring" cx="50" cy="50" r="8"/></svg></div><div class="tu-cap" data-k="cap"></div>',
  },
  pull: {
    svg: () => `<svg viewBox="16 0 288 220">
      <rect class="tu-solid" x="104" y="24" width="112" height="20" rx="5"/>
      <path class="tu-ln" d="M112 44 H208 L198 70 H122 Z M208 57 H244"/>
      <path class="tu-water" data-k="s1" d="M150 70 V156"/><path class="tu-water" data-k="s2" d="M170 70 V156"/>
      <clipPath id="tuCupP"><path d="M128 146 H192 L186 196 H134 Z"/></clipPath>
      <rect class="tu-coffee" data-k="liq" x="124" y="196" width="72" height="60" clip-path="url(#tuCupP)"/>
      ${tuCup(128, 146, 64, 50)}
      <text class="tu-big" data-k="sec" x="262" y="120">0 s</text>
      <text class="tu-lab sm" x="262" y="140">shot time</text>
    </svg>`,
    frame(e, u, st) {
      const on = sg(u, 0.06, 0.14);
      ['s1', 's2'].forEach((k) => { e[k].style.opacity = on * (1 - sg(u, 0.9, 0.97)); e[k].style.strokeDashoffset = -st.t * 40; });
      e.liq.setAttribute('y', (196 - 38 * ez(sg(u, 0.1, 0.92))).toFixed(1));
      e.sec.textContent = Math.round(28 * sg(u, 0.05, 0.92)) + ' s';
    },
  },
  plateflat: {
    svg: () => `<svg viewBox="16 0 288 220">
      <path class="tu-faint" d="M24 196 H296"/>
      <g data-k="pl"><path class="tu-flat light" d="M70 150 H250 L282 194 H38 Z"/>
        <path class="tu-ink" d="M130 160 H166 M132 170 H164 M140 180 H156 M180 160 H212 L206 184 H186 Z"/></g>
      <path class="tu-faint" data-k="light" d="M110 40 L96 90 M160 34 V88 M210 40 L224 90"/>
      <text class="tu-lab" data-k="up" x="160" y="214">Drawing side up</text>
      <text class="tu-lab sm" data-k="ev" x="160" y="28">Even light, no strong shadows</text>
    </svg>`,
    frame(e, u) {
      const a = ez(sg(u, 0, 0.45));
      e.pl.setAttribute('transform', `translate(0 ${(-60 * (1 - a)).toFixed(1)})`);
      e.pl.style.opacity = sg(u, 0, 0.2);
      tuOn(e.up, u > 0.45);
      tuOn(e.light, u > 0.6);
      tuOn(e.ev, u > 0.6);
    },
  },
  patterns: {
    svg: () => `<svg viewBox="16 0 288 220">
      ${Object.values(LV_PATS).map((p, i) => `<g data-k="c${i}"><rect class="tu-pat" x="${36 + (i % 2) * 128}" y="${36 + Math.floor(i / 2) * 76}" width="120" height="64" rx="12"/><text class="tu-patt" x="${48 + (i % 2) * 128}" y="${64 + Math.floor(i / 2) * 76}">${p.name}</text><text class="tu-pats" x="${48 + (i % 2) * 128}" y="${84 + Math.floor(i / 2) * 76}">${p.skill}</text></g>`).join('')}
      <circle class="tu-tap" data-k="tap" cx="0" cy="0" r="6"/>
      <text class="tu-lab sm" x="160" y="208">Start with a free pour</text>
    </svg>`,
    frame(e, u) {
      const k = Math.min(3, Math.floor(u * 4.4)), f = (u * 4.4) % 1;
      for (let i = 0; i < 4; i++) e['c' + i].classList.toggle('on', i === k);
      tuAt(e.tap, { cx: 150 + (k % 2) * 128, cy: 82 + Math.floor(k / 2) * 76, r: 6 + 18 * f });
      e.tap.style.opacity = f < 0.6 ? 1 - f / 0.6 : 0;
    },
  },
  compare: {
    dur: 6.5,
    svg: () => '<div class="tu-two"><figure><div class="tu-cup lv-demo sm"><canvas data-k="a" width="120" height="120"></canvas></div><figcaption>Yours</figcaption></figure><figure><div class="tu-cup lv-demo sm"><canvas data-k="b" width="120" height="120"></canvas></div><figcaption>Target</figcaption></figure></div><div class="tu-cap off" data-k="tip">Tip: come closer for a rounder heart</div>',
    init(st) {
      st.a = milkNew(capOf('heart'));
      st.b = milkNew(capOf('heart'));
      st.at = 0;
    },
    frame(e, u, st) {
      const to = 11 * sg(u, 0, 0.7);
      for (; st.at < to; st.at += 1 / 30) {
        const q = scriptInput('heart', st.at), off = st.at > 4 ? { x: q.x + 5 * Math.sin(st.at * 2.1), h: q.h + 8 } : {};
        milkStep(st.a, Object.assign({}, q, off), 1 / 30);
        milkStep(st.b, q, 1 / 30);
      }
      milkDraw(e.a, st.a);
      milkDraw(e.b, st.b);
      tuOn(e.tip, u > 0.75);
    },
  },
};

function simInit(st) {
  st.m = milkNew(capOf('heart'));
  st.at = 0;
}

function simFrame(e, u, st, sc) {
  const b = sc.sim, to = b * u;
  let inp = scriptInput('heart', st.at);
  for (; st.at < to; st.at += 1 / 30) { inp = scriptInput('heart', st.at); milkStep(st.m, inp, 1 / 30); }
  milkDraw(e.cv, st.m);
  tuAt(e.ring, { cx: inp.x, cy: inp.y, r: 5 + inp.h * 0.18 });
  e.ring.classList.toggle('pouring', inp.flow > 1);
  const g = CG.target('heart', Math.min(st.at, b - 0.01)), d = patPt(g);
  e.cap.textContent = g.step.label;
  tuOn(e.dot, g.stepIndex > 0);
  tuAt(e.dot, { cx: d.x, cy: d.y });
}

const TU = { page: 1, pair: false, kind: 'app', i: 0, t: 0, raf: 0, last: 0, st: null, e: null };

const tutorKind = (k) => k !== 'brew' ? k : appState.method === 'espresso' ? 'espresso' : methodOf(appState.method).window ? 'pourover' : 'timer';
const guideData = () => GUIDE[NAV.tutor][TU.page - 1];
const guideSteps = () => { const s = guideData().steps; return typeof s === 'function' ? s() : s; };
const tuScene = () => SCENES[guideSteps()[TU.i][0]];

function openGuide(k, page = 1, help = false) {
  NAV.tutor = k;
  NAV.help = help;
  Object.assign(TU, { page, pair: page === 1 && hasProp(k) });
  const cur = $('tuCurtain'), first = !TU.ready;
  TU.ready = true;
  if (first || calm() || glActive() || currentScreen === 'tutor') { go('tutor'); return; }
  cur.classList.add('on');
  $('statusBar').classList.add('dark');
  cur.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 280, easing: 'cubic-bezier(.4,0,.2,1)' }).onfinish = () => {
    go('tutor');
    cur.classList.remove('on');
  };
}

function renderTutor() {
  const d = guideData(), steps = guideSteps();
  TU.kind = tutorKind(NAV.tutor);
  $('tuKicker').textContent = d.kicker;
  $('tuHead').textContent = d.title;
  $('tuLede').textContent = d.lede;
  $('tuWhy').innerHTML = d.why || '';
  $('tuWhy').classList.toggle('hidden', !d.why);
  $('tuNeed').innerHTML = d.need;
  $('tuBack').classList.toggle('hidden', NAV.tutor === 'app');
  $('tuSegs').innerHTML = steps.map((_, i) => `<button type="button" data-i="${i}" aria-label="Step ${i + 1}"><b></b></button>`).join('');
  document.querySelector('[data-screen=tutor]').scrollTop = 0;
  tuStep(0);
}

function enterTutor() {
  renderTutor();
  tuReveal(0, 18);
}

function tuParts() {
  return ['tuHeadBox', 'tuCard', 'tuNote', 'tuNeed'].map($);
}

function tuReveal(dx, dy) {
  if (calm()) return;
  tuParts().forEach((el, i) => el.animate([{ opacity: 0, transform: `translate(${dx}px, ${dy}px)` }, { opacity: 1, transform: 'none' }], { duration: 520, delay: i * 60, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'backwards' }));
}

function tuPage(p) {
  const dir = p > TU.page ? 1 : -1;
  TU.page = p;
  renderTutor();
  tuReveal(dir * 36, 0);
}

function tuStep(i) {
  stopTutor();
  const steps = guideSteps(), [, title, text] = steps[i], n = steps.length, d = guideData();
  TU.i = i;
  TU.played = false;
  tuPlay();
  $('tuCount').textContent = 'Step ' + (i + 1) + ' of ' + n;
  $('tuTitle').textContent = title;
  $('tuText').innerHTML = termify(esc(text));
  $('tuNext').textContent = i < n - 1 ? 'Next' : TU.pair && TU.page === 1 ? d.next : d.go;
  $('tuSegs').querySelectorAll('button').forEach((b, k) => { b.className = k < i ? 'done' : k === i ? 'on' : ''; b.firstChild.style.width = k < i ? '100%' : '0%'; });
  replay($('tuNote'), 'tu-in');
  if (glActive()) applyGlasses('tutor');
  if (calm()) { tuDraw(1); return; }
  tuDraw(0);
  TU.raf = requestAnimationFrame(tuFrame);
}

function tuPlay() {
  const sc = tuScene();
  Object.assign(TU, { t: 0, st: { t: 0, dt: 0 }, last: performance.now() });
  $('tuScene').innerHTML = sc.svg();
  TU.e = {};
  $('tuScene').querySelectorAll('[data-k]').forEach((el) => { TU.e[el.dataset.k] = el; });
  if (sc.init) sc.init(TU.st);
  if (sc.sim) simInit(TU.st);
}

function tuDraw(u) {
  const sc = tuScene();
  if (sc.sim) simFrame(TU.e, u, TU.st, sc);
  else sc.frame(TU.e, u, TU.st);
  const seg = $('tuSegs').children[TU.i];
  if (seg) seg.firstChild.style.width = (TU.played ? 100 : u * 100).toFixed(1) + '%';
}

function tuFrame(now) {
  const dt = Math.min(0.05, (now - TU.last) / 1000), dur = tuScene().dur || 6.5;
  TU.last = now;
  TU.t += dt;
  Object.assign(TU.st, { t: TU.t, dt });
  const u = clamp(TU.t / dur);
  tuDraw(u);
  if (TU.t >= dur + 1.4) {
    TU.played = true;
    tuPlay();
    tuDraw(0);
  }
  TU.raf = requestAnimationFrame(tuFrame);
}

function stopTutor() {
  cancelAnimationFrame(TU.raf);
}

function tuNext() {
  if (TU.i < guideSteps().length - 1) { tuStep(TU.i + 1); return; }
  const k = NAV.tutor;
  markSeen((TU.page === 1 ? 'intro-' : 'prop-') + k);
  if (TU.page === 1 && TU.pair) tuPage(2);
  else guideEnd();
}

function tuSkip() {
  markSeen('intro-' + NAV.tutor);
  if (hasProp(NAV.tutor)) markSeen('prop-' + NAV.tutor);
  guideEnd();
}

function guideEnd() {
  if (TU.ending) return;
  TU.ending = true;
  stopTutor();
  const leave = () => (NAV.help ? back() : modeStart(NAV.tutor));
  if (calm() || glActive()) { TU.ending = false; leave(); return; }
  const cur = $('tuCurtain'), parts = [document.querySelector('.tu-top')].concat(tuParts(), $('tuNext'));
  const outs = parts.map((el, i) => el.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(-10px)' }], { duration: 240, delay: i * 25, easing: 'cubic-bezier(.4,0,1,1)', fill: 'forwards' }));
  outs[outs.length - 1].onfinish = () => {
    cur.classList.add('on');
    $('statusBar').classList.add('dark');
    leave();
    outs.forEach((a) => a.cancel());
    const scr = document.querySelector('.screen.active'), box = scr.querySelector(':scope > .hm'), kids = box ? [...box.children] : [...scr.children];
    kids.forEach((el, i) => el.animate([{ opacity: 0, transform: 'translateY(26px) scale(.985)' }, { opacity: 1, transform: 'none' }], { duration: 640, delay: 80 + i * 60, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'backwards' }));
    cur.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 520, easing: 'cubic-bezier(.3,0,.2,1)' }).onfinish = () => {
      TU.ending = false;
      cur.classList.remove('on');
      $('statusBar').classList.toggle('dark', ['brew', 'pour', 'tutor'].includes(currentScreen));
    };
  };
}

function tuBack() {
  if (TU.i > 0) tuStep(TU.i - 1);
  else if (TU.page === 2 && TU.pair) tuPage(1);
  else if (NAV.tutor !== 'app') { stopTutor(); back(); }
}

function initTutor() {
  $('tuNext').addEventListener('click', tuNext);
  $('tuBack').addEventListener('click', tuBack);
  $('tuSkip').addEventListener('click', tuSkip);
  $('tuSegs').addEventListener('click', (e) => { const b = e.target.closest('[data-i]'); if (b) tuStep(+b.dataset.i); });
}

function openMode(k) {
  if (!seen('intro-' + k)) openGuide(k);
  else if (hasProp(k) && !seen('prop-' + k)) openGuide(k, 2);
  else modeStart(k);
}

function quickMethod(k) {
  appState.method = k;
  openMode('brew');
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
      <div class="sh-set"><span>Brew clock</span>${segRow('setClock', [[1, 'Real time'], [5, '5× faster']], brewSpeed)}</div>
      <div class="sh-set"><span>Pour with</span>${segRow('setInput', [['ring', 'Ring'], ['finger', 'Finger'], ['demo', 'Demo']], LV.input)}</div>
      <div class="sh-set"><span>Ring direction</span>${segRow('setFlip', [['x', 'Flip left-right'], ['y', 'Flip up-down']], '')}</div>
      <div class="sh-set"><span>Ring height</span><em class="sh-note">${ringSaved() ? 'Measured on this phone, in real centimetres.' : 'Read from where you hold still. Measure once with a ruler for real centimetres.'}</em></div>
      <button type="button" class="btn-ghost sh-reset" id="setMeasure"><i class="fa-solid fa-ruler-vertical"></i> Measure ring height</button>
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
  $('setIntro').onclick = () => { closeSheet(); openGuide('app'); };
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
  $('setMeasure').onclick = () => { closeSheet(); Object.assign(LV, { measure: true, input: 'ring', key: LV.key || 'free' }); go('pour'); };
  $('setClock').onclick = (e) => { const b = e.target.closest('[data-v]'); if (!b) return; brewSpeed = +b.dataset.v; segOn('setClock', 'data-v', b.dataset.v); };
  $('setInput').onclick = (e) => { const b = e.target.closest('[data-v]'); if (!b) return; LV.input = b.dataset.v; segOn('setInput', 'data-v', b.dataset.v); };
  $('setFlip').onclick = (e) => { const b = e.target.closest('[data-v]'); if (!b) return; const k = 'flip' + b.dataset.v.toUpperCase(); LV[k] = !LV[k]; ls.set('cg-' + k, LV[k] ? '1' : '0'); flips(); };
}

const FLOWS = { coffee: [['grind', 'Set up'], ['brew', 'Brew'], ['review', 'Result']], art: [['pick', 'Pattern'], ['pour', 'Pour'], ['art', 'Result']] };
const FLOW_OF = { grind: 'coffee', brew: 'coffee', review: 'coffee', pick: 'art', pour: 'art', art: 'art' };

function renderCrumbs(name) {
  const f = FLOW_OF[name], el = document.querySelector(`[data-screen="${name}"] .crumbs`);
  if (!f || !el) return;
  const steps = FLOWS[f].map(([k, t]) => [k, k === 'pick' && name !== 'pick' ? LV_PATS[LV.key].name : t]), i = steps.findIndex((x) => x[0] === name), lead = f === 'coffee' ? methodName(appState.method) : 'LiveARt';
  el.innerHTML = '<button type="button" data-crumb="home" aria-label="Home"><i class="fa-solid fa-house"></i></button><b>' + esc(lead) + '</b>'
    + steps.map(([k, t], j) => `<button type="button" data-crumb="${k}" class="${j < i ? 'done' : j === i ? 'on' : ''}"${j >= i ? ' disabled' : ''}>${t}</button>`).join('');
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
  const brands = (navigator.userAgentData && navigator.userAgentData.brands) || [];
  document.documentElement.classList.toggle('lg-refract', brands.some((b) => b.brand === 'Chromium'));
  syncTabs('home');
}

function initMethod() {
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
  $('grindTipRow').querySelector('i').className = 'fa-solid fa-' + (m.window ? 'weight-scale' : 'clock') + ' icon-fa ic-teal-dark ic-26';
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
  const txt = diff === 0
    ? ['ok', `Right for ${name}.`, appState.method === 'espresso' ? 'Enough resistance for a 25 to 30 second shot.' : 'Water moves through at the pace this method needs.']
    : diff < 0
      ? ['warn', `Finer than ${name} needs.`, 'Tighter gaps slow the water and pull out more bitterness.']
      : ['warn', `Coarser than ${name} needs.`, 'Wide gaps let water rush through. The cup tastes sour and thin.'];
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
  $('pxCaption').textContent = step === 'wdt' && appState.wdt ? 'Side view · grounds stirred even' : STEP_CAPTION[step];
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
  $('pxDrips').innerHTML = [106, 120, 134].map((x) => `<line x1="${x}" y1="174" x2="${x + (x - 120) * 0.14}" y2="191"/>`).join('')
    + `<g id="pxSpurt"><line class="hot" x1="84" y1="174" x2="78" y2="191"/></g>`;
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

function showToast(msg) {
  const toast = $('applyToast');
  toast.textContent = msg;
  toast.classList.add('on');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => toast.classList.remove('on'), 5000);
}

function applyRecipe(method, prep, field, temp, msg) {
  appState.method = method;
  appState.grindFor = method;
  ['grind', 'dose', 'wdt', 'tamp', 'level'].forEach((k) => { if (prep[k] !== undefined) appState[k] = prep[k]; });
  appState.step = FIELD_STEP[field] || 'grind';
  if (temp) CG.Store.setGear({ temp });
  go('grind');
  document.querySelector('[data-screen=grind]').scrollTop = 0;
  showToast(msg);
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
  start: eoStart, stop: eoStop, getResult: eoGetResult, finishNow: eoFinishNow, setWide: eoSetWide, setAligning, track: eoTrack,
  isPinned: () => pinned,
};

let brewMethod = null, brewIndex = 0, brewSeconds = 0, totalElapsed = 0, brewTimer = null, onCompleteCb = null, brewSpeed = 1, brewDone = false;
const BW = { cone: 0, bed: 0, cup: 0, poured: 0, out: 0, pour: false };

const currentPhase = () => brewMethod.phases[Math.min(brewIndex, brewMethod.phases.length - 1)];
const pourAt = (ph, s) => ph.pour[2] + (ph.pour[3] - ph.pour[2]) * clamp((s - ph.pour[0]) / (ph.pour[1] - ph.pour[0]));
const pouringAt = (ph, s) => !!ph.pour && s >= ph.pour[0] && s < ph.pour[1];

function brewFlow() {
  const ph = currentPhase(), g = ph.pour ? pourAt(ph, brewSeconds) : BW.poured, add = Math.max(0, g - BW.poured);
  const soak = Math.min(add, 2 * parseFloat(brewMethod.dose) - BW.bed);
  BW.poured += add;
  BW.bed += soak;
  BW.cone += add - soak;
  BW.out = BW.cone * 0.04;
  BW.cone -= BW.out;
  BW.cup += BW.out;
  const now = pouringAt(ph, brewSeconds);
  if (now !== BW.pour) buzz('cue', true);
  BW.pour = now;
}

function drawCone() {
  const m = brewMethod, water = parseFloat(m.yield), lv = clamp(BW.cone / (water * 0.3)), cup = clamp(BW.cup / (water - 2 * parseFloat(m.dose)));
  $('bcWater').style.transform = `translateY(${((1 - lv) * 46).toFixed(1)}px)`;
  $('bcCup').style.transform = `translateY(${((1 - cup) * 40).toFixed(1)}px)`;
  $('bcBed').classList.toggle('wet', BW.bed > 0);
  $('bcStream').classList.toggle('on', BW.pour);
  $('bcDrip').classList.toggle('on', BW.out > 0.2);
}

function renderBrew() {
  const ph = currentPhase(), m = brewMethod, n = m.phases.length, s = brewSeconds, guide = !!m.window;
  const left = ph.open ? mmss(s) : mmss(Math.max(0, ph.duration - s));
  $('brewPhasePillName').textContent = ph.name;
  $('brewPhasePillTime').textContent = '· ' + left;
  $('brewTimer').classList.toggle('guide', guide);
  $('btStep').textContent = 'Step ' + (brewIndex + 1) + ' of ' + n + ' · ' + ph.name;
  $('btK').textContent = !guide ? '' : ph.open ? 'Dripping for' : 'Scale should read';
  $('btTime').textContent = guide && ph.pour ? Math.round(pourAt(ph, s)) + ' g' : left;
  $('btCue').innerHTML = termify(esc(ph.pour && s < ph.pour[0] ? 'Get ready. Pour when the stream shows.' : ph.pour && !pouringAt(ph, s) ? ph.wait.replace('#', mmss(ph.duration - s)) : ph.cue));
  $('btTotal').textContent = guide ? 'Total ' + mmss(totalElapsed) : '';
  $('brewNextBtn').classList.toggle('hidden', guide && !ph.open);
  $('brewNextBtn').classList.toggle('go', !!ph.open);
  $('brewNextBtn').textContent = ph.open ? 'Done dripping' : brewIndex < n - 1 ? 'Next: ' + m.phases[brewIndex + 1].name.toLowerCase() : 'Finish';
  paintPhases(brewIndex, ph.open ? 0 : Math.min(1, s / ph.duration), m.phases);
  if (guide) drawCone();
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
  if (!currentPhase().open && brewSeconds >= currentPhase().duration) {
    if (brewIndex >= brewMethod.phases.length - 1) return finishEarly();
    brewIndex += 1;
    brewSeconds = 0;
  }
  if (brewMethod.window) brewFlow();
  renderBrew();
}

function startTimer() {
  clearInterval(brewTimer);
  $('brewTimer').style.setProperty('--tick', 1 / brewSpeed + 's');
  brewTimer = setInterval(tick, 1000 / brewSpeed);
}

function stopBrew() {
  clearInterval(brewTimer);
}

function finishEarly() {
  stopBrew();
  brewDone = true;
  if (onCompleteCb) onCompleteCb(totalElapsed);
}

function startBrew(methodKey, onComplete) {
  brewMethod = methodOf(methodKey);
  brewIndex = brewSeconds = totalElapsed = 0;
  Object.assign(BW, { cone: 0, bed: 0, cup: 0, poured: 0, out: 0, pour: false });
  brewDone = false;
  onCompleteCb = onComplete;
  startTimer();
  renderBrew();
}

function skipPhase() {
  if (brewMethod.window && !currentPhase().open) return buzz('warn', true);
  if (brewIndex >= brewMethod.phases.length - 1) return finishEarly();
  brewIndex += 1;
  brewSeconds = 0;
  renderBrew();
}

const Brew = { startBrew, finishEarly, stopBrew, skipPhase };

const brewCamera = createCameraController();

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
  $('brewFinishBtn').classList.toggle('hidden', !esp);
  if (esp) return startEspressoLiveBrew();
  Brew.startBrew(appState.method, (elapsed) => {
    appState.lastEspressoResult = null;
    toReview(elapsed);
  });
}

function initLiveBrew() {
  $('brewFinishBtn').addEventListener('click', () => CG.EspressoOverlay.finishNow());
  $('brewNextBtn').addEventListener('click', () => Brew.skipPhase());
}

function stopLiveBrew() {
  if (appState.method !== 'espresso' && brewMethod && !brewDone && totalElapsed > 0) showToast('Stopped. Nothing was saved.');
  Brew.stopBrew();
  CG.EspressoOverlay.stop();
  brewCamera.stop();
}

function toReview(sec) {
  renderReview(sec);
  go('review');
}

function shotCause(f) {
  const p = prepState(), g = CG.GRIND.target.espresso;
  if (f.time < CG.SHOT.targetLo) return 'Running fast. ' + (p.grind > g ? 'The grind is coarse, so the water finds wide gaps.' : p.dose < 18 ? 'There is not much coffee to hold the water back.' : 'The water finds an easy path through the coffee.');
  if (f.time > CG.SHOT.targetHi) return 'Running slow. ' + (p.grind < g ? 'The grind is fine, so the gaps between grains are tiny.' : 'A lot of coffee holds the water back.');
  if (f.risk >= 0.55) return 'On pace, but one side may run fast. ' + (p.level === 'tilted' ? 'The tilted tamp leaves a thin side.' : !p.wdt ? 'Lumps leave loose spots.' : 'A soft tamp lets the coffee shift.');
  return 'On pace. The grind and dose hold the water back about right.';
}

function brewNow() {
  go('brew');
}

const RV = { rec: null, pane: 0, t: 0 };
const BD = { id: null };
const RP = { x0: 10, x1: 310, y0: 12, y1: 118 };

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
  const m = methodOf(rec.method), ph = m.phases, plan = CG.Verdict.plan(rec.method), w = m.window;
  const T = Math.max(w ? w[1] : plan, rec.time) * 1.08, pct = (t) => (t / T * 100).toFixed(1) + '%';
  host.innerHTML = `
    <div class="rv-head"><div class="rv-title">Your brew</div><div class="rv-hint">${w ? 'Your time vs the target' : 'Planned vs actual'}</div></div>
    <div class="ph">
      <div class="ph-bar" style="width:${pct(w ? w[1] : plan)}">${ph.map((p) => `<span style="flex:${p.open && w ? w[1] - CG.Verdict.pourEnd(rec.method) : p.duration}">${p.name}</span>`).join('')}</div>
      ${w ? `<div class="ph-win" style="left:${pct(w[0])};width:${pct(w[1] - w[0])}"></div>` : ''}
      <div class="ph-mark" data-r="mark" style="left:0%"><b>${mmss(rec.time)}</b></div>
    </div>
    <div class="ph-scale"><span>0:00</span><span>${w ? 'Target ' + mmss(w[0]) + '–' + mmss(w[1]) : 'Planned ' + mmss(plan)}</span></div>`;
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
  const w = methodOf(r.method).window;
  if (w) {
    return [{ lab: 'Total time', v: r.time, lo: w[0], hi: w[1], min: w[0] - 90, max: w[1] + 90, fmt: mmss, sub: 'Target ' + mmss(w[0]) + '–' + mmss(w[1]) }, null, null];
  }
  const plan = CG.Verdict.plan(r.method);
  return [{ lab: 'Time', v: r.time, lo: plan * 0.9, hi: plan * 1.1, min: 0, max: plan * 1.6, fmt: mmss, sub: 'Planned ' + mmss(plan) }, null, null];
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

const MILK = { N: 120, R: 46, area: 34, r0: 2.2, drag: 0.9, dragR: 5, vmax: 70, sharp: 7, mixK: 12, mixG: 0.45, mixR: 10, spread: 3, punch: 0.6 };
const floatOf = (h) => clamp((38 - h) / 22);
const levelOf = (m) => clamp(m.vol / m.cap);
const surfR = (lv) => MILK.R * (0.5 + 0.5 * lv);

function milkNew(cap) {
  const n = MILK.N * MILK.N;
  return { foam: new Float32Array(n), tmp: new Float32Array(n), age: new Float32Array(n), atmp: new Float32Array(n), mix: new Float32Array(n), mtmp: new Float32Array(n), vol: cap * FILL.esp, cap, prev: null, jv: [0, 0], seg: 0, off: 9, dir: 0 };
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

function milkSpread(m, dt) {
  const N = MILK.N, M = m.mix, T = m.mtmp, a = Math.min(0.24, MILK.spread * dt * (N / 100) ** 2);
  for (let j = 1; j < N - 1; j++) {
    for (let i = 1; i < N - 1; i++) {
      const c = j * N + i;
      T[c] = M[c] + a * (M[c - 1] + M[c + 1] + M[c - N] + M[c + N] - 4 * M[c]);
    }
  }
  m.mix = T;
  m.mtmp = M;
}

function milkStep(m, inp, dt) {
  const N = MILK.N, k = 100 / N, f = m.foam, t = m.tmp, R = surfR(levelOf(m));
  milkSpread(m, dt);
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
      if (rc > R - 1) { const out = (vx * (x - 50) + vy * (y - 50)) / rc; if (out > 0) { vx -= out * (x - 50) / rc; vy -= out * (y - 50) / rc; } }
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
        m.mix[c] = Math.min(1, m.mix[c] + (1 - s) * q * dt / m.cap * (MILK.mixK * Math.exp(-d2 / mixR2) + MILK.mixG));
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
  const N = MILK.N, ctx = cv.getContext('2d'), img = ctx.createImageData(N, N), d = img.data, tex = cremaTex(), F = m.foam, A = m.age, k = 100 / N, rs = surfR(levelOf(m));
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const c = j * N + i, o = c * 4, x = (i + 0.5) * k - 50, y = (j + 0.5) * k - 50, r = Math.hypot(x, y);
      const edge = clamp((MILK.R - r) / k + 0.5);
      if (!edge) { d[o + 3] = 0; continue; }
      let a = clamp((F[c] - 0.36) / 0.28);
      a = a * a * (3 - 2 * a);
      const mx = m.mix[c], tx = tex[c], wet = clamp((rs - r) / k + 0.5);
      const br = 78 + 90 * mx + 30 * tx, bg = 44 + 68 * mx + 18 * tx, bb = 24 + 42 * mx + 10 * tx;
      const gx = i < N - 1 ? Math.abs(A[c + 1] - A[c]) : 0, gy = j < N - 1 ? Math.abs(A[c + N] - A[c]) : 0, ln = clamp((Math.max(gx, gy) - 0.15) / 0.3) * a * 0.55;
      const w = clamp((r - rs) / (MILK.R - rs + 0.01)), sh = 1 - 0.22 * Math.exp(-(((r - rs) / 1.6) ** 2));
      d[o] = ((br * (1 - a) + 246 * a) * (1 - ln) + br * ln) * wet + (196 + 42 * w) * sh * (1 - wet);
      d[o + 1] = ((bg * (1 - a) + 239 * a) * (1 - ln) + bg * ln) * wet + (184 + 44 * w) * sh * (1 - wet);
      d[o + 2] = ((bb * (1 - a) + 226 * a) * (1 - ln) + bb * ln) * wet + (166 + 48 * w) * sh * (1 - wet);
      d[o + 3] = 255 * edge;
    }
  }
  if (cv.width !== N) { cv.width = N; cv.height = N; }
  ctx.putImageData(img, 0, 0);
}

const LV_PATS = {
  free: { name: 'Free pour', skill: 'Get the feel', blurb: 'No pattern to follow. Fill the cup to half in circles, then bring the ring close and draw.', demo: 'heart' },
  heart: { name: 'Heart', skill: 'High, then close', blurb: 'One pour, then one line through the middle. Tulip and rosetta build on it.' },
  tulip: { name: 'Tulip', skill: 'Lift to stop', blurb: 'Three small pours stacked up. You learn when to stop and start.' },
  rosetta: { name: 'Rosetta', skill: 'Wiggle side to side', blurb: 'Wiggle the ring to the sides while you move up the cup. Keep the rhythm even.' },
};
const RING_Z = { near: 200, far: 440, check: 250 };
const RING_TIP = { start: 12, stop: 8 };
const LV_RING_MM = { [CG.TARGETS.cupring]: 150, [CG.TARGETS.cupring8]: 133.3 };
const LV = {
  key: 'free', input: 'ring', flipX: ls.get('cg-flipX') === '1', flipY: ls.get('cg-flipY') === '1', debug: false, focus: null, taps: 0,
  m: null, inp: null, raf: 0, last: 0, p: 0, t: 0, cal: null, steady: 0, seenAt: 0, startAt: 0, poured: false, done: false, log: [], camOn: false, finger: null,
  demo: { m: null, raf: 0, t: 0, key: null }, goals: {}, result: null,
};
const pourCamera = createCameraController();

const patPt = (g) => ({ x: g.x, y: 100 - g.y });
const capOf = (key) => CG.PATTERNS[key === 'free' ? 'heart' : key].cap;

function scriptInput(key, t) {
  const g = CG.target(key, t), p = patPt(g);
  return { x: p.x, y: p.y, h: g.heightMm, flow: g.flow };
}

function lvGoal(key, slice) {
  if (key === 'free') return null;
  const g = LV.goals[key] || (LV.goals[key] = { m: milkNew(capOf(key)), t: 0 }), dur = CG.PATTERNS[key].dur;
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
  Object.assign(D, { m: milkNew(capOf(key)), t: 0, key, last: performance.now() });
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
  $('lvDemoCue').textContent = g.step.label;
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
  Object.assign(LV, { m: milkNew(capOf(key)), inp: null, p: 0, t: 0, cal: null, steady: 0, seenAt: 0, startAt: 0, lostAt: 0, ringPrev: null, tip: false, cm: false, poured: false, done: false, log: [], finger: null, taps: 0, stage: 'fill', ang: null, spin: 0, still: 0, circ: 0, fillT: 0, dwell: 0, drawLv: 0, drawAt: 0, full: false });
  $('poTitle').textContent = LV_PATS[key].name;
  $('po').className = 'po po-' + LV.input;
  $('poCup').className = 'po-cup' + (free ? ' free' : '');
  $('poCup').dataset.stage = 'fill';
  $('poRoute').setAttribute('d', free ? '' : routeD(key, CG.PATTERNS[key].steps[0].t1, CG.PATTERNS[key].dur));
  $('poSteps').innerHTML = free ? '' : CG.PATTERNS[key].steps.map((st) => `<i title="${st.label}"><svg viewBox="0 0 14 14">${STEP_ICON[iconOf(st)]}</svg></i>`).join('');
  milkDraw($('poCanvas'), LV.m);
  $('po').classList.toggle('measure', !!LV.measure);
  if (LV.measure) $('poTitle').textContent = 'Ring height';
  pourWait(LV.measure ? ['Ring height check', 'Stand a ruler on the phone next to the front camera. Hold the ring flat, engraved side down, right above the camera at 25 cm. Keep it still.'] : LV.input === 'finger' ? ['Pour with your finger', 'Touch the cup and draw circles to fill it. Lift your finger to stop.'] : LV.input === 'demo' ? ['Demo pour', 'The pour plays by itself.'] : ['Hold the ring above your phone', 'Engraved side down, about 25 cm above the middle of the screen.']);
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
    if (!LV.measure) pourWait(['Hold it flat and still', 'This sets flat. Finding the middle of your cup.']);
    if (LV.steady < 12) return null;
    if (LV.measure) return LV.measure === true ? ringMeasured(ring) : null;
    LV.cal = ring;
    LV.k = ringScale();
    LV.cm = ringSaved();
    pourWait(null);
    buzz('confirm', true);
    tlog('ring-cal', { d: Math.round(ring.d) });
  }
  const c = LV.cal, K = 100 / 70, sx = LV.flipX ? 1 : -1, sy = LV.flipY ? 1 : -1, z = ring.d * LV.k;
  const tilt = Math.acos(clamp(Math.abs(ring.n[0] * c.n[0] + ring.n[1] * c.n[1] + ring.n[2] * c.n[2]))) * 180 / Math.PI;
  LV.tip = tilt > (LV.tip ? RING_TIP.stop : RING_TIP.start);
  return {
    x: clamp(50 + sx * (ring.x - c.x) * K, 2, 98), y: clamp(50 + sy * (ring.y - c.y) * K, 2, 98),
    h: (LV.cm ? clamp((z - RING_Z.near) / (RING_Z.far - RING_Z.near)) : clamp((ring.d / c.d - 0.85) / 0.75)) * 80, flow: LV.tip ? clamp((tilt - 6) / 24) * 12 : 0, seen: true, raw: { d: ring.d, z, tilt },
  };
}

const ringSaved = () => { const s = ls.json('cg-ring-scale'); return !!(s && s.c); };

function ringScale(est) {
  const v = $('pourVideo'), w = v.videoWidth || 3, h = v.videoHeight || 4, s = ls.json('cg-ring-scale');
  return Math.max(w, h) / h * (s && s.c && !est ? s.c : Math.tan(Math.PI / 8) / Math.tan(39.5 * Math.PI / 180));
}

function ringMeasured(ring) {
  const v = $('pourVideo'), k = RING_Z.check / ring.d, est = ringScale(true);
  LV.steady = 0;
  if (k < est * 0.6 || k > est * 1.6) {
    pourWait(['Try again', 'That reading looks wrong. Check the ruler: the ring flat, 25 cm right above the camera.']);
    return null;
  }
  ls.set('cg-ring-scale', JSON.stringify({ c: k * v.videoHeight / Math.max(v.videoWidth, v.videoHeight) }));
  LV.measure = 'done';
  buzz('success', true);
  tlog('ring-scale', { k: +k.toFixed(3), d: Math.round(ring.d) });
  pourWait(['Saved', 'Heights now read in real centimetres on this phone. Go back and pour.']);
  return null;
}

function fingerInput() {
  const f = LV.finger, g = LV.key === 'free' ? null : CG.target(LV.key, LV.p);
  if (!f) return LV.inp ? Object.assign({}, LV.inp, { flow: 0, seen: false }) : null;
  pourWait(null);
  if (LV.stage !== 'draw') return { x: f.x, y: f.y, h: 55, flow: LV.m.cap * (FILL.half - FILL.esp) / 5, seen: true };
  return { x: f.x, y: f.y, h: g ? g.heightMm : 12, flow: g ? Math.max(4, g.flow) : 9, seen: true };
}

function trackSpin(inp, dt) {
  const dx = inp.x - 50, dy = inp.y - 50, a = Math.atan2(dy, dx), on = inp.flow > 1 && Math.hypot(dx, dy) > 3;
  let w = 0;
  if (on && LV.ang !== null) {
    const d = a - LV.ang;
    w = Math.abs(d - Math.round(d / (2 * Math.PI)) * 2 * Math.PI) / dt;
  }
  LV.ang = on ? a : null;
  LV.spin += (Math.min(w, 12) - LV.spin) * Math.min(1, dt * 4);
  LV.still = inp.flow > 1 && LV.spin < 1 ? LV.still + dt : 0;
  if (inp.flow > 1) { LV.fillT += dt; if (LV.spin >= 1) LV.circ += dt; }
}

const startPt = (key) => patPt(spineAt(key, CG.PATTERNS[key].steps[0].t1));

function pourStage(inp, dt) {
  const key = LV.key, free = key === 'free', lv = levelOf(LV.m), fill = free ? null : CG.PATTERNS[key].steps[0];
  if (LV.stage === 'fill') {
    trackSpin(inp, dt);
    if (fill) LV.p = fill.t1 * Math.min(0.999, (lv - FILL.esp) / (FILL.half - FILL.esp));
    if (lv < FILL.half) return;
    LV.stage = free ? 'draw' : 'ready';
    LV.drawLv = lv;
    LV.drawAt = LV.t;
    buzz('confirm', true);
    tlog('pour-filled', { circ: +(LV.circ / Math.max(0.1, LV.fillT)).toFixed(2) });
  } else if (LV.stage === 'ready') {
    const s = startPt(key), amp = CG.target(key, fill.t1).amp;
    LV.dwell = inp.flow > 1 && Math.abs(inp.x - s.x) < 5 + amp && Math.abs(inp.y - s.y) < 5 ? LV.dwell + dt : 0;
    LV.drawLv = lv;
    if (LV.dwell > 0.4) { LV.stage = 'draw'; LV.p = fill.t1; }
  } else if (!free) LV.p = traceStep(inp, dt);
}

function demoInput(key, free) {
  if (free) return scriptInput('heart', LV.t);
  return scriptInput(key, Math.min(CG.PATTERNS[key].dur, LV.p + 0.06));
}

function smooth(a, b, k) {
  if (!a) return b;
  return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, h: a.h + (b.h - a.h) * k * 0.6, flow: a.flow + (b.flow - a.flow) * k * 0.6, seen: b.seen, raw: b.raw };
}

function pourFrame(now) {
  const dt = Math.min(0.05, (now - LV.last) / 1000), key = LV.key, free = key === 'free';
  LV.last = now;
  LV.t += dt;
  const raw = LV.input === 'demo' ? demoInput(key, free) : LV.input === 'finger' ? fingerInput() : ringInput(now);
  if (LV.input === 'demo') { pourWait(null); raw.seen = true; }
  LV.inp = raw ? (LV.input === 'ring' ? smooth(LV.inp, raw, 0.5) : raw) : null;
  const inp = LV.inp, g = free ? null : CG.target(key, LV.p);
  if (inp) {
    milkStep(LV.m, inp, dt);
    if (inp.flow > 1 && !LV.poured) { LV.poured = true; LV.startAt = LV.t; }
    pourStage(inp, dt);
    LV.log.push({ t: LV.t, p: LV.p, s: g && LV.stage !== 'ready' ? g.stepIndex : -1, x: inp.x, y: inp.y, h: inp.h, f: inp.flow, seen: inp.seen });
  }
  $('poCup').dataset.stage = LV.stage;
  milkDraw($('poCanvas'), LV.m);
  pourHud(inp, free ? null : CG.target(key, LV.p));
  if (inp && inp.seen) LV.lostAt = 0;
  else if (LV.poured && !LV.lostAt) LV.lostAt = LV.t;
  const lost = LV.stage === 'draw' && LV.poured && LV.lostAt && LV.t - LV.lostAt > 2.5;
  if (!LV.done && (lost || LV.m.vol >= LV.m.cap || (!free && LV.p >= CG.PATTERNS[key].dur - 0.01))) {
    LV.done = true;
    LV.full = !free && LV.m.vol >= LV.m.cap && LV.p < CG.PATTERNS[key].dur - 0.3;
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

const STEP_ICON = {
  circle: '<path d="M11 7a4 4 0 1 1-1.2-2.9M10.2 1.8v2.6H7.6"/>',
  hold: '<circle cx="7" cy="7" r="2.6" class="fill"/>',
  small: '<circle cx="7" cy="7" r="1.7" class="fill"/>',
  lift: '<path d="M3.5 2.5h7M7 12V5M4.5 7.5 7 5l2.5 2.5"/>',
  wiggle: '<path d="M1.5 7h11M4 4.5 1.5 7 4 9.5M10 4.5l2.5 2.5L10 9.5"/>',
  pull: '<path d="M7 12.5V2M4.5 4.5 7 2l2.5 2.5"/>',
  down: '<path d="M7 1.5V12M4.5 9.5 7 12l2.5-2.5"/>',
};
const iconOf = (st) => st.key === 'fill' ? 'circle' : st.hz ? 'wiggle' : st.key.startsWith('stop') ? 'lift' : st.key === 'cut' ? (st.pos(1).y < st.pos(0).y ? 'down' : 'pull') : st.key === 'cap' || st.key === 'push3' ? 'small' : 'hold';

function sayOf(stage, st, inp, off) {
  const finger = LV.input === 'finger';
  if (inp && !inp.seen && LV.input === 'ring') return inp.raw && inp.raw.z < RING_Z.near + 40 ? 'Too low for the camera. Lift a little' : 'Hold the ring above the screen';
  if (off) return off;
  if (stage === 'fill') return LV.still > 0.8 ? 'Move in circles' : finger ? 'Draw circles on the cup' : 'Pour high, fill to half';
  if (stage === 'ready') return finger ? 'Lift your finger, then touch the dot' : 'Lower the ring over the dot';
  if (st) return finger ? st.fcue : '';
  if (LV.t - LV.drawAt < 2) return 'Half full. Now draw on top';
  if (!inp || inp.flow <= 1) return finger ? 'Touch the cup to pour' : 'Tilt to pour';
  return finger ? '' : inp.h > 38 ? 'High: the milk sinks' : inp.h < 16 ? 'Close: white shows' : '';
}

const tiltOf = (flow) => 6 + 2 * flow;

function jugAt(k, x, h, tilt, pour, lv) {
  const sx = 66 + (x - 50) * 0.5, sy = 52 - h * 0.6, st = $('ps' + k + 'St');
  $('ps' + k + 'Jug').setAttribute('transform', `translate(${sx.toFixed(1)} ${sy.toFixed(1)}) rotate(${(-tilt).toFixed(0)})`);
  st.setAttribute('x1', sx.toFixed(1));
  st.setAttribute('x2', sx.toFixed(1));
  st.setAttribute('y1', sy.toFixed(1));
  st.setAttribute('y2', (pour ? 94 - lv * 36 : sy).toFixed(1));
}

function aimOf(stage, g, tx) {
  if (stage === 'fill') return { x: fillPos(0, LV.t).x, h: 55, tilt: 26, pour: true };
  if (stage === 'ready') return { x: startPt(LV.key).x, h: 55 - 44 * clamp((LV.t * 0.6) % 1 * 1.6), tilt: tiltOf(CG.PATTERNS[LV.key].steps[1].f[0]), pour: true };
  return g ? { x: tx, h: g.heightMm, tilt: tiltOf(g.flow), pour: g.flow > 1 } : null;
}

function bandOf(stage, g) {
  if (stage === 'fill') return { h: [45, 65], t: [20, 30] };
  const st = stage === 'ready' && LV.key !== 'free' ? CG.PATTERNS[LV.key].steps[1] : stage === 'draw' && g ? g.step : null;
  return st ? { h: st.h, t: [st.f[0] ? tiltOf(st.f[0]) : 0, tiltOf(st.f[1])] } : null;
}

function youOf(inp) {
  if (!inp || !inp.seen) return null;
  return { tilt: inp.raw ? inp.raw.tilt : tiltOf(inp.flow) };
}

function paneLiquid(k, lv) {
  const top = 94 - lv * 36, mix = clamp((lv - FILL.esp) / (FILL.half - FILL.esp));
  $('ps' + k + 'Liq').setAttribute('y', top.toFixed(1));
  $('ps' + k + 'Liq').setAttribute('height', (100 - top).toFixed(1));
  $('ps' + k + 'Liq').style.fill = `rgb(${78 + 90 * mix},${44 + 68 * mix},${24 + 42 * mix})`;
  $('ps' + k + 'Half').classList.toggle('hidden', LV.stage !== 'fill');
}

function drawScene(inp, aim, lv, band) {
  const you = LV.input === 'finger' ? null : youOf(inp);
  const tOk = !!(you && band && you.tilt >= band.t[0] - 4 && you.tilt <= band.t[1] + 4);
  const hOk = !!(you && band && inp.h >= band.h[0] - 6 && inp.h <= band.h[1] + 6), hy = (h) => clamp(1 - h / 80) * 100;
  ['Do', 'You'].forEach((k) => paneLiquid(k, lv));
  $('psYouPane').classList.toggle('hidden', LV.input === 'finger');
  $('psDoPane').classList.toggle('hidden', !aim);
  $('psPanes').classList.toggle('hidden', !aim && LV.input === 'finger');
  if (aim) jugAt('Do', aim.x, aim.h, aim.tilt, aim.pour, lv);
  ['psYouJug', 'psYouSt', 'psYouPane'].forEach((id) => { $(id).classList.toggle('ok', tOk); $(id).classList.toggle('off', !!(you && band) && !tOk); });
  ['psYouJug', 'psYouSt'].forEach((id) => $(id).classList.toggle('hidden', !you));
  $('poBand').classList.toggle('hidden', !band);
  if (band) $('poBand').style.cssText = `top:${hy(band.h[1] + 6)}%;bottom:${100 - hy(Math.max(0, band.h[0] - 6))}%`;
  $('poMark').classList.toggle('hidden', !you);
  if (you) $('poMark').style.top = hy(inp.h) + '%';
  $('poHeight').classList.toggle('ok', hOk);
  $('poHeight').classList.toggle('off', !!(you && band) && !hOk);
  $('psKey').classList.toggle('hidden', !you || !band);
  if (you) jugAt('You', inp.x, inp.h, you.tilt, inp.flow > 1, lv);
  $('psYouLab').textContent = you ? 'You' : 'Ring not seen';
}

function heightOff(inp, stage, g) {
  const b = bandOf(stage, g), band = stage === 'fill' || stage === 'draw' ? b && b.h : null;
  if (!inp || !inp.seen || LV.input !== 'ring' || !band) return '';
  if (inp.h < band[0] - 6) return stage === 'fill' ? 'Higher, so the milk sinks' : 'Move higher';
  if (inp.h > band[1] + 6 && stage === 'draw') return 'Move closer';
  const t = inp.raw ? inp.raw.tilt : tiltOf(inp.flow);
  return t < b.t[0] - 4 ? 'Tip the ring more' : t > b.t[1] + 4 ? 'Tip the ring less' : '';
}

function pourHud(inp, g) {
  const spout = $('poSpout'), stage = LV.stage, lv = levelOf(LV.m), draw = stage === 'draw' && g;
  spout.classList.toggle('hidden', !inp);
  if (inp) {
    spout.setAttribute('cx', inp.x.toFixed(1));
    spout.setAttribute('cy', inp.y.toFixed(1));
    spout.setAttribute('r', (3 + inp.h * 0.12).toFixed(1));
    spout.classList.toggle('pouring', inp.flow > 1);
    spout.classList.toggle('lost', !inp.seen);
  }
  $('poSwirl').classList.toggle('nudge', LV.still > 0.8);
  $('poWig').classList.toggle('on', !!(draw && g.hz));
  let tx = 50;
  if (draw) {
    const sp = patPt(spineAt(LV.key, LV.p)), p0 = patPt(spineAt(LV.key, g.step.t0)), p1 = patPt(spineAt(LV.key, g.step.t1 - 0.01));
    tx = g.hz ? sp.x + g.amp * Math.sin(2 * Math.PI * g.hz * LV.t) : patPt(g).x;
    const ty = (g.hz ? sp.y : patPt(g).y).toFixed(1);
    ['poTarget', 'poHalo'].forEach((id) => { $(id).setAttribute('cx', tx.toFixed(1)); $(id).setAttribute('cy', ty); });
    if (g.hz) $('poWig').setAttribute('d', wigD(sp.x, sp.y, g.amp));
    $('poNow').setAttribute('d', routeD(LV.key, g.step.t0, g.step.t1));
    $('poNow').classList.toggle('moves', Math.hypot(p1.x - p0.x, p1.y - p0.y) > 5);
  }
  if (stage === 'ready') { const s = startPt(LV.key); $('poStart').setAttribute('transform', `translate(${s.x.toFixed(1)} ${s.y.toFixed(1)})`); }
  const off = heightOff(inp, stage, g), st = draw ? g.step : null, i = draw ? g.stepIndex : 0;
  drawScene(inp, aimOf(stage, st && g, tx), lv, bandOf(stage, st && g));
  $('poStep').textContent = stage === 'fill' ? 'Circle high' : stage === 'ready' ? 'Go to the dot' : st ? st.label : 'Draw close';
  $('poCueText').textContent = sayOf(stage, st, inp, off);
  $('poCueText').classList.toggle('warn', !!off || (stage === 'fill' && LV.still > 0.8) || !!(inp && !inp.seen && LV.input === 'ring'));
  $('poSteps').querySelectorAll('i').forEach((el, k) => { el.className = k < i ? 'done' : k === i ? 'on' : ''; el.classList.toggle('focus', LV.focus === k); });
  $('poCue').classList.toggle('focus', !!g && LV.focus === i);
  const dbg = LV.debug && inp && inp.raw;
  $('poDebug').textContent = dbg ? `Height ${(inp.raw.z / 10).toFixed(1)} cm (camera ${inp.raw.d.toFixed(0)} × ${LV.k.toFixed(2)}) · tilt ${inp.raw.tilt.toFixed(0)}° · x ${inp.x.toFixed(0)} y ${inp.y.toFixed(0)} · flow ${inp.flow.toFixed(1)} · cup ${Math.round(lv * 100)}%` : '';
}

const wigD = (x, y, a) => `M${(x - a).toFixed(1)} ${y.toFixed(1)} H${(x + a).toFixed(1)} M${(x - a + 4).toFixed(1)} ${(y - 3.4).toFixed(1)} L${(x - a).toFixed(1)} ${y.toFixed(1)} L${(x - a + 4).toFixed(1)} ${(y + 3.4).toFixed(1)} M${(x + a - 4).toFixed(1)} ${(y - 3.4).toFixed(1)} L${(x + a).toFixed(1)} ${y.toFixed(1)} L${(x + a - 4).toFixed(1)} ${(y + 3.4).toFixed(1)}`;

function stopPour() {
  cancelAnimationFrame(LV.raf);
  LV.camRun = (LV.camRun || 0) + 1;
  CG.Tracker.stop();
  pourCamera.stop();
}

function finishPour() {
  const key = LV.key, res = pourTip(key, LV.log, { even: LV.circ / Math.max(0.1, LV.fillT), over: LV.drawLv, full: LV.full });
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

function fillTips(fx) {
  const out = [];
  if (fx.full) out.push({ step: 1, w: 0.95, code: 'full', head: 'The cup filled up before the end', why: 'Start the pattern at half full, and keep the stream steady.' });
  if (fx.even < 0.5) out.push({ step: 0, w: 0.85, code: 'fill-circles', head: 'Pour the fill in circles', why: 'Moving in circles mixes the milk evenly into the espresso before you start to draw.' });
  if (fx.over > 0.62) out.push({ step: 0, w: 0.75, code: 'fill-over', head: 'Start the pattern at half full', why: 'A fuller cup leaves less room to draw.' });
  return out;
}

function pourTip(key, log, fx = { even: 1, over: 0.5, full: false }) {
  const live = log.filter((s) => s.seen), auto = LV.input !== 'ring', fill = fillTips(fx);
  if (key === 'free') {
    if (fill.length) return Object.assign(fill[0], { step: null });
    const pour = live.filter((s) => s.f > 1), hi = pour.filter((s) => s.h > 38).length / (pour.length || 1), lo = pour.filter((s) => s.h < 16).length / (pour.length || 1);
    if (!pour.length) return { code: 'none', head: 'Tilt the ring to pour', why: 'The milk only flows while the ring is tilted, like a jug.' };
    if (auto) return { code: 'free-finger', ok: true, head: 'Now try it with the ring', why: 'With the ring you choose the height yourself: high to fill, close to draw.', next: 'heart' };
    if (lo > 0.75) return { code: 'free-close', head: 'Start higher next time', why: 'You poured close the whole time, so white covered the top. Every pattern starts high, so the milk sinks first.' };
    if (hi > 0.75) return { code: 'free-high', head: 'Bring the ring closer at the end', why: 'From high up the milk sank and the top stayed brown. Close to the screen, white shows.' };
    return { code: 'free-ok', ok: true, head: 'High, then close. That is how every pattern starts.', why: 'Try the heart next. It adds one line through the middle.', next: 'heart' };
  }
  const steps = CG.PATTERNS[key].steps, found = fill;
  steps.forEach((st, i) => {
    const s = live.filter((x) => x.s === i);
    if (s.length < 5) return;
    const pour = st.f[1] > 1, frac = (fn) => s.filter(fn).length / s.length;
    const high = frac((x) => x.h > st.h[1] + 8), low = frac((x) => x.h < st.h[0] - 8);
    if (!auto && st.h[0] < 20 && high > 0.4) found.push({ step: i, w: high, code: 'high', head: 'Bring the ring closer', why: 'Close to the screen is where the white shows.' });
    if (!auto && st.h[0] >= 40 && low > 0.4) found.push({ step: i, w: low, code: 'low', head: 'Start higher', why: 'From high up the milk sinks under the coffee first. Close too early and white spreads everywhere.' });
    if (!auto && st.key === 'cut' && low > 0.4) found.push({ step: i, w: low, code: 'cut-low', head: 'Lift a little for the last line', why: 'A lifted, thin stream cuts a clean line.' });
    if (pour && st.key !== 'fill' && frac((x) => x.f < st.f[0] * 0.5) > 0.4) found.push({ step: i, w: frac((x) => x.f < st.f[0] * 0.5), code: 'flow', head: 'Keep the ring tilted', why: 'The milk stops as soon as the ring is flat.' });
    if (!pour && frac((x) => x.f > 2.5) > 0.5) found.push({ step: i, w: frac((x) => x.f > 2.5), code: 'stop', head: 'Hold the ring flat to stop', why: st.why });
    if (st.hz > 0 && s.length > 20) {
      let turns = 0;
      for (let k = 2; k < s.length; k++) if (Math.sign(s[k].x - s[k - 1].x) !== Math.sign(s[k - 1].x - s[k - 2].x)) turns++;
      const hz = turns / 2 / Math.max(0.5, s[s.length - 1].t - s[0].t), xs = s.map((x) => x.x).sort((a, b) => a - b), amp = (xs[Math.floor(xs.length * 0.9)] - xs[Math.floor(xs.length * 0.1)]) / 2;
      if (amp < 4) found.push({ step: i, w: 0.9, code: 'wiggle-none', head: auto ? 'Wiggle your finger from side to side' : 'Wiggle the ring from side to side', why: 'The side to side movement is what draws the leaves. Follow the arrows.' });
      else if (hz < st.hz * 0.6) found.push({ step: i, w: 0.8, code: 'wiggle-slow', head: 'Wiggle faster', why: 'About two wiggles a second makes the leaves.' });
      else if (amp < 8) found.push({ step: i, w: 0.7, code: 'wiggle-small', head: 'Wiggle wider', why: 'Small wiggles give thin, crowded leaves.' });
    }
  });
  found.sort((a, b) => b.w - a.w);
  if (found.length) return found[0];
  const next = PAT_NEXT[key];
  return { code: 'ok', ok: true, head: 'Close to the target', why: next ? 'Try the ' + LV_PATS[next].name.toLowerCase() + ' next. It adds one move: ' + LV_PATS[next].skill.toLowerCase() + '.' : 'Try it again a little faster.', next };
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

const AR_SHEET = { settings: settingsSheet, words: glossarySheet, help: () => helpSheet(AR.name) };

function setGlasses(on) {
  appState.glasses = on;
  const sheet = !on && AR_SHEET[AR.sub] && (AR.sub !== 'help' || HELP[AR.name] || AR.name === 'brew' || AR.name === 'grind') && AR_SHEET[AR.sub];
  const apply = () => { applyGlasses(document.querySelector('.screen.active').dataset.screen); if (sheet) sheet(); };
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

const QUICK = ['espresso', 'pourover', 'aeropress', 'immersion', 'chemex', 'mokapot'];

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
const arHintOf = (it) => (!it ? AR_HINT : it.adj ? AR_HINT_ADJ : it.act ? AR_HINT : AR_HINT_INFO).replace(arCanBack() ? /^$/ : / · <b>Hold<\/b> to go back/, '');

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
    layout: 'sum', kicker, title: replayName(rec), lead: arChip(rec.model ? 'Flow and pressure through the shot. The shaded band is the time to aim for.' : methodOf(rec.method).window ? 'Your time against the target. The green line is the target.' : 'The time you planned against the time it took.', 'plain'),
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
        { ic: arFa('circle-info'), k: 'Help', t: 'How the app works', s: 'The start page, again', act: () => openGuide('app') },
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

  tutor() {
    const d = guideData(), steps = guideSteps(), [, t, x] = steps[TU.i], last = TU.i === steps.length - 1, plain = (h) => h.replace(/<b>[^<]*<\/b>/, '');
    return {
      layout: 'sum', kicker: d.kicker + ' · ' + d.title + ' · Step ' + (TU.i + 1) + ' of ' + steps.length, title: t, lead: (TU.i === 0 ? arChip(d.lede, 'plain') + (d.why ? arChip(plain(d.why), 'plain') : '') : '') + arChip(x, 'plain'),
      panel: arLend($('tuCard'), 360, false, 'big'),
      items: [
        { ic: arFa(last ? 'play' : 'arrow-right'), t: $('tuNext').textContent, d: last ? plain(d.need) : 'The next step.', act: tuNext },
      ].concat(last ? [] : [{ ic: arFa('forward'), t: 'Skip', d: 'Go straight to the app.', act: tuSkip }]),
      start: 0,
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
      layout: 'sum', kicker: m.name, title: 'Brewing', lead: arChip(m.window ? 'Pour until your scale matches the number.' : 'Pour along with the timer. Each step says what to do.', 'plain'),
      panel: arDiv('ar-col grow', arField('phase', 'ar-sub') + arField('time', 'ar-big') + arField('cue', 'ar-txt') + arDiv('ar-segs', m.phases.map((p) => '<div class="ar-seg"><i></i>' + esc(p.name) + '</div>').join(''))),
      items: [
        m.window ? { ic: arFa('check'), t: 'Done dripping', d: 'Tap in the last step, when the water has drained.', act: arClick('#brewNextBtn') } : { ic: arFa('forward-step'), t: 'Next step', d: 'Moves on before the timer ends.', act: arClick('#brewNextBtn') },
        arHelpCard(),
      ],
      live() {
        const p = currentPhase();
        arSet('phase', esc(p.name + (arText('btK') ? ' · ' + arText('btK') : '')));
        arSet('time', esc(arText('btTime')));
        arSet('cue', esc(arText('btCue')));
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
        arOpen('replay', 'chart-area', replayName(rec), '', '', 'Watch the brew again against the time to aim for.'),
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
        arOpen('replay', 'chart-area', replayName(r), '', '', 'Watch the brew again.'),
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
      items: keys.map((k) => ({ ic: mi('liveart'), t: LV_PATS[k].name, v: LV_PATS[k].skill, d: LV_PATS[k].blurb + ' Tap to pour.', sel: k === LV.key, focus: () => { if (LV.key !== k) pickPattern(k); }, act: () => { pickPattern(k); go('pour'); } }))
        .concat(arHelpCard()),
      start: keys.indexOf(LV.key),
      live() {
        arSet('why', esc(arText('lvWhy')));
      },
    };
  },

  pour() {
    return {
      layout: 'sum', kicker: 'LiveARt · ' + LV_PATS[LV.key].name, title: 'Pour',
      panel: arLend($('poCup'), 300, false) + arDiv('ar-col grow', arField('wait', 'ar-mid sm') + arLend($('poCue'), 360, false, 'fill')),
      items: [{ ic: arFa('chevron-left'), t: 'Back', d: 'Back to the patterns.', act: back }, { ic: arFa('hand-pointer'), t: 'Pour with your finger', d: 'Goes to the phone view and pours with your finger on the screen.', act: () => { setGlasses(false); LV.input = 'finger'; startPour(); } }, arHelpCard()],
      live() {
        arSet('wait', $('po').classList.contains('waiting') ? esc(arText('poWaitHead')) : '');
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
  if (name !== AR.name) {
    AR.sub = null;
    AR.ask = null;
    if (NAV.dir !== 'back') Object.keys(AR.pos).forEach((k) => { if (k.split(':')[0] === name) delete AR.pos[k]; });
  }
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

const arCanBack = () => !!(AR.top || AR.sub || (AR.name !== 'home' && !(AR.name === 'tutor' && NAV.tutor === 'app' && TU.page === 1 && TU.i === 0)));

function arBack() {
  if (!arCanBack()) return;
  buzz('select');
  if (AR.top) arTop(false);
  else if (AR.sub) arSub(null);
  else if (AR.name === 'tutor') tuBack();
  else back();
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
initTutor();
initNav();
initPrep();
if (CG.Tracker.available()) CG.Tracker.load();
renderHome();
arInit();

const DEEP = { ring: () => openMode('liveart'), plate: () => quickMethod('espresso') };
const deepKey = location.hash.slice(1);
if (DEEP[deepKey]) {
  history.replaceState(null, '', location.pathname + location.search);
  tlog('qr', { prop: deepKey });
  DEEP[deepKey]();
} else openGuide('app');
