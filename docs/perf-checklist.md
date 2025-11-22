# Performance Checklist (Manual)

Goal: quick, repeatable smoke for perf-sensitive flows. Keep data realistic (e.g., 50–80 sessions in CSV, 20 players).

## Targets & Environments
- Devices: iPhone (Safari), mid-tier Android (Chrome), desktop Chrome/Firefox.
- Thresholds (guide, not hard fails):
  - All-Time load (cold): <3s to visible table; warm: <1.5s.
  - Modal open/close (Player History, Match Result): <300ms perceived.
  - Sorting (All-Time headers): <200ms to update table.
  - Scroll: smooth, no visible jank on player list/All-Time table.

## Checklist
1) All-Time Leaderboard
   - Start from cold reload; open All-Time. Time to loading notice → table visible. Note skips/warnings.
   - Hit Refresh button (warm). Confirm reuse of cache, quick re-render.
2) All-Time sorting
   - Sort by Points, Pts/Session, Goals. Ensure header `aria-sort` flips and table updates without lag.
3) Player History modal
   - Open from All-Time table, check chart render time and close latency.
4) Match Result modal
   - Open/close with scorers enabled; stepper responsiveness on touch and keyboard.
5) Roster interactions
   - Scroll Available/Playing lists, drag/drop (desktop), search filter responsiveness.
6) Leaderboard view
   - With tournament results, verify table renders without layout shift; scroll smooth inside sticky header container.

## How to run
- Use device timers or a simple stopwatch; for deeper dives, use browser DevTools Performance (desktop) or Safari Web Inspector (iOS).
- Note data shape used (CSV size, players count) and cache state (cold vs warm). Keep notes alongside changes for regression tracking.
