/**
 * Profile stats aggregation and score-over-time chart drawing.
 */

import type { FieldSizeId } from "@mamba/engine";
import type { MyScoreRow } from "./supabase.ts";

const SIZES: FieldSizeId[] = ["small", "medium", "large"];
const MODES = ["solo", "ai:easy", "ai:medium", "ai:hard"] as const;

/** One size/mode bucket for the stats table. */
export interface StatRow {
  sizeId: FieldSizeId;
  mode: string;
  label: string;
  plays: number;
  scores: MyScoreRow[];
}

/** Column keys for the stats table sort. */
export type StatSortKey = "size" | "mode" | "plays";

/** Active sort for the stats table. */
export interface StatSort {
  key: StatSortKey;
  dir: "asc" | "desc";
}

/**
 * Human-readable board size label.
 *
 * @param sizeId - Board size.
 * @returns Display label.
 */
export function formatSizeLabel(sizeId: FieldSizeId): string {
  if (sizeId === "small") {
    return "Small";
  }
  if (sizeId === "large") {
    return "Large";
  }
  return "Medium";
}

/**
 * Human-readable mode label.
 *
 * @param mode - Game mode key.
 * @returns Display label.
 */
export function formatModeLabel(mode: string): string {
  if (mode === "solo") {
    return "Solo";
  }
  if (mode.startsWith("ai:")) {
    const diff = mode.slice(3);
    return `AI ${diff.charAt(0).toUpperCase()}${diff.slice(1)}`;
  }
  return mode;
}

/**
 * Human-readable size + mode label.
 *
 * @param sizeId - Board size.
 * @param mode - Game mode key.
 * @returns Display label.
 */
export function formatStatLabel(sizeId: FieldSizeId, mode: string): string {
  return `${formatSizeLabel(sizeId)} · ${formatModeLabel(mode)}`;
}

/**
 * Stable index of a size for ordering.
 *
 * @param sizeId - Board size.
 * @returns Sort rank.
 */
function sizeRank(sizeId: FieldSizeId): number {
  return SIZES.indexOf(sizeId);
}

/**
 * Stable index of a mode for ordering.
 *
 * @param mode - Game mode key.
 * @returns Sort rank.
 */
function modeRank(mode: string): number {
  const idx = (MODES as readonly string[]).indexOf(mode);
  return idx >= 0 ? idx : MODES.length;
}

/**
 * Returns a sorted copy of stats rows.
 *
 * @param rows - Stats rows.
 * @param sort - Active sort key and direction.
 * @returns Sorted rows.
 */
export function sortStatRows(rows: StatRow[], sort: StatSort): StatRow[] {
  const mul = sort.dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    let primary = 0;
    if (sort.key === "size") {
      primary = sizeRank(a.sizeId) - sizeRank(b.sizeId);
    } else if (sort.key === "mode") {
      primary = modeRank(a.mode) - modeRank(b.mode);
    } else {
      primary = a.plays - b.plays;
    }
    if (primary !== 0) {
      return primary * mul;
    }
    // Tie-breakers keep the table stable and readable.
    const bySize = sizeRank(a.sizeId) - sizeRank(b.sizeId);
    if (bySize !== 0) {
      return bySize;
    }
    return modeRank(a.mode) - modeRank(b.mode);
  });
}

/**
 * Groups the player's scores into size/mode rows (only non-empty buckets).
 *
 * @param scores - Chronological verified scores.
 * @returns Rows sorted by size then mode.
 */
export function buildStatRows(scores: MyScoreRow[]): StatRow[] {
  const rows: StatRow[] = [];
  for (const sizeId of SIZES) {
    for (const mode of MODES) {
      const bucket = scores.filter((s) => s.sizeId === sizeId && s.mode === mode);
      if (bucket.length === 0) {
        continue;
      }
      rows.push({
        sizeId,
        mode,
        label: formatStatLabel(sizeId, mode),
        plays: bucket.length,
        scores: bucket,
      });
    }
  }
  return rows;
}

/**
 * Trailing rolling average of the last `window` values ending at each index.
 *
 * @param values - Series values.
 * @param window - Window length (e.g. 10).
 * @returns Same-length array of averages.
 */
export function rollingAverage(values: number[], window: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < values.length; i += 1) {
    const start = Math.max(0, i - window + 1);
    let sum = 0;
    for (let j = start; j <= i; j += 1) {
      sum += values[j];
    }
    out.push(sum / (i - start + 1));
  }
  return out;
}

/** How the chart maps games onto the X axis. */
export type ChartXMode = "date" | "game";

/**
 * Computes plot-relative X positions (0..plotW) for each score.
 *
 * @param times - Chronological timestamps (ms), one per game.
 * @param mode - Date-proportional or equal per game.
 * @param plotW - Plot width in CSS pixels.
 * @returns X offsets from the left of the plot area.
 */
export function scoreXPositions(
  times: number[],
  mode: ChartXMode,
  plotW: number,
): number[] {
  const n = times.length;
  if (n === 0) {
    return [];
  }
  if (n === 1) {
    return [plotW / 2];
  }
  if (mode === "game") {
    return times.map((_, i) => (i / (n - 1)) * plotW);
  }
  const t0 = times[0];
  const tSpan = Math.max(1, times[n - 1] - t0);
  return times.map((t) => ((t - t0) / tSpan) * plotW);
}

/**
 * Draws score dots and a dashed 10-game rolling average on a canvas.
 *
 * @param canvas - Target canvas (CSS size used for drawing).
 * @param scores - Chronological scores for one size/mode.
 * @param options - Drawing options (`xMode` defaults to date).
 */
export function drawScoreHistoryChart(
  canvas: HTMLCanvasElement,
  scores: MyScoreRow[],
  options?: { xMode?: ChartXMode },
): void {
  const xMode: ChartXMode = options?.xMode ?? "date";
  const dpr = window.devicePixelRatio || 1;
  const cssW = Math.max(320, canvas.clientWidth || 640);
  const cssH = Math.max(220, canvas.clientHeight || 280);
  canvas.width = Math.floor(cssW * dpr);
  canvas.height = Math.floor(cssH * dpr);
  const ctx = canvas.getContext("2d");
  if (!ctx || scores.length === 0) {
    return;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const pad = { top: 24, right: 16, bottom: 40, left: 48 };
  const plotW = cssW - pad.left - pad.right;
  const plotH = cssH - pad.top - pad.bottom;

  ctx.fillStyle = "#070a12";
  ctx.fillRect(0, 0, cssW, cssH);

  const values = scores.map((s) => s.score);
  const avg = rollingAverage(values, 10);
  let yMin = Math.min(...values, ...avg);
  let yMax = Math.max(...values, ...avg);
  if (yMin === yMax) {
    yMin -= 1;
    yMax += 1;
  }
  const yPad = (yMax - yMin) * 0.08;
  yMin -= yPad;
  yMax += yPad;

  const xs = scoreXPositions(
    scores.map((s) => s.createdAt),
    xMode,
    plotW,
  );
  const xAt = (i: number): number => pad.left + xs[i];
  const yAt = (v: number): number =>
    pad.top + plotH - ((v - yMin) / (yMax - yMin)) * plotH;

  // Axes
  ctx.strokeStyle = "#1a2a4a";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(pad.left, pad.top);
  ctx.lineTo(pad.left, pad.top + plotH);
  ctx.lineTo(pad.left + plotW, pad.top + plotH);
  ctx.stroke();

  // Y ticks
  ctx.fillStyle = "#6a7a9a";
  ctx.font = "11px 'IBM Plex Mono', monospace";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for (let i = 0; i <= 4; i += 1) {
    const v = yMin + ((yMax - yMin) * i) / 4;
    const y = yAt(v);
    ctx.strokeStyle = "#12182a";
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(pad.left + plotW, y);
    ctx.stroke();
    ctx.fillStyle = "#6a7a9a";
    ctx.fillText(String(Math.round(v)), pad.left - 6, y);
  }

  // X labels (first / mid / last)
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  const labelIdx = [0, Math.floor((scores.length - 1) / 2), scores.length - 1];
  const seen = new Set<number>();
  for (const i of labelIdx) {
    if (seen.has(i)) {
      continue;
    }
    seen.add(i);
    let label: string;
    if (xMode === "game") {
      label = `#${i + 1}`;
    } else {
      const d = new Date(scores[i].createdAt);
      label = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
    }
    ctx.fillText(label, xAt(i), pad.top + plotH + 8);
  }

  // Rolling average (dashed)
  ctx.strokeStyle = "#3a8cff";
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 5]);
  ctx.beginPath();
  for (let i = 0; i < avg.length; i += 1) {
    const x = xAt(i);
    const y = yAt(avg[i]);
    if (i === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  }
  ctx.stroke();
  ctx.setLineDash([]);

  // Score dots
  for (let i = 0; i < scores.length; i += 1) {
    const x = xAt(i);
    const y = yAt(values[i]);
    ctx.fillStyle = "#f0d000";
    ctx.beginPath();
    ctx.arc(x, y, 3.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#101010";
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  // Legend
  ctx.font = "11px 'IBM Plex Mono', monospace";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#f0d000";
  ctx.beginPath();
  ctx.arc(pad.left + 8, 12, 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#c8d0e0";
  ctx.fillText("Score", pad.left + 16, 12);
  ctx.strokeStyle = "#3a8cff";
  ctx.setLineDash([6, 5]);
  ctx.beginPath();
  ctx.moveTo(pad.left + 70, 12);
  ctx.lineTo(pad.left + 100, 12);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillText("10-game avg", pad.left + 106, 12);
}
