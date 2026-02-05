# ECG Futsal Codebase Guide (A–Z)

This doc is for follow-up agents. It explains what the app does, how it is structured, and where to make changes.

## Quick Facts
- Static, mobile-first web app. No build step, no framework, no external libraries.
- Entry point: `index.html`. Styling in `styles/main.css`. JS is ES modules in `scripts/`.
- State is persisted in `localStorage` only.
- All-Time Leaderboard data is loaded from `ecgfutsal2025-26.txt` (CSV).

## How To Run
- Open `index.html` in a browser.
- Optional tests: `node scripts/tests/runner.js`.

## Repo Map
- `index.html`: UI structure, modals, tabs, and static elements.
- `styles/main.css`: Global theme, layouts, components, responsive rules, and table styling.
- `scripts/main.js`: Main controller; renders UI, handles interactions, team generation, scheduling, results, leaderboard, and All-Time view.
- `scripts/data/config.js`: Roster, colors, skill/stamina ratings, and rating helpers.
- `scripts/logic/balance.js`: Post-pass balancing for skill and stamina.
- `scripts/state/storage.js`: localStorage keys, load/save, sanitization hooks.
- `scripts/state/migrations.js`: Legacy data migration/cleanup.
- `scripts/utils/*.js`: RNG, validation, logging, and All-Time warning notice.
- `scripts/ui/roster.js`: Helper for clamping attendee count (not currently used by `main.js`).
- `ecgfutsal2025-26.txt`: All-Time CSV data file.
- `docs/perf-checklist.md`: Manual performance checklist.
- `vercel.json`: Headers for JS content type on Vercel.

## Core Concepts
### Local Storage Keys
Defined in `scripts/state/storage.js`:
- `futsal.players`: master roster (array of names).
- `futsal.match.attendees`: current match attendees (array of names).
- `futsal.match.teams`: generated teams (`[{id,name,color,members[]}]`).
- `futsal.match.results`: results keyed by match id (`{ [matchId]: { a, b, round, ga, gb, gpa?, gpb?, gaDraft?, gbDraft?, gpaDraft?, gpbDraft? } }`).
- `futsal.match.rounds`: number of rounds (int).
- `futsal.match.timestamp`: legacy timestamp (still saved, no longer used for seeding).
- `futsal.pref.trackScorers`: boolean user preference for scorer tracking.
- `futsal.leaderboard.prevRanks`: cache used for rank change arrows.
- `futsal.version`: migration version.

### State Shape
`state` lives in `scripts/state/storage.js` and is hydrated by `loadState()`.

### Constraints
- No external libraries or fonts.
- Keep HTML/CSS/JS separation intact.
- Use existing helpers (storage, rendering, RNG).

## UI Structure (index.html)
Tabs:
- Players (`playersSection`)
- Teams (`teamsSection`)
- Matches (`matchesSection`)
- Leaderboard (`leaderboardSection`)
- All-Time Leaderboard is a separate section (`allTimeSection`) opened via header button.

Modals:
- Result entry (`resultModal`)
- Player history (`playerModal`)
- Add player (`addPlayerModal`)
- Remove player (`removePlayerModal`)
- Reset confirmation (`resetModal`)
- Team count selection for 11 attendees (`teamCountModal`)
- Remove round (`removeRoundModal`)
- End tournament (`endTournamentModal`)

## Styling (styles/main.css)
- CSS variables in `:root` define palette (`--bg`, `--panel`, `--accent`, `--danger`, etc.).
- Sticky header and tab bar.
- `.team-pill`, `.notice`, `.panel`, `.table-wrap`, `.tab`, `.btn` are key components.
- `.table-wrap` provides sticky headers for tables.

## Team Generation
Primary logic in `scripts/main.js`:
- Attendees must be >= 8 to generate.
- Team count: `t = max(1, min(4, floor(n/4)))`.
  - For 11 players: user chooses 2 or 3 teams.
  - For 15 players: defaults to 3 teams without a modal.
- Team capacities: base of 4 each, remainder (`n - 4t`) distributed to last `r` teams.
- Stable seed: 1-hour time window based on attendee set (see `scripts/utils/random.js`).
- Assignment algorithm:
  1) Sort players by skill descending, tie-broken by seeded order.
  2) Greedy assignment to team with largest skill deficit to target, capacity-aware.
  3) Stamina-aware tie-breaks when skill deficits are equal.
  4) Post-pass swaps to reduce skill deviation (`balanceSkillToTargets`).
  5) Post-pass swaps for stamina smoothing (equal-skill swaps only, `balanceStaminaEqualSkill`).

### Harmony Pairs
In `scripts/main.js`:
- `HARMONY_TOKENS` holds base64-encoded `NameA|NameB` pairs.
- Current decoded pair: `Ruben|Ramtin`.
- During assignment, a small penalty (`HARMONY_PENALTY`) discourages pairing.
- `applyRosterHarmonyFinal()` tries to swap players post-assignment to separate paired players if possible.

## Scheduling
`scripts/main.js` generates a round-robin schedule:
- For 4 teams, classic fixed order: `A-B, C-D, A-C, B-D, A-D, B-C`.
- For other team counts, uses deterministic shuffle and streak avoidance (`orderRoundPairings`).
- Tries to avoid any team playing 3 matches in a row across the full schedule.
- “Next Match” is the first unplayed match; future matches are visually dimmed.
- Kickoff fairness: next starting team is balanced across teams with a stable RNG.

## Results Entry
- Results entered via `resultModal`.
- `Save - Match End` finalizes scores; `Close` stores drafts (`gaDraft`, `gbDraft`, etc.) without marking as played.
- Per-player scorer tracking is optional per match; stored as `gpa` / `gpb` maps.
- If a team has only 3 players, a “Guest player” input appears to balance totals; guest goals do not count toward leaderboards.

## Leaderboard (Current Tournament)
- Computed from `state.results`.
- Sorting: Points desc, then Goal Difference (GD) desc, then Goals For (GF) desc, then team name.
- Winner banner shown when all matches are scored.
- Co-winners if Points and GD are tied.
- Rank-change arrows use `futsal.leaderboard.prevRanks` cache.
- “Copy results” and “Email summary” buttons are shown when tournament completes.

## Share / Email Summary
- Share text summarizes winner + standings + top scorers.
- Email summary builds CSV `Date,Player,Points,Goals` using current date and calculated points.

## All-Time Leaderboard
Data source: `ecgfutsal2025-26.txt` (CSV).

CSV rules:
- Header optional: `Date,Player,Points,Goals`.
- Date and player are required; points must be numeric.
- Goals column optional; missing or non-numeric goals are treated as 0.
- Older rows with 3 columns are accepted.

Fetch behavior:
- Always fetches `ecgfutsal2025-26.txt` with a cache-busting timestamp.
- Warnings displayed via `buildAllTimeCSVWarningNotice()` and logged with code `AT201`.

All-Time features:
- Sortable table with stable tie-breakers.
- Header insight cards (rank gains/losses, points/session deltas).
- Badges and trophies (MVP, Playmaker, Top Scorer, streaks, attendance, etc.).
- Player history modal with multiple views (points, goals, rank history, trophy room).

Notes:
- Playmaker badge only awarded for sessions on/after `2025-11-12` (goal tracking start).
- Cached data lives on `window.__allTime*` variables for modal usage.

## Validation, Migration, Logging
- `scripts/utils/validation.js` sanitizes localStorage shapes and values.
- `scripts/state/migrations.js` upgrades legacy storage to current shape (`CURRENT_VERSION = 1`).
- `scripts/utils/logging.js` and `reportWarning()` dedupe console warnings.

## Tests
Minimal, dependency-free runner in `scripts/tests/runner.js`.
Coverage includes:
- Storage validation helpers
- All-Time warning notice
- Team balance logic
- Migrations

Run:
```
node scripts/tests/runner.js
```

## Deployment
- Pure static site.
- `vercel.json` sets JS content type headers for `/scripts/*.js`.

## Common Change Points
- Roster/skills/stamina: `scripts/data/config.js`.
- Team generation rules: `scripts/main.js` (generateTeams, generateTeamsOverride).
- Scheduling rules: `scripts/main.js` (renderSchedule, orderRoundPairings).
- All-Time leaderboard logic: `scripts/main.js` (renderAllTime, parseCSVSimple, badge logic).
- Theme/visuals: `styles/main.css`.

## Troubleshooting / Gotchas
- All-Time warning about skipped rows means malformed CSV. Check `ecgfutsal2025-26.txt` and console `AT201`.
- Players tab locks after teams are generated; use “Start new match” to reset.
- If localStorage is corrupted, sanitizers reset to safe defaults and log warnings.
- Goal-tracking stats are incomplete for sessions before goal tracking began.

## Conventions
- Avoid inline event handlers; use `addEventListener`.
- Keep HTML, CSS, and JS separated.
- Prefer existing utility helpers for RNG and storage.

