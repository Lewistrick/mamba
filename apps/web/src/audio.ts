/**
 * Web Audio beep cues for pellet eats, molt, and death.
 */

import type { GameEvent } from "@mamba/engine";

const BLUE_A = 880;
const BLUE_B = 987.77;
const GREEN_GS = 1661.22;
const GREEN_B = BLUE_B * 2;
const YELLOW_A = 440;
const YELLOW_F = 698.46;

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
          this.playNotes([BLUE_A, BLUE_B], 0.07);
          break;
        case "eat_green":
          this.playNotes([GREEN_GS, GREEN_B], 0.08);
          break;
        case "eat_yellow":
          this.playNotes([YELLOW_A, YELLOW_F], 0.1);
          break;
        case "molt":
          this.playNotes([523.25, 392.0, 329.63], 0.09);
          break;
        case "die":
          this.playNotes([220, 110], 0.16);
          break;
      }
    }
  }

  /**
   * Plays a sequence of square-ish beeps.
   *
   * @param freqs - Frequencies in Hz.
   * @param noteSec - Duration of each note.
   */
  private playNotes(freqs: number[], noteSec: number): void {
    const ctx = this.ensureContext();
    let t = ctx.currentTime;
    for (const freq of freqs) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "square";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.12, t + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + noteSec);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t);
      osc.stop(t + noteSec + 0.02);
      t += noteSec * 0.85;
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
