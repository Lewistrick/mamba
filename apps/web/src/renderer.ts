/**
 * Canvas renderer for Mamba game state (retro DOS-inspired look).
 */

import type { Direction, GameState, Point } from "@mamba/engine";

const COLORS = {
  background: "#000000",
  border: "#3a6adf",
  hudBg: "#b01515",
  hudText: "#f0d000",
  hudMuted: "#8ec8ff",
  snake: "#f0d000",
  snakeFace: "#101010",
  wall: "#a01818",
  wallHatch: "#c44a4a",
  blue: "#3a8cff",
  green: "#33cc44",
  yellow: "#f0d000",
  overlay: "rgba(0, 0, 0, 0.72)",
  white: "#f5f5f5",
} as const;

const CELL = 16;
const HUD_H = 28;
const PAD = 12;
const FOOTER_H = 36;

/**
 * Draws the full game frame including HUD, field, and overlays.
 */
export class Renderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;

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
   * Resizes the canvas to fit a given field size.
   *
   * @param width - Field width in cells.
   * @param height - Field height in cells.
   */
  resize(width: number, height: number): void {
    this.canvas.width = PAD * 2 + width * CELL + 4;
    this.canvas.height = HUD_H + PAD * 2 + height * CELL + 4 + FOOTER_H;
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
    const { ctx, canvas } = this;
    const width = state?.width ?? 40;
    const height = state?.height ?? 22;
    this.resize(width, height);

    ctx.fillStyle = COLORS.background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    this.drawHud(
      state?.score ?? 0,
      state?.bluePellets.length ?? 0,
      state?.greenValue ?? 10,
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
   * Draws the top status bar.
   */
  private drawHud(score: number, blueCount: number, greenValue: number): void {
    const { ctx, canvas } = this;
    ctx.fillStyle = COLORS.hudBg;
    ctx.fillRect(0, 0, canvas.width, HUD_H);

    ctx.font = "bold 14px 'IBM Plex Mono', monospace";
    ctx.textBaseline = "middle";
    const cy = HUD_H / 2;

    ctx.fillStyle = COLORS.hudText;
    ctx.fillText("MAMBA", 10, cy);

    ctx.font = "12px 'IBM Plex Mono', monospace";
    ctx.fillStyle = COLORS.hudMuted;
    ctx.fillText("(c) 1989, Bert Uffen, Amsterdam", 78, cy);

    const right = canvas.width - 10;
    ctx.textAlign = "right";
    ctx.fillStyle = COLORS.hudText;
    ctx.fillText(`Score : ${score}`, right, cy);

    ctx.fillStyle = COLORS.green;
    ctx.fillText(`** = ${greenValue}`, right - 130, cy);

    ctx.fillStyle = COLORS.blue;
    ctx.fillText(`@@ = ${blueCount}`, right - 210, cy);

    ctx.textAlign = "left";
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
      this.fillCell(origin, state.yellowPellet.pos, COLORS.yellow);
    }

    this.drawSnake(origin, state);
  }

  /**
   * Draws the snake with a smiley head and `<<` / `>>` style tail.
   */
  private drawSnake(origin: Point, state: GameState): void {
    const { snake, direction } = state;
    if (snake.length === 0) {
      return;
    }

    for (let i = 1; i < snake.length - 1; i += 1) {
      this.fillCell(origin, snake[i], COLORS.snake);
    }

    if (snake.length > 1) {
      const tail = snake[snake.length - 1];
      const before = snake[snake.length - 2];
      const glyph = tailGlyph(before, tail);
      this.drawTextCell(origin, tail, glyph, COLORS.snake);
    }

    const head = snake[0];
    this.fillCell(origin, head, COLORS.snake);
    this.drawFace(origin, head, direction);
  }

  /**
   * Draws a simple face on the head cell.
   */
  private drawFace(origin: Point, head: Point, direction: Direction): void {
    const { ctx } = this;
    const x = origin.x + head.x * CELL;
    const y = origin.y + head.y * CELL;
    ctx.fillStyle = COLORS.snakeFace;

    const eyeY = y + 5;
    let leftX = x + 4;
    let rightX = x + 10;
    if (direction === "Left") {
      leftX = x + 3;
      rightX = x + 9;
    } else if (direction === "Right") {
      leftX = x + 5;
      rightX = x + 11;
    }

    ctx.fillRect(leftX, eyeY, 2, 2);
    ctx.fillRect(rightX, eyeY, 2, 2);
    ctx.fillRect(x + 5, y + 10, 6, 2);
  }

  /**
   * Fills a wall cell with a hatched red pattern.
   */
  private drawWall(origin: Point, p: Point): void {
    const { ctx } = this;
    const x = origin.x + p.x * CELL;
    const y = origin.y + p.y * CELL;
    ctx.fillStyle = COLORS.wall;
    ctx.fillRect(x, y, CELL, CELL);
    ctx.strokeStyle = COLORS.wallHatch;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = -CELL; i < CELL * 2; i += 4) {
      ctx.moveTo(x + i, y);
      ctx.lineTo(x + i + CELL, y + CELL);
    }
    ctx.stroke();
  }

  /**
   * Fills a solid cell.
   */
  private fillCell(origin: Point, p: Point, color: string): void {
    const { ctx } = this;
    ctx.fillStyle = color;
    ctx.fillRect(origin.x + p.x * CELL, origin.y + p.y * CELL, CELL, CELL);
  }

  /**
   * Draws a two-character glyph centered in a cell.
   */
  private drawTextCell(origin: Point, p: Point, text: string, color: string): void {
    const { ctx } = this;
    const x = origin.x + p.x * CELL + CELL / 2;
    const y = origin.y + p.y * CELL + CELL / 2;
    ctx.fillStyle = color;
    ctx.font = "bold 12px 'IBM Plex Mono', monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, x, y);
    ctx.textAlign = "left";
  }

  /**
   * Draws a double-line blue border around the field.
   */
  private strokeBorder(x: number, y: number, w: number, h: number): void {
    const { ctx } = this;
    ctx.strokeStyle = COLORS.border;
    ctx.lineWidth = 2;
    ctx.strokeRect(x - 1, y - 1, w + 2, h + 2);
    ctx.lineWidth = 1;
    ctx.strokeRect(x - 3, y - 3, w + 6, h + 6);
  }

  /**
   * Draws credit footer text.
   */
  private drawFooter(): void {
    const { ctx, canvas } = this;
    const y = canvas.height - FOOTER_H + 14;
    ctx.font = "11px 'IBM Plex Mono', monospace";
    ctx.fillStyle = COLORS.border;
    ctx.textAlign = "center";
    ctx.fillText("Original game by Bert Uffen · Remake in progress", canvas.width / 2, y);
    ctx.fillStyle = COLORS.white;
    ctx.fillText("Phase 1 — single player", canvas.width / 2, y + 14);
    ctx.textAlign = "left";
  }

  /**
   * Draws a start or game-over overlay.
   */
  private drawOverlay(kind: "start" | "gameover", score: number): void {
    const { ctx, canvas } = this;
    ctx.fillStyle = COLORS.overlay;
    ctx.fillRect(0, HUD_H, canvas.width, canvas.height - HUD_H - FOOTER_H);

    ctx.textAlign = "center";
    ctx.fillStyle = COLORS.hudText;
    ctx.font = "bold 28px 'IBM Plex Mono', monospace";
    const cx = canvas.width / 2;
    const cy = canvas.height / 2 - 10;

    if (kind === "start") {
      ctx.fillText("MAMBA", cx, cy - 16);
      ctx.font = "14px 'IBM Plex Mono', monospace";
      ctx.fillStyle = COLORS.white;
      ctx.fillText("Press Enter or Space to start", cx, cy + 16);
    } else {
      ctx.fillText("GAME OVER", cx, cy - 16);
      ctx.font = "14px 'IBM Plex Mono', monospace";
      ctx.fillStyle = COLORS.white;
      ctx.fillText(`Score: ${score}`, cx, cy + 12);
      ctx.fillText("Press Enter or Space to play again", cx, cy + 32);
    }
    ctx.textAlign = "left";
  }

  /**
   * Top-left pixel of the playfield grid.
   */
  private fieldOrigin(): Point {
    return { x: PAD + 2, y: HUD_H + PAD + 2 };
  }
}

/**
 * Chooses a tail glyph based on the segment before the tip.
 *
 * @param before - Segment closer to the head.
 * @param tail - Tail tip.
 * @returns ASCII-ish tail marker.
 */
function tailGlyph(before: Point, tail: Point): string {
  if (before.x < tail.x) {
    return "<<";
  }
  if (before.x > tail.x) {
    return ">>";
  }
  if (before.y < tail.y) {
    return "^^";
  }
  return "vv";
}
