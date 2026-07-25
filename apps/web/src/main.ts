/**
 * Mamba Phase 1 — single-player browser client.
 */

import { Game, type Direction, type GameState } from "@mamba/engine";
import { Renderer } from "./renderer.ts";
import "./style.css";

/** Fixed simulation rate (ticks per second). */
const TICKS_PER_SECOND = 10;

const KEY_TO_DIR: Record<string, Direction> = {
  ArrowUp: "Up",
  ArrowDown: "Down",
  ArrowLeft: "Left",
  ArrowRight: "Right",
};

type Screen = "start" | "playing" | "gameover";

const canvas = document.querySelector<HTMLCanvasElement>("#game");
if (!canvas) {
  throw new Error("#game canvas not found");
}

const renderer = new Renderer(canvas);
let game: Game | null = null;
let state: GameState | null = null;
let screen: Screen = "start";
let accumulator = 0;
let lastTime = performance.now();

/**
 * Starts a new medium-field run.
 */
function startGame(): void {
  game = Game.medium((Math.random() * 0xffffffff) >>> 0);
  state = game.getState();
  screen = "playing";
  accumulator = 0;
}

/**
 * Handles keyboard input for movement and start/restart.
 *
 * @param event - Keyboard event.
 */
function onKeyDown(event: KeyboardEvent): void {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    if (screen === "start" || screen === "gameover") {
      startGame();
    }
    return;
  }

  const dir = KEY_TO_DIR[event.key];
  if (dir && game && screen === "playing") {
    event.preventDefault();
    if (event.repeat) {
      return;
    }
    game.queueDirection(dir);
  }
}

/**
 * Main animation / simulation loop.
 *
 * @param now - RAF timestamp.
 */
function frame(now: number): void {
  const dt = Math.min(0.1, (now - lastTime) / 1000);
  lastTime = now;

  if (screen === "playing" && game) {
    accumulator += dt;
    const step = 1 / TICKS_PER_SECOND;
    while (accumulator >= step) {
      state = game.tick();
      accumulator -= step;
      if (state.status === "gameover") {
        screen = "gameover";
        accumulator = 0;
        break;
      }
    }
  }

  const overlay = screen === "start" ? "start" : screen === "gameover" ? "gameover" : null;
  renderer.draw(state, overlay);
  requestAnimationFrame(frame);
}

window.addEventListener("keydown", onKeyDown);
renderer.draw(null, "start");
requestAnimationFrame(frame);
