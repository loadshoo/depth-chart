import { ScaleLinear } from "d3-scale";
import { numberToRgb, formatVolume } from "./utils";
import type { Colors } from "./types";

/** Font used for axis labels */
const FONT_FAMILY = "system-ui, -apple-system, sans-serif";

const FONT_SIZE = 12; // CSS px
export { FONT_SIZE };

/** Height of the bottom price axis in CSS px */
export const AXIS_HEIGHT = FONT_SIZE + 5;

/**
 * Draw the horizontal price axis at the bottom of the chart.
 * Uses 5 evenly spaced ticks between domain[0] and domain[1].
 */
export function drawHorizontalAxis(
  ctx: CanvasRenderingContext2D,
  priceScale: ScaleLinear<number, number>,
  domain: [number, number],
  width: number,   // CSS px
  height: number,  // CSS px
  colors: Colors,
): void {
  const NUM_TICKS = 5;
  const [start, end] = domain;
  if (!isFinite(start) || !isFinite(end) || isNaN(start) || isNaN(end)) return;
  const step = (end - start) / NUM_TICKS;
  const tickFormat = priceScale.tickFormat(NUM_TICKS);

  const axisY = height - AXIS_HEIGHT / 2;
  const labelY = axisY + 3;

  ctx.save();
  ctx.font = `${FONT_SIZE}px ${FONT_FAMILY}`;
  ctx.fillStyle = numberToRgb(colors.textSecondary);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  for (let i = 0.5; i < NUM_TICKS; i++) {
    const tick = start + i * step;
    const x = priceScale(tick);
    if (x < 0 || x > width) continue;

    // tick mark
    ctx.fillText("|", x, axisY - FONT_SIZE * 0.5);

    // label
    ctx.fillText(tickFormat(tick), x, labelY);
  }

  ctx.restore();
}

/**
 * Draw the vertical volume axis on the right of the chart.
 * Renders a "enter/update/exit" style list of ticks derived from the scale.
 */
export function drawVerticalAxis(
  ctx: CanvasRenderingContext2D,
  volumeScale: ScaleLinear<number, number>,
  axisOffsetX: number, // right edge of the plot area in CSS px
  height: number,
  colors: Colors,
  resolution: number,
): void {
  const numTicks = Math.floor(height / 50);
  const ticks = volumeScale.ticks(numTicks).filter((t) => t !== 0);
  if (ticks.length === 0) return;

  ctx.save();
  ctx.font = `${FONT_SIZE}px ${FONT_FAMILY}`;
  ctx.fillStyle = numberToRgb(colors.textSecondary);
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";

  for (const tick of ticks) {
    const y = volumeScale(tick);
    if (y < 0 || y > height - AXIS_HEIGHT) continue;

    ctx.fillText("-", axisOffsetX, y);
    ctx.fillText(formatVolume(tick), axisOffsetX + 5 * resolution, y);
  }

  ctx.restore();
}

/**
 * Draw the vertical mid-price line at the horizontal centre.
 */
export function drawMidPriceLine(
  ctx: CanvasRenderingContext2D,
  midX: number,    // CSS px
  height: number,  // CSS px
): void {
  ctx.save();
  ctx.beginPath();
  ctx.setLineDash([]);
  ctx.strokeStyle = "#dedede";
  ctx.lineWidth = 1.5;
  ctx.moveTo(midX, 0);
  ctx.lineTo(midX, height);
  ctx.stroke();
  ctx.restore();
}

/**
 * Draw a semi-transparent overlay rect (used for buy / sell side highlight).
 */
export function drawOverlayRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  color: number,
  alpha: number,
): void {
  if (w <= 0 || h <= 0) return;
  ctx.save();
  ctx.fillStyle = numberToRgb(color, alpha);
  ctx.fillRect(x, y, w, h);
  ctx.restore();
}

/**
 * Draw the crosshair indicator (vertical line + horizontal half-line + circle).
 */
export function drawIndicator(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  color: number,
  side: "buy" | "sell",
): void {
  ctx.save();
  ctx.strokeStyle = numberToRgb(color);
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 3]);

  // vertical line
  ctx.beginPath();
  ctx.moveTo(x, 0);
  ctx.lineTo(x, height);
  ctx.stroke();

  // horizontal half-line toward centre
  ctx.beginPath();
  if (side === "buy") {
    ctx.moveTo(0, y);
  } else {
    ctx.moveTo(width, y);
  }
  ctx.lineTo(width / 2, y);
  ctx.stroke();

  // circle
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.arc(x, y, 4, 0, Math.PI * 2);
  ctx.fillStyle = numberToRgb(color);
  ctx.fill();

  ctx.restore();
}

/**
 * Draw a label with a solid background, left- or right-aligned.
 * Returns the bounding box so callers can avoid overlapping.
 */
export function drawLabel(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  anchor: { x: number; y: number },
  color: number,
  bgColor: number,
  resolution: number,
): void {
  if (!text) return;
  ctx.save();
  ctx.font = `${FONT_SIZE}px ${FONT_FAMILY}`;

  const metrics = ctx.measureText(text);
  const tw = metrics.width;
  const th = FONT_SIZE * 1.2;
  const pad = 1.5 * resolution;

  const rx = x - anchor.x * tw - pad;
  const ry = y - anchor.y * th - pad;
  const rw = tw + 2 * pad;
  const rh = th + 2 * pad;

  ctx.fillStyle = numberToRgb(bgColor);
  ctx.fillRect(rx, ry, rw, rh);

  ctx.fillStyle = numberToRgb(color);
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText(text, rx + pad, ry + pad);

  ctx.restore();
}

/**
 * 绘制带有边框和圆角的两行Tooltip卡片，展示当前价格和价差幅度
 */
export function drawHoverTooltip(
  ctx: CanvasRenderingContext2D,
  priceLabel: string,
  rangeLabel: string,
  x: number,
  y: number,
  side: "buy" | "sell",
  color: number,
  bgColor: number,
  resolution: number,
  cssWidth: number,
): void {
  ctx.save();
  ctx.font = `${FONT_SIZE}px ${FONT_FAMILY}`;

  const text1 = `Price: ${priceLabel}`;
  const text2 = `Range: ${rangeLabel}`;

  const tw1 = ctx.measureText(text1).width;
  const tw2 = ctx.measureText(text2).width;
  const tw = Math.max(tw1, tw2);

  const padX = 8 * resolution;
  const padY = 6 * resolution;
  const lineSpacing = 4 * resolution;
  const rh = FONT_SIZE * 2 + lineSpacing + padY * 2;
  const rw = tw + padX * 2;

  // 定位逻辑，买单显示在准星右侧，卖单显示在准星左侧
  let rx = side === "buy" ? x + 12 * resolution : x - rw - 12 * resolution;
  const ry = y - rh / 2;

  // 边界保护
  if (rx < 0) rx = 0;
  if (rx + rw > cssWidth) rx = cssWidth - rw;

  // 背景
  ctx.fillStyle = numberToRgb(bgColor, 0.9);
  ctx.beginPath();
  if (ctx.roundRect) {
    ctx.roundRect(rx, ry, rw, rh, 4 * resolution);
  } else {
    ctx.rect(rx, ry, rw, rh);
  }
  ctx.fill();

  // 边框
  ctx.strokeStyle = numberToRgb(color, 0.6);
  ctx.lineWidth = 1;
  ctx.stroke();

  // 文本
  ctx.fillStyle = numberToRgb(color);
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText(text1, rx + padX, ry + padY);
  ctx.fillText(text2, rx + padX, ry + padY + FONT_SIZE + lineSpacing);

  ctx.restore();
}

