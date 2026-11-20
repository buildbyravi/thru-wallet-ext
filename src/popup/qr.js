/**
 * QR code renderer for wallet receive addresses.
 * Uses qrcode-generator (MIT, Kazuhiko Arase) vendored in vendor/.
 *
 * Renders to a <canvas> in the Thru brand palette, sampled from the official
 * thru.org "center" asset: ice paper (#E3F5F6 family), charcoal-slate
 * (#2C383E), and the scarlet-to-maroon red ramp (#DE5D63 ... #AB5255).
 * Two looks:
 *
 *   raised — Thru-red gradient "worm" modules with rounded corners, slate
 *            finder eyes, and a soft slate shadow lifting tiles off the
 *            paper. The 3D brand treatment.
 *   flat   — solid crimson squares on the same paper. Used when the canvas
 *            2D context lacks roundRect/createLinearGradient (old engines,
 *            DOM shims). Still brand-correct and high-contrast; deliberately
 *            NOT the old amber-on-dark inverted look, which weaker scanners
 *            handle poorly.
 *
 * Canvas drawing only — no external network calls.
 */
import qrcode from './vendor/qrcode-generator.js';

/** Brand colors sampled from the thru.org center asset histogram. */
export const THRU_QR = {
  paper: '#edf7f8',
  slate: '#2c383e',
  redHi: '#e25057',
  redLo: '#a93a41',
  flat: '#d0444b',
};

/**
 * Render a QR code onto a <canvas> element.
 * @param {HTMLCanvasElement} canvas — target canvas
 * @param {string} data — the string to encode (address)
 * @param {object} [opts]
 * @param {number} [opts.size=200] — canvas width/height in px
 * @param {number} [opts.margin=2] — quiet zone in modules
 * @param {'raised'|'flat'} [opts.theme='raised'] — look; 'raised' degrades to
 *   'flat' on contexts without roundRect/gradients
 */
export function renderQR(canvas, data, opts = {}) {
  const { size = 200, margin = 2, theme = 'raised' } = opts;

  // Type 0 = auto-detect version. ECC level M = good error correction.
  const qr = qrcode(0, 'M');
  qr.addData(data);
  qr.make();

  const moduleCount = qr.getModuleCount();
  const totalModules = moduleCount + margin * 2;

  canvas.width = size;
  canvas.height = size;

  const ctx = canvas.getContext('2d');
  const cell = size / totalModules;
  const xy = (i) => (i + margin) * cell;

  ctx.fillStyle = THRU_QR.paper;
  ctx.fillRect(0, 0, size, size);

  const raised = theme === 'raised'
    && typeof ctx.roundRect === 'function'
    && typeof ctx.createLinearGradient === 'function';

  if (!raised) {
    ctx.fillStyle = THRU_QR.flat;
    for (let row = 0; row < moduleCount; row++) {
      for (let col = 0; col < moduleCount; col++) {
        if (qr.isDark(row, col)) {
          ctx.fillRect(
            Math.round(xy(col)),
            Math.round(xy(row)),
            Math.ceil(cell),
            Math.ceil(cell),
          );
        }
      }
    }
    return;
  }

  // Raised: gradient worms + slate eyes + paper discs, with one soft shadow.
  const grad = ctx.createLinearGradient(0, 0, 0, size);
  grad.addColorStop(0, THRU_QR.redHi);
  grad.addColorStop(1, THRU_QR.redLo);

  const isEye = (r, c) => (r < 7 && c < 7) || (r < 7 && c >= moduleCount - 7)
    || (r >= moduleCount - 7 && c < 7);

  ctx.save();
  ctx.shadowColor = 'rgba(44, 56, 62, 0.28)'; // slate-tinted depth
  ctx.shadowBlur = cell * 0.5;
  ctx.shadowOffsetY = cell * 0.26;

  ctx.fillStyle = grad;
  const radius = cell * 0.34;
  for (let row = 0; row < moduleCount; row++) {
    for (let col = 0; col < moduleCount; col++) {
      if (qr.isDark(row, col) && !isEye(row, col)) {
        ctx.beginPath();
        ctx.roundRect(xy(col), xy(row), cell, cell, radius);
        ctx.fill();
      }
    }
  }

  // Finder eyes: slate rounded square, paper pupil ring, gradient pupil. The
  // paper ring is drawn with the shadow off so it does not smear the slate.
  for (const [er, ec] of [[0, 0], [0, moduleCount - 7], [moduleCount - 7, 0]]) {
    ctx.fillStyle = THRU_QR.slate;
    ctx.beginPath();
    ctx.roundRect(xy(ec), xy(er), cell * 7, cell * 7, cell * 1.6);
    ctx.fill();

    ctx.shadowColor = 'rgba(0, 0, 0, 0)';
    ctx.fillStyle = THRU_QR.paper;
    ctx.beginPath();
    ctx.roundRect(xy(ec) + cell, xy(er) + cell, cell * 5, cell * 5, cell * 1.1);
    ctx.fill();
    ctx.shadowColor = 'rgba(44, 56, 62, 0.28)';

    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.roundRect(xy(ec) + cell * 2, xy(er) + cell * 2, cell * 3, cell * 3, cell * 0.8);
    ctx.fill();
  }
  ctx.restore();
}
