import { numberToRgb } from "./utils";

type DepthCurveSide = "buy" | "sell";

function traceDepthCurvePath(
  ctx: CanvasRenderingContext2D,
  points: [number, number][],
  baseY: number,
): void {
  ctx.beginPath();
  ctx.moveTo(points[0][0], baseY);

  for (let i = 0; i < points.length - 1; i++) {
    const [x0, y0] = points[i];
    const [x1] = points[i + 1];
    ctx.lineTo(x0, y0);
    ctx.lineTo(x1, y0);
  }

  const last = points[points.length - 1];
  ctx.lineTo(last[0], last[1]);
  ctx.lineTo(last[0], baseY);
  ctx.closePath();
}

function traceDepthCurveStrokePath(
  ctx: CanvasRenderingContext2D,
  points: [number, number][],
  baseY: number,
): void {
  ctx.beginPath();
  ctx.moveTo(points[0][0], baseY);
  ctx.lineTo(points[0][0], points[0][1]);

  for (let i = 0; i < points.length - 1; i++) {
    const [x0, y0] = points[i];
    const [x1, y1] = points[i + 1];
    ctx.lineTo(x1, y0);
    ctx.lineTo(x1, y1);
  }
}

/**
 * Draw a step-after area + stroke curve on a canvas 2D context.
 *
 * Points are already in *canvas pixel coordinates* (not CSS pixels),
 * because the CanvasRenderer applies the DPR transform to the context.
 *
 * @param ctx           Canvas 2D context (already scaled by DPR).
 * @param points        Array of [x, y] in CSS pixel units (after scale transform).
 * @param chartHeight   Full canvas height in CSS pixels.
 * @param axisHeight    Height of the bottom axis bar in CSS pixels.
 * @param fillColor     24-bit integer fill color.
 * @param strokeColor   24-bit integer stroke color.
 * @param strokeWidth   Stroke width in CSS pixels.
 * @param fillAlpha     Fill opacity (0–1).
 */
export function drawDepthCurve(
  ctx: CanvasRenderingContext2D,
  points: [number, number][],
  chartHeight: number,
  axisHeight: number,
  fillColor: number,
  strokeColor: number,
  strokeWidth: number,
  fillAlpha: number,
  _side: DepthCurveSide,
): void {
  if (points.length < 2) return;

  const baseY = chartHeight - axisHeight;

  // ── Area (step-after fill) ───────────────────────────────────────────────
  ctx.save();
  traceDepthCurvePath(ctx, points, baseY);

  ctx.fillStyle = numberToRgb(fillColor, fillAlpha);
  ctx.fill();
  ctx.restore();

  // ── Stroke (step-after line) ─────────────────────────────────────────────
  ctx.save();
  traceDepthCurveStrokePath(ctx, points, baseY);
  ctx.lineWidth = strokeWidth;
  ctx.strokeStyle = numberToRgb(strokeColor, 1);
  ctx.lineJoin = "miter";
  ctx.lineCap = "butt";

  ctx.stroke();
  ctx.restore();
}

/**
 * Clip a list of points so that no x value exceeds `maxX`.
 * If a segment crosses maxX, an interpolated point at maxX is inserted.
 */
export function clipPointsRight(
  points: [number, number][],
  maxX: number,
): [number, number][] {
  const result: [number, number][] = [];
  for (let i = 0; i < points.length; i++) {
    const [x, y] = points[i];
    if (i === 0) {
      result.push(points[i]);
      continue;
    }
    const prevX = points[i - 1][0];
    if (prevX <= maxX && x > maxX) {
      result.push([maxX, y]);
    } else if (prevX > maxX) {
      /* skip */
    } else {
      result.push(points[i]);
    }
  }
  return result;
}
