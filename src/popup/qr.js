// Local QR encoding with the vendored qrcode-generator (MIT, Kazuhiko Arase).
import qrcode from './vendor/qrcode-generator.js';

const SIZE = 208;
const QUIET_MODULES = 4;

export function renderQR(canvas, data) {
  const qr = qrcode(0, 'M');
  qr.addData(data);
  qr.make();

  const modules = qr.getModuleCount();
  const cell = Math.floor(SIZE / (modules + 2 * QUIET_MODULES));
  const inset = Math.floor((SIZE - modules * cell) / 2);
  canvas.width = SIZE;
  canvas.height = SIZE;

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('QR canvas is unavailable.');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, SIZE, SIZE);
  ctx.fillStyle = '#000';
  for (let row = 0; row < modules; row++) {
    for (let col = 0; col < modules; col++) {
      if (qr.isDark(row, col)) ctx.fillRect(inset + col * cell, inset + row * cell, cell, cell);
    }
  }
}
