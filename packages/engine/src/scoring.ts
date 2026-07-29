/**
 * Versus score helpers: pellet vs time/win components and net formulas.
 */

/** Player totals used for scoring breakdowns. */
export interface ScoreParts {
  score: number;
  survivalScore: number;
  winBonus: number;
}

/**
 * Points from pellets only (excludes time and win bonuses baked into `score`).
 *
 * @param player - Player totals.
 * @returns Pellet component.
 */
export function pelletScore(player: ScoreParts): number {
  return player.score - player.survivalScore - player.winBonus;
}

/**
 * Versus net for leaderboards / game-over:
 * your pellets − opponent pellets + your time + your win.
 *
 * Opponent time/win are not deducted (only their pellet score is).
 *
 * @param you - Local / seat 0.
 * @param opponent - Seat 1.
 * @returns Net score.
 */
export function versusNetScore(you: ScoreParts, opponent: ScoreParts): number {
  return (
    pelletScore(you) - pelletScore(opponent) + you.survivalScore + you.winBonus
  );
}

/**
 * Mid-match HUD net: your pellets − opponent pellets + your time (no win).
 *
 * @param you - Local player.
 * @param opponent - Opponent.
 * @returns HUD net.
 */
export function versusHudNetScore(you: ScoreParts, opponent: ScoreParts): number {
  return pelletScore(you) - pelletScore(opponent) + you.survivalScore;
}
