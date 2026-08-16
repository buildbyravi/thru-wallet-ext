// Loading shimmer placeholders for balance, tokens, and history.

/**
 * Returns HTML for a list of skeleton loading rows.
 * @param {number} [count=3]
 * @returns {string} HTML string
 */
export function renderSkeletonList(count = 3) {
  let html = '';
  for (let i = 0; i < count; i++) {
    html += `
      <div class="skeleton-row">
        <div class="skeleton-avatar"></div>
        <div class="skeleton-lines">
          <div class="skeleton-line w-60"></div>
          <div class="skeleton-line w-40"></div>
        </div>
        <div class="skeleton-value w-30"></div>
      </div>
    `;
  }
  return html;
}

/**
 * Returns HTML for balance hero skeleton.
 * @returns {string} HTML string
 */
export function renderBalanceSkeleton() {
  return `<div class="skeleton-hero shimmer"></div>`;
}
