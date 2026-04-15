import { cssVar, hexStringToNumber } from "./utils";
import type { Colors, Dimensions } from "./types";

export { colorConfigToColors } from "./utils";

/** Default dark-theme colour set (used when CSS variables are unavailable). */
export const DEFAULT_COLORS: Colors = {
  buyFill: hexStringToNumber("#16452d"),
  buyStroke: hexStringToNumber("#26ff8a"),
  sellFill: hexStringToNumber("#800700"),
  sellStroke: hexStringToNumber("#ff261a"),
  backgroundSurface: hexStringToNumber("#0a0a0a"),
  textPrimary: hexStringToNumber("#ffffff"),
  textSecondary: hexStringToNumber("#fafafa"),
  overlay: hexStringToNumber("#80AAB0"),
  backgroundLabel: hexStringToNumber("#0a0a0a"),
};

/**
 * Derive colors from the CSS custom properties on the given element.
 * Falls back to DEFAULT_COLORS when the variables are not defined.
 */
export function getColors(element: HTMLElement | null): Colors {
  return {
    buyFill: hexStringToNumber(
      cssVar(element, "--pennant-color-depth-buy-fill", "#16452d")
    ),
    buyStroke: hexStringToNumber(
      cssVar(element, "--pennant-color-depth-buy-stroke", "#26ff8a")
    ),
    sellFill: hexStringToNumber(
      cssVar(element, "--pennant-color-depth-sell-fill", "#800700")
    ),
    sellStroke: hexStringToNumber(
      cssVar(element, "--pennant-color-depth-sell-stroke", "#ff261a")
    ),
    backgroundSurface: hexStringToNumber(
      cssVar(element, "--pennant-background-surface-color", "#0a0a0a")
    ),
    textPrimary: hexStringToNumber(
      cssVar(element, "--pennant-font-color-base", "#ffffff")
    ),
    textSecondary: hexStringToNumber(
      cssVar(element, "--pennant-font-color-secondary", "#fafafa")
    ),
    overlay: hexStringToNumber("#80AAB0"),
    backgroundLabel: hexStringToNumber(
      cssVar(element, "--pennant-background-label-color", "#0a0a0a")
    ),
  };
}

/** Derive stroke width from CSS custom properties or device pixel ratio. */
export function getDimensions(element: HTMLElement | null): Dimensions {
  const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
  return { strokeWidth: 2 * dpr };
}
