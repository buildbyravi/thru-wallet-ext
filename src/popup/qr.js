/**
 * QR code renderer for wallet receive addresses.
 * Uses qrcode-generator (MIT, Kazuhiko Arase) vendored in vendor/.
 *
 * Renders to a <canvas> element with the wallet's Industrial UI palette:
 * dark background + amber modules (the "dots"). No external network calls.
 *
 * Usage:
 *   import { renderQR } from './qr.js';
 *   renderQR(canvasElement, 'taABC...xyz', { size: 200 });
 */

import qrcode from './vendor/qrcode-generator.js';

/**
 * Render a QR code onto a <canvas> element.
 * @param {HTMLCanvasElement} canvas — target canvas
 * @param {string} data — the string to encode (address)
 * @param {object} [opts]
 * @param {number} [opts.size=200] — canvas width/height in px
 * @param {string} [opts.fg='#ffb224'] — module (dot) color
 * @param {string} [opts.bg='#121417'] — background color
 * @param {number} [opts.margin=2] — quiet zone in modules
 */
export function renderQR(canvas, data, opts = {}) {
  const { size = 200, fg = '#ffb224', bg = '#121417', margin = 2 } = opts;

  // Type 0 = auto-detect version. ECC level M = good error correction.
  const qr = qrcode(0, 'M');
  qr.addData(data);
  qr.make();

  const moduleCount = qr.getModuleCount();
  const totalModules = moduleCount + margin * 2;

  canvas.width = size;
  canvas.height = size;

  const ctx = canvas.getContext('2d');
  const cellSize = size / totalModules;

  // Background
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, size, size);

  // Modules
  ctx.fillStyle = fg;
  for (let row = 0; row < moduleCount; row++) {
    for (let col = 0; col < moduleCount; col++) {
      if (qr.isDark(row, col)) {
        const x = (col + margin) * cellSize;
        const y = (row + margin) * cellSize;
        // Slight rounding for a cleaner look at small sizes
        ctx.fillRect(
          Math.round(x),
          Math.round(y),
          Math.ceil(cellSize),
          Math.ceil(cellSize),
        );
      }
    }
  }
}
