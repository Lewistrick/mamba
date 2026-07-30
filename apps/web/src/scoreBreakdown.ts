/**
 * Game-over score breakdown lines for solo and versus overlays.
 */

import { pelletScore, versusNetScore, type GameState } from "@mamba/engine";

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
 * @param options - Optional opponent label (default AI) and fair-mode flag
 * (real multiplayer: opponent pellets shown for reference only, not deducted).
 * @returns Display lines.
 */
export function gameOverScoreLines(
  state: GameState,
  options?: { opponentLabel?: string; fair?: boolean },
): string[] {
  if (state.players.length > 1) {
    const oppLabel = options?.opponentLabel ?? "AI";
    const fair = options?.fair ?? false;
    const you = state.players[0];
    const opp = state.players[1];
    const time = you.survivalScore;
    const win = you.winBonus;
    const yourPellets = pelletScore(you);
    const oppPellets = pelletScore(opp);
    const net = state.netScore;
    const oppText = fair ? String(oppPellets) : `-${oppPellets}`;
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

/** One row of the real-multiplayer game-over table. */
export interface MpScoreRow {
  label: string;
  you: number;
  opp: number;
}

/** Column names + row values for the real-multiplayer game-over table. */
export interface MpScoreTable {
  youName: string;
  oppName: string;
  rows: MpScoreRow[];
}

/**
 * Structured level/score/bonus breakdown for the real-multiplayer game-over
 * table (fair net: opponent pellets are never deducted, on either side).
 *
 * @param state - Remapped final state (player 0 = local "you").
 * @param names - Absolute seat display names.
 * @param youIndex - Local absolute seat.
 * @returns Column names and row values.
 */
export function mpScoreTable(
  state: GameState,
  names: [string, string],
  youIndex: number,
): MpScoreTable {
  const you = state.players[0];
  const opp = state.players[1];
  return {
    youName: names[youIndex] || "You",
    oppName: names[1 - youIndex] || "Opponent",
    rows: [
      { label: "Level", you: you.level, opp: opp.level },
      { label: "Score", you: pelletScore(you), opp: pelletScore(opp) },
      { label: "Time bonus", you: you.survivalScore, opp: opp.survivalScore },
      { label: "Win bonus", you: you.winBonus, opp: opp.winBonus },
      { label: "Net score", you: state.netScore, opp: versusNetScore(opp, you, true) },
    ],
  };
}
