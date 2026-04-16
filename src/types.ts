// ──────────────────────────────────────────────
// Public types
// ──────────────────────────────────────────────

export type PriceLevel = {
  price: number;
  volume: number;
};

export type OrderBookData = {
  buy: PriceLevel[];
  sell: PriceLevel[];
};

export interface ColorConfig {
  /** CSS hex string, e.g. "#16452d" */
  buyFill: string;
  buyStroke: string;
  sellFill: string;
  sellStroke: string;
  backgroundSurface: string;
  textPrimary: string;
  textSecondary: string;
  overlay: string;
  /** Background behind tooltip labels */
  backgroundLabel: string;
}

export interface Colors {
  buyFill: number;
  buyStroke: number;
  sellFill: number;
  sellStroke: number;
  backgroundSurface: number;
  textPrimary: number;
  textSecondary: number;
  overlay: number;
  backgroundLabel: number;
}

export interface Dimensions {
  strokeWidth: number;
}

export type ThemeVariant = "light" | "dark";

export type DepthChartProps = {
  /** Raw order book data – each entry has a price level and resting volume at that level */
  data: OrderBookData;
  /** Format a price number into a display string */
  priceFormat?: (price: number) => string;
  /** Format a volume number into a display string */
  volumeFormat?: (volume: number) => string;
  /**
    * Indicative price if the auction ended now, 0 if not in auction mode.
   * When non-zero the chart enters auction mode with different tooltip style.
   */
  indicativePrice?: number;
    /** Optional mid-price override. Omit it to derive the midpoint from incoming best bid / best ask data. */
  midPrice?: number;
  /** Override the default text to display when there is not enough data. */
  notEnoughDataText?: React.ReactNode;
  /** Light or dark theme – switches data-theme attribute for CSS variable resolution */
  theme?: ThemeVariant;
  /** Trading pair code (e.g. "BTC/USDT"). When changed the zoom resets. */
  pairCode?: string;
  /** Override default colors */
  colorsConfig?: Partial<ColorConfig>;
  /** Width of the stroke around the area curves in pixels */
  strokeWidth?: number;
  /** Alpha of the fill area under the curves (0–1) */
  fillAlpha?: number;
};

export interface DepthChartHandle {
  /** Simulate the user hovering over the chart at a particular price */
  update(price: number): void;
  /** Simulate the user's mouse leaving the chart */
  clear(): void;
}
