/**
 * Game-over score breakdown lines for solo and versus overlays.
 */

import { pelletScore, type GameState } from "@mamba/engine";

/**
 * Builds aligned game-over score lines.
 *
 * Versus (AI or multiplayer):
 * ```
 * Your score  ... pellets only
 * AI score    ... −opponent pellets only
 * Time bonus  ... your survival
 * Win bonus   ... your win
 * ------------------ +
 * Net score   ... pellets_you − pellets_AI + time + win
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
    const you = state.players[0];
    const opp = state.players[1];
    const time = you.survivalScore;
    const win = you.winBonus;
    const yourPellets = pelletScore(you);
    const oppPellets = pelletScore(opp);
    const net = state.netScore;
    const oppText = `-${oppPellets}`;
    const valueWidth = Math.max(
      String(yourPellets).length,
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
      row("Your score", String(yourPellets)),
      row(`${oppLabel} score`, oppText),
      row("Time bonus", String(time)),
      row("Win bonus", String(win)),
      rule,
      row("Net score", String(net)),
    ];
  }

  return [`Score  ${state.score}`];
}
