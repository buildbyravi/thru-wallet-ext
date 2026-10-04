# DevTools extraction commands

> [!NOTE]
> Reference tool notebook. Use `docs/DOCS_INDEX.md` for the documentation map and
> `docs/STATUS_AND_ROADMAP.md` for current state.

Console one-liners for pulling structure, styles, and copy out of any extension or web UI
(the Rabby-element workflow: inspect → run → paste into chat or a spec). Open the target
UI first (`chrome://extensions` → your extension → Inspect views: popup), press F12, select
the element in the **Elements** panel so `$0` points at it, then run the command on the
**Console** tab. `copy(...)` puts the result straight on your clipboard.

## Structure

```js
// Pretty-printed outer HTML (the one you will use most)
copy($0.outerHTML.replace(/></g, '>\n<'))
```

```js
// Compact structure map: tag + first 4 classes + text, indented — readable in chat,
// unlike full outerHTML
copy((() => {
  const walk = (el, depth = 0) => [...el.children].map((c) => {
    const cls = typeof c.className === 'string' && c.className.trim()
      ? '.' + c.className.trim().split(/\s+/).slice(0, 4).join('.') : '';
    const text = c.children.length ? '' : (c.textContent.trim() ? ` "${c.textContent.trim().slice(0, 48)}"` : '');
    return '  '.repeat(depth) + c.tagName.toLowerCase() + cls + text + '\n' + (c.children.length ? walk(c, depth + 1) : '');
  }).join('');
  return walk($0);
})())
```

## Styles

```js
// Computed layout box of the selected element
copy((() => {
  const s = getComputedStyle($0);
  const keys = ['display', 'position', 'width', 'height', 'padding', 'margin', 'gap',
    'flexDirection', 'justifyContent', 'alignItems', 'borderRadius', 'background',
    'color', 'fontSize', 'fontWeight', 'lineHeight', 'boxShadow', 'transform', 'transition'];
  return Object.fromEntries(keys.map((k) => [k, s[k]]));
})())
```

```js
// Design vocabulary of a subtree: every class name used (Tailwind mines well with this)
copy([...new Set([...$0.querySelectorAll('*'), $0]
  .flatMap((e) => (typeof e.className === 'string' ? e.className.split(/\s+/) : []))]
  .filter(Boolean).sort())
```

```js
// CSS custom properties (theme tokens) the page defines
copy(Object.fromEntries([...document.styleSheets]
  .flatMap((sheet) => { try { return [...sheet.cssRules]; } catch { return []; } })
  .filter((rule) => rule.style)
  .flatMap((rule) => [...rule.style]
    .filter((prop) => prop.startsWith('--'))
    .map((prop) => [prop, rule.style.getPropertyValue(prop)]))))
```

## Behaviour

```js
// Listeners Chrome attached to the selected node
getEventListeners($0)
```

```js
// React props of a node (Rabby is React — class names and handlers live here)
(() => {
  const key = Object.keys($0).find((k) => k.startsWith('__reactProps$'));
  if (!key) return console.log('not a React node');
  copy(JSON.stringify($0[key], (k, v) => (typeof v === 'function' ? '[fn]' : v), 2).slice(0, 4000));
})()
```

## Text

```js
// All visible copy in a region
copy($0.innerText)
```

## Tips

- `$0` is the last element clicked in the Elements panel; `$1` is the one before it.
- `copy()` works on strings, objects (JSON), and arrays — anything clipboard-serializable.
- Full outerHTML of a big card (like Rabby's balance card) is thousands of characters; the
  **structure map** + **computed box** pair above is usually what a rebuild actually needs.
