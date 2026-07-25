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
  snakeDark: "#101010",
  wall: "#8b1515",
  wallHatch: "#d44a4a",
  blue: "#3ac0ff",
  green: "#2ee04a",
  yellow: "#f0d000",
  overlay: "rgba(0, 0, 0, 0.72)",
  white: "#f5f5f5",
} as const;

/** Logical cell size in CSS pixels. */
const CELL = 28;
const HUD_H = 40;
const PAD = 16;
const FOOTER_H = 40;
const GAP = 1;

/**
 * Draws the full game frame including HUD, field, and overlays.
 */
export class Renderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private sizedFor: { width: number; height: number; dpr: number } | null = null;

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
   * Ensures the canvas backing store matches the field size and device pixel ratio.
   * Skips work when nothing changed (avoids clearing fonts every frame).
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
      this.sizedFor.dpr === dpr
    ) {
      return;
    }

    this.sizedFor = { width, height, dpr };
    const cssW = PAD * 2 + width * CELL + 8;
    const cssH = HUD_H + PAD * 2 + height * CELL + 8 + FOOTER_H;

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
      width: PAD * 2 + width * CELL + 8,
      height: HUD_H + PAD * 2 + height * CELL + 8 + FOOTER_H,
    };
  }

  /**
   * Renders a frame.
   *
   * @param state - Current engine state, or null before the first game.
   * @param overlay - Optional overlay mode.
   */
  draw(
    state: GameState | null,
    overlay: "start" | "gameover" | null = null,
  ): void {
    const width = state?.width ?? 40;
    const height = state?.height ?? 22;
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

    if (overlay === "start" || state === null) {
      this.drawOverlay("start", state?.score ?? 0);
    } else if (overlay === "gameover" || state.status === "gameover") {
      this.drawOverlay("gameover", state.score);
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

    ctx.fillStyle = COLORS.hudBadge;
    ctx.fillRect(8, 6, 78, HUD_H - 12);
    ctx.fillStyle = COLORS.hudText;
    ctx.font = "bold 18px 'IBM Plex Mono', monospace";
    ctx.fillText("MAMBA", 16, cy);

    ctx.font = "13px 'IBM Plex Mono', monospace";
    ctx.fillStyle = COLORS.hudMuted;
    ctx.fillText("(c) 1989, Bert Uffen, Amsterdam", 98, cy);

    const right = cssW - 12;
    this.drawHudStat(right, cy, `Score : ${score}`);
    this.drawHudStat(right - 160, cy, `Level : ${level}`);

    ctx.fillStyle = COLORS.blue;
    ctx.font = "bold 14px 'IBM Plex Mono', monospace";
    ctx.textAlign = "right";
    ctx.fillText("@@", right - 300, cy);
    ctx.fillStyle = COLORS.hudBadge;
    ctx.fillRect(right - 285, 8, 36, HUD_H - 16);
    ctx.fillStyle = COLORS.hudText;
    ctx.textAlign = "center";
    ctx.fillText(String(blueCount), right - 267, cy);

    ctx.textAlign = "left";
  }

  /**
   * Draws a yellow-on-red HUD value chip.
   */
  private drawHudStat(rightEdge: number, cy: number, label: string): void {
    const { ctx } = this;
    ctx.font = "13px 'IBM Plex Mono', monospace";
    const width = Math.ceil(ctx.measureText(label).width) + 14;
    ctx.fillStyle = COLORS.hudBadge;
    ctx.fillRect(rightEdge - width, 8, width, HUD_H - 16);
    ctx.fillStyle = COLORS.hudText;
    ctx.textAlign = "right";
    ctx.fillText(label, rightEdge - 7, cy);
  }

  /**
   * Draws an empty bordered field (pre-game).
   */
  private drawEmptyField(width: number, height: number): void {
    const origin = this.fieldOrigin();
    this.strokeBorder(origin.x, origin.y, width * CELL, height * CELL);
  }

  /**
   * Draws the playfield contents.
   *
   * @param state - Engine state.
   */
  private drawField(state: GameState): void {
    const origin = this.fieldOrigin();
    const { ctx } = this;

    ctx.fillStyle = COLORS.background;
    ctx.fillRect(origin.x, origin.y, state.width * CELL, state.height * CELL);
    this.strokeBorder(origin.x, origin.y, state.width * CELL, state.height * CELL);

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
   * Draws preset 1 snake: gapped tiles, pixel smiley head, chevron tail.
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
      this.fillBlock(origin, tail, COLORS.snake);
      this.drawChevronTail(origin, tail, before);
    }

    const head = snake[0];
    this.fillBlock(origin, head, COLORS.snake);
    this.drawSmileyHead(origin, head, direction);
  }

  /**
   * Draws a classic two-eye + mouth face with pixels (no Unicode).
   */
  private drawSmileyHead(origin: Point, head: Point, direction: Direction): void {
    const { ctx } = this;
    const x = origin.x + head.x * CELL + GAP;
    const y = origin.y + head.y * CELL + GAP;
    const size = CELL - GAP * 2;

    ctx.fillStyle = COLORS.snakeDark;

    // Eyes
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

    // Mouth
    const mouthY = y + Math.floor(size * 0.62);
    const mouthW = Math.floor(size * 0.4);
    const mouthX = x + Math.floor((size - mouthW) / 2);
    ctx.fillRect(mouthX, mouthY, mouthW, Math.max(2, Math.floor(size * 0.1)));
  }

  /**
   * Draws a geometric chevron tail (not font text).
   */
  private drawChevronTail(origin: Point, tail: Point, before: Point): void {
    const { ctx } = this;
    const x = origin.x + tail.x * CELL + GAP;
    const y = origin.y + tail.y * CELL + GAP;
    const size = CELL - GAP * 2;
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

    ctx.fillStyle = COLORS.snakeDark;
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
    const x = origin.x + p.x * CELL;
    const y = origin.y + p.y * CELL;

    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, CELL, CELL);
    ctx.clip();

    ctx.fillStyle = COLORS.wall;
    ctx.fillRect(x, y, CELL, CELL);

    ctx.strokeStyle = COLORS.wallHatch;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let i = -CELL; i <= CELL * 2; i += 5) {
      ctx.moveTo(x + i, y);
      ctx.lineTo(x + i + CELL, y + CELL);
    }
    ctx.stroke();
    ctx.restore();
  }

  /**
   * Fills a nearly full cell block (1px gap for a tiled DOS look).
   */
  private fillBlock(origin: Point, p: Point, color: string): void {
    const { ctx } = this;
    ctx.fillStyle = color;
    ctx.fillRect(
      origin.x + p.x * CELL + GAP,
      origin.y + p.y * CELL + GAP,
      CELL - GAP * 2,
      CELL - GAP * 2,
    );
  }

  /**
   * Draws a glyph centered in a cell (pellets only).
   */
  private drawTextCell(origin: Point, p: Point, text: string, color: string): void {
    const { ctx } = this;
    const x = Math.round(origin.x + p.x * CELL + CELL / 2);
    const y = Math.round(origin.y + p.y * CELL + CELL / 2);
    ctx.fillStyle = color;
    ctx.font = `bold ${Math.floor(CELL * 0.65)}px 'IBM Plex Mono', monospace`;
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
    ctx.fillText("Phase 1 — single player", Math.round(cssW / 2), y + 16);
    ctx.textAlign = "left";
  }

  /**
   * Draws a start or game-over overlay.
   */
  private drawOverlay(kind: "start" | "gameover", score: number): void {
    const { ctx } = this;
    const { width: cssW, height: cssH } = this.logicalSize;
    ctx.fillStyle = COLORS.overlay;
    ctx.fillRect(0, HUD_H, cssW, cssH - HUD_H - FOOTER_H);

    ctx.textAlign = "center";
    ctx.fillStyle = COLORS.hudText;
    ctx.font = "bold 36px 'IBM Plex Mono', monospace";
    const cx = Math.round(cssW / 2);
    const cy = Math.round(cssH / 2) - 10;

    if (kind === "start") {
      ctx.fillText("MAMBA", cx, cy - 20);
      ctx.font = "16px 'IBM Plex Mono', monospace";
      ctx.fillStyle = COLORS.white;
      ctx.fillText("Press Enter or Space to start", cx, cy + 20);
    } else {
      ctx.fillText("GAME OVER", cx, cy - 20);
      ctx.font = "16px 'IBM Plex Mono', monospace";
      ctx.fillStyle = COLORS.white;
      ctx.fillText(`Score: ${score}`, cx, cy + 16);
      ctx.fillText("Press Enter or Space to play again", cx, cy + 40);
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
