/**
 * Canvas renderer for Mamba game state (retro DOS-inspired look).
 */

import type { Direction, GameState, Point } from "@mamba/engine";

const COLORS = {
  background: "#000000",
  borderOuter: "#3a6adf",
  borderInner: "#d0d8e8",
  hudBar: "#1e4aad",
  hudBadge: "#c41e1e",
  hudText: "#f0d000",
  hudMuted: "#ffffff",
  snake: "#f0c800",
  snakeBright: "#ffe44d",
  snakeDark: "#101010",
  wall: "#8b1515",
  wallHatch: "#d44a4a",
  blue: "#3ac0ff",
  green: "#2ee04a",
  yellow: "#f0d000",
  overlay: "rgba(0, 0, 0, 0.72)",
  white: "#f5f5f5",
} as const;

const PREFERRED_CELL = 28;
const HUD_H = 40;
const PAD = 16;
const FOOTER_H = 40;
const GAP = 1;

/** Viewport budget used to fit the board on screen. */
export interface FitBudget {
  maxWidth: number;
  maxHeight: number;
}

/**
 * Draws the full game frame including HUD, field, and overlays.
 */
export class Renderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private cell = PREFERRED_CELL;
  private sizedFor: {
    width: number;
    height: number;
    dpr: number;
    cell: number;
  } | null = null;

  /**
   * @param canvas - Target canvas element.
   */
  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("Canvas 2D context unavailable");
    }
    this.ctx = ctx;
  }

  /**
   * Computes a cell size so the board fits inside the given CSS-pixel budget.
   *
   * @param fieldWidth - Cells across.
   * @param fieldHeight - Cells down.
   * @param budget - Available stage size.
   * @returns Chosen cell size in CSS pixels.
   */
  fitCellSize(fieldWidth: number, fieldHeight: number, budget: FitBudget): number {
    const chromeX = PAD * 2 + 8;
    const chromeY = HUD_H + FOOTER_H + PAD * 2 + 8;
    const maxCellW = Math.floor((budget.maxWidth - chromeX) / fieldWidth);
    const maxCellH = Math.floor((budget.maxHeight - chromeY) / fieldHeight);
    this.cell = Math.max(8, Math.min(PREFERRED_CELL, maxCellW, maxCellH));
    return this.cell;
  }

  /**
   * Ensures the canvas backing store matches field size, cell size, and DPR.
   *
   * @param width - Field width in cells.
   * @param height - Field height in cells.
   */
  resize(width: number, height: number): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (
      this.sizedFor !== null &&
      this.sizedFor.width === width &&
      this.sizedFor.height === height &&
      this.sizedFor.dpr === dpr &&
      this.sizedFor.cell === this.cell
    ) {
      return;
    }

    this.sizedFor = { width, height, dpr, cell: this.cell };
    const cssW = PAD * 2 + width * this.cell + 8;
    const cssH = HUD_H + PAD * 2 + height * this.cell + 8 + FOOTER_H;

    this.canvas.style.width = `${cssW}px`;
    this.canvas.style.height = `${cssH}px`;
    this.canvas.width = Math.round(cssW * dpr);
    this.canvas.height = Math.round(cssH * dpr);

    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.ctx.imageSmoothingEnabled = true;
  }

  /**
   * Logical (CSS-pixel) canvas size used for layout math.
   */
  private get logicalSize(): { width: number; height: number } {
    const width = this.sizedFor?.width ?? 40;
    const height = this.sizedFor?.height ?? 22;
    return {
      width: PAD * 2 + width * this.cell + 8,
      height: HUD_H + PAD * 2 + height * this.cell + 8 + FOOTER_H,
    };
  }

  /**
   * Renders a frame.
   *
   * @param state - Current engine state, or null before the first game.
   * @param overlay - Optional overlay mode.
   * @param budget - Stage size for live rescale.
   */
  draw(
    state: GameState | null,
    overlay: "start" | "gameover" | null = null,
    budget?: FitBudget,
  ): void {
    const width = state?.width ?? 40;
    const height = state?.height ?? 22;
    if (budget) {
      this.fitCellSize(width, height, budget);
    }
    this.resize(width, height);

    const { ctx } = this;
    const { width: cssW, height: cssH } = this.logicalSize;

    ctx.fillStyle = COLORS.background;
    ctx.fillRect(0, 0, cssW, cssH);

    this.drawHud(
      state?.score ?? 0,
      state?.bluePellets.length ?? 0,
      state?.level ?? 1,
    );

    if (state === null) {
      this.drawEmptyField(width, height);
    } else {
      this.drawField(state);
    }

    this.drawFooter();

    if (overlay === "gameover" || state?.status === "gameover") {
      this.drawOverlay("gameover", state?.score ?? 0);
    }
  }

  /**
   * Draws the top status bar (title, blue count, level, score).
   */
  private drawHud(score: number, blueCount: number, level: number): void {
    const { ctx } = this;
    const { width: cssW } = this.logicalSize;
    ctx.fillStyle = COLORS.hudBar;
    ctx.fillRect(0, 0, cssW, HUD_H);

    const cy = Math.round(HUD_H / 2);
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";

    ctx.fillStyle = COLORS.hudBadge;
    ctx.fillRect(8, 6, 78, HUD_H - 12);
    ctx.fillStyle = COLORS.hudText;
    ctx.font = "bold 18px 'IBM Plex Mono', monospace";
    ctx.fillText("MAMBA", 16, cy);

    // Pack stats from the right so small boards never overlap the title.
    let cursor = cssW - 10;
    cursor = this.drawHudStat(cursor, cy, `Score : ${score}`);
    cursor -= 8;
    cursor = this.drawHudStat(cursor, cy, `Level : ${level}`);
    cursor -= 10;

    ctx.font = "bold 14px 'IBM Plex Mono', monospace";
    const countLabel = String(blueCount);
    const countWidth = Math.max(28, Math.ceil(ctx.measureText(countLabel).width) + 12);
    cursor -= countWidth;
    ctx.fillStyle = COLORS.hudBadge;
    ctx.fillRect(cursor, 8, countWidth, HUD_H - 16);
    ctx.fillStyle = COLORS.hudText;
    ctx.textAlign = "center";
    ctx.fillText(countLabel, cursor + countWidth / 2, cy);

    ctx.fillStyle = COLORS.blue;
    ctx.textAlign = "right";
    ctx.fillText("@@", cursor - 6, cy);
    ctx.textAlign = "left";
  }

  /**
   * Draws a yellow-on-red HUD value chip anchored to a right edge.
   *
   * @returns The left edge x of the chip (for packing more stats).
   */
  private drawHudStat(rightEdge: number, cy: number, label: string): number {
    const { ctx } = this;
    ctx.font = "13px 'IBM Plex Mono', monospace";
    const width = Math.ceil(ctx.measureText(label).width) + 14;
    const left = rightEdge - width;
    ctx.fillStyle = COLORS.hudBadge;
    ctx.fillRect(left, 8, width, HUD_H - 16);
    ctx.fillStyle = COLORS.hudText;
    ctx.textAlign = "right";
    ctx.fillText(label, rightEdge - 7, cy);
    ctx.textAlign = "left";
    return left;
  }

  /**
   * Draws an empty bordered field (pre-game).
   */
  private drawEmptyField(width: number, height: number): void {
    const origin = this.fieldOrigin();
    this.strokeBorder(origin.x, origin.y, width * this.cell, height * this.cell);
  }

  /**
   * Draws the playfield contents.
   *
   * @param state - Engine state.
   */
  private drawField(state: GameState): void {
    const origin = this.fieldOrigin();
    const { ctx } = this;
    const cell = this.cell;

    ctx.fillStyle = COLORS.background;
    ctx.fillRect(origin.x, origin.y, state.width * cell, state.height * cell);
    this.strokeBorder(origin.x, origin.y, state.width * cell, state.height * cell);

    for (const wall of state.walls) {
      this.drawWall(origin, wall);
    }
    for (const p of state.bluePellets) {
      this.drawTextCell(origin, p, "@@", COLORS.blue);
    }
    for (const p of state.greenPellets) {
      this.drawTextCell(origin, p, "**", COLORS.green);
    }
    if (state.yellowPellet) {
      this.fillBlock(origin, state.yellowPellet.pos, COLORS.yellow);
    }

    this.drawSnake(origin, state);
  }

  /**
   * Draws the snake: solid body tiles, bright smiley head, chevron-only tail.
   */
  private drawSnake(origin: Point, state: GameState): void {
    const { snake, direction } = state;
    if (snake.length === 0) {
      return;
    }

    const bodyEnd = snake.length > 1 ? snake.length - 1 : snake.length;
    for (let i = 1; i < bodyEnd; i += 1) {
      this.fillBlock(origin, snake[i], COLORS.snake);
    }

    if (snake.length > 1) {
      const tail = snake[snake.length - 1];
      const before = snake[snake.length - 2];
      this.drawChevronTail(origin, tail, before);
    }

    const head = snake[0];
    this.fillBlock(origin, head, COLORS.snakeBright);
    this.drawSmileyHead(origin, head, direction);
  }

  /**
   * Draws a classic two-eye + mouth face with dark pixels on a bright head.
   */
  private drawSmileyHead(origin: Point, head: Point, direction: Direction): void {
    const { ctx } = this;
    const cell = this.cell;
    const x = origin.x + head.x * cell + GAP;
    const y = origin.y + head.y * cell + GAP;
    const size = cell - GAP * 2;

    ctx.fillStyle = COLORS.snakeDark;

    const eyeY = y + Math.floor(size * 0.28);
    const eyeSize = Math.max(2, Math.floor(size * 0.12));
    let leftEyeX = x + Math.floor(size * 0.22);
    let rightEyeX = x + Math.floor(size * 0.62);
    if (direction === "Left") {
      leftEyeX = x + Math.floor(size * 0.16);
      rightEyeX = x + Math.floor(size * 0.56);
    } else if (direction === "Right") {
      leftEyeX = x + Math.floor(size * 0.28);
      rightEyeX = x + Math.floor(size * 0.68);
    }

    ctx.fillRect(leftEyeX, eyeY, eyeSize, eyeSize);
    ctx.fillRect(rightEyeX, eyeY, eyeSize, eyeSize);

    const mouthY = y + Math.floor(size * 0.62);
    const mouthW = Math.floor(size * 0.4);
    const mouthX = x + Math.floor((size - mouthW) / 2);
    ctx.fillRect(mouthX, mouthY, mouthW, Math.max(2, Math.floor(size * 0.1)));
  }

  /**
   * Draws yellow geometric chevrons on a transparent tail cell.
   */
  private drawChevronTail(origin: Point, tail: Point, before: Point): void {
    const { ctx } = this;
    const cell = this.cell;
    const x = origin.x + tail.x * cell + GAP;
    const y = origin.y + tail.y * cell + GAP;
    const size = cell - GAP * 2;
    const cx = x + size / 2;
    const cy = y + size / 2;
    const arm = size * 0.22;

    let dx = 0;
    let dy = 0;
    if (before.x < tail.x) {
      dx = -1;
    } else if (before.x > tail.x) {
      dx = 1;
    } else if (before.y < tail.y) {
      dy = -1;
    } else {
      dy = 1;
    }

    ctx.fillStyle = COLORS.snake;
    for (const offset of [-arm * 0.55, arm * 0.15]) {
      ctx.beginPath();
      if (dx !== 0) {
        const tipX = cx + dx * (arm + offset);
        ctx.moveTo(tipX, cy);
        ctx.lineTo(tipX - dx * arm, cy - arm * 0.7);
        ctx.lineTo(tipX - dx * arm, cy + arm * 0.7);
      } else {
        const tipY = cy + dy * (arm + offset);
        ctx.moveTo(cx, tipY);
        ctx.lineTo(cx - arm * 0.7, tipY - dy * arm);
        ctx.lineTo(cx + arm * 0.7, tipY - dy * arm);
      }
      ctx.closePath();
      ctx.fill();
    }
  }

  /**
   * Fills a wall cell with a hatched red pattern, clipped to the cell.
   */
  private drawWall(origin: Point, p: Point): void {
    const { ctx } = this;
    const cell = this.cell;
    const x = origin.x + p.x * cell;
    const y = origin.y + p.y * cell;

    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, cell, cell);
    ctx.clip();

    ctx.fillStyle = COLORS.wall;
    ctx.fillRect(x, y, cell, cell);

    ctx.strokeStyle = COLORS.wallHatch;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let i = -cell; i <= cell * 2; i += 5) {
      ctx.moveTo(x + i, y);
      ctx.lineTo(x + i + cell, y + cell);
    }
    ctx.stroke();
    ctx.restore();
  }

  /**
   * Fills a nearly full cell block (1px gap for a tiled DOS look).
   */
  private fillBlock(origin: Point, p: Point, color: string): void {
    const { ctx } = this;
    const cell = this.cell;
    ctx.fillStyle = color;
    ctx.fillRect(
      origin.x + p.x * cell + GAP,
      origin.y + p.y * cell + GAP,
      cell - GAP * 2,
      cell - GAP * 2,
    );
  }

  /**
   * Draws a glyph centered in a cell (pellets only).
   */
  private drawTextCell(origin: Point, p: Point, text: string, color: string): void {
    const { ctx } = this;
    const cell = this.cell;
    const x = Math.round(origin.x + p.x * cell + cell / 2);
    const y = Math.round(origin.y + p.y * cell + cell / 2);
    ctx.fillStyle = color;
    ctx.font = `bold ${Math.floor(cell * 0.65)}px 'IBM Plex Mono', monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, x, y);
    ctx.textAlign = "left";
  }

  /**
   * Draws a double-line border around the field.
   */
  private strokeBorder(x: number, y: number, w: number, h: number): void {
    const { ctx } = this;
    ctx.strokeStyle = COLORS.borderOuter;
    ctx.lineWidth = 3;
    ctx.strokeRect(x - 4, y - 4, w + 8, h + 8);
    ctx.strokeStyle = COLORS.borderInner;
    ctx.lineWidth = 1;
    ctx.strokeRect(x - 1, y - 1, w + 2, h + 2);
  }

  /**
   * Draws credit footer text.
   */
  private drawFooter(): void {
    const { ctx } = this;
    const { width: cssW, height: cssH } = this.logicalSize;
    const y = cssH - FOOTER_H + 14;
    ctx.font = "12px 'IBM Plex Mono', monospace";
    ctx.fillStyle = COLORS.borderOuter;
    ctx.textAlign = "center";
    ctx.fillText("Original game by Bert Uffen · Remake in progress", Math.round(cssW / 2), y);
    ctx.fillStyle = COLORS.white;
    ctx.fillText("Phase 3 — local leaderboards", Math.round(cssW / 2), y + 16);
    ctx.textAlign = "left";
  }

  /**
   * Draws a game-over overlay.
   */
  private drawOverlay(kind: "gameover", score: number): void {
    const { ctx } = this;
    const { width: cssW, height: cssH } = this.logicalSize;
    ctx.fillStyle = COLORS.overlay;
    ctx.fillRect(0, HUD_H, cssW, cssH - HUD_H - FOOTER_H);

    ctx.textAlign = "center";
    ctx.fillStyle = COLORS.hudText;
    ctx.font = "bold 36px 'IBM Plex Mono', monospace";
    const cx = Math.round(cssW / 2);
    const cy = Math.round(cssH / 2) - 10;

    if (kind === "gameover") {
      ctx.fillText("GAME OVER", cx, cy - 20);
      ctx.font = "16px 'IBM Plex Mono', monospace";
      ctx.fillStyle = COLORS.white;
      ctx.fillText(`Score: ${score}`, cx, cy + 16);
      ctx.fillText("Press Play or Enter to try again", cx, cy + 40);
    }
    ctx.textAlign = "left";
  }

  /**
   * Top-left pixel of the playfield grid.
   */
  private fieldOrigin(): Point {
    return { x: PAD + 4, y: HUD_H + PAD + 4 };
  }
}
