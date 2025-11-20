# ECG Futsal — Modular Futsal Team Generator

A mobile‑first, multi‑file static app to pick attendees, generate balanced teams, plan matches, record results, and show standings. State is persisted in localStorage. No frameworks, no build steps. App header now shows “⚽️ ECG Futsal”.

## Quick Orientation
- Structure: `index.html` stores markup only, `styles/main.css` holds the entire theme, and JS lives in ES modules under `scripts/` (`data`, `state`, `logic`, `utils`, and `main.js`).
- Persistence: localStorage only (no backend).
- Roster: Predefined players seeded into `futsal.players` once.
- Accessibility: keyboardable lists and visible focus.
- Mobile: large touch targets, sticky actions, compact cards.

## Data Model (localStorage keys)
- `futsal.players`: master roster (array of names).
- `futsal.match.attendees`: selected attendees for the current match (array of names).
- `futsal.match.teams`: generated teams (array of `{id,name,color,members[]}`).
- `futsal.match.results`: match results `{ [matchId]: { a, b, round, ga, gb, gpa?, gpb? } }`.
  - `gpa`/`gpb` (optional): per‑player goal maps for team A/B, e.g. `{ "Ruben": 2, "Job": 1 }` (only stored if >0).
  - Draft fields (optional; mid‑game persistence): `gaDraft`, `gbDraft`, `gpaDraft`, `gpbDraft`. These save current inputs when closing the modal without finalizing. Drafts do not count as played results until “Save - Match End”.
- `futsal.match.rounds`: number of rounds (int, default 2).
- `futsal.match.timestamp`: legacy timestamp (still stored; no longer used for seeding).

## Tabs & UX
- Players: pick attendees from Available → Playing Today, then Generate Teams.
  - Limit: max 20 attendees, teams lock players after generation.
  - Start new match: a top button appears on the Players tab when a tournament exists (teams generated). It clears teams/results/rounds and unlocks Players (was labeled “Reset”).
- Teams: shows team pill, members, and size.
- Matches: full schedule by rounds, “Next Match” heading + kickoff indicator.
  - Result entry via modal with large +/- steppers; score button toggles edit.
- Leaderboard: Team badge, Played, Points, GD (colored), members (small).

## All‑Time Leaderboard (CSV‑driven)
- Access: header button “All‑Time Leaderboard” (not a tab).
- Data source: `ecgfutsal2025-26.txt` (CSV) in the project root.
  - Format: `YYYY‑MM‑DD,Player,Points,Goals` (header optional; case-insensitive `Date,Player,Points,Goals` is accepted). Older rows that only have three columns are still supported and treated as `Goals = 0` until backfilled.
  - Name matching is exact; typos create separate entries.
- Refresh behavior: Always fetches fresh data when you open the All‑Time view (cache busts with a timestamp). A Refresh button is shown in the header while the All‑Time view is active to force a re‑fetch without leaving the view.
- Latest match label: top-right muted label shows the most recent session date.
- Header insight cards (clickable):
  - Largest Rank Gain / Largest Rank Loss (vs previous session ranks; based on Points with stable tie‑breakers).
  - Largest Pts/Session Increase / Decrease (% change of career PPM before vs after latest; requires prior matches; colored green/red).
- Table: sortable by Player, Matches, Points, Pts/Session, Goals, or Goals/Session with stable tie-breakers.
- Goals/Session averages only consider sessions with recorded goals (older sessions remain blank until backfilled).
- Badges: up to two pill badges appear next to each player — ⭐ Latest Top Scorer (led the most recent session in goals), 🎖️ Playmaker (highest points+goals contribution in the latest session), 🥇 All-Time Topscorer (most career goals), 🏆 Session Ace (most sessions ending with the day’s highest points), 👑 Most Valuable Player (highest Pts/Session with ≥60% attendance), ⚽ streak ladder “Three/Four/Five/Six/Seven/Eight/Nine/Ten In A Row” (consecutive scoring sessions; absences don’t break the streak), 🎯 Sharpshooter (2+ goals/session), ⚡ On Fire (biggest positive form jump last 3 vs career), 🥶 Cold Streak (biggest negative form swing last 3 vs career), 🛡️ Iron Man (current 6+ attendance streak), and 📈 Rocket Rank (5+ rank jump). The modal lists all earned badges with descriptions.
- Player history modal: three responsive views.
  - Points per Session bar chart (attendance-aware, 0 when present but scoreless).
  - Goals per Session bar chart (same styling; “×” marks sessions with no goal data yet).
  - Rank by Total Points line chart (1 is best; no zero ranks) plus quick stats for matches, total points/goals, PPM/GPM, and last‑3 deltas.
  - Trophy Room (counts for MVP, Latest Top Scorer, All-Time Topscorer, Playmaker; shown only if earned).
- Manual CSV workflow: when a tournament ends, use the Leaderboard “Email summary” button to copy/paste freshly generated `Date,Player,Points,Goals` rows into `ecgfutsal2025-26.txt`. Players who skip a session simply don’t get a row, so their goal count stays null instead of zero.

## Team Generation
- Team count: `t = max(1, min(4, floor(n/4)))`.
- Target sizes (default): base 4 each; remaining players fill last `r = n − 4t` teams (+1 each).
- Edge counts with choice:
  - 11 players → modal asks 2 or 3 teams.
    - 2 teams: 6‑5; 3 teams: 4‑4‑3.
  - 15 players → default is 3 teams (5‑5‑5) without a modal; 4 teams when there are 16–20 players (e.g., 16→4‑4‑4‑4; 17–19→5‑5‑5‑4; 20→5‑5‑5‑5).
  - For overrides (11‑player case), capacities are evenly distributed across the chosen number of teams (as shown in the modal), then the same seeded skill‑balanced assignment is used.
- Skill model: `SKILLS` constant (1–5, accepts arbitrary decimals). Incidental players default to 3 unless overridden in the modal, which steps in 0.5 increments.
- Stamina model: `STAMINA` constant (1–5, accepts arbitrary decimals). Incidental players default to 3 unless overridden in the modal, which steps in 0.5 increments.
- Algorithm (skill‑first with post‑passes):
  1) Deterministic seeded order for tie‑breaks (see Seeding below).
  2) Sort players by skill desc, tie‑break by seeded order.
  3) Greedy assignment to the team with the largest skill deficit to its target (capacity‑aware).
  4) Skill balancer (post‑pass): deterministic pairwise swaps that strictly reduce total deviation from targets (capacity × average skill) without changing team sizes.
  5) Stamina on tie: during greedy assignment, when two teams are tied on skill deficit, prefer for high‑stamina players (≥ average stamina): the smaller‑capacity team; if equal capacity, the team with lower current stamina; otherwise keep existing tie‑breakers.
  6) Stamina smoother (post‑pass): deterministic swaps only between equal‑skill players to smooth stamina without changing any team’s total skill.
- Colors: Red, Blue, Green, Yellow (first `t`). Team names default to just the color (e.g., “Red”). Inline rename persists.

## Seeding & Stability
- Stable, time‑windowed seed: same attendee set within a 1‑hour bucket yields the same teams and schedule — even across Reset.
- Seed = FNV‑1a hash of `sorted(attendees).join('|') + '|' + timeBucket(1h)`.
- To change the stability window: edit `STABLE_WINDOW_MS` in `scripts/utils/random.js`.

## Schedule Generation
- Round robin over teams (1–N rounds).
- For 4 teams, uses the classic sequence per round: `A–B, C–D, A–C, B–D, A–D, B–C`.
- Ordering aims to avoid any team playing 3 consecutive matches across the full schedule (2 in a row allowed if needed).
- “Next Match”: the first unplayed match is labeled and emphasized.
- Kickoff fairness: the starting team for the next match is assigned to balance starts across teams; tie‑break by seed. A ⚽️ appears on the starting team’s pill.

## Results & Leaderboard
- Modal defaults to 0–0 and supports big +/- steppers.
- Modal actions: “Save - Match End” finalizes the match; “Close” preserves current inputs as a draft (does not mark the match as played).
- Per‑player scorers: under each team’s total, every team member has a mini stepper. Totals auto‑sync with the sum of player goals.
  - If a team has only 3 players (e.g., 11 attendees → 4‑4‑3), a “Guest player” input appears for that team so goals can balance. Guest goals count toward the match score but are excluded from Top Scorers and other leaderboards.
- Points: Win=3, Draw=1, Loss=0.
- Leaderboard columns: Team, Played, Points (sorted desc), GD (Goals For − Goals Against).
  - Sorting tie-break currently uses Goals For (GF) after Points; GD is displayed only.
  - Winner banner appears when the tournament completes.
  - Co-winners: If the top teams tie on Points and Goal Difference (GF−GA), they are declared joint winners (banner, trophies, and share text reflect this).
- Tournament end confirmation: when the last match is finalized, a modal appears: “All matches have been played and all results are in. Do you want to end the tournament or play another round?”
  - “End Tournament” switches to Leaderboard and triggers the winner toast + confetti.
  - “Add New Round” increases rounds by 1 (no celebration) and continues play.
- Top Scorers: table of players with ≥1 goal (totals aggregated from `gpa`/`gpb`), sorted by goals desc.
- Sharing: “Email Summary” composes a prefilled email with teams (incl. avg skill/stamina), schedule + results, standings, and top scorers. Subject includes the current date.

## Players Tab Locking
- After teams are generated, the Players tab disables moves and shows a banner: “Players are locked — teams have been generated. Tap Reset to start over.”

## Notable UI Patterns
- Team pill: rounded border tinted to team color; winner pills fill with solid color + white text.
- Matches card: teams stack vertically (each with members under the pill). Score area is right‑aligned, shows a button for unplayed/played states.

## Changing Skills / Behavior
- Skills: edit `SKILLS` map and `DEFAULT_SKILL` in `scripts/data/config.js`. Values can be any decimal within 1–5; `normalizeRating` only clamps (no rounding) so 3.20 stays 3.20. Use `snapToRatingStep` if you need to quantize to 0.5.
- Stamina: edit `STAMINA` map and `DEFAULT_STAMINA` in `scripts/data/config.js`. Same rules as skills — call `normalizeRating` to clamp, `snapToRatingStep` for a 0.5 grid.
- Stability window: adjust `STABLE_WINDOW_MS` inside `scripts/utils/random.js`.
- Schedule constraint: see `orderRoundPairings()` function.
- Kickoff fairness: logic sits in `renderSchedule()` using `startCounts` and stable RNG.

## Toasts
- Non‑final toasts have been removed for a quieter UX:
  - No hype toast after saving an individual match.
  - No toast on copy‑to‑clipboard for results (fallback prompt remains if clipboard fails).
  - No toast when trying to remove a round that has results (the modal explains the constraint).
- The only toast that remains is the “Winner” toast at tournament end (after confirming End Tournament), accompanied by confetti.

## Conventions
- Keep changes minimal, extend the modular structure (HTML + CSS + JS modules).
- No external libraries or fonts.
- Inline event handlers are avoided; use addEventListener.
- Use existing helpers:
  - Storage: `loadState`, `saveAttendees`, `saveTeams`, `saveResults`, `saveRounds`.
  - Rendering: `renderRoster`, `renderTeams`, `renderSchedule`, `renderLeaderboard`.
  - Actions: `resetAll`, `generateTeams`, `addAdditionalRound`.
  - Utils: `mulberry32`, `shuffleSeeded`, `computeStableSeedFromAttendees`, `orderRoundPairings`.


If you’re an LLM agent continuing work: keep the HTML/CSS/JS separation intact and respect the stability rules above to avoid surprising users.
