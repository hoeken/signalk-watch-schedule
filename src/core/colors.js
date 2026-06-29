/**
 * Deterministic team → color mapping. Used by both the server (published in
 * watch.* shifts) and the webapp, so team N is always the same color everywhere.
 *
 * Palette is chosen for high contrast against white text and reasonable
 * separation for common color-vision deficiencies.
 */

/** @type {string[]} */
export const PALETTE = [
  "#2563eb", // blue
  "#dc2626", // red
  "#16a34a", // green
  "#d97706", // amber
  "#7c3aed", // violet
  "#0891b2", // cyan
  "#db2777", // pink
  "#65a30d", // lime
];

/**
 * Stable color for a team by its 0-based index. Wraps the palette if there are
 * more teams than colors.
 * @param {number} teamIndex
 * @returns {string} hex color
 */
export function getTeamColor(teamIndex) {
  const i = ((teamIndex % PALETTE.length) + PALETTE.length) % PALETTE.length;
  return PALETTE[i];
}
