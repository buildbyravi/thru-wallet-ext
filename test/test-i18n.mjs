import assert from 'node:assert/strict';
import { messages } from '../src/ui/i18n/messages.js';
import { translate } from '../src/ui/i18n/translate.js';

const keys = Object.keys(messages.en);
assert.deepEqual(Object.keys(messages['zh-CN']).sort(), [...keys].sort());
for (const key of keys) {
  assert.ok(messages['zh-CN'][key].trim(), `empty translation: ${key}`);
  const placeholders = str => [...str.matchAll(/\{([A-Za-z][A-Za-z0-9_]*)\}/g)].map(m => m[1]).sort();
  assert.deepEqual(placeholders(messages['zh-CN'][key]), placeholders(messages.en[key]), key);
}
assert.equal(translate('zh-CN', 'common.wallet'), '钱包');
assert.equal(translate('unsupported', 'common.wallet'), 'Wallet');
assert.equal(translate('zh-CN', 'review.sendTo', { amount: '1 THRU', recipient: 'taTest{amount}' }),
  '向 taTest{amount} 发送 1 THRU', 'interpolated values are never recursively translated');
assert.equal(translate('zh-CN', 'review.sendTo', { amount: '1 THRU' }),
  '向 {recipient} 发送 1 THRU');
assert.throws(() => translate('en', 'toString'), /Unknown message key/);
assert.throws(() => translate('en', 'not-a-key'), /Unknown message key/);
assert.throws(() => translate('toString', 'not-a-key'), /Unknown message key/);
console.log('i18n catalog foundation checks passed; language not enabled.');
