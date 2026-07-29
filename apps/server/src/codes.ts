/**
 * 6-character room codes (no ambiguous 0/O/1/I).
 */

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/**
 * Generates a random room code.
 *
 * @param length - Code length (default 6).
 * @param random - Optional RNG in [0, 1).
 * @returns Uppercase alphanumeric code.
 */
export function generateRoomCode(
  length = 6,
  random: () => number = Math.random,
): string {
  let out = "";
  for (let i = 0; i < length; i += 1) {
    out += ALPHABET[Math.floor(random() * ALPHABET.length) % ALPHABET.length];
  }
  return out;
}

/**
 * Normalizes a user-entered room code.
 *
 * @param raw - Raw input.
 * @returns Uppercased trimmed code, or null if invalid.
 */
export function normalizeRoomCode(raw: string): string | null {
  const code = raw.trim().toUpperCase();
  if (!/^[A-Z0-9]{6}$/.test(code)) {
    return null;
  }
  return code;
}
