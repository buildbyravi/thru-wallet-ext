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
 * Backup confirmation challenge: pick the correct word for N specific positions.
 *
 * Rabby confirms a phrase by asking the user to re-type it. Multiple choice proves the same
 * thing without a second input that would have to be hardened against spellcheck, autofill
 * and logging.
 *
 * Rewritten after testing showed two defects in the first version:
 *
 *   - Positions were drawn with rejection sampling from the whole phrase, which could cluster
 *     (0,1,2) and made the "Word N" labels look like question numbers rather than positions.
 *     Positions are now taken one per evenly-sized bucket, so they are always spread out and
 *     the label unambiguously means "the Nth word of your phrase".
 *   - A duplicated word in the phrase made a pick ambiguous. Options are now deduplicated and
 *     drawn from the wordlist of OTHER positions, so exactly one option is correct.
 *
 * @param {Object} props
 *   phrase     the mnemonic to verify against
 *   rounds     how many positions to ask about (default 3)
 *   onChange   (allCorrect: boolean) => void
 */
export function SeedPhraseChallenge({ phrase = '', rounds = 3, onChange } = {}) {
  const d = disposer();
  const words = String(phrase || '').trim().split(/\s+/).filter(Boolean);
  const total = words.length;
  const asked = Math.max(1, Math.min(rounds, total));

  // One position per bucket, so questions are spread across the phrase instead of clustering.
  const positions = [];
  const bucket = total / asked;
  for (let i = 0; i < asked; i += 1) {
    const lo = Math.floor(i * bucket);
    const hi = Math.max(lo, Math.floor((i + 1) * bucket) - 1);
    positions.push(lo + Math.floor(Math.random() * (hi - lo + 1)));
  }

  const answers = new Map();
  let allCorrect = false;

  function report() {
    allCorrect = positions.every((pos) => answers.get(pos) === words[pos]);
    onChange?.(allCorrect);
  }

  const questions = positions.map((pos) => {
    const correct = words[pos];

    // Decoys come from other positions and must differ from the correct word, so exactly one
    // option can be right even when the phrase repeats a word.
    const pool = words.filter((w, i) => i !== pos && w !== correct);
    const decoys = new Set();
    let guard = 0;
    while (decoys.size < 3 && pool.length && guard < 200) {
      decoys.add(pool[Math.floor(Math.random() * pool.length)]);
      guard += 1;
    }

    const options = [correct, ...decoys].sort(() => Math.random() - 0.5);

    const optionEls = options.map((word) => {
      const btn = h('button', {
        type: 'button',
        class: 'chip-option',
        text: word,
        'aria-label': `Word ${pos + 1}: ${word}`,
      });
      d.on(btn, 'click', () => {
        answers.set(pos, word);
        for (const sibling of optionEls) {
          sibling.classList.remove('selected');
          sibling.setAttribute('aria-pressed', 'false');
        }
        btn.classList.add('selected');
        btn.setAttribute('aria-pressed', 'true');
        report();
      });
      return btn;
    });

    return h('div', { class: 'challenge-row' }, [
      h('span', { class: 'eyebrow', text: `Word #${pos + 1} of your phrase` }),
      h('div', { class: 'row-flex wrap' }, optionEls),
    ]);
  });

  const el = h('div', { class: 'stack stack-3' }, questions);

  // Report the initial (incorrect) state so the caller's button starts disabled without the
  // caller having to duplicate that assumption.
  report();

  return {
    el,
    get isComplete() {
      return allCorrect;
    },
    destroy() {
      answers.clear();
      d.dispose();
      el.remove();
    },
  };
}
