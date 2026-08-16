// Seed phrase display and confirmation.
//
// Consolidates THREE copies of mnemonic-grid rendering (popup.js:119, backup.js:64,
// export-reveal.js:62). All three used innerHTML on a per-word span; this builds nodes.
//
// The critical fix is what the old code did with the phrase itself. popup.js:465 wrote the
// mnemonic to `grid.dataset.raw` and no code path ever removed it — and manifest.json
// registers popup.html as a side panel, so that document can live for days. Here the words
// exist only as text nodes and a local array, both dropped by destroy(). Nothing is written
// to a data attribute, and there is no copy of the phrase reachable from the DOM.

import { h, disposer } from '../kit/dom.js';

/**
 * Numbered word grid, blurred until explicitly revealed.
 *
 * @param {Object} props
 *   phrase    the mnemonic (space separated)
 *   revealed  start revealed (default false)
 */
export function SeedPhraseGrid({ phrase = '', revealed = false } = {}) {
  let words = String(phrase || '').trim().split(/\s+/).filter(Boolean);

  const grid = h('div', {
    class: ['mnemonic-grid', revealed ? null : 'blurred'].filter(Boolean),
    role: 'list',
    'aria-label': 'Recovery phrase',
  }, words.map((word, i) => h('span', { role: 'listitem' }, [
    h('em', { text: String(i + 1), 'aria-hidden': 'true' }),
    h('span', { text: word }),
  ])));

  return {
    el: grid,
    get words() {
      return words.slice();
    },
    reveal() {
      grid.classList.remove('blurred');
    },
    hide() {
      grid.classList.add('blurred');
    },
    toggle() {
      grid.classList.toggle('blurred');
      return !grid.classList.contains('blurred');
    },
    destroy() {
      // Drop the text nodes first, then the local array. Neither the phrase nor any
      // fragment of it survives in the DOM or on this instance.
      while (grid.firstChild) grid.removeChild(grid.firstChild);
      words = [];
      grid.remove();
    },
  };
}

/**
 * Backup confirmation challenge: pick the right word for N random positions.
 *
 * Rabby confirms a phrase by asking the user to re-enter it. A multiple-choice challenge
 * proves the same thing (the phrase was actually recorded) without requiring the user to
 * type 12 words into a field that could be logged or autofilled, and without a second
 * input that has to be hardened against spellcheck.
 *
 * @param {Object} props
 *   phrase     the mnemonic to verify against
 *   rounds     how many positions to ask about (default 3)
 *   onChange   (allCorrect: boolean) => void
 */
export function SeedPhraseChallenge({ phrase = '', rounds = 3, onChange } = {}) {
  const d = disposer();
  const words = String(phrase || '').trim().split(/\s+/).filter(Boolean);

  // Deterministic-per-mount but unpredictable positions, so a user cannot learn "it always
  // asks for word 4".
  const positions = [];
  while (positions.length < Math.min(rounds, words.length)) {
    const candidate = Math.floor(Math.random() * words.length);
    if (!positions.includes(candidate)) positions.push(candidate);
  }
  positions.sort((a, b) => a - b);

  const answers = new Map();

  function report() {
    const allCorrect = positions.every((pos) => answers.get(pos) === words[pos]);
    onChange?.(allCorrect);
  }

  const questions = positions.map((pos) => {
    // Three decoys drawn from the phrase itself, so a wrong pick is plausible and the
    // challenge cannot be passed by recognising an obviously foreign word.
    const decoys = new Set([words[pos]]);
    while (decoys.size < 4 && decoys.size < words.length) {
      decoys.add(words[Math.floor(Math.random() * words.length)]);
    }
    const options = [...decoys].sort(() => Math.random() - 0.5);

    const optionEls = options.map((word) => {
      const btn = h('button', {
        type: 'button',
        class: 'chip-option',
        text: word,
      });
      d.on(btn, 'click', () => {
        answers.set(pos, word);
        for (const sibling of optionEls) sibling.classList.remove('selected');
        btn.classList.add('selected');
        report();
      });
      return btn;
    });

    return h('div', { class: 'challenge-row' }, [
      h('span', { class: 'eyebrow', text: `Word ${pos + 1}` }),
      h('div', { class: 'row-flex wrap' }, optionEls),
    ]);
  });

  const el = h('div', { class: 'stack stack-3' }, questions);

  return {
    el,
    destroy() {
      answers.clear();
      d.dispose();
      el.remove();
    },
  };
}
