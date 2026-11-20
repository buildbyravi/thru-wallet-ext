#!/usr/bin/env node
// Verify the pixels requested by our canvas renderer against the encoded matrix.
import assert from 'node:assert/strict';
import { renderQR } from '../src/popup/qr.js';
import qrcode from '../src/popup/vendor/qrcode-generator.js';

function draw(address) {
  const calls = [];
  const context = {
    fillStyle: '',
    fillRect(...rect) { calls.push([this.fillStyle, ...rect]); },
  };
  const canvas = { getContext: () => context };
  renderQR(canvas, address);
  assert.equal(canvas.width, 208);
  assert.equal(canvas.height, 208);
  assert.deepEqual(calls.shift(), ['#fff', 0, 0, 208, 208]);
  const qr = qrcode(0, 'M');
  qr.addData(address);
  qr.make();
  const count = qr.getModuleCount();
  const [, offsetX, offsetY, cell] = calls[0];
  assert.ok(Number.isInteger(cell) && cell > 0);
  assert.ok(offsetX === offsetY && offsetX >= 4 * cell
    && 208 - offsetX - count * cell >= 4 * cell, 'white quiet zone on all four sides');
  const expected = [];
  for (let row = 0; row < count; row++) {
    for (let col = 0; col < count; col++) {
      if (qr.isDark(row, col)) expected.push(['#000', offsetX + col * cell, offsetY + row * cell, cell, cell]);
    }
  }
  assert.deepEqual(calls, expected, 'solid, integer-aligned black modules reproduce every encoded cell');
  return calls;
}

const address = 'taTHRU1234567890abcdefABCDEF1234567890abcdef1234';
assert.notDeepEqual(draw(address), draw(`${address.slice(0, -1)}5`), 'another address produces another matrix');
assert.throws(() => renderQR({ getContext: () => null }, address), /unavailable/);
console.log('QR renderer checks passed: exact matrix, 4-module quiet zone, changed address, unavailable canvas.');
