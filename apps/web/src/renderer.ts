/**
 * Canvas renderer for Mamba game state (retro DOS-inspired look).
 */

import type { Direction, GameState, Point } from "@mamba/engine";
import { pelletScore, versusHudNetScore } from "@mamba/engine";
import { gameOverScoreLines } from "./scoreBreakdown.ts";

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
  snakeAi: "#3ecfcf",
  snakeAiBright: "#7fffff",
  snakeAiDark: "#0a3030",
  wall: "#8b1515",
  wallHatch: "#d44a4a",
  blue: "#3ac0ff",
  green: "#2ee04a",
  yellow: "#b8e600",
  yellowTimer: "#000000",
  yellowTimerUrgent: "#d00000",
  overlay: "rgba(0, 0, 0, 0.72)",
  white: "#f5f5f5",
} as const;

const PREFERRED_CELL = 28;
const HUD_H = 40;
const PAD = 16;
const GAP = 1;
/** Must match the client simulation rate in main.ts. */
const TICKS_PER_SECOND = 10;

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
    const chromeY = HUD_H + PAD * 2 + 8;
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
    const cssH = HUD_H + PAD * 2 + height * this.cell + 8;

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
      height: HUD_H + PAD * 2 + height * this.cell + 8,
    };
  }

  /**
   * Renders a frame.
   *
   * @param state - Current engine state, or null before the first game.
   * @param overlay - Optional overlay mode.
   * @param budget - Stage size for live rescale.
   * @param options - Display tweaks (e.g. opponent HUD label).
   */
  draw(
    state: GameState | null,
    overlay: "start" | "gameover" | "paused" | null = null,
    budget?: FitBudget,
    options?: {
      opponentLabel?: string;
      fair?: boolean;
      dimOpponent?: boolean;
      /** Admin-mode debug overlay: cells considered for the next yellow-pellet spawn, marked with a cross. */
      adminCandidates?: readonly Point[];
    },
  ): void {
    const width = state?.width ?? 40;
    const height = state?.height ?? 22;
    if (budget) {
      this.fitCellSize(width, height, budget);
    }
    this.resize(width, height);

    const { ctx } = this;
    const { width: cssW, height: cssH } = this.logicalSize;
    const opponentLabel = options?.opponentLabel ?? "AI";
    const fair = options?.fair ?? false;
    const dimOpponent = options?.dimOpponent ?? false;

    ctx.fillStyle = COLORS.background;
    ctx.fillRect(0, 0, cssW, cssH);

    this.drawHud(state, opponentLabel, fair);

    if (state === null) {
      this.drawEmptyField(width, height);
    } else {
      this.drawField(state, dimOpponent);
      if (options?.adminCandidates?.length) {
        this.drawAdminCandidates(this.fieldOrigin(), options.adminCandidates);
      }
    }

    if (overlay === "paused") {
      this.drawOverlay("paused", state, opponentLabel, fair);
    } else if (overlay === "gameover") {
      this.drawOverlay("gameover", state, opponentLabel, fair);
    }
  }

  /**
   * Draws the top status bar (title, level, score / versus stats).
   *
   * @param state - Game state.
   * @param opponentLabel - Label for player 1 scores.
   * @param fair - Real multiplayer: net score doesn't deduct opponent pellets.
   */
  private drawHud(state: GameState | null, opponentLabel = "AI", fair = false): void {
    const { ctx } = this;
    const { width: cssW } = this.logicalSize;
    ctx.fillStyle = COLORS.hudBar;
    ctx.fillRect(0, 0, cssW, HUD_H);

    const cy = Math.round(HUD_H / 2);
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";

    ctx.font = "bold 18px 'IBM Plex Mono', monospace";
    const logoPaddingX = 8;
    const logoWidth = Math.ceil(ctx.measureText("MAMBA").width) + logoPaddingX * 2;
    ctx.fillStyle = COLORS.hudBadge;
    ctx.fillRect(8, 6, logoWidth, HUD_H - 12);
    ctx.fillStyle = COLORS.hudText;
    ctx.fillText("MAMBA", 8 + logoPaddingX, cy);

    const score = state?.score ?? 0;
    const level = state?.level ?? 1;
    const versus = (state?.players.length ?? 1) > 1;
    const timeBonus = state?.survivalScore ?? 0;

    // Packed from the right so left-to-right order matches the labels below.
    let cursor = cssW - 10;
    if (versus && state?.players[0] && state.players[1]) {
      const you = state.players[0];
      const opp = state.players[1];
      const youPellets = pelletScore(you);
      const oppPellets = pelletScore(opp);
      const hudNet = versusHudNetScore(you, opp, fair);
      cursor = this.drawHudStat(cursor, cy, `Net : ${hudNet}`);
      cursor -= 8;
      cursor = this.drawHudStat(cursor, cy, `Time : ${timeBonus}`);
      cursor -= 8;
      cursor = this.drawHudStat(
        cursor,
        cy,
        `${opponentLabel} : ${oppPellets}`,
      );
      cursor -= 8;
      cursor = this.drawHudStat(cursor, cy, `You : ${youPellets}`);
    } else {
      cursor = this.drawHudStat(cursor, cy, `Score : ${score}`);
    }
    cursor -= 10;

    ctx.font = "bold 14px 'IBM Plex Mono', monospace";
    const levelLabel = String(level);
    const levelWidth = Math.max(28, Math.ceil(ctx.measureText(levelLabel).width) + 12);
    cursor -= levelWidth;
    ctx.fillStyle = COLORS.hudBadge;
    ctx.fillRect(cursor, 8, levelWidth, HUD_H - 16);
    ctx.fillStyle = COLORS.hudText;
    ctx.textAlign = "center";
    ctx.fillText(levelLabel, cursor + levelWidth / 2, cy);

    ctx.fillStyle = COLORS.hudMuted;
    ctx.textAlign = "right";
    ctx.fillText("Lv", cursor - 6, cy);
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
   * @param dimOpponent - Desaturate the opponent's snake (stale/disconnected).
   */
  private drawField(state: GameState, dimOpponent = false): void {
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
    for (const yellow of state.yellowPellets) {
      this.drawYellowPellet(origin, yellow);
    }

    for (let i = state.players.length - 1; i >= 0; i -= 1) {
      this.drawSnakePlayer(origin, state.players[i], i === 0, i === 1 && dimOpponent);
    }
  }

  /**
   * Draws the lime bonus pellet and second countdown once TTL is set.
   */
  private drawYellowPellet(
    origin: Point,
    yellow: GameState["yellowPellets"][number],
  ): void {
    this.fillBlock(origin, yellow.pos, COLORS.yellow);
    if (yellow.ttl === null) {
      return;
    }
    const seconds = yellow.ttl / TICKS_PER_SECOND;
    const label = seconds >= 10 ? String(Math.floor(seconds)) : seconds.toFixed(1);
    const color =
      seconds < 3 ? COLORS.yellowTimerUrgent : COLORS.yellowTimer;
    this.drawTextCell(origin, yellow.pos, label, color, 0.42);
  }

  /**
   * Draws one snake (human yellow or AI cyan).
   *
   * @param dim - Desaturate this snake — used for a multiplayer opponent
   * whose position hasn't been refreshed by the server recently (stale or
   * mid-reconnect), so it reads as "not live" rather than being guessed at.
   */
  private drawSnakePlayer(
    origin: Point,
    player: GameState["players"][number],
    human: boolean,
    dim = false,
  ): void {
    const { body, direction } = player;
    if (body.length === 0) {
      return;
    }

    const { ctx } = this;
    if (dim) {
      ctx.save();
      ctx.filter = "saturate(35%) brightness(80%)";
    }

    const bodyColor = human ? COLORS.snake : COLORS.snakeAi;
    const headColor = human ? COLORS.snakeBright : COLORS.snakeAiBright;
    const faceColor = human ? COLORS.snakeDark : COLORS.snakeAiDark;

    const bodyEnd = body.length > 1 ? body.length - 1 : body.length;
    for (let i = 1; i < bodyEnd; i += 1) {
      this.fillBlock(origin, body[i], bodyColor);
    }

    if (body.length > 1) {
      const tail = body[body.length - 1];
      const before = body[body.length - 2];
      this.drawChevronTail(origin, tail, before, bodyColor);
    }

    const head = body[0];
    this.fillBlock(origin, head, headColor);
    this.drawSmileyHead(origin, head, direction, faceColor);

    if (dim) {
      ctx.restore();
    }
  }

  /**
   * Draws a classic two-eye + mouth face with dark pixels on a bright head.
   */
  private drawSmileyHead(
    origin: Point,
    head: Point,
    direction: Direction,
    faceColor: string = COLORS.snakeDark,
  ): void {
    const { ctx } = this;
    const cell = this.cell;
    const x = origin.x + head.x * cell + GAP;
    const y = origin.y + head.y * cell + GAP;
    const size = cell - GAP * 2;

    ctx.fillStyle = faceColor;

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
   * Draws geometric chevrons on a transparent tail cell.
   */
  private drawChevronTail(
    origin: Point,
    tail: Point,
    before: Point,
    color: string = COLORS.snake,
  ): void {
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

    ctx.fillStyle = color;
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
   *
   * @param fontScale - Font size as a fraction of cell size (default 0.65).
   */
  private drawTextCell(
    origin: Point,
    p: Point,
    text: string,
    color: string,
    fontScale = 0.65,
  ): void {
    const { ctx } = this;
    const cell = this.cell;
    const x = Math.round(origin.x + p.x * cell + cell / 2);
    const y = Math.round(origin.y + p.y * cell + cell / 2);
    ctx.fillStyle = color;
    ctx.font = `bold ${Math.floor(cell * fontScale)}px 'IBM Plex Mono', monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, x, y);
    ctx.textAlign = "left";
  }

  /**
   * Admin-mode debug overlay: marks every cell the yellow-pellet placement
   * search considered, drawn on top of the field (including over the
   * already-placed pellet) so nothing looks "placed" yet while paused.
   *
   * @param origin - Field origin.
   * @param positions - Candidate cells.
   */
  private drawAdminCandidates(origin: Point, positions: readonly Point[]): void {
    for (const p of positions) {
      this.drawTextCell(origin, p, "X", COLORS.yellow, 0.8);
    }
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
   * Draws a full-field status overlay (game over or pause).
   *
   * @param kind - Overlay mode.
   * @param state - Engine state used for the score breakdown.
   */
  private drawOverlay(
    kind: "gameover" | "paused",
    state: GameState | null,
    opponentLabel = "AI",
    fair = false,
  ): void {
    const { ctx } = this;
    const { width: cssW, height: cssH } = this.logicalSize;
    ctx.fillStyle = COLORS.overlay;
    ctx.fillRect(0, HUD_H, cssW, cssH - HUD_H);

    ctx.textAlign = "center";
    ctx.fillStyle = COLORS.hudText;
    ctx.font = "bold 36px 'IBM Plex Mono', monospace";
    const cx = Math.round(cssW / 2);
    const cy = Math.round(cssH / 2) - 10;

    if (kind === "paused") {
      ctx.fillText("PAUSED", cx, cy - 10);
      ctx.font = "16px 'IBM Plex Mono', monospace";
      ctx.fillStyle = COLORS.white;
      ctx.fillText("Press P to resume", cx, cy + 24);
    } else {
      ctx.fillText("GAME OVER", cx, cy - 48);
      ctx.font = "16px 'IBM Plex Mono', monospace";
      ctx.fillStyle = COLORS.white;
      const lines = state
        ? gameOverScoreLines(state, { opponentLabel, fair })
        : ["Score  0"];
      let y = cy - 8;
      for (const line of lines) {
        ctx.fillText(line, cx, y);
        y += 22;
      }
      ctx.fillText("Press Play or Enter to try again", cx, y + 12);
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
