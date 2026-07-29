/**
 * Game-over score breakdown lines for solo and versus overlays.
 */

import type { GameState } from "@mamba/engine";

/**
 * Builds aligned game-over score lines.
 *
 * Versus (AI or multiplayer):
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
 * @param state - Final engine state (player 0 = local “you”).
 * @param options - Optional opponent label (default AI).
 * @returns Display lines.
 */
export function gameOverScoreLines(
  state: GameState,
  options?: { opponentLabel?: string },
): string[] {
  if (state.players.length > 1) {
    const oppLabel = options?.opponentLabel ?? "AI";
    const you = state.players[0].score;
    const opp = state.players[1].score;
    const time = state.players[0].survivalScore;
    const win = state.players[0].winBonus;
    const net = state.netScore;
    const oppText = `-${opp}`;
    const valueWidth = Math.max(
      String(you).length,
      oppText.length,
      String(time).length,
      String(win).length,
      String(net).length,
    );
    const labelWidth = Math.max("Time bonus".length, `${oppLabel} score`.length);
    const row = (label: string, value: string): string =>
      `${label.padEnd(labelWidth, " ")}  ${value.padStart(valueWidth, " ")}`;
    const rule = `${"-".repeat(labelWidth + 2 + valueWidth)} +`;
    return [
      row("Your score", String(you)),
      row(`${oppLabel} score`, oppText),
      row("Time bonus", String(time)),
      row("Win bonus", String(win)),
      rule,
      row("Net score", String(net)),
    ];
  }

  return [`Score  ${state.score}`];
}
