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

/**
 * Human-readable size + mode label.
 *
 * @param sizeId - Board size.
 * @param mode - Game mode key.
 * @returns Display label.
 */
export function formatStatLabel(sizeId: FieldSizeId, mode: string): string {
  const size =
    sizeId === "small" ? "Small" : sizeId === "large" ? "Large" : "Medium";
  let modeLabel = mode;
  if (mode === "solo") {
    modeLabel = "Solo";
  } else if (mode.startsWith("ai:")) {
    const diff = mode.slice(3);
    modeLabel = `AI ${diff.charAt(0).toUpperCase()}${diff.slice(1)}`;
  }
  return `${size} · ${modeLabel}`;
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

/**
 * Draws score dots and a dashed 10-game rolling average on a canvas.
 *
 * @param canvas - Target canvas (CSS size used for drawing).
 * @param scores - Chronological scores for one size/mode.
 */
export function drawScoreHistoryChart(
  canvas: HTMLCanvasElement,
  scores: MyScoreRow[],
): void {
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

  const t0 = scores[0].createdAt;
  const t1 = scores[scores.length - 1].createdAt;
  const tSpan = Math.max(1, t1 - t0);

  const xAt = (i: number): number => {
    if (scores.length === 1) {
      return pad.left + plotW / 2;
    }
    const t = scores[i].createdAt;
    return pad.left + ((t - t0) / tSpan) * plotW;
  };
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

  // X date labels (first / mid / last)
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  const labelIdx = [0, Math.floor((scores.length - 1) / 2), scores.length - 1];
  const seen = new Set<number>();
  for (const i of labelIdx) {
    if (seen.has(i)) {
      continue;
    }
    seen.add(i);
    const d = new Date(scores[i].createdAt);
    const label = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
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
