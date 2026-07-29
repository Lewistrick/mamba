/**
 * Standard Elo rating updates for 1v1 matches.
 *
 * Expected score: {@code 1 / (1 + 10^((Rb - Ra) / 400))}
 * New rating: {@code R + K * (S - E)} where S is 1 / 0.5 / 0 for win / draw / loss.
 */

/** Starting rating for new players. */
export const INITIAL_ELO = 1000;

/** K-factor (rating sensitivity). */
export const ELO_K = 32;

/** Match outcome from player A's perspective. */
export type EloScore = 1 | 0.5 | 0;

/** Per-player Elo change. */
export interface EloChange {
  before: number;
  after: number;
  delta: number;
}

/** Pair of Elo updates after a match. */
export interface EloMatchResult {
  a: EloChange;
  b: EloChange;
}

/**
 * Expected score for player A against B.
 *
 * @param ratingA - A's rating.
 * @param ratingB - B's rating.
 * @returns Probability in (0, 1).
 */
export function expectedScore(ratingA: number, ratingB: number): number {
  return 1 / (1 + 10 ** ((ratingB - ratingA) / 400));
}

/**
 * Applies one player's score against their expected value.
 *
 * @param rating - Current rating.
 * @param expected - Expected score E.
 * @param score - Actual score S (1 / 0.5 / 0).
 * @param k - K-factor.
 * @returns Rounded new rating.
 */
export function nextRating(
  rating: number,
  expected: number,
  score: EloScore,
  k: number = ELO_K,
): number {
  return Math.round(rating + k * (score - expected));
}

/**
 * Updates both players' Elo after a match.
 *
 * @param ratingA - Player 0 rating.
 * @param ratingB - Player 1 rating.
 * @param winnerIndex - 0, 1, or null for a draw.
 * @param k - K-factor.
 * @returns Before/after/delta for both seats.
 */
export function updateMatchElo(
  ratingA: number,
  ratingB: number,
  winnerIndex: number | null,
  k: number = ELO_K,
): EloMatchResult {
  const scoreA: EloScore =
    winnerIndex === null ? 0.5 : winnerIndex === 0 ? 1 : 0;
  const scoreB: EloScore = (1 - scoreA) as EloScore;
  const ea = expectedScore(ratingA, ratingB);
  const eb = expectedScore(ratingB, ratingA);
  const afterA = nextRating(ratingA, ea, scoreA, k);
  const afterB = nextRating(ratingB, eb, scoreB, k);
  return {
    a: { before: ratingA, after: afterA, delta: afterA - ratingA },
    b: { before: ratingB, after: afterB, delta: afterB - ratingB },
  };
}
