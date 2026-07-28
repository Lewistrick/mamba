-- Allow negative net scores (vs AI: player − AI).

alter table public.scores drop constraint if exists scores_score_check;
