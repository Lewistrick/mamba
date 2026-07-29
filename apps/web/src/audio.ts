/**
 * Web Audio beep cues for pellet eats, molt, death, and multiplayer.
 */

import type { GameEvent } from "@mamba/engine";

/** Two-note cues: ~96ms total so they finish inside a 100ms game tick. */
const TWO_NOTE_SEC = 0.048;

const BLUE_A = 880;
const BLUE_B = 987.77;
const GREEN_GS = 1661.22;
const GREEN_B = BLUE_B * 2;
const YELLOW_A = 440;
/** F4 — downward major third from A4. */
const YELLOW_F = 349.23;

/** Countdown beep base (Hz). */
const COUNTDOWN_BEEP_HZ = 660;
/** Perfect fourth above the beep. */
const COUNTDOWN_BOOP_HZ = COUNTDOWN_BEEP_HZ * (4 / 3);

/**
 * Plays short retro tone sequences. Respects a mute flag.
 */
export class SoundBoard {
  private ctx: AudioContext | null = null;
  private muted = false;

  /**
   * @param muted - Initial mute state.
   */
  constructor(muted = false) {
    this.muted = muted;
  }

  /**
   * Updates mute state.
   *
   * @param muted - True to silence output.
   */
  setMuted(muted: boolean): void {
    this.muted = muted;
  }

  /**
   * Ensures an AudioContext exists (must run after a user gesture).
   */
  resume(): void {
    if (this.muted) {
      return;
    }
    const ctx = this.ensureContext();
    if (ctx.state === "suspended") {
      void ctx.resume();
    }
  }

  /**
   * Plays cues for all events from a tick.
   *
   * @param events - Engine events.
   */
  playEvents(events: readonly GameEvent[]): void {
    if (this.muted || events.length === 0) {
      return;
    }
    for (const event of events) {
      switch (event.type) {
        case "eat_blue":
          this.playNotes([BLUE_A, BLUE_B], TWO_NOTE_SEC);
          break;
        case "eat_green":
          this.playNotes([GREEN_GS, GREEN_B], TWO_NOTE_SEC);
          break;
        case "eat_yellow":
          this.playNotes([YELLOW_A, YELLOW_F], TWO_NOTE_SEC);
          break;
        case "molt":
          break;
        case "die":
          // Death can ring a bit past one tick — the run is already over.
          this.playNotes([220, 110], 0.12, 0.9);
          break;
      }
    }
  }

  /**
   * Short ascending cue when the opponent fills the room.
   */
  playJoinSuccess(): void {
    if (this.muted) {
      return;
    }
    this.resume();
    this.playNotes([523.25, 659.25, 783.99], 0.09, 0.85);
  }

  /**
   * Match-start countdown: beep (0.5s) + silence (0.5s) × 3, then boop (1s, P4 up).
   */
  playMatchCountdown(): void {
    if (this.muted) {
      return;
    }
    this.resume();
    const ctx = this.ensureContext();
    let t = ctx.currentTime;
    for (let i = 0; i < 3; i += 1) {
      this.scheduleTone(ctx, COUNTDOWN_BEEP_HZ, t, 0.5, 0.08);
      t += 1; // 0.5 tone + 0.5 silence
    }
    this.scheduleTone(ctx, COUNTDOWN_BOOP_HZ, t, 1, 0.1);
  }

  /**
   * Plays a sequence of soft triangle beeps.
   *
   * @param freqs - Frequencies in Hz.
   * @param noteSec - Duration of each note.
   * @param stepFactor - Fraction of noteSec before the next note starts (default abuts within a tick).
   */
  private playNotes(freqs: number[], noteSec: number, stepFactor = 1): void {
    const ctx = this.ensureContext();
    const step = noteSec * stepFactor;
    let t = ctx.currentTime;
    for (const freq of freqs) {
      this.scheduleTone(ctx, freq, t, noteSec, 0.06);
      t += step;
    }
  }

  /**
   * Schedules one triangle tone.
   *
   * @param ctx - Audio context.
   * @param freq - Frequency Hz.
   * @param start - Start time.
   * @param noteSec - Duration.
   * @param peak - Peak gain.
   */
  private scheduleTone(
    ctx: AudioContext,
    freq: number,
    start: number,
    noteSec: number,
    peak: number,
  ): void {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "triangle";
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(
      peak,
      start + Math.min(0.02, noteSec * 0.1),
    );
    gain.gain.exponentialRampToValueAtTime(peak * 0.7, start + noteSec * 0.55);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + noteSec);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(start);
    osc.stop(start + noteSec + 0.02);
  }

  /**
   * Lazily creates the shared AudioContext.
   *
   * @returns Audio context.
   */
  private ensureContext(): AudioContext {
    this.ctx ??= new AudioContext();
    return this.ctx;
  }
}
