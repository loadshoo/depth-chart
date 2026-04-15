import { extent, max, mean, min } from "d3-array";
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
import type { Colors, Dimensions, OrderBookData, PriceLevel } from "./types";
import { cumsum, formatVolume } from "./utils";

// ───────────────────────────────────────────────────────────
// Ratio threshold: price-gap% / volume-fraction > THRESHOLD
// → treat the extreme price level as an outlier and drop it.
// ───────────────────────────────────────────────────────────
const PRICE_VOLUME_RATIO_THRESHOLD = 100;

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
    this._data = {
      buy: [...data.buy].sort((a, b) => b.price - a.price),  // descending
      sell: [...data.sell].sort((a, b) => a.price - b.price), // ascending
    };
    this.initialPriceDifference = 0; // force re-compute on next update

    // Cumulative volumes
    const buyVols = cumsum(this._data.buy.map((l) => l.volume));
    const sellVols = cumsum(this._data.sell.map((l) => l.volume));

    this.cumulativeBuy = this._data.buy.map((l, i) => [l.price, buyVols[i]]);
    this.cumulativeSell = this._data.sell.map((l, i) => [l.price, sellVols[i]]);

    // Merged price/volume arrays sorted by price ascending
    const merged: { price: number; vol: number }[] = [
      ...this.cumulativeBuy.map(([p, v]) => ({ price: p, vol: v })),
      ...this.cumulativeSell.map(([p, v]) => ({ price: p, vol: v })),
    ].sort((a, b) => a.price - b.price);

    this.prices = merged.map((x) => x.price);
    this.volumes = merged.map((x) => x.vol);
    this.priceLabels = this.prices.map(this.priceFormat);
    this.volumeLabels = this.volumes.map((v) => this.volumeFormat(v));

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

    this.maxPriceDifference =
      max(this.prices.map((p) => Math.abs(p - midPrice))) ?? 0;

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

    const halfRange = this._span * this.maxPriceDifference;
    const priceExtent: [number, number] = [
      midPrice - halfRange,
      midPrice + halfRange,
    ];

    // Visible index extent for volume scale calculation
    const visibleVolumes = this.prices
      .map((p, i) => ({ p, v: this.volumes[i] }))
      .filter((d) => d.p >= priceExtent[0] && d.p <= priceExtent[1])
      .map((d) => d.v);

    const maxVol = max(visibleVolumes) ?? 0;
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

    // Extend curve points to symmetric extremes so chart looks symmetric
    const buyCurvePoints: [number, number][] = [...this.cumulativeBuy];
    const sellCurvePoints: [number, number][] = [...this.cumulativeSell];

    if (buyCurvePoints.length > 0) {
      buyCurvePoints.push([
        midPrice - this.maxPriceDifference,
        buyCurvePoints.at(-1)![1],
      ]);
    }
    if (sellCurvePoints.length > 0) {
      sellCurvePoints.push([
        midPrice + this.maxPriceDifference,
        sellCurvePoints.at(-1)![1],
      ]);
    }

    // Convert data coords to canvas CSS coords
    const allVolumeZero = ticks.every((t) => t === 0);
    this._buyCssPoints = buyCurvePoints.map(([p, v]) => [
      this.priceScale(p),
      allVolumeZero ? cssH - AXIS_HEIGHT : this.volumeScale(v),
    ] as [number, number]);

    this._sellCssPoints = clipPointsRight(
      sellCurvePoints.map(([p, v]) => [
        this.priceScale(p),
        allVolumeZero ? cssH - AXIS_HEIGHT : this.volumeScale(v),
      ] as [number, number]),
      this.plotWidth,
    );

    this._midPrice = this._midPrice || midPrice;
    this._computedMidPrice = midPrice;
    this._priceExtent = priceExtent;
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
