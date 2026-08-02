/**
 * Persisted client settings (board size, mode, sound).
 */

import type { AiDifficulty, FieldSizeId } from "@mamba/engine";
import { AI_DIFFICULTIES } from "@mamba/engine";

const STORAGE_KEY = "mamba.settings.v1";

/** Client-side preferences. */
export interface Settings {
  sizeId: FieldSizeId;
  soundEnabled: boolean;
  /** Last used high-score name. */
  playerName: string;
  /** Local vs global leaderboard view. */
  leaderboardScope: "local" | "global";
  /** Solo or versus AI. */
  playMode: "solo" | "ai";
  /** AI difficulty when playMode is ai. */
  aiDifficulty: AiDifficulty;
  /** Persistent guest identity (room-seat/reconnect key + score rate-limit key). */
  guestId: string;
  /** True once the guest has explicitly confirmed a name (gates Play until set). */
  hasChosenName: boolean;
  /** Global leaderboard: hide scores from unverified (guest) players. */
  hideGuestScores: boolean;
}

const DEFAULTS: Settings = {
  sizeId: "medium",
  soundEnabled: true,
  playerName: "",
  leaderboardScope: "local",
  playMode: "solo",
  aiDifficulty: "medium",
  guestId: "",
  hasChosenName: false,
  hideGuestScores: false,
};

/**
 * Builds the leaderboard / submit mode string from play settings.
 *
 * @param settings - Client settings.
 * @returns `solo` or `ai:{difficulty}`.
 */
export function playModeKey(settings: Settings): string {
  return settings.playMode === "ai" ? `ai:${settings.aiDifficulty}` : "solo";
}

/**
 * Loads settings from localStorage, falling back to defaults.
 *
 * @returns Current settings.
 */
export function loadSettings(): Settings {
  let settings: Settings;
  let needsSave = false;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      settings = { ...DEFAULTS };
      needsSave = true;
    } else {
      const parsed = JSON.parse(raw) as Partial<Settings>;
      const sizeId =
        parsed.sizeId === "small" ||
        parsed.sizeId === "medium" ||
        parsed.sizeId === "large"
          ? parsed.sizeId
          : DEFAULTS.sizeId;
      const aiDifficulty = AI_DIFFICULTIES.includes(parsed.aiDifficulty as AiDifficulty)
        ? (parsed.aiDifficulty as AiDifficulty)
        : DEFAULTS.aiDifficulty;
      const playMode = parsed.playMode === "ai" ? "ai" : "solo";
      settings = {
        sizeId,
        soundEnabled:
          typeof parsed.soundEnabled === "boolean"
            ? parsed.soundEnabled
            : DEFAULTS.soundEnabled,
        playerName:
          typeof parsed.playerName === "string" && parsed.playerName.trim().length > 0
            ? parsed.playerName.trim().slice(0, 12)
            : DEFAULTS.playerName,
        leaderboardScope:
          parsed.leaderboardScope === "global" ? "global" : "local",
        playMode,
        aiDifficulty,
        guestId: typeof parsed.guestId === "string" ? parsed.guestId : "",
        hasChosenName:
          typeof parsed.hasChosenName === "boolean" ? parsed.hasChosenName : false,
        hideGuestScores:
          typeof parsed.hideGuestScores === "boolean" ? parsed.hideGuestScores : false,
      };
    }
  } catch {
    settings = { ...DEFAULTS };
    needsSave = true;
  }
  if (!settings.guestId) {
    settings.guestId = crypto.randomUUID();
    needsSave = true;
  }
  if (needsSave) {
    saveSettings(settings);
  }
  return settings;
}

/**
 * Saves settings to localStorage.
 *
 * @param settings - Preferences to persist.
 */
export function saveSettings(settings: Settings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}
