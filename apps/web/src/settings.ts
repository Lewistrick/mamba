/**
 * Persisted client settings (board size + sound).
 */

import type { FieldSizeId } from "@mamba/engine";

const STORAGE_KEY = "mamba.settings.v1";

/** Client-side preferences. */
export interface Settings {
  sizeId: FieldSizeId;
  soundEnabled: boolean;
  /** Last used high-score name. */
  playerName: string;
}

const DEFAULTS: Settings = {
  sizeId: "medium",
  soundEnabled: true,
  playerName: "AAA",
};

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
