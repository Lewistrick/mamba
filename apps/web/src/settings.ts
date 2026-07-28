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
}

const DEFAULTS: Settings = {
  sizeId: "medium",
  soundEnabled: true,
  playerName: "AAA",
  leaderboardScope: "local",
  playMode: "solo",
  aiDifficulty: "medium",
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
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return { ...DEFAULTS };
    }
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
    return {
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
    };
  } catch {
    return { ...DEFAULTS };
  }
}

/**
 * Saves settings to localStorage.
 *
 * @param settings - Preferences to persist.
 */
export function saveSettings(settings: Settings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}
