# DSA Dojo

A cinematic, Dark Souls-inspired DSA practice tracker that turns LeetCode problem-solving into an RPG adventure. Problems are monsters, topics are dungeons, and mastery is earned through battle.

**[Live Site](https://heyiamhemant.github.io/DSA_Dojo/)**

> Looking for the original V1 (forest theme)? It now lives at **[DSA_Dojo_legacy](https://github.com/heyiamhemant/DSA_Dojo_legacy)** ([live](https://heyiamhemant.github.io/DSA_Dojo_legacy/)).

## Preview

| Title Screen | Dashboard |
|:-:|:-:|
| ![Intro](screenshots/intro_v2.png) | ![Dashboard](screenshots/dashboard_v2.png) |

| Realms of Conquest | Dungeon Pathway |
|:-:|:-:|
| ![Realms](screenshots/realms_v2.png) | ![Pathway](screenshots/pathway_v2.png) |

| Quest Board | Bestiary |
|:-:|:-:|
| ![Quest Board](screenshots/quest_board_v2.png) | ![Bestiary](screenshots/bestiary_v2.png) |

| Boss Raids |
|:-:|
| ![Boss Raids](screenshots/boss_raids_v2.png) |

## Features

### Core Game Loop
- **Dungeon Pathway** — A dignified codex-atlas of stone-seal keeps with parallax ramparts, animated fireflies, torch sconces, and per-topic Dark Souls scene art behind every node.
- **Quest Board** — A spaced-repetition engine that generates daily quests. Prioritizes overdue reviews over new problems, gates difficulty progression (no Hard problems until you've built a foundation), and supports a "minimum reviews" setting so the early days aren't dominated by unlocks. Themed sliders / segmented controls let you tune the day's mix without leaving the page.
- **Prerequisite gating** — Sequel problems (the "II" / "III" variants) carry a `prereq_id` link. The quest generator won't surface them until the base problem has been solved, and the modal shows a 🔒/🔓 hint explaining why a problem is or isn't gated.
- **Plan reconciliation** — Today's plan is timestamped on creation. If the catalog drifts, the quest board surfaces a stale-plan banner instead of silently serving yesterday's hunt.
- **Snooze & Pin** — Problems can be snoozed off today's plan or pinned in. Quest cards also surface the *reason* a problem appeared (overdue review / new unlock / spaced-repetition due) plus the number of days overdue.
- **Bestiary** — A filterable, sortable view of all tracked problems with difficulty, topic, confidence level, last reviewed date, and next due date. Each card carries a Dark Souls scene image keyed to the problem's topic.
- **Boss Raids** — A separate System Design section with its own encounter tracking.

### Progress & Stats
- **XP & Leveling** — Earn XP scaled by difficulty and confidence. Level up through ranks from Wanderer to Mythic Champion.
- **Slime / Drake / Demon Tiers** — Easy / Medium / Hard problems are rendered as 🟢 Slimes, 🐉 Drakes, 👹 Demons throughout the UI (hero powerbars, quest cards, bestiary, realms tooltips, dashboard subtitle).
- **Power Levels** — Per-tier power bars composed of three weighted segments — **Activity** (training frequency in the last 90 days, 30-day half-life), **Mastery** (avg confidence on recent reviews), and **Streak** (×0.6 rusty → ×1.3 forged). The legend has a `?` button that expands an inline explainer, every segment has a hover tooltip, and clicking any tier reveals the slain/unslain problems contributing to it sorted by most recent.
- **Realms of Conquest** — Each topic gets a card with lifetime conquest %, 180-day momentum, tier breakdowns, conquered/alert badges, and a sortable toolbar.
- **Streak Tracking** — Consecutive review days earn XP multipliers. Milestone rewards at 3, 7, 14, 30, and 60-day streaks. A multi-layered animated SVG flame replaces the 🔥 emoji on the hero card. 24-hour grace period before the streak ticks down.
- **Streak Recovery** — Miss a day (or two) and an active recovery banner appears at the top of the dashboard. Rate a small number of extra problems within 24 hours to bridge the missed day(s) and restore the broken chain. The banner spells out the projection (`CURRENT N days ▶ RECOVER TO M days`), the required problem count scales with how many days were missed, and on success a green confirmation banner replaces it.
- **180-day Heatmap** — Month-labeled timeline of review activity with custom hover tooltips.
- **Chronicle of Battle** — 14-day analytics view (reviews per day, XP earned per day) with click-to-inspect bars.

### Sync & Sharing
- **GitHub Gist sync** — Cross-device progress sync without a server. Paste a personal access token (with `gist` scope) into the settings modal and your `userData` rides on a private gist that both your laptop and phone read/write.
- **Showcase mode** — `https://heyiamhemant.github.io/DSA_Dojo/?profile=<github_username>` renders a public, read-only portfolio view of any user's progress (everything except notes). Edit affordances are disabled and a branded header makes it clear this is someone else's dojo.
- **Export / Import** — Save and restore all progress as JSON. Still works as a no-network fallback.

### Catalog quality
- **Alt links for premium problems** — When a LeetCode URL is paywalled, the catalog also carries an `alt_url` (GfG Practice / InterviewBit / NeetCode) so quest cards and the modal always offer a free path to read the problem.
- **De-duplicated entries** — Older C++/Python sibling records have been merged into single canonical problems. A one-shot `migrateMergedUserData()` runs on app boot to transfer existing user data from retired IDs to their canonical replacements.

### UX
- **Dashboard tabs** — Three tabs (Overview / Progress / Realms) with collapsible `<details>` panels whose open/closed state persists in `localStorage`.
- **Font modes** — Live toggle between **Herald** (ornate / MedievalSharp + Cinzel) and **Tome** (Crimson Pro book-feel) for users who want the gaming vibe without the busy lettering. Choice is persisted, and MedievalSharp is retained for the intro splash regardless of mode.
- **Mobile-first** — Hamburger drawer nav, single-column card grids, every text element clamped/word-broken to prevent overflow.
- **Safari-tested** — All multi-layer card backgrounds use literal `background-image` strings (no CSS-variable indirection that Safari fumbles), `-webkit-backdrop-filter` prefixes everywhere, quoted relative URLs.
- **Light & Dark Mode** — Full theme support.

## Run Locally

No build step. Everything is static.

```bash
git clone https://github.com/heyiamhemant/DSA_Dojo.git
cd DSA_Dojo
open index.html        # macOS
xdg-open index.html    # Linux
start index.html       # Windows
```

## Tech

- `index.html` — UI shell, all styles, panel rendering, inline app script
- `dojo-core.js` — game logic (XP, spaced repetition, level thresholds, prerequisite gating, power-level formulas, problem dataset)
- `assets/` — Dark Souls scene art (for personal/educational use only — not redistributed)

No frameworks, no dependencies, no server. Persists to `localStorage` locally and (optionally) syncs to a private GitHub Gist for cross-device use.

### Dev console helpers

Open DevTools on the live or local site and run:

| Helper                  | What it does                                                                  |
| ----------------------- | ----------------------------------------------------------------------------- |
| `dojoTestRecovery()`    | Inject a synthetic "broken streak" state so you can preview the banner / toast |
| `dojoExplainStreak()`   | Dump last 7 days of activity, current streak, recovery state, detection verdict |
| `dojoResetRecovery()`   | Clear stale recovery state + streakFills                                       |

On every page load the recovery detector also logs `[recovery] skip: …` or `[recovery] DETECTED …` with the reason, so you can see exactly why the banner did or didn't appear.

## History

This repo previously hosted both a `/` (V1 forest) and `/v2/` (V2 Dark Souls) site. As of April 2026, V2 took over the root and V1 was split into [DSA_Dojo_legacy](https://github.com/heyiamhemant/DSA_Dojo_legacy). Older commits with `/v2/` paths still exist in the git history of this repo for reference.

## Credits

Problem set sourced from [Leetcode_interesting_repo](https://github.com/heyiamhemant/Leetcode_interesting_repo). Dark Souls imagery © FromSoftware/Bandai Namco — used here for personal, non-commercial purposes.
