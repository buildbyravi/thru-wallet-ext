// Icons as DATA, built into real SVG nodes.
//
// The deleted src/popup/icons.js returned SVG markup as template strings, which forced
// every caller to use innerHTML. That was fine for trusted geometry but it made the icon set
// a standing reason to keep an innerHTML sink in the codebase, and sinks get reused for
// untrusted values later. It went with the launchpad quarantine; this is the replacement.
//
// So the geometry lives here as arrays of [tag, attrs] and is built with createElementNS.
// Same paths, same visual result, no HTML parser involved.
//
// Icons are converted as routes migrate. Add what a route needs; there is no value in
// transcribing the whole set ahead of use.

import { h } from './dom.js';

/** @type {Record<string, Array<[string, Object]>>} */
const SHAPES = {
  lock: [
    ['rect', { x: 3, y: 11, width: 18, height: 11, rx: 2 }],
    ['path', { d: 'M7 11V7a5 5 0 0 1 10 0v4' }],
  ],
  unlock: [
    ['rect', { x: 3, y: 11, width: 18, height: 11, rx: 2 }],
    ['path', { d: 'M7 11V7a5 5 0 0 1 9.9-1' }],
  ],
  eye: [
    ['path', { d: 'M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z' }],
    ['circle', { cx: 12, cy: 12, r: 3 }],
  ],
  eyeOff: [
    ['path', { d: 'M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19M14.12 14.12a3 3 0 1 1-4.24-4.24' }],
    ['line', { x1: 1, y1: 1, x2: 23, y2: 23 }],
  ],
  back: [['polyline', { points: '15 18 9 12 15 6' }]],
  chevronRight: [['polyline', { points: '9 18 15 12 9 6' }]],
  chevronDown: [['polyline', { points: '6 9 12 15 18 9' }]],
  check: [['polyline', { points: '20 6 9 17 4 12' }]],
  x: [
    ['line', { x1: 18, y1: 6, x2: 6, y2: 18 }],
    ['line', { x1: 6, y1: 6, x2: 18, y2: 18 }],
  ],
  plus: [
    ['line', { x1: 12, y1: 5, x2: 12, y2: 19 }],
    ['line', { x1: 5, y1: 12, x2: 19, y2: 12 }],
  ],
  copy: [
    ['rect', { x: 9, y: 9, width: 13, height: 13, rx: 2 }],
    ['path', { d: 'M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1' }],
  ],
  warning: [
    ['path', { d: 'M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z' }],
    ['line', { x1: 12, y1: 9, x2: 12, y2: 13 }],
    ['line', { x1: 12, y1: 17, x2: 12.01, y2: 17 }],
  ],
  info: [
    ['circle', { cx: 12, cy: 12, r: 10 }],
    ['line', { x1: 12, y1: 16, x2: 12, y2: 12 }],
    ['line', { x1: 12, y1: 8, x2: 12.01, y2: 8 }],
  ],
  shield: [['path', { d: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z' }]],
  clock: [
    ['circle', { cx: 12, cy: 12, r: 10 }],
    ['polyline', { points: '12 6 12 12 16 14' }],
  ],
  key: Object.assign([
    ['path', {
      d: 'M11.412 11.9329L20.3449 3M11.3427 12.0899C12.6786 13.4011 13.2058 15.3238 12.7241 17.1281C12.2425 18.9325 10.8257 20.3417 9.01188 20.8208C7.19802 21.2999 5.26514 20.7755 3.94703 19.4467C1.96514 17.4054 1.99348 14.1609 4.01074 12.1542C6.02801 10.1476 9.28974 10.1194 11.3417 12.0909L11.3427 12.0899ZM15.2503 8.20192L18.1028 11.0394L21.4308 7.729L18.5783 4.89148L15.2503 8.20192Z',
    }],
  ], { viewBox: '0 0 24 24', stroke: 'currentColor', strokeWidth: 1.5, fill: 'none' }),
  seed: Object.assign([
    ['path', {
      d: 'M19.1783 3H5.07207C4.30578 3 3.68457 3.6212 3.68457 4.3875V20.1125C4.30578 20.8788 5.07207 21.5 5.07207 21.5H19.1783C19.9446 21.5 20.5658 20.8788 20.5658 20.1125V4.3875C20.5658 3.6212 19.9446 3 19.1783 3Z',
      stroke: 'currentColor',
      'stroke-width': 1.5,
      fill: 'none',
    }],
    ['path', {
      d: 'M14.8 9.6C14.5 8.3 13.5 7.5 12.1 7.5C10.4 7.5 9.3 8.5 9.3 9.8C9.3 11.2 10.4 11.8 11.9 12.2L12.3 12.3C13.9 12.7 15 13.4 15 14.8C15 16.2 13.8 17.1 12.1 17.1C10.4 17.1 9.4 16.2 9.2 14.8',
      stroke: 'currentColor',
      'stroke-width': 1.6,
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
      fill: 'none',
    }],
  ], { viewBox: '0 0 24 24', fill: 'none' }),
  wallet: [
    ['path', { d: 'M20 12V8H6a2 2 0 0 1-2-2c0-1.1.9-2 2-2h12v4' }],
    ['path', { d: 'M4 6v12a2 2 0 0 0 2 2h14v-4' }],
    ['circle', { cx: 16, cy: 14, r: 1 }],
  ],
  settings: [
    ['circle', { cx: 12, cy: 12, r: 3 }],
    ['path', { d: 'M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z' }],
  ],
  refresh: Object.assign([
    ['path', {
      d: 'M13.4375 6.3125H11C10.6891 6.3125 10.4375 6.06055 10.4375 5.74999C10.4375 5.43945 10.6891 5.1875 11 5.1875H11.9785C11.0959 3.94028 9.64441 3.12501 8.00002 3.12501C5.30762 3.12501 3.12502 5.30764 3.12502 7.99999C3.12502 10.6924 5.30764 12.875 8.00002 12.875C10.6924 12.875 12.875 10.6924 12.875 7.99999C12.875 7.68946 13.1265 7.43751 13.4375 7.43751C13.748 7.43751 14 7.68946 14 7.99999C14 11.3137 11.3134 14 8.00001 14C4.68652 14 2 11.3137 2 7.99999C2 4.68631 4.68652 2 8.00001 2C10.011 2 11.7872 2.99148 12.875 4.51054V3.5C12.875 3.18944 13.1265 2.9375 13.4375 2.9375C13.748 2.9375 14 3.18944 14 3.5V5.75C14 6.06055 13.748 6.3125 13.4375 6.3125Z',
      fill: 'currentColor',
    }],
  ], { viewBox: '0 0 16 16', fill: 'currentColor' }),
  external: [
    ['path', { d: 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6' }],
    ['polyline', { points: '15 3 21 3 21 9' }],
    ['line', { x1: 10, y1: 14, x2: 21, y2: 3 }],
  ],
  trash: [
    ['polyline', { points: '3 6 5 6 21 6' }],
    ['path', { d: 'M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2' }],
  ],
  search: [
    ['circle', { cx: 11, cy: 11, r: 8 }],
    ['line', { x1: 21, y1: 21, x2: 16.65, y2: 16.65 }],
  ],
  spinner: [
    ['circle', { cx: 12, cy: 12, r: 9, 'stroke-opacity': 0.25 }],
    ['path', { d: 'M21 12a9 9 0 0 0-9-9' }],
  ],
  send: [
    ['line', { x1: 7, y1: 17, x2: 17, y2: 7 }],
    ['polyline', { points: '7 7 17 7 17 17' }],
  ],
  receive: [
    ['line', { x1: 17, y1: 7, x2: 7, y2: 17 }],
    ['polyline', { points: '17 17 7 17 7 7' }],
  ],
  swap: [
    ['path', { d: 'm16 3 4 4-4 4' }],
    ['path', { d: 'M20 7H4' }],
    ['path', { d: 'm8 21-4-4 4-4' }],
    ['path', { d: 'M4 17h16' }],
  ],
  globe: [
    ['circle', { cx: 12, cy: 12, r: 10 }],
    ['line', { x1: 2, y1: 12, x2: 22, y2: 12 }],
    ['path', { d: 'M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z' }],
  ],
  gas: [
    ['path', { d: 'M3 22h12' }],
    ['path', { d: 'M4 9h10' }],
    ['path', { d: 'M14 22V4a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v18' }],
    ['path', { d: 'M14 13h2a2 2 0 0 1 2 2v2a2 2 0 0 0 2 2h0a2 2 0 0 0 2-2V9.83a2 2 0 0 0-.59-1.42L18 5' }],
  ],
  sidePanel: [
    ['rect', { x: 3, y: 3, width: 18, height: 18, rx: 3 }],
    ['line', { x1: 15, y1: 3, x2: 15, y2: 21 }],
  ],
  faucet: [
    ['line', { x1: 12, y1: 5, x2: 12, y2: 19 }],
    ['line', { x1: 5, y1: 12, x2: 19, y2: 12 }],
  ],
  history: [
    ['path', { d: 'M3 12a9 9 0 1 0 3-6.7' }],
    ['polyline', { points: '3 4 3 9 8 9' }],
    ['polyline', { points: '12 7 12 12 15 15' }],
  ],
  bolt: [
    ['polygon', { points: '13 2 3 14 12 14 11 22 21 10 12 10 13 2' }],
  ],
  coins: [
    ['circle', { cx: 8, cy: 8, r: 6 }],
    ['path', { d: 'M18.09 10.37A6 6 0 1 1 10.34 18' }],
    ['line', { x1: 7, y1: 6, x2: 9, y2: 6 }],
    ['line', { x1: 8, y1: 5, x2: 8, y2: 7 }],
  ],
  rocket: [
    ['path', { d: 'M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z' }],
    ['path', { d: 'M12 15l-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z' }],
    ['path', { d: 'M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0' }],
    ['path', { d: 'M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5' }],
  ],
  edit: [
    ['path', { d: 'M12 20h9' }],
    ['path', { d: 'M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z' }],
  ],
  help: [
    ['circle', { cx: 12, cy: 12, r: 10 }],
    ['path', { d: 'M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3' }],
    ['line', { x1: 12, y1: 17, x2: 12.01, y2: 17 }],
  ],
  bell: [
    ['path', { d: 'M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9' }],
    ['path', { d: 'M13.73 21a2 2 0 0 1-3.46 0' }],
  ],
  pending: Object.assign([
    ['path', {
      d: 'M23.3665 12C23.7256 12 24.0185 12.2912 23.9991 12.6495C23.8559 15.2914 22.8419 17.819 21.1058 19.8327C19.2279 22.0108 16.6298 23.4428 13.7844 23.868C10.939 24.2932 8.03537 23.6834 5.60195 22.1496C3.16853 20.6158 1.36706 18.2599 0.525371 15.5106C-0.316314 12.7613 -0.142268 9.80146 1.01584 7.16962C2.17394 4.53778 4.23913 2.40891 6.83557 1.17044C9.432 -0.068032 12.3871 -0.333791 15.1631 0.421526C17.7295 1.11981 19.985 2.64786 21.583 4.75749C21.7997 5.0436 21.7199 5.4487 21.4223 5.64947C21.1247 5.85024 20.7221 5.77048 20.5035 5.4858C19.0813 3.63355 17.0872 2.29179 14.8215 1.67532C12.3461 1.00179 9.71099 1.23877 7.39571 2.34313C5.08043 3.4475 3.23888 5.34583 2.20618 7.69268C1.17348 10.0395 1.01828 12.6789 1.76882 15.1304C2.51936 17.582 4.12576 19.6828 6.29567 21.0505C8.46559 22.4183 11.0548 22.962 13.5921 22.5829C16.1294 22.2037 18.4461 20.9268 20.1207 18.9845C21.6534 17.2067 22.5549 14.9798 22.6966 12.6494C22.7184 12.2912 23.0074 12 23.3665 12Z',
      fill: 'currentColor',
    }],
  ], { viewBox: '0 0 24 24', fill: 'currentColor' }),
  pendingSpin: Object.assign([
    ['path', {
      d: 'M9.08354 0.851769C9.18588 0.913191 9.25963 1.01275 9.28856 1.12855C9.31749 1.24434 9.29924 1.36689 9.23782 1.46923C9.17639 1.57157 9.07683 1.64531 8.96103 1.67425C8.84523 1.70318 8.72268 1.68492 8.62034 1.6235C7.82899 1.1484 6.92302 0.898169 5.99999 0.899768C3.1833 0.899768 0.899999 3.18302 0.899999 5.99965C0.899999 8.81629 3.1833 11.0995 5.99999 11.0995C8.81669 11.0995 11.1 8.81628 11.1 5.99965C11.1016 5.07678 10.8515 4.17094 10.3765 3.37966C10.3461 3.32899 10.326 3.27282 10.3173 3.21437C10.3086 3.15592 10.3115 3.09633 10.3258 3.039C10.3402 2.98167 10.3657 2.92773 10.4008 2.88025C10.436 2.83277 10.4802 2.79268 10.5309 2.76227C10.5816 2.73187 10.6377 2.71175 10.6962 2.70305C10.7546 2.69435 10.8142 2.69725 10.8716 2.71158C10.9289 2.72592 10.9828 2.7514 11.0303 2.78658C11.0778 2.82176 11.1179 2.86595 11.1483 2.91662C11.7072 3.84777 12.0016 4.91366 12 5.99965C12 9.31322 9.31364 11.9995 5.99999 11.9995C2.68635 11.9995 -1.17424e-07 9.31322 -2.62268e-07 5.99965C-4.07112e-07 2.68608 2.68635 -0.000211833 5.99999 -0.000211978C7.10099 -0.000212026 8.15954 0.297231 9.08354 0.851769Z',
      fill: 'currentColor',
    }],
  ], { viewBox: '0 0 12 12', fill: 'currentColor' }),
};

export const ICON_NAMES = Object.keys(SHAPES);

/**
 * Build an icon as an SVG node.
 * @param {string} name
 * @param {number} [size=16]
 * @param {{ title?: string, className?: string, viewBox?: string, fill?: string, stroke?: string, strokeWidth?: number }} [options]
 *   Pass `title` only for a standalone meaningful graphic. An icon inside a button that
 *   already has an accessible name must stay aria-hidden, or screen readers announce it
 *   twice.
 * @returns {SVGElement}
 */
export function icon(name, size = 16, options = {}) {
  const shapes = SHAPES[name];
  if (!shapes) throw new Error(`icon(): unknown icon '${name}'. Add its geometry to src/ui/kit/icon.js.`);

  const hasCustomFill = Object.prototype.hasOwnProperty.call(shapes, 'fill');
  const viewBox = options.viewBox || shapes.viewBox || '0 0 24 24';
  const fill = options.fill || (hasCustomFill ? shapes.fill : null) || 'none';
  const stroke = options.stroke || shapes.stroke || (hasCustomFill ? 'none' : 'currentColor');
  const strokeWidth = options.strokeWidth ?? shapes.strokeWidth ?? (hasCustomFill ? 0 : 2);

  const children = shapes.map(([tag, attrs]) => h(tag, attrs));
  if (options.title) {
    children.unshift(h('title', { text: options.title }));
  }

  const svgAttrs = {
    width: size,
    height: size,
    viewBox,
    fill,
    class: options.className,
    ...(options.title ? { role: 'img' } : { 'aria-hidden': 'true', focusable: 'false' }),
  };
  if (stroke !== 'none') {
    svgAttrs.stroke = stroke;
    svgAttrs['stroke-width'] = strokeWidth;
    svgAttrs['stroke-linecap'] = 'round';
    svgAttrs['stroke-linejoin'] = 'round';
  }

  return h('svg', svgAttrs, children);
}
