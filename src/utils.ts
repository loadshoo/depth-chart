import Decimal from "decimal.js";
import type { ColorConfig, Colors } from "./types";

/**
 * Cumulative sum of a numeric array.
 * Uses Decimal.js to avoid floating-point drift.
 */
export function cumsum(values: number[]): number[] {
  let sum = 0;
  return values.map((v) => {
    sum = Decimal.add(sum, +v || 0).toNumber();
    return sum;
  });
}

/**
 * Count decimal places in a number.
 */
export function getDecimalPlaces(n: number): number {
  const s = n.toString();
  const idx = s.indexOf(".");
  return idx >= 0 ? s.length - idx - 1 : 0;
}

/**
 * Return the index of the element in the sorted array `arr` that is closest
 * to `value` (ties towards the higher index).
 */
export function bisectCenter(arr: number[], value: number): number {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (arr[mid] < value) lo = mid + 1;
    else hi = mid;
  }
  // lo is the first element >= value
  if (lo === 0) return 0;
  if (lo >= arr.length) return arr.length - 1;
  const before = arr[lo - 1];
  const after = arr[lo];
  return value - before <= after - value ? lo - 1 : lo;
}

/**
 * Convert a CSS hex string such as "#FF0000" or "#ff000080" to a 24-bit
 * integer that Canvas / CSS can consume as a colour.
 * Alpha channel (if present) is discarded – alpha is always handled separately.
 */
export function hexStringToNumber(hex: string): number {
  const clean = hex.replace("#", "").slice(0, 6);
  return parseInt(clean.padEnd(6, "0"), 16);
}

/**
 * Convert a Partial<ColorConfig> (string values) to a Colors object (numeric),
 * falling back to `defaults` for missing keys.
 */
export function colorConfigToColors(
  partial: Partial<ColorConfig>,
  defaults: Colors,
): Colors {
  return {
    buyFill: partial.buyFill ? hexStringToNumber(partial.buyFill) : defaults.buyFill,
    buyStroke: partial.buyStroke ? hexStringToNumber(partial.buyStroke) : defaults.buyStroke,
    sellFill: partial.sellFill ? hexStringToNumber(partial.sellFill) : defaults.sellFill,
    sellStroke: partial.sellStroke ? hexStringToNumber(partial.sellStroke) : defaults.sellStroke,
    backgroundSurface: partial.backgroundSurface ? hexStringToNumber(partial.backgroundSurface) : defaults.backgroundSurface,
    textPrimary: partial.textPrimary ? hexStringToNumber(partial.textPrimary) : defaults.textPrimary,
    textSecondary: partial.textSecondary ? hexStringToNumber(partial.textSecondary) : defaults.textSecondary,
    overlay: partial.overlay ? hexStringToNumber(partial.overlay) : defaults.overlay,
    backgroundLabel: partial.backgroundLabel ? hexStringToNumber(partial.backgroundLabel) : defaults.backgroundLabel,
  };
}

/** Convert a 24-bit hex number to a CSS rgb string for Canvas use */
export function numberToRgb(n: number, alpha = 1): string {
  const r = (n >> 16) & 0xff;
  const g = (n >> 8) & 0xff;
  const b = n & 0xff;
  return alpha < 1 ? `rgba(${r},${g},${b},${alpha})` : `rgb(${r},${g},${b})`;
}

/**
 * Format large volume numbers compactly (1000 → 1.00K).
 */
export function formatVolume(n: number): string {
  if (n >= 1_000) {
    return Intl.NumberFormat("en-US", {
      notation: "compact",
      maximumFractionDigits: 2,
      minimumFractionDigits: 2,
    }).format(n);
  }
  const prec = getDecimalPlaces(n);
  return n.toLocaleString("en-US", {
    maximumFractionDigits: prec,
    minimumFractionDigits: prec,
  });
}

/** Read a CSS custom property from an element or return the fallback. */
export function cssVar(el: HTMLElement | null, name: string, fallback: string): string {
  if (!el) return fallback;
  const v = getComputedStyle(el).getPropertyValue(name).trim();
  return v || fallback;
}
