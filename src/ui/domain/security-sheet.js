// Security sheet — the destination of the dashboard's Security tile.
//
// Replaces the old "coming soon" banner (an inline .notice that shoved the action grid down
// and looked like a form error). This is a real bottom sheet, built from the same primitives
// as the token drawer and the tx detail sheet: .modal-overlay + .tx-sheet, backdrop click /
// Escape / Close all close, focus is trapped and restored.
//
// It shows the wallet's REAL posture (see src/shared/security-checks.js): recovery phrase
// backup, auto-lock, password-for-signing, optional whitelist, network and site connections.
// Rows with a fix carry one action that closes the sheet and routes to the right screen.
//
// The sheet never calls the bridge itself. The host passes `load()` (three read-only calls),
// which keeps this component testable and keeps the layering rule "domain -> no bridge".

import { h, disposer, clear } from '../kit/dom.js';
import { icon } from '../kit/icon.js';
import { Button } from '../kit/button.js';
import { Sheet } from '../kit/sheet.js';
import { evaluateSecurity } from '../../shared/security-checks.js';

const STATUS_ICON = { ok: 'check', warn: 'warning', info: 'info', unknown: 'help' };

/**
 * @param {Object} props
 *   load        async () => { prefs, autoLockMinutes, keyrings, networkLabel, isTestNetwork }
 *   onNavigate  (route) => void   called AFTER the sheet has closed
 *   onClose     () => void        called exactly once when the sheet closes
 * @returns {{ el: HTMLElement, refresh(): Promise<void>, destroy(): void }}
 */
export function SecuritySheet({ load, onNavigate, onClose } = {}) {
  let paintD = disposer();
  let run = 0;

  const sheet = Sheet({ label: 'Security', className: 'security-sheet', onClose });
  const { track } = sheet;
  sheet.cleanup(() => {
    run += 1; // invalidate any in-flight load
    paintD.dispose();
  });
  const close = () => sheet.close();

  // ---- Head ------------------------------------------------------------------------------
  const closeBtn = track(Button({ label: 'Close', variant: 'text', onClick: () => close() }));
  const head = h('div', { class: 'modal-head token-drawer-head' }, [
    h('span', { class: 'modal-icon' }, icon('shield', 18)),
    h('h2', { text: 'Security' }),
    closeBtn.el,
  ]);

  // ---- Summary + list hosts -------------------------------------------------------------------
  const summaryHost = h('div', { class: 'security-summary' });
  const listHost = h('div', { class: 'security-list', role: 'list' });

  const settingsBtn = track(Button({
    label: 'Open security settings',
    iconName: 'settings',
    onClick: () => go('/settings'),
  }));

  function go(route) {
    close();
    onNavigate?.(route);
  }

  // ---- Painters ----------------------------------------------------------------------------
  function paintLoading() {
    paintD.dispose();
    paintD = disposer();
    clear(summaryHost);
    clear(listHost);
    summaryHost.className = 'security-summary loading';
    summaryHost.appendChild(h('div', { class: 'security-skel wide' }));
    for (let i = 0; i < 4; i += 1) {
      listHost.appendChild(h('div', { class: 'security-skel row' }));
    }
    listHost.setAttribute('aria-busy', 'true');
  }

  function paintError(error) {
    paintD.dispose();
    paintD = disposer();
    clear(summaryHost);
    clear(listHost);
    listHost.removeAttribute('aria-busy');
    summaryHost.className = 'security-summary attention';
    const retry = h('button', { type: 'button', class: 'security-row-action', text: 'Try again' });
    paintD.on(retry, 'click', () => { void refresh(); });
    summaryHost.appendChild(h('div', { class: 'security-summary-text' }, [
      h('p', { class: 'security-summary-title', text: 'Could not read your security settings' }),
      h('p', { class: 'security-summary-sub', text: error?.message || 'The wallet did not answer. Try again.' }),
    ]));
    summaryHost.appendChild(retry);
  }

  function paintRow(check) {
    const status = STATUS_ICON[check.status] ? check.status : 'info';
    const children = [
      h('span', { class: 'security-row-icon' }, icon(STATUS_ICON[status], 14)),
      h('div', { class: 'security-row-body' }, [
        h('p', { class: 'security-row-title', text: check.title }),
        h('p', { class: 'security-row-detail', text: check.detail }),
      ]),
    ];
    if (check.action) {
      const btn = h('button', {
        type: 'button',
        class: 'security-row-action',
        text: check.action.label,
        'aria-label': `${check.action.label}: ${check.title}`,
      });
      paintD.on(btn, 'click', () => go(check.action.route));
      children.push(btn);
    }
    return h('div', { class: ['security-row', status], role: 'listitem' }, children);
  }

  function paint(result) {
    paintD.dispose();
    paintD = disposer();
    clear(summaryHost);
    clear(listHost);
    listHost.removeAttribute('aria-busy');

    const { checks, okCount, gradedCount, level } = result;
    summaryHost.className = `security-summary ${level}`;
    const pct = gradedCount === 0 ? 0 : Math.round((okCount / gradedCount) * 100);

    const title = level === 'good'
      ? 'Your wallet is well protected'
      : level === 'attention'
        ? `${gradedCount - okCount} thing${gradedCount - okCount === 1 ? '' : 's'} to fix`
        : 'Security status unavailable';
    const sub = gradedCount === 0
      ? 'Settings could not be read.'
      : `${okCount} of ${gradedCount} protections are on.`;

    const bar = h('div', { class: 'security-meter', role: 'presentation' }, [
      h('div', { class: 'security-meter-fill', style: { width: `${pct}%` } }),
    ]);

    summaryHost.appendChild(h('span', { class: 'security-summary-icon' }, icon(level === 'good' ? 'shield' : 'warning', 20)));
    summaryHost.appendChild(h('div', { class: 'security-summary-text' }, [
      h('p', { class: 'security-summary-title', text: title }),
      h('p', { class: 'security-summary-sub', text: sub }),
      bar,
    ]));

    // Needs-attention rows first so the fix is above the fold; the stable sort keeps the
    // declared order inside each group.
    const rank = { warn: 0, unknown: 1, ok: 2, info: 3 };
    [...checks]
      .sort((a, b) => (rank[a.status] ?? 9) - (rank[b.status] ?? 9))
      .forEach((check) => listHost.appendChild(paintRow(check)));
  }

  async function refresh() {
    if (sheet.closed || typeof load !== 'function') return;
    const mine = ++run;
    paintLoading();
    try {
      const snapshot = await load();
      if (sheet.closed || mine !== run) return;
      paint(evaluateSecurity(snapshot || {}));
    } catch (error) {
      if (sheet.closed || mine !== run) return;
      paintError(error);
    }
  }

  // ---- Assemble + open -----------------------------------------------------------------------
  sheet.card.appendChild(head);
  sheet.card.appendChild(summaryHost);
  sheet.card.appendChild(listHost);
  sheet.card.appendChild(settingsBtn.el);

  sheet.open();
  void refresh();

  return {
    el: sheet.el,
    refresh,
    destroy() {
      close();
    },
  };
}
