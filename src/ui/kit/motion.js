// Motion — the cross-fade applied on route changes (Task T-04 / Pane f4).
//
// The dossier's motion contract: 200ms, the shared ease-out, 4px of rise,
// and silence under prefers-reduced-motion (enforced here at trigger time
// and globally in styles/tokens.css).

export function enter(el) {
  // Browser contract only. The route-lifecycle tests mount routes in a DOM
  // that has neither matchMedia nor Element.animate; animating there is
  // meaningless and would reject the mount promise.
  if (typeof matchMedia !== 'function' || !el || typeof el.animate !== 'function') return;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  el.animate(
    [
      { opacity: 0, transform: 'translateY(4px)' },
      { opacity: 1, transform: 'none' },
    ],
    { duration: 200, easing: 'cubic-bezier(0.22, 0.61, 0.36, 1)' }
  );
}
