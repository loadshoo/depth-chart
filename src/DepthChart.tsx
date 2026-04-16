import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useCallback,
} from "react";
import "./DepthChart.css";

import { DepthChartCore } from "./core";
import { DepthChartInteraction } from "./interaction";
import { getColors, getDimensions, colorConfigToColors, DEFAULT_COLORS } from "./theme";
import type { DepthChartHandle, DepthChartProps } from "./types";

export { type DepthChartProps, type DepthChartHandle, type PriceLevel } from "./types";

/** Standard font size in CSS pixels */
export const FONT_SIZE = 12;
/** Height of the bottom price axis in CSS pixels */
export const AXIS_HEIGHT = FONT_SIZE + 5;

function clamp(value: number, minValue: number, maxValue: number): number {
  return Math.max(minValue, Math.min(maxValue, value));
}

function defaultPriceFormat(price: number): string {
  return price.toLocaleString("en-US", { maximumFractionDigits: 5 });
}

function defaultVolumeFormat(volume: number): string {
  return Math.round(volume).toLocaleString("en-US");
}

/** Throttle a ResizeObserver callback to at most once every `ms` milliseconds. */
function useThrottledResize<T extends HTMLElement>(
  ms: number,
  onResize: (w: number, h: number) => void,
) {
  const ref = useRef<T>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (timerRef.current !== null) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => {
          timerRef.current = null;
          onResize(width, height);
        }, ms);
      }
    });

    observer.observe(el);
    return () => {
      observer.disconnect();
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  });

  return ref;
}

/**
 * DepthChart
 *
 * A Canvas-based depth (order book) chart rendered with two stacked canvas layers.
 *
 * Layer 1 (`contentsCanvas`): area curves for buy and sell sides.
 * Layer 2 (`uiCanvas`):       price & volume axes, hover tooltips, zoom interaction.
 */
export const DepthChart = forwardRef<DepthChartHandle, DepthChartProps>(
  (
    {
      data,
      priceFormat = defaultPriceFormat,
      volumeFormat = defaultVolumeFormat,
      indicativePrice = 0,
      midPrice = 0,
      notEnoughDataText = "No data",
      theme = "dark",
      pairCode,
      colorsConfig,
      strokeWidth,
      fillAlpha = 0.2,
    },
    ref,
  ) => {
    const styleRef = useRef<HTMLDivElement>(null!);
    const contentsRef = useRef<HTMLCanvasElement>(null!);
    const uiRef = useRef<HTMLCanvasElement>(null!);

    const coreRef = useRef<DepthChartCore>(null!);
    const interactionRef = useRef<DepthChartInteraction>(null!);

    // ── initialise ─────────────────────────────────────────────────────────
    useEffect(() => {
      const resolution = window.devicePixelRatio || 1;
      const colors = colorsConfig
        ? colorConfigToColors(colorsConfig, DEFAULT_COLORS)
        : getColors(styleRef.current);
      const dimensions = strokeWidth ? { strokeWidth } : getDimensions(styleRef.current);

      const core = new DepthChartCore({
        contentsCanvas: contentsRef.current,
        resolution,
        colors,
        dimensions,
        fillAlpha,
        priceFormat,
        volumeFormat,
      });

      const interaction = new DepthChartInteraction({
        uiCanvas: uiRef.current,
        resolution,
        core,
      });

      // Wire zoom events: interaction → core.span → re-render
      let initialSpan = 1;
      interaction.addEventListener("zoomstart", () => {
        initialSpan = core.span;
        interaction.transform = 1;
        interaction.scaleExtent = [
          initialSpan / core.maxSpan,
          initialSpan / core.minSpan,
        ];
      });
      interaction.addEventListener("zoom", (e) => {
        const k = (e as CustomEvent<{ k: number }>).detail.k;
        core.span = clamp(initialSpan / k, core.minSpan, core.maxSpan);
        interaction.render();
      });

      coreRef.current = core;
      interactionRef.current = interaction;

      return () => {
        core.destroy();
        interaction.destroy();
        interaction.unbindEvents(uiRef.current);
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // ── sync formatters ───────────────────────────────────────────────────
    useEffect(() => {
      if (!coreRef.current) return;
      coreRef.current.priceFormat = priceFormat;
      coreRef.current.volumeFormat = volumeFormat;
    }, [priceFormat, volumeFormat]);

    // ── reset zoom on symbol change ───────────────────────────────────────
    useEffect(() => {
      if (!coreRef.current) return;
      coreRef.current.span = 1;
      if (interactionRef.current) interactionRef.current.transform = 1;
    }, [pairCode]);

    // ── resize ────────────────────────────────────────────────────────────
    const handleResize = useCallback((w: number, h: number) => {
      if (!coreRef.current) return;
      coreRef.current.resize(w, h);
      interactionRef.current?.resize(w, h);
      // re-render interaction layer after resize so axes are redrawn
      requestAnimationFrame(() => interactionRef.current?.render());
    }, []);

    const resizeRef = useThrottledResize<HTMLDivElement>(50, handleResize);

    // ── data ──────────────────────────────────────────────────────────────
    useEffect(() => {
      if (!coreRef.current) return;
      coreRef.current.data = data;
      requestAnimationFrame(() => interactionRef.current?.render());
    }, [data]);

    // ── indicativePrice ───────────────────────────────────────────────────
    useEffect(() => {
      if (!coreRef.current) return;
      coreRef.current.indicativePrice = indicativePrice;
      if (interactionRef.current) interactionRef.current.indicativePrice = indicativePrice;
    }, [indicativePrice]);

    // ── midPrice ──────────────────────────────────────────────────────────
    useEffect(() => {
      if (!coreRef.current) return;
      coreRef.current.midPrice = midPrice;
    }, [midPrice]);

    // ── theme / colors / dimensions ───────────────────────────────────────
    useEffect(() => {
      if (!coreRef.current) return;
      requestAnimationFrame(() => {
        const colors = colorsConfig
          ? colorConfigToColors(colorsConfig, DEFAULT_COLORS)
          : getColors(styleRef.current);
        const dimensions = strokeWidth ? { strokeWidth } : getDimensions(styleRef.current);
        coreRef.current.colors = colors;
        coreRef.current.dimensions = dimensions;
        coreRef.current.forceRender();
        interactionRef.current?.render();
      });
    }, [theme, colorsConfig, strokeWidth]);

    // ── imperative handle ─────────────────────────────────────────────────
    useImperativeHandle(ref, () => ({
      update(price: number) {
        interactionRef.current?.updatePrice(price);
      },
      clear() {
        interactionRef.current?.clearPrice();
      },
    }));

    return (
      <div ref={styleRef} className="depth-chart-container" data-theme={theme}>
        <div ref={resizeRef} className="depth-chart-canvas-container">
          <canvas ref={contentsRef} className="depth-chart-canvas" />
          <canvas ref={uiRef} className="depth-chart-canvas" />
        </div>
      </div>
    );
  },
);

DepthChart.displayName = "DepthChart";
