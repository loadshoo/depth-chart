import { Delaunay } from "d3-delaunay";

function clamp(value: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, value));
}

function formatRangeLabel(price: number, midPrice: number): string {
  if (!midPrice) return "-";
  return (Math.abs(price - midPrice) / midPrice * 100).toFixed(2) + "%";
}

import { AXIS_HEIGHT, FONT_SIZE } from "./drawAxes";
import {
  drawHorizontalAxis,
  drawVerticalAxis,
  drawMidPriceLine,
  drawOverlayRect,
  drawIndicator,
  drawLabel,
  drawHoverTooltip,
} from "./drawAxes";
import { CanvasRenderer } from "./renderer";
import type { DepthChartCore } from "./core";
import { numberToRgb } from "./utils";

const OVERLAY_ALPHA = 0.05;

function findNearestPriceIndex(points: [number, number][], targetPrice: number): number {
  if (points.length === 0) return -1;

  const ascending = points.length < 2 || points[0][0] <= points[points.length - 1][0];
  let low = 0;
  let high = points.length;

  while (low < high) {
    const mid = (low + high) >>> 1;
    const price = points[mid][0];
    if (ascending ? price < targetPrice : price > targetPrice) low = mid + 1;
    else high = mid;
  }

  if (low <= 0) return 0;
  if (low >= points.length) return points.length - 1;

  const previous = points[low - 1][0];
  const current = points[low][0];
  return Math.abs(previous - targetPrice) <= Math.abs(current - targetPrice)
    ? low - 1
    : low;
}

type HoverDatum = {
  index: number;
  price: number;
  volume: number;
  pixelX: number;
  pixelY: number;
};

type HoverState = {
  sourceSide: "buy" | "sell";
  buy: HoverDatum | null;
  sell: HoverDatum | null;
} | null;

type AuctionHoverState = {
  index: number;
  pixelX: number;
  pixelY: number;
} | null;

/**
 * DepthChartInteraction
 *
 * Owns the *UI/axes* canvas and handles:
 * - Rendering axes, labels, mid-price line
 * - Mouse/touch hover tooltips and overlay highlights
 * - Wheel zoom + two-finger pinch zoom
 *
 * Communicates zoom events up via EventTarget dispatch.
 */
export class DepthChartInteraction extends EventTarget {
  private uiRenderer: CanvasRenderer;
  private baseRenderer: CanvasRenderer;
  private core: DepthChartCore;
  private canvas: HTMLCanvasElement;

  public transform: number = 1;
  public scaleExtent: [number, number] = [0, Infinity];

  private hoverState: HoverState = null;
  private auctionHover: AuctionHoverState = null;
  private lastPointer: { x: number; y: number } | null = null;

  // Gesture tracking
  private wheelTimer: ReturnType<typeof setTimeout> | null = null;
  private touch0: { point: [number, number]; original: [number, number]; id: number } | null = null;
  private touch1: { point: [number, number]; original: [number, number]; id: number } | null = null;
  private originalTransform: number = 1;

  private _indicativePrice: number = 0;
  private auctionDelaunay: Delaunay<[number, number]> | null = null;
  private auctionPoints: [number, number][] = [];
  private baseVersion: number = -1;
  private auctionVersion: number = -1;
  private pointerFrameId: number | null = null;
  private pendingPointer: { x: number; y: number } | null = null;

  constructor(options: {
    uiCanvas: HTMLCanvasElement;
    resolution: number;
    core: DepthChartCore;
  }) {
    super();
    this.canvas = options.uiCanvas;
    this.uiRenderer = new CanvasRenderer(options.uiCanvas, options.resolution);
    this.baseRenderer = new CanvasRenderer(document.createElement("canvas"), options.resolution);
    this.core = options.core;

    this._bindEvents(options.uiCanvas);
  }

  resize(cssWidth: number, cssHeight: number): void {
    this.uiRenderer.resize(cssWidth, cssHeight);
    this.baseRenderer.resize(cssWidth, cssHeight);
    this.baseVersion = -1;
  }

  set indicativePrice(p: number) {
    this._indicativePrice = p;
  }

  // ── public render call ────────────────────────────────────────────────────

  render(): void {
    const core = this.core;
    const ctx = this.uiRenderer.ctx;
    const cssW = core.cssWidth;
    const cssH = core.cssHeight;
    const r = core.resolution;

    this.uiRenderer.clear();

    if (core.prices.length < 2) return;

    this._renderStaticLayer(cssW, cssH, r);

    if (this._indicativePrice && core.prices.length > 1) {
      this._rebuildAuctionCacheIfNeeded();
    } else {
      this.auctionPoints = [];
      this.auctionDelaunay = null;
      this.auctionVersion = -1;
    }

    if (this.lastPointer) {
      this._processHoverX(this.lastPointer.x, this.lastPointer.y);
    }

    // Hover overlays & tooltips
    if (this._indicativePrice && this.auctionHover) {
      this._renderAuctionHover(ctx, cssW, cssH);
    } else if (!this._indicativePrice && this.hoverState) {
      this._renderNormalHover(ctx, cssW, cssH);
    }
  }

  // ── external update / clear (exposed via React forwardRef) ────────────────

  updatePrice(price: number): void {
    const x = this.core.priceScale(price);
    this.lastPointer = { x, y: 0 };
    this._processHoverX(x, 0);
    this.render();
  }

  clearPrice(): void {
    this.hoverState = null;
    this.auctionHover = null;
    this.lastPointer = null;
    this.pendingPointer = null;
    this.render();
  }

  private _renderStaticLayer(cssW: number, cssH: number, resolution: number): void {
    const core = this.core;

    if (this.baseVersion !== core.scaleVersion) {
      const ctx = this.baseRenderer.ctx;
      this.baseRenderer.clear();

      drawHorizontalAxis(
        ctx,
        core.priceScale,
        core._priceExtent,
        cssW,
        cssH,
        core.colors,
      );

      drawVerticalAxis(
        ctx,
        core.volumeScale,
        core.plotWidth,
        cssH,
        core.colors,
        resolution,
      );

      drawMidPriceLine(ctx, core.plotWidth / 2, cssH);
      this.baseVersion = core.scaleVersion;
    }

    const ctx = this.uiRenderer.ctx;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.baseRenderer.canvas, 0, 0);
    ctx.restore();
  }

  private _rebuildAuctionCacheIfNeeded(): void {
    const core = this.core;
    if (this.auctionVersion === core.scaleVersion) return;

    const points = new Array<[number, number]>(core.prices.length);
    for (let index = 0; index < core.prices.length; index += 1) {
      points[index] = [
        core.priceScale(core.prices[index]),
        core.volumeScale(core.volumes[index]),
      ];
    }

    this.auctionPoints = points;
    this.auctionDelaunay = Delaunay.from(points);
    this.auctionVersion = core.scaleVersion;
  }

  // ── hover rendering helpers ───────────────────────────────────────────────

  private _renderAuctionHover(
    ctx: CanvasRenderingContext2D,
    cssW: number,
    cssH: number,
  ): void {
    const state = this.auctionHover!;
    const core = this.core;

    drawIndicator(
      ctx,
      state.pixelX,
      state.pixelY,
      cssW,
      cssH,
      0xcccccc,
      "sell", // neutral
    );

    drawLabel(
      ctx,
      core.priceLabels[state.index] ?? "",
      clamp(state.pixelX, (core.priceLabels[state.index]?.length ?? 8) * 4, cssW / 2),
      cssH - AXIS_HEIGHT / 2,
      { x: 0.5, y: 0.5 },
      core.colors.textPrimary,
      core.colors.backgroundLabel,
      core.resolution,
    );

    drawLabel(
      ctx,
      core.volumeLabels[state.index] ?? "",
      state.pixelX > cssW / 2 ? cssW / 2 + 3 : cssW / 2 - 3,
      state.pixelY,
      { x: state.pixelX > cssW / 2 ? 0 : 1, y: 0.5 },
      core.colors.textPrimary,
      core.colors.backgroundLabel,
      core.resolution,
    );
  }

  private _renderNormalHover(
    ctx: CanvasRenderingContext2D,
    cssW: number,
    cssH: number,
  ): void {
    const state = this.hoverState!;
    const core = this.core;
    const midX = core.priceScale(core._computedMidPrice);

    // Buy side
    const buyDatum = state.buy;
    if (buyDatum) {
      const bX = buyDatum.pixelX;
      const bVolY = buyDatum.pixelY;

      drawOverlayRect(
        ctx,
        0,
        0,
        bX,
        cssH - AXIS_HEIGHT,
        core.colors.overlay,
        OVERLAY_ALPHA,
      );

      drawIndicator(ctx, bX, bVolY, cssW, cssH, core.colors.buyStroke, "buy");

      drawLabel(
        ctx,
        core.priceFormat(buyDatum.price),
        clamp(
          bX,
          core.priceFormat(buyDatum.price).length * 4,
          midX - core.priceFormat(buyDatum.price).length * 4,
        ),
        cssH - AXIS_HEIGHT / 2 + 3 * core.resolution,
        { x: 0.5, y: 0.5 },
        core.colors.buyStroke,
        core.colors.backgroundLabel,
        core.resolution,
      );

      drawLabel(
        ctx,
        core.volumeFormat(buyDatum.volume),
        0,
        clamp(bVolY, FONT_SIZE, cssH - AXIS_HEIGHT - FONT_SIZE),
        { x: 0, y: 0.5 },
        core.colors.buyStroke,
        core.colors.backgroundLabel,
        core.resolution,
      );

      const spreadLabel = formatRangeLabel(buyDatum.price, core._computedMidPrice);

      drawHoverTooltip(
        ctx,
        core.priceFormat(buyDatum.price),
        spreadLabel,
        bX,
        bVolY,
        "buy",
        core.colors.buyStroke,
        core.colors.backgroundLabel,
        core.resolution,
        cssW,
        cssH,
        midX,
      );
    }

    // Sell side
    const sellDatum = state.sell;
    if (sellDatum) {
      const sX = sellDatum.pixelX;
      const sVolY = sellDatum.pixelY;

      drawOverlayRect(
        ctx,
        sX,
        0,
        core.plotWidth - sX,
        cssH - AXIS_HEIGHT,
        core.colors.overlay,
        OVERLAY_ALPHA,
      );

      drawIndicator(ctx, sX, sVolY, cssW, cssH, core.colors.sellStroke, "sell");

      drawLabel(
        ctx,
        core.priceFormat(sellDatum.price),
        clamp(
          sX,
          midX + core.priceFormat(sellDatum.price).length * 4,
          core.plotWidth - core.priceFormat(sellDatum.price).length * 4,
        ),
        cssH - AXIS_HEIGHT / 2 + 3 * core.resolution,
        { x: 0.5, y: 0.5 },
        core.colors.sellStroke,
        core.colors.backgroundLabel,
        core.resolution,
      );

      drawLabel(
        ctx,
        core.volumeFormat(sellDatum.volume),
        cssW,
        clamp(sVolY, FONT_SIZE, cssH - AXIS_HEIGHT - FONT_SIZE),
        { x: 1, y: 0.5 },
        core.colors.sellStroke,
        core.colors.backgroundLabel,
        core.resolution,
      );

      const spreadLabel = formatRangeLabel(sellDatum.price, core._computedMidPrice);

      drawHoverTooltip(
        ctx,
        core.priceFormat(sellDatum.price),
        spreadLabel,
        sX,
        sVolY,
        "sell",
        core.colors.sellStroke,
        core.colors.backgroundLabel,
        core.resolution,
        cssW,
        cssH,
        midX,
      );
    }
  }

  // ── pointer / hover computation ───────────────────────────────────────────

  private _processHoverX(cssX: number, cssY: number): void {
    const core = this.core;
    if (core.prices.length < 2) {
      this.hoverState = null;
      this.auctionHover = null;
      return;
    }

    const midX = core.priceScale(core._computedMidPrice);

    if (this._indicativePrice && this.auctionDelaunay) {
      const idx = this.auctionDelaunay.find(cssX, cssY);
      const point = this.auctionPoints[idx];
      const d = point ? Math.hypot(cssX - point[0], cssY - point[1]) : Infinity;
      if (d < 50) {
        this.auctionHover = {
          index: idx,
          pixelX: point[0],
          pixelY: point[1],
        };
      } else {
        this.auctionHover = null;
      }
      return;
    }

    const hoveredPrice = core.priceScale.invert(clamp(cssX, 0, core.plotWidth));
    const sourceSide = cssX > midX ? "sell" : "buy";

    if (sourceSide === "buy") {
      const buy = this._findNearestSideDatum(core.cumulativeBuy, hoveredPrice, core);
      const sell = buy
        ? this._findNearestSideDatum(
            core.cumulativeSell,
            core._computedMidPrice + (core._computedMidPrice - buy.price),
            core,
          )
        : null;
      this.hoverState = { sourceSide, buy, sell };
      return;
    }

    const sell = this._findNearestSideDatum(core.cumulativeSell, hoveredPrice, core);
    const buy = sell
      ? this._findNearestSideDatum(
          core.cumulativeBuy,
          core._computedMidPrice - (sell.price - core._computedMidPrice),
          core,
        )
      : null;
    this.hoverState = { sourceSide, buy, sell };
  }

  private _findNearestSideDatum(
    points: [number, number][],
    targetPrice: number,
    core: DepthChartCore,
  ): HoverDatum | null {
    if (points.length === 0) return null;

    const bestIndex = findNearestPriceIndex(points, targetPrice);

    const [price, volume] = points[bestIndex];
    return {
      index: bestIndex,
      price,
      volume,
      pixelX: core.priceScale(price),
      pixelY: core.volumeScale(volume),
    };
  }

  // ── event binding ─────────────────────────────────────────────────────────

  private _bindEvents(canvas: HTMLCanvasElement): void {
    canvas.addEventListener("pointerenter", this._onPointerEnter);
    canvas.addEventListener("pointermove", this._onPointerMove);
    canvas.addEventListener("pointerleave", this._onPointerLeave);
    canvas.addEventListener("pointerdown", this._onPointerDown);
    canvas.addEventListener("wheel", this._onWheel, { passive: false });
    canvas.addEventListener("touchstart", this._onTouchStart, { passive: false });
    canvas.addEventListener("touchmove", this._onTouchMove, { passive: false });
    canvas.addEventListener("touchend", this._onTouchEnd);
  }

  unbindEvents(canvas: HTMLCanvasElement | null | undefined = this.canvas): void {
    if (!canvas) return;

    canvas.removeEventListener("pointerenter", this._onPointerEnter);
    canvas.removeEventListener("pointermove", this._onPointerMove);
    canvas.removeEventListener("pointerleave", this._onPointerLeave);
    canvas.removeEventListener("pointerdown", this._onPointerDown);
    canvas.removeEventListener("wheel", this._onWheel);
    canvas.removeEventListener("touchstart", this._onTouchStart);
    canvas.removeEventListener("touchmove", this._onTouchMove);
    canvas.removeEventListener("touchend", this._onTouchEnd);
  }

  private _rect(canvas: HTMLCanvasElement) {
    return canvas.getBoundingClientRect();
  }

  private _cssXY(e: PointerEvent | MouseEvent): [number, number] {
    const rect = this._rect(e.target as HTMLCanvasElement);
    return [e.clientX - rect.left, e.clientY - rect.top];
  }

  private _onPointerMove = (e: PointerEvent) => {
    if ("ontouchstart" in self) return; // let touch events handle it on touch devices
    const [x, y] = this._cssXY(e);
    this._schedulePointerRender(x, y);
  };

  private _onPointerEnter = (e: PointerEvent) => {
    if ("ontouchstart" in self) return;
    const [x, y] = this._cssXY(e);
    this._schedulePointerRender(x, y);
  };

  private _onPointerLeave = () => {
    if (this.pointerFrameId !== null) {
      cancelAnimationFrame(this.pointerFrameId);
      this.pointerFrameId = null;
    }
    this.hoverState = null;
    this.auctionHover = null;
    this.lastPointer = null;
    this.pendingPointer = null;
    this.render();
  };

  private _onPointerDown = (e: PointerEvent) => {
    if (!("ontouchstart" in self)) return;
    const [x, y] = this._cssXY(e);
    this._schedulePointerRender(x, y);
  };

  private _schedulePointerRender(x: number, y: number): void {
    this.pendingPointer = { x, y };
    if (this.pointerFrameId !== null) return;

    this.pointerFrameId = requestAnimationFrame(() => {
      this.pointerFrameId = null;
      if (!this.pendingPointer) return;

      const nextPointer = this.pendingPointer;
      this.pendingPointer = null;
      this.lastPointer = nextPointer;
      this._processHoverX(nextPointer.x, nextPointer.y);
      this.render();
    });
  }

  private _emitZoom(k: number): void {
    this.dispatchEvent(new CustomEvent("zoom", { detail: { k } }));
  }

  private _onWheel = (e: WheelEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (this.wheelTimer !== null) clearTimeout(this.wheelTimer);
    else this.dispatchEvent(new CustomEvent("zoomstart"));

    const k = Math.pow(2, -e.deltaY * 0.002 * (e.ctrlKey ? 10 : 1));
    this.transform = clamp(
      this.transform * k,
      this.scaleExtent[0],
      this.scaleExtent[1],
    );
    this._emitZoom(this.transform);

    this.wheelTimer = setTimeout(() => {
      this.wheelTimer = null;
      this.dispatchEvent(new CustomEvent("zoomend"));
    }, 150);
  };

  private _touchPoint(t: Touch, canvas: HTMLCanvasElement): [number, number] {
    const rect = canvas.getBoundingClientRect();
    return [t.clientX - rect.left, t.clientY - rect.top];
  }

  private _onTouchStart = (e: TouchEvent) => {
    e.preventDefault();
    e.stopImmediatePropagation();
    const canvas = e.target as HTMLCanvasElement;
    let started = false;

    for (const t of Array.from(e.touches)) {
      const p = this._touchPoint(t, canvas);
      if (!this.touch0) {
        this.touch0 = { point: p, original: p, id: t.identifier };
        started = true;
      } else if (!this.touch1 && this.touch0.id !== t.identifier) {
        this.touch1 = { point: p, original: p, id: t.identifier };
      }
    }

    if (started) {
      this.originalTransform = this.transform;
      this.dispatchEvent(new CustomEvent("zoomstart"));
    }
  };

  private _onTouchMove = (e: TouchEvent) => {
    e.preventDefault();
    e.stopImmediatePropagation();
    const canvas = e.target as HTMLCanvasElement;

    for (const t of Array.from(e.changedTouches)) {
      const p = this._touchPoint(t, canvas);
      if (this.touch0?.id === t.identifier) this.touch0.point = p;
      else if (this.touch1?.id === t.identifier) this.touch1.point = p;
    }

    if (this.touch1 && this.touch0) {
      const dp = dist(this.touch0.point, this.touch1.point);
      const dl = dist(this.touch0.original, this.touch1.original);
      const k = dl > 0 ? Math.sqrt(dp / dl) : 1;
      this.transform = clamp(
        this.originalTransform * k,
        this.scaleExtent[0],
        this.scaleExtent[1],
      );
      this._emitZoom(this.transform);
    }
  };

  private _onTouchEnd = (e: TouchEvent) => {
    for (const t of Array.from(e.changedTouches)) {
      if (this.touch0?.id === t.identifier) this.touch0 = null;
      else if (this.touch1?.id === t.identifier) this.touch1 = null;
    }
    if (!this.touch0 && !this.touch1) {
      this.dispatchEvent(new CustomEvent("zoomend"));
    }
  };

  destroy(): void {
    if (this.wheelTimer !== null) clearTimeout(this.wheelTimer);
    if (this.pointerFrameId !== null) cancelAnimationFrame(this.pointerFrameId);
    this.unbindEvents();
  }
}

function dist([x0, y0]: [number, number], [x1, y1]: [number, number]): number {
  return Math.sqrt((x1 - x0) ** 2 + (y1 - y0) ** 2);
}
