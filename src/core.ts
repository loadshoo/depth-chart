import { max, mean } from "d3-array";
import { ScaleLinear, scaleLinear } from "d3-scale";

import { AXIS_HEIGHT, FONT_SIZE } from "./drawAxes";
import {
  drawDepthCurve,
  clipPointsRight,
} from "./drawCurves";
import {
  drawHorizontalAxis,
  drawVerticalAxis,
  drawMidPriceLine,
} from "./drawAxes";
import { CanvasRenderer } from "./renderer";
import type { Colors, Dimensions, OrderBookData } from "./types";
import { formatVolume } from "./utils";

// ───────────────────────────────────────────────────────────
// Ratio threshold: price-gap% / volume-fraction > THRESHOLD
// → treat the extreme price level as an outlier and drop it.
// ───────────────────────────────────────────────────────────
const PRICE_VOLUME_RATIO_THRESHOLD = 100;
const MIN_VISIBLE_NODES_ON_ZOOM = 20;

function clamp(value: number, minValue: number, maxValue: number): number {
  return Math.max(minValue, Math.min(maxValue, value));
}

function lowerBound(values: number[], target: number): number {
  let low = 0;
  let high = values.length;

  while (low < high) {
    const mid = (low + high) >>> 1;
    if (values[mid] < target) low = mid + 1;
    else high = mid;
  }

  return low;
}

function upperBound(values: number[], target: number): number {
  let low = 0;
  let high = values.length;

  while (low < high) {
    const mid = (low + high) >>> 1;
    if (values[mid] <= target) low = mid + 1;
    else high = mid;
  }

  return low;
}

function getMaxDistanceFromSortedPrices(prices: number[], midPrice: number): number {
  if (prices.length === 0) return 0;
  return Math.max(
    Math.abs(prices[0] - midPrice),
    Math.abs(prices[prices.length - 1] - midPrice),
  );
}

function getVisibleMaxVolume(
  prices: number[],
  volumes: number[],
  minPrice: number,
  maxPrice: number,
): number {
  const start = lowerBound(prices, minPrice);
  const end = upperBound(prices, maxPrice);

  let maxVolume = 0;
  for (let index = start; index < end; index += 1) {
    if (volumes[index] > maxVolume) {
      maxVolume = volumes[index];
    }
  }

  return maxVolume;
}

function appendCompressedPoint(
  points: [number, number][],
  x: number,
  y: number,
): void {
  const nextPoint: [number, number] = [x, y];
  if (points.length === 0) {
    points.push(nextPoint);
    return;
  }

  const lastIndex = points.length - 1;
  const lastPoint = points[lastIndex];
  if (Math.round(lastPoint[0]) === Math.round(x)) {
    points[lastIndex] = nextPoint;
    return;
  }

  points.push(nextPoint);
}

function projectCurvePoints(options: {
  source: [number, number][];
  extraPoint?: [number, number];
  priceScale: ScaleLinear<number, number>;
  volumeScale: ScaleLinear<number, number>;
  fallbackY: number;
  clipRightAt?: number;
}): [number, number][] {
  const {
    source,
    extraPoint,
    priceScale,
    volumeScale,
    fallbackY,
    clipRightAt,
  } = options;
  const result: [number, number][] = [];

  const appendPoint = (price: number, volume: number): boolean => {
    let x = priceScale(price);
    const scaledY = volumeScale(volume);
    const y = Number.isFinite(scaledY) ? scaledY : fallbackY;

    if (clipRightAt !== undefined && x > clipRightAt) {
      x = clipRightAt;
      appendCompressedPoint(result, x, y);
      return false;
    }

    appendCompressedPoint(result, x, y);
    return true;
  };

  for (let index = 0; index < source.length; index += 1) {
    const [price, volume] = source[index];
    if (!appendPoint(price, volume) && clipRightAt !== undefined) {
      return result;
    }
  }

  if (extraPoint) {
    appendPoint(extraPoint[0], extraPoint[1]);
  }

  return result;
}

function getMidPrice(
  indicativePrice: number,
  midPrice: number,
  buyPrice: number | undefined,
  sellPrice: number | undefined,
): number {
  if (indicativePrice) return indicativePrice;
  if (midPrice) return midPrice;
  if (buyPrice !== undefined && sellPrice !== undefined)
    return mean([buyPrice, sellPrice]) as number;
  return buyPrice ?? sellPrice ?? 0;
}

function getMinHalfRangeForVisibleNodes(
  prices: number[],
  midPrice: number,
  minVisibleNodes: number,
): number {
  if (prices.length === 0) return 0;

  const targetCount = Math.min(minVisibleNodes, prices.length);
  let left = lowerBound(prices, midPrice) - 1;
  let right = left + 1;
  let furthestDistance = 0;

  for (let count = 0; count < targetCount; count += 1) {
    const leftDistance = left >= 0 ? Math.abs(prices[left] - midPrice) : Infinity;
    const rightDistance = right < prices.length ? Math.abs(prices[right] - midPrice) : Infinity;

    if (leftDistance <= rightDistance) {
      furthestDistance = leftDistance;
      left -= 1;
    } else {
      furthestDistance = rightDistance;
      right += 1;
    }
  }

  return Number.isFinite(furthestDistance) ? furthestDistance : 0;
}

/**
 * DepthChartCore
 *
 * Owns *two* CanvasRenderer instances (contents + ui) and holds all the
 * computed state needed to draw both layers.  Has no knowledge of React or
 * DOM events – those live in DepthChartInteraction.
 */
export class DepthChartCore {
  private contentsRenderer: CanvasRenderer;

  // ── raw data ────────────────────────────────────────────────────────────
  private _data: OrderBookData = { buy: [], sell: [] };
  private _indicativePrice: number = 0;
  private _midPrice: number = 0;

  // ── derived data ─────────────────────────────────────────────────────────
  /** [price, cumulativeVolume] sorted buy side */
  public cumulativeBuy: [number, number][] = [];
  /** [price, cumulativeVolume] sorted sell side */
  public cumulativeSell: [number, number][] = [];

  /** All prices (buy + sell) sorted ascending */
  public prices: number[] = [];
  /** Cumulative volume matching each price in `this.prices` */
  public volumes: number[] = [];

  /** Formatted price strings matching `this.prices` */
  public priceLabels: string[] = [];
  /** Formatted volume strings matching `this.volumes` */
  public volumeLabels: string[] = [];

  // ── scales ───────────────────────────────────────────────────────────────
  public priceScale: ScaleLinear<number, number> = scaleLinear();
  public volumeScale: ScaleLinear<number, number> = scaleLinear();
  /** plotWidth excludes the right-side volume axis area */
  public plotWidth: number = 0;

  public _span: number = 1;
  public initialSpan: number = 1;
  public minSpan: number = 1;
  public maxSpan: number = 1;
  public scaleVersion: number = 0;
  public dataVersion: number = 0;
  private maxPriceDifference: number = 0;
  private initialPriceDifference: number = 0;

  // ── style ────────────────────────────────────────────────────────────────
  public colors: Colors;
  public dimensions: Dimensions;
  public fillAlpha: number;

  public priceFormat: (p: number) => string;
  public volumeFormat: (v: number) => string;

  // ── RAF ──────────────────────────────────────────────────────────────────
  private frameId: number | null = null;
  private dirty = false;

  constructor(options: {
    contentsCanvas: HTMLCanvasElement;
    resolution: number;
    colors: Colors;
    dimensions: Dimensions;
    fillAlpha: number;
    priceFormat: (p: number) => string;
    volumeFormat: (v: number) => string;
  }) {
    this.contentsRenderer = new CanvasRenderer(options.contentsCanvas, options.resolution);
    this.colors = options.colors;
    this.dimensions = options.dimensions;
    this.fillAlpha = options.fillAlpha;
    this.priceFormat = options.priceFormat;
    this.volumeFormat = options.volumeFormat;
  }

  get resolution(): number {
    return this.contentsRenderer.resolution;
  }

  get canvasWidth(): number {
    return this.contentsRenderer.width;
  }

  get canvasHeight(): number {
    return this.contentsRenderer.height;
  }

  /** CSS pixel width of the chart canvas. */
  get cssWidth(): number {
    return this.canvasWidth / this.resolution;
  }

  /** CSS pixel height of the chart canvas. */
  get cssHeight(): number {
    return this.canvasHeight / this.resolution;
  }

  // ── public API ───────────────────────────────────────────────────────────

  resize(cssWidth: number, cssHeight: number): void {
    this.contentsRenderer.resize(cssWidth, cssHeight);
    this.invalidate();
  }

  set data(data: OrderBookData) {
    const buy = [...data.buy].sort((a, b) => b.price - a.price);
    const sell = [...data.sell].sort((a, b) => a.price - b.price);

    this._data = { buy, sell };
    this.initialPriceDifference = 0; // force re-compute on next update
    this.dataVersion += 1;

    this.cumulativeBuy = new Array(buy.length);
    this.cumulativeSell = new Array(sell.length);

    let buyVolumeSum = 0;
    for (let index = 0; index < buy.length; index += 1) {
      buyVolumeSum += buy[index].volume || 0;
      this.cumulativeBuy[index] = [buy[index].price, buyVolumeSum];
    }

    let sellVolumeSum = 0;
    for (let index = 0; index < sell.length; index += 1) {
      sellVolumeSum += sell[index].volume || 0;
      this.cumulativeSell[index] = [sell[index].price, sellVolumeSum];
    }

    const mergedLength = this.cumulativeBuy.length + this.cumulativeSell.length;
    this.prices = new Array(mergedLength);
    this.volumes = new Array(mergedLength);

    let buyIndex = this.cumulativeBuy.length - 1;
    let sellIndex = 0;
    let mergedIndex = 0;

    while (buyIndex >= 0 || sellIndex < this.cumulativeSell.length) {
      const buyPoint = buyIndex >= 0 ? this.cumulativeBuy[buyIndex] : null;
      const sellPoint = sellIndex < this.cumulativeSell.length ? this.cumulativeSell[sellIndex] : null;

      if (!sellPoint || (buyPoint && buyPoint[0] <= sellPoint[0])) {
        this.prices[mergedIndex] = buyPoint![0];
        this.volumes[mergedIndex] = buyPoint![1];
        buyIndex -= 1;
      } else {
        this.prices[mergedIndex] = sellPoint[0];
        this.volumes[mergedIndex] = sellPoint[1];
        sellIndex += 1;
      }

      mergedIndex += 1;
    }

    this.priceLabels = new Array(mergedLength);
    this.volumeLabels = new Array(mergedLength);
    for (let index = 0; index < mergedLength; index += 1) {
      this.priceLabels[index] = this.priceFormat(this.prices[index]);
      this.volumeLabels[index] = this.volumeFormat(this.volumes[index]);
    }

    this.invalidate();
  }

  get data(): OrderBookData {
    return this._data;
  }

  set indicativePrice(price: number) {
    this._indicativePrice = price;
    this.invalidate();
  }

  set midPrice(price: number) {
    this._midPrice = price;
    this.invalidate();
  }

  set span(span: number) {
    this._span = span;
    this.invalidate();
  }

  get span(): number {
    return this._span;
  }

  destroy(): void {
    if (this.frameId !== null) {
      cancelAnimationFrame(this.frameId);
      this.frameId = null;
    }
  }

  // ── rendering pipeline ───────────────────────────────────────────────────

  private invalidate(): void {
    this.dirty = true;
    if (this.frameId !== null) return;
    this.frameId = requestAnimationFrame(() => {
      this.frameId = null;
      if (!this.dirty) return;
      this.dirty = false;
      this.computeScales();
      this.renderContents();
    });
  }

  /**
   * Compute all scales and derived values.  Called every frame before render.
   * Public so that DepthChartInteraction can also call it after resize.
   */
  public computeScales(): void {
    if (this.prices.length === 0) return;

    const midPrice = getMidPrice(
      this._indicativePrice,
      this._midPrice,
      this._data.buy[0]?.price,
      this._data.sell[0]?.price,
    );

    this.maxPriceDifference = getMaxDistanceFromSortedPrices(this.prices, midPrice);

    if (this.maxPriceDifference <= 0) {
      this.minSpan = 1;
      this.maxSpan = 1;
      this._span = 1;
      return;
    }

    if (!this.initialPriceDifference && this.maxPriceDifference > 0) {
      // Filter outliers to compute the initial view span
      const buyLevels = [...this._data.buy].sort((a, b) => a.price - b.price);
      const sellLevels = [...this._data.sell].sort((a, b) => a.price - b.price);
      const totalBuyVol = this.cumulativeBuy.at(-1)?.[1] ?? 1;
      const totalSellVol = this.cumulativeSell.at(-1)?.[1] ?? 1;

      while (buyLevels.length > 2) {
        const gapRatio =
          Math.abs(
            (buyLevels[0].price - buyLevels[1].price) /
              (buyLevels[0].price - midPrice || 1),
          ) /
          (buyLevels[0].volume / totalBuyVol);
        if (gapRatio > PRICE_VOLUME_RATIO_THRESHOLD) {
          buyLevels.splice(0, 1);
        } else {
          break;
        }
      }

      while (sellLevels.length > 2) {
        const last = sellLevels.length - 1;
        const gapRatio =
          Math.abs(
            (sellLevels[last].price - sellLevels[last - 1].price) /
              (sellLevels[last].price - midPrice || 1),
          ) /
          (sellLevels[last].volume / totalSellVol);
        if (gapRatio > PRICE_VOLUME_RATIO_THRESHOLD) {
          sellLevels.splice(-1, 1);
        } else {
          break;
        }
      }

      this.initialPriceDifference =
        max(
          [...buyLevels, ...sellLevels].map((l) =>
            Math.abs(l.price - midPrice),
          ),
        ) ?? 0;
      this.initialSpan = 1;
    }

    const minVisibleHalfRange = getMinHalfRangeForVisibleNodes(
      this.prices,
      midPrice,
      MIN_VISIBLE_NODES_ON_ZOOM,
    );

    this.maxSpan = 1;
    this.minSpan = minVisibleHalfRange
      ? Math.min(1, (minVisibleHalfRange * 1.001) / this.maxPriceDifference)
      : 1;
    this._span = clamp(this._span || 1, this.minSpan, this.maxSpan);

    const halfRange = this._span * this.maxPriceDifference;
    const priceExtent: [number, number] = [
      midPrice - halfRange,
      midPrice + halfRange,
    ];

    // Visible index extent for volume scale calculation
    const maxVol = getVisibleMaxVolume(
      this.prices,
      this.volumes,
      priceExtent[0],
      priceExtent[1],
    ) || max(this.volumes) || 0;
    const volumeExtent: [number, number] = [0, 1.2 * maxVol];

    const cssH = this.cssHeight;
    const cssW = this.cssWidth;

    this.volumeScale = scaleLinear()
      .domain(volumeExtent)
      .range([cssH - AXIS_HEIGHT, 0]);

    // Compute axis label width to reserve right margin
    const numTicks = Math.floor(cssH / 50);
    const ticks = this.volumeScale.ticks(numTicks).filter((t) => t !== 0);
    const maxLabelLen =
      ticks.reduce((m, t) => Math.max(m, formatVolume(t).length), 0) + 0.8;
    const axisMarginRight = 8 * maxLabelLen; // approx px

    this.plotWidth = cssW - axisMarginRight;

    this.priceScale = scaleLinear()
      .domain(priceExtent)
      .range([0, this.plotWidth]);

    const allVolumeZero = ticks.every((t) => t === 0);
    const fallbackY = cssH - AXIS_HEIGHT;
    const volumeScale = allVolumeZero
      ? scaleLinear<number, number>().domain([0, 1]).range([fallbackY, fallbackY])
      : this.volumeScale;

    this._buyCssPoints = projectCurvePoints({
      source: this.cumulativeBuy,
      extraPoint: this.cumulativeBuy.length > 0
        ? [midPrice - this.maxPriceDifference, this.cumulativeBuy[this.cumulativeBuy.length - 1][1]]
        : undefined,
      priceScale: this.priceScale,
      volumeScale,
      fallbackY,
    });

    this._sellCssPoints = clipPointsRight(
      projectCurvePoints({
        source: this.cumulativeSell,
        extraPoint: this.cumulativeSell.length > 0
          ? [midPrice + this.maxPriceDifference, this.cumulativeSell[this.cumulativeSell.length - 1][1]]
          : undefined,
        priceScale: this.priceScale,
        volumeScale,
        fallbackY,
        clipRightAt: this.plotWidth,
      }),
      this.plotWidth,
    );

    this._computedMidPrice = midPrice;
    this._priceExtent = priceExtent;
    this.scaleVersion += 1;
  }

  // Computed CSS-coord curve points (used by both contents and interaction layers)
  public _buyCssPoints: [number, number][] = [];
  public _sellCssPoints: [number, number][] = [];
  public _computedMidPrice: number = 0;
  public _priceExtent: [number, number] = [0, 0];

  /** Render the contents (area curves) canvas. */
  public renderContents(): void {
    const ctx = this.contentsRenderer.ctx;
    const cssW = this.cssWidth;
    const cssH = this.cssHeight;
    const r = this.resolution;

    this.contentsRenderer.clear();

    drawDepthCurve(
      ctx,
      this._buyCssPoints,
      cssH,
      AXIS_HEIGHT,
      this.colors.buyFill,
      this.colors.buyStroke,
      this.dimensions.strokeWidth / r,
      this.fillAlpha,
      "buy",
    );

    drawDepthCurve(
      ctx,
      this._sellCssPoints,
      cssH,
      AXIS_HEIGHT,
      this.colors.sellFill,
      this.colors.sellStroke,
      this.dimensions.strokeWidth / r,
      this.fillAlpha,
      "sell",
    );
  }

  /** Force a synchronous full redraw (used after resize). */
  public forceRender(): void {
    if (this.frameId !== null) {
      cancelAnimationFrame(this.frameId);
      this.frameId = null;
    }
    this.dirty = false;
    this.computeScales();
    this.renderContents();
  }
}
