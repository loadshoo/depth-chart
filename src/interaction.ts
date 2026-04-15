import { bisectLeft, bisectRight, zip } from "d3-array";
import { Delaunay } from "d3-delaunay";

function clamp(value: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, value));
}

import { AXIS_HEIGHT, FONT_SIZE } from "./drawAxes";
import {
  drawHorizontalAxis,
  drawVerticalAxis,
  drawMidPriceLine,
  drawOverlayRect,
  drawIndicator,
  drawLabel,
} from "./drawAxes";
import { CanvasRenderer } from "./renderer";
import type { DepthChartCore } from "./core";
import type { Colors } from "./types";
import { bisectCenter, numberToRgb } from "./utils";

const OVERLAY_ALPHA = 0.05;

type HoverState = {
  buyIndex: number;
  sellIndex: number;
  buyPixelX: number;
  sellPixelX: number;
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
  private core: DepthChartCore;

  public transform: number = 1;
  public scaleExtent: [number, number] = [0, Infinity];

  private hoverState: HoverState = null;
  private auctionHover: AuctionHoverState = null;

  // Gesture tracking
  private wheelTimer: ReturnType<typeof setTimeout> | null = null;
  private touch0: { point: [number, number]; original: [number, number]; id: number } | null = null;
  private touch1: { point: [number, number]; original: [number, number]; id: number } | null = null;
  private originalTransform: number = 1;

  private _indicativePrice: number = 0;
  private auctionDelaunay: Delaunay<[number, number]> | null = null;

  constructor(options: {
    uiCanvas: HTMLCanvasElement;
    resolution: number;
    core: DepthChartCore;
  }) {
    super();
    this.uiRenderer = new CanvasRenderer(options.uiCanvas, options.resolution);
    this.core = options.core;

    this._bindEvents(options.uiCanvas);
  }

  resize(cssWidth: number, cssHeight: number): void {
    this.uiRenderer.resize(cssWidth, cssHeight);
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

    // Build Delaunay for auction mode
    if (this._indicativePrice && core.prices.length > 1) {
      const pts = zip(core.prices, core.volumes) as [number, number][];
      this.auctionDelaunay = Delaunay.from(pts);
    } else {
      this.auctionDelaunay = null;
    }

    // Axes
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
      r,
    );

    drawMidPriceLine(ctx, core.plotWidth / 2, cssH);

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
    this._processHoverX(x, 0);
    this.render();
  }

  clearPrice(): void {
    this.hoverState = null;
    this.auctionHover = null;
    this.render();
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
    const bIdx = state.buyIndex;
    if (bIdx >= 0 && bIdx < core.prices.length && core.prices[bIdx] < midX) {
      const bX = state.buyPixelX;
      const bVol = core.volumes[bIdx];
      const bVolY = core.volumeScale(bVol);

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
        core.priceLabels[bIdx] ?? "",
        clamp(
          bX,
          (core.priceLabels[bIdx]?.length ?? 0) * 4,
          midX - (core.priceLabels[bIdx]?.length ?? 0) * 4,
        ),
        cssH - AXIS_HEIGHT / 2 + 3 * core.resolution,
        { x: 0.5, y: 0.5 },
        core.colors.buyStroke,
        core.colors.backgroundLabel,
        core.resolution,
      );

      drawLabel(
        ctx,
        core.volumeLabels[bIdx] ?? "",
        0,
        clamp(bVolY, FONT_SIZE, cssH - AXIS_HEIGHT - FONT_SIZE),
        { x: 0, y: 0.5 },
        core.colors.buyStroke,
        core.colors.backgroundLabel,
        core.resolution,
      );

      // % diff label midway between bX and midX
      const midPrice = core._computedMidPrice;
      const numPrice = parseFloat(core.priceLabels[bIdx]?.replace(/,/g, "") ?? "0");
      const pctDiff = midPrice
        ? (((numPrice - midPrice) / midPrice) * 100).toFixed(2) + "%"
        : "";
      if (pctDiff) {
        drawLabel(
          ctx,
          pctDiff,
          bX + (midX - bX) / 2,
          clamp(bVolY, FONT_SIZE, cssH - AXIS_HEIGHT - FONT_SIZE),
          { x: 0.5, y: 0.5 },
          core.colors.buyStroke,
          core.colors.backgroundLabel,
          core.resolution,
        );
      }
    }

    // Sell side
    const sIdx = state.sellIndex;
    if (
      sIdx >= 0 &&
      sIdx < core.prices.length &&
      core.prices[sIdx] > core.priceScale.invert(midX)
    ) {
      const sX = state.sellPixelX;
      const sVol = core.volumes[sIdx];
      const sVolY = core.volumeScale(sVol);

      drawOverlayRect(
        ctx,
        sX,
        0,
        cssW - sX,
        cssH - AXIS_HEIGHT,
        core.colors.overlay,
        OVERLAY_ALPHA,
      );

      drawIndicator(ctx, sX, sVolY, cssW, cssH, core.colors.sellStroke, "sell");

      drawLabel(
        ctx,
        core.priceLabels[sIdx] ?? "",
        clamp(
          sX,
          midX + (core.priceLabels[sIdx]?.length ?? 0) * 4,
          cssW - (core.priceLabels[sIdx]?.length ?? 0) * 4,
        ),
        cssH - AXIS_HEIGHT / 2 + 3 * core.resolution,
        { x: 0.5, y: 0.5 },
        core.colors.sellStroke,
        core.colors.backgroundLabel,
        core.resolution,
      );

      drawLabel(
        ctx,
        core.volumeLabels[sIdx] ?? "",
        cssW,
        clamp(sVolY, FONT_SIZE, cssH - AXIS_HEIGHT - FONT_SIZE),
        { x: 1, y: 0.5 },
        core.colors.sellStroke,
        core.colors.backgroundLabel,
        core.resolution,
      );

      const midPrice = core._computedMidPrice;
      const numPrice = parseFloat(core.priceLabels[sIdx]?.replace(/,/g, "") ?? "0");
      const pctDiff = midPrice
        ? "+" + (((numPrice - midPrice) / midPrice) * 100).toFixed(2) + "%"
        : "";
      if (pctDiff) {
        drawLabel(
          ctx,
          pctDiff,
          midX + (sX - midX) / 2,
          clamp(sVolY, FONT_SIZE, cssH - AXIS_HEIGHT - FONT_SIZE),
          { x: 0.5, y: 0.5 },
          core.colors.sellStroke,
          core.colors.backgroundLabel,
          core.resolution,
        );
      }
    }
  }

  // ── pointer / hover computation ───────────────────────────────────────────

  private _processHoverX(cssX: number, cssY: number): void {
    const core = this.core;
    if (core.prices.length < 2) return;

    const midX = core.priceScale(core._computedMidPrice);

    if (this._indicativePrice && this.auctionDelaunay) {
      const idx = this.auctionDelaunay.find(cssX, cssY);
      const d = Math.hypot(cssX - core.prices[idx], cssY - core.volumes[idx]);
      if (d < 50) {
        this.auctionHover = {
          index: idx,
          pixelX: core.prices[idx],
          pixelY: core.volumes[idx],
        };
      } else {
        this.auctionHover = null;
      }
      return;
    }

    const nearestIdx = bisectCenter(core.prices, cssX);
    const nearestX = core.prices[nearestIdx];

    let buyIndex: number;
    let sellIndex: number;
    let buyX: number;
    let sellX: number;

    if (cssX > midX) {
      sellIndex = nearestIdx;
      sellX = nearestX;
      buyX = 2 * midX - nearestX;
      buyIndex =
        core.prices[0] >= midX
          ? -1
          : bisectLeft(core.prices, buyX) - 1;
    } else {
      buyIndex = nearestIdx;
      buyX = nearestX;
      sellX = 2 * midX - nearestX;
      sellIndex =
        core.prices.at(-1)! <= midX
          ? -1
          : bisectRight(core.prices, sellX) - 1;
    }

    this.hoverState = {
      buyIndex,
      sellIndex,
      buyPixelX: buyX,
      sellPixelX: sellX,
    };
  }

  // ── event binding ─────────────────────────────────────────────────────────

  private _bindEvents(canvas: HTMLCanvasElement): void {
    canvas.addEventListener("pointermove", this._onPointerMove);
    canvas.addEventListener("pointerleave", this._onPointerLeave);
    canvas.addEventListener("pointerdown", this._onPointerDown);
    canvas.addEventListener("wheel", this._onWheel, { passive: false });
    canvas.addEventListener("touchstart", this._onTouchStart, { passive: false });
    canvas.addEventListener("touchmove", this._onTouchMove, { passive: false });
    canvas.addEventListener("touchend", this._onTouchEnd);
  }

  unbindEvents(canvas: HTMLCanvasElement): void {
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
    this._processHoverX(x, y);
    this.render();
  };

  private _onPointerLeave = () => {
    this.hoverState = null;
    this.auctionHover = null;
    this.render();
  };

  private _onPointerDown = (e: PointerEvent) => {
    if (!("ontouchstart" in self)) return;
    const [x, y] = this._cssXY(e);
    this._processHoverX(x, y);
    this.render();
  };

  private _emitZoom(k: number): void {
    this.dispatchEvent(new CustomEvent("zoom", { detail: { k } }));
  }

  private _onWheel = (e: WheelEvent) => {
    e.preventDefault();
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
  }
}

function dist([x0, y0]: [number, number], [x1, y1]: [number, number]): number {
  return Math.sqrt((x1 - x0) ** 2 + (y1 - y0) ** 2);
}
