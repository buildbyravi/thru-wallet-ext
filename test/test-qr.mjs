#!/usr/bin/env node
// QR renderer checks: brand palette, raised look, and the flat degradation path.
// Renders onto a fake canvas whose 2D context records what the renderer asks for —
// pure math, no DOM, no browser.
import { renderQR, THRU_QR } from '../src/popup/qr.js';

let pass = 0, fail = 0;
function ok(cond, label, detail) {
  if (cond) { pass++; console.log(`  ok - ${label}`); }
  else { fail++; console.log(`  FAIL - ${label}${detail != null ? ` :: ${detail}` : ''}`); }
}

const ADDRESS = 'taTHRU1234567890abcdefABCDEF1234567890abcdef1234';

function fakeCtx({ roundRect = true } = {}) {
  const calls = {
    fillRect: [], fillStyleValues: [], roundRect: 0, fills: [], gradients: [],
    saves: 0, restores: 0,
  };
  const saved = [];
  const state = (ctx) => ({
    fillStyle: ctx.fillStyle, shadowColor: ctx.shadowColor, shadowBlur: ctx.shadowBlur,
    shadowOffsetX: ctx.shadowOffsetX, shadowOffsetY: ctx.shadowOffsetY,
  });
  const ctx = {
    fillStyle: '',
    shadowColor: '',
    shadowBlur: 0,
    shadowOffsetX: 0,
    shadowOffsetY: 0,
    save() { calls.saves++; saved.push(state(this)); },
    restore() {
      calls.restores++;
      if (!saved.length) throw new Error('Canvas restore() without save()');
      Object.assign(this, saved.pop());
    },
    beginPath() { this.pathRounded = false; },
    fill() { calls.fills.push({ ...state(this), rounded: this.pathRounded }); },
    fillRect(...a) { calls.fillRect.push(a); calls.fillStyleValues.push(this.fillStyle); },
    createLinearGradient(...a) {
      const stops = [];
      const g = { addColorStop: (at, color) => stops.push([at, color]) };
      calls.gradients.push({ args: a, stops, gradient: g });
      return g;
    },
  };
  if (roundRect) ctx.roundRect = () => { calls.roundRect++; ctx.pathRounded = true; };
  return { ctx, calls };
}

function fakeCanvas(ctxWrap) {
  return { width: 0, height: 0, getContext: () => ctxWrap.ctx };
}

{
  // Raised path ----------------------------------------------------------
  const w = fakeCtx();
  const canvas = fakeCanvas(w);
  renderQR(canvas, ADDRESS, { size: 200 });

  ok(canvas.width === 200 && canvas.height === 200, 'canvas is sized to the requested side');
  ok(w.calls.fillRect.length === 1 && w.calls.fillRect[0].join(',') === '0,0,200,200'
    && w.calls.fillStyleValues[0] === THRU_QR.paper,
    'the paper background covers the full canvas including the quiet zone',
    `${JSON.stringify(w.calls.fillRect[0])} fill=${w.calls.fillStyleValues[0]}`);
  ok(w.calls.gradients.length === 1, 'one brand gradient is created');
  const stops = w.calls.gradients[0].stops;
  ok(stops[0][1] === THRU_QR.redHi && stops[1][1] === THRU_QR.redLo,
    `the gradient ramps from scarlet (${THRU_QR.redHi}) to maroon (${THRU_QR.redLo})`);
  ok(w.calls.gradients[0].args.join(',') === '0,0,0,200', 'the gradient runs top-to-bottom across the QR');
  ok(w.calls.roundRect > 300, `rounded "worm" modules are drawn (${w.calls.roundRect} rounded rects)`);
  const raisedModules = w.calls.fills.filter((draw) => draw.rounded
    && draw.fillStyle === w.calls.gradients[0].gradient);
  ok(raisedModules.length > 300 && raisedModules.every((draw) => draw.shadowBlur > 0
    && draw.shadowOffsetY > 0 && draw.shadowColor === 'rgba(44, 56, 62, 0.28)'),
    'every raised module is actually drawn with a soft slate shadow');
  ok(w.calls.fills.filter((draw) => draw.fillStyle === THRU_QR.paper).length === 3
    && w.calls.fills.filter((draw) => draw.fillStyle === THRU_QR.paper)
      .every((draw) => draw.shadowColor === 'rgba(0, 0, 0, 0)'),
    'finder-eye paper rings are drawn without shadow');
  ok(w.calls.saves === 1 && w.calls.restores === 1 && w.ctx.shadowColor === ''
    && w.ctx.shadowBlur === 0 && w.ctx.shadowOffsetY === 0 && w.ctx.fillStyle === THRU_QR.paper,
    'the renderer restores canvas state after drawing');

  // Contrast: WCAG relative-luminance ratio of both gradient ends vs paper must
  // stay scanner-sane (QR readers need far less than text, but keep >= 3:1 anyway).
  const lum = (hex) => {
    const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const ratio = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  const paperL = lum(THRU_QR.paper);
  ok(ratio(lum(THRU_QR.redHi), paperL) >= 3 && ratio(lum(THRU_QR.redLo), paperL) >= 3,
    'both gradient ends keep >= 3:1 luminance contrast against the paper');
  ok(ratio(lum(THRU_QR.slate), paperL) >= 3, 'the slate finder eyes keep >= 3:1 contrast');
}

{
  // Flat path (no roundRect on the context) -------------------------------
  const w = fakeCtx({ roundRect: false });
  renderQR(fakeCanvas(w), ADDRESS, { size: 200 });
  ok(w.calls.roundRect === 0 && w.calls.fillRect.length > 1,
    'missing roundRect degrades to flat squares');
  ok(w.calls.fillStyleValues.slice(1).every((v) => v === THRU_QR.flat),
    `flat modules use solid brand crimson (${THRU_QR.flat}), not the old amber inversion`);
  ok(w.ctx.shadowColor === '' && w.ctx.shadowBlur === 0, 'no shadow on the flat path');
}

{
  // Explicit theme: 'flat' request stays flat even on a capable context ----
  const w = fakeCtx();
  renderQR(fakeCanvas(w), ADDRESS, { size: 200, theme: 'flat' });
  ok(w.calls.roundRect === 0 && w.calls.gradients.length === 0,
    "theme 'flat' skips gradients and rounding on capable contexts too");
}

console.log(`QR renderer checks: ${pass}/${pass + fail} passed.`);
if (fail) process.exit(1);
