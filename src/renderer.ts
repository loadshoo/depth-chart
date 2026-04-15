/**
 * Low-level Canvas 2D renderer.
 * Wraps a <canvas> element, handles DPR scaling, and exposes `ctx`.
 */
export class CanvasRenderer {
  public canvas: HTMLCanvasElement;
  public ctx: CanvasRenderingContext2D;
  public resolution: number;

  private _width: number = 0;
  private _height: number = 0;

  constructor(canvas: HTMLCanvasElement, resolution = 1) {
    this.canvas = canvas;
    this.resolution = resolution;
    this.ctx = canvas.getContext("2d")!;
  }

  get width(): number {
    return this._width;
  }

  get height(): number {
    return this._height;
  }

  resize(cssWidth: number, cssHeight: number): void {
    const r = this.resolution;
    this._width = Math.round(cssWidth * r);
    this._height = Math.round(cssHeight * r);
    this.canvas.width = this._width;
    this.canvas.height = this._height;
    this.canvas.style.width = `${cssWidth}px`;
    this.canvas.style.height = `${cssHeight}px`;
    this.ctx.setTransform(r, 0, 0, r, 0, 0);
  }

  clear(): void {
    this.ctx.clearRect(0, 0, this._width, this._height);
  }
}
