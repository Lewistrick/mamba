/**
 * Game-over score breakdown lines for solo and versus overlays.
 */

import type { GameState } from "@mamba/engine";

/**
 * Builds aligned game-over score lines.
 *
 * Versus:
 * ```
 * Your score  ... 35
 * AI score    ... -29
 * Time bonus  ... 19
 * Win bonus   ... 200
 * ------------------ +
 * Net score   ... 206
 * ```
 *
 * Solo: single score line (no time / win bonus).
 *
 * @param state - Final engine state.
 * @returns Display lines.
 */
export function gameOverScoreLines(state: GameState): string[] {
  if (state.players.length > 1) {
    const you = state.players[0].score;
    const ai = state.players[1].score;
    const time = state.players[0].survivalScore;
    const win = state.players[0].winBonus;
    const net = state.netScore;
    const aiText = `-${ai}`;
    const valueWidth = Math.max(
      String(you).length,
      aiText.length,
      String(time).length,
      String(win).length,
      String(net).length,
    );
    const labelWidth = "Time bonus".length;
    const row = (label: string, value: string): string =>
      `${label.padEnd(labelWidth, " ")}  ${value.padStart(valueWidth, " ")}`;
    const rule = `${"-".repeat(labelWidth + 2 + valueWidth)} +`;
    return [
      row("Your score", String(you)),
      row("AI score", aiText),
      row("Time bonus", String(time)),
      row("Win bonus", String(win)),
      rule,
      row("Net score", String(net)),
    ];
  }

  return [`Score  ${state.score}`];
}
