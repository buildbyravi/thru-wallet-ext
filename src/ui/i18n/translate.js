// Pure frontend translation lookup: no DOM scanning, storage, RPC or network requests.
// Interpolation is returned as plain text; callers must use the existing safe DOM helpers.
import { messages } from './messages.js';

export function translate(locale, key, values = {}) {
  const english = Object.hasOwn(messages.en, key) ? messages.en[key] : undefined;
  if (typeof english !== 'string') throw new Error(`Unknown message key: ${key}`);
  const template = Object.hasOwn(messages, locale) ? messages[locale][key] ?? english : english;
  return template.replace(/\{([A-Za-z][A-Za-z0-9_]*)\}/g, (match, name) =>
    Object.hasOwn(values, name) ? String(values[name]) : match);
}
