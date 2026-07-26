/**
 * Web Audio beep cues for pellet eats, molt, and death.
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
   * Plays a sequence of soft triangle beeps.
   *
   * @param freqs - Frequencies in Hz.
   * @param noteSec - Duration of each note.
   * @param stepFactor - Fraction of noteSec before the next note starts (default abuts within a tick).
   */
  private playNotes(freqs: number[], noteSec: number, stepFactor = 1): void {
    const ctx = this.ensureContext();
    const step = noteSec * stepFactor;
    const peak = 0.06;
    let t = ctx.currentTime;
    for (const freq of freqs) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "triangle";
      osc.frequency.value = freq;
      // Gentle attack/release — less clicky than a square blip.
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(peak, t + 0.012);
      gain.gain.exponentialRampToValueAtTime(peak * 0.7, t + noteSec * 0.55);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + noteSec);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t);
      osc.stop(t + noteSec + 0.01);
      t += step;
    }
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
