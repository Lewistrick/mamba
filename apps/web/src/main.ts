/**
 * Mamba Phase 2 — sizes, HTML menu, live rescale, sound.
 */

import {
  FIELD_SIZES,
  Game,
  type Direction,
  type FieldSizeId,
  type GameState,
} from "@mamba/engine";
import { SoundBoard } from "./audio.ts";
import { Renderer } from "./renderer.ts";
import { loadSettings, saveSettings, type Settings } from "./settings.ts";
import "./style.css";

/** Fixed simulation rate (ticks per second). */
const TICKS_PER_SECOND = 10;

const KEY_TO_DIR: Record<string, Direction> = {
  ArrowUp: "Up",
  ArrowDown: "Down",
  ArrowLeft: "Left",
  ArrowRight: "Right",
};

type Screen = "menu" | "playing" | "gameover";

const canvasEl = document.querySelector<HTMLCanvasElement>("#game");
const stageEl = document.querySelector<HTMLElement>("#stage");
const playBtnEl = document.querySelector<HTMLButtonElement>("#btn-play");
const soundToggleEl = document.querySelector<HTMLInputElement>("#sound-enabled");
const statusNode = document.querySelector<HTMLElement>("#status");
const sizeInputs = document.querySelectorAll<HTMLInputElement>('input[name="size"]');

if (!canvasEl || !stageEl || !playBtnEl || !soundToggleEl || !statusNode) {
  throw new Error("Required DOM nodes missing");
}

const canvas = canvasEl;
const stage = stageEl;
const playBtn = playBtnEl;
const soundToggle = soundToggleEl;
const statusEl = statusNode;

const settings: Settings = loadSettings();
const sounds = new SoundBoard(!settings.soundEnabled);
const renderer = new Renderer(canvas);

let game: Game | null = null;
let state: GameState | null = null;
let screen: Screen = "menu";
let accumulator = 0;
let lastTime = performance.now();

/**
 * Applies persisted settings to the menu controls.
 */
function syncMenuFromSettings(): void {
  for (const input of sizeInputs) {
    input.checked = input.value === settings.sizeId;
  }
  soundToggle.checked = settings.soundEnabled;
  sounds.setMuted(!settings.soundEnabled);
}

/**
 * Reads the selected board size from the radio group.
 *
 * @returns Field size id.
 */
function selectedSizeId(): FieldSizeId {
  for (const input of sizeInputs) {
    if (input.checked && (input.value === "small" || input.value === "medium" || input.value === "large")) {
      return input.value;
    }
  }
  return "medium";
}

/**
 * Persists current menu choices.
 */
function persistFromMenu(): void {
  settings.sizeId = selectedSizeId();
  settings.soundEnabled = soundToggle.checked;
  sounds.setMuted(!settings.soundEnabled);
  saveSettings(settings);
}

/**
 * Stage pixel budget for live board rescale.
 *
 * @returns Max CSS width/height for the canvas.
 */
function stageBudget(): { maxWidth: number; maxHeight: number } {
  const rect = stage.getBoundingClientRect();
  return {
    maxWidth: Math.max(200, Math.floor(rect.width)),
    maxHeight: Math.max(200, Math.floor(rect.height)),
  };
}

/**
 * Updates the status line under the Play button.
 *
 * @param text - Message to show.
 */
function setStatus(text: string): void {
  statusEl.textContent = text;
}

/**
 * Starts a new run with the currently selected size.
 */
function startGame(): void {
  persistFromMenu();
  sounds.resume();
  game = Game.withSize(settings.sizeId, (Math.random() * 0xffffffff) >>> 0);
  state = game.getState();
  screen = "playing";
  accumulator = 0;
  playBtn.textContent = "Restart";
  setStatus("");
}

/**
 * Toggles sound on/off and syncs the menu checkbox.
 */
function toggleSound(): void {
  soundToggle.checked = !soundToggle.checked;
  persistFromMenu();
  sounds.resume();
}

/**
 * Handles keyboard input for movement, restart, and sound.
 *
 * @param event - Keyboard event.
 */
function onKeyDown(event: KeyboardEvent): void {
  if (event.key === "Enter" || event.key === " ") {
    if (screen !== "playing") {
      event.preventDefault();
      startGame();
    }
    return;
  }

  if (event.key === "s" || event.key === "S") {
    if (event.repeat) {
      return;
    }
    event.preventDefault();
    toggleSound();
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
      sounds.playEvents(state.events);
      accumulator -= step;
      if (state.status === "gameover") {
        screen = "gameover";
        accumulator = 0;
        playBtn.textContent = "Play again";
        setStatus(`Score ${state.score}`);
        break;
      }
    }
  }

  const previewSize = FIELD_SIZES[selectedSizeId()];
  const drawState =
    state ??
    ({
      width: previewSize.width,
      height: previewSize.height,
      snake: [],
      direction: "Right",
      walls: [],
      bluePellets: [],
      greenPellets: [],
      yellowPellet: null,
      score: 0,
      level: 1,
      pelletsEatenThisLife: 0,
      moltThreshold: 0,
      status: "playing",
      tick: 0,
      blueValue: 1,
      greenValue: 10,
      events: [],
    } satisfies GameState);

  const overlay = screen === "gameover" ? "gameover" : null;
  renderer.draw(screen === "menu" ? drawState : state, overlay, stageBudget());
  requestAnimationFrame(frame);
}

playBtn.addEventListener("click", () => {
  startGame();
});

soundToggle.addEventListener("change", () => {
  persistFromMenu();
  sounds.resume();
});

for (const input of sizeInputs) {
  input.addEventListener("change", () => {
    persistFromMenu();
    if (screen === "menu" || screen === "gameover") {
      state = null;
    }
    setStatus("");
  });
}

window.addEventListener("keydown", onKeyDown);
syncMenuFromSettings();
setStatus("");
requestAnimationFrame(frame);
