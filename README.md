# AI Boom Tycoon

An isometric management game about the AI boom, inspired by the office-building
loop of *E-Shop Tycoon*. You start in a garage in January 2023 with one gaming
PC and $75,000. You build a lab, train bigger and bigger models, win
subscribers, raise money, and race four rival labs to AGI.

It runs in any modern browser, with no build step and no dependencies.

## Play

Open `index.html` in a browser. Or serve the folder:

```sh
npm start          # serves the folder with npx serve
```

Progress saves automatically to your browser every in-game month. Saves from
older versions are upgraded when they load.

**Share it.** `.github/workflows/pages.yml` publishes the game to GitHub Pages
on every push to `main`. Turn it on once under Settings › Pages › Source:
GitHub Actions. The Feedback button in the top bar pauses the game and sends a
snapshot of the run so far, with your comments, to Claude. Outside the Claude
artifact, it and "Send this run to Claude" show
the report for copying, so testers can paste it into a chat or send it to you.

**Modes.** Standard games come in Relaxed, Normal and Hard. The Daily
challenge gives everyone the same seed for the day (same candidates, events and
rival moves) and ranks results on a shared leaderboard. Sandbox starts you with
$10M, no bankruptcy and rivals who never quite reach AGI.

## How it plays

| Loop | What you do |
| --- | --- |
| **Build** | Place GPUs, cooling, power, desks and comfort items on an isometric grid. Keep total heat below total cooling, or every GPU glows red and slows down; where coolers stand does not matter. Whiteboards help researchers within 2 tiles, comfort items help desks within 3. Late-game hardware takes 2×2 tiles. |
| **Train** | Pick a model size (Tiny 1B to Ultra 10T) and training data (licensed, synthetic, human feedback). Runs consume compute measured in PF-days, with a live loss curve. |
| **Deploy** | Your live model wins market share based on its OmniBench score against rivals, your hype, your price and whether you have enough compute to serve everyone. |
| **Sell** | Besides the chat app, launch a Developer API, Image Studio and Agents. Each has its own customers, price and compute bill. |
| **Hire** | Researchers earn research points, engineers speed up training and serving, growth staff bring users, and safety staff prevent scandals. Everyone needs a desk and a reason to stay. |
| **Research** | 26 technologies across five tiers, from Scaling Laws to the AGI Blueprint. They unlock bigger models, better hardware and efficiency gains. |
| **Fund** | Optional. Pitch investors for up to three competing term sheets: a top-tier VC (hype), a Big Tech partner (free cloud compute) or a founder-friendly fund (less dilution). Ask for a better price and risk the investor walking, or walk away and pay for it with lower offers for six months. Interest depends on your numbers for the stage, your runway and past walk-aways. Offices only cost money, so you can bootstrap on revenue and keep the whole company. |
| **Survive** | Random events: GPU shortages, jailbreak scandals, copyright lawsuits, poaching, Senate hearings, enterprise deals, heatwaves and bubble talk. Rivals act too: they launch free tiers, start price wars, sue you and answer your launches with their own. |
| **Stay aligned** | Safety staff, safety research and your choices in a crisis add up to an alignment score. It decides how the world greets your AGI: trusted, uneasy or reckless. |

**Pacing.** The game starts with two tabs, two stats and two items. Tabs,
stats, build categories, research tiers, model sizes and funding rounds appear
as you earn them, with a dot on anything new. The shop only teases the next
thing you can unlock instead of listing everything. There are no random events
for the first 45 days. The story runs in six chapters (The Garage, First
Believers, Downtown, The Scale-up, Big Tech Energy, The Last Mile), and each
opens with a title card.

**Personality.** Staff have short bios. They talk in speech bubbles about what
is actually happening (training, overheating, a rival release, running out of
money) and get up to visit the coffee machine, couch, whiteboard or servers.
Every finished model gets a launch reveal: the score counts up, you see where
it lands on the leaderboard, and fictional users post about it. Big moments set
off confetti and a cheer. Rival releases come with press lines, and small
synthesized sound effects can be muted from the top bar.

**Clear effects.** Every person in Team shows what they add (RP a day,
training speed, users per GPU, market share, scandal risk) and what that means
right now, such as "your current run finishes 12 days sooner" or "about 40
subscribers ($800/mo), less than their salary". Candidates show the same before
you hire them. The Market tab breaks your share down factor by factor against
the leading rival and names the biggest drag. Models shows how training speed
is calculated and refuses runs that would take over a year. R&D and morale show
where their numbers come from. Cancelling a run refunds half the data cost.

**Guidance.** R&D tags every technology on the path to the AGI Blueprint and
counts how many are done. Models has a planner that says how much compute a
run needs to finish in 150 days and how many of your best GPUs that means. An
alert fires when your GPUs sit idle for 20 days, and a full-screen prompt
appears the moment the AGI Blueprint is done. The game counts real play time
(only while the page is visible) and shows it at the end.

**Extras.** 18 achievements saved in your browser, a quiet generated music
loop you can switch off in the Menu, and synthesized sound effects.

**Mentor.** Mira Castell, a founder who has built two labs, walks you through
an 11-step tutorial: place rigs, watch the heat, train, deploy, raise money and
hire. The game pauses while she talks, and each task finishes the moment you do
it. After that she only speaks up with about 20 hand-written tips, each once
per game and only when it applies (overheating, running out of runway,
unused research points, the AGI Project and so on). Non-urgent tips wait at
least 45 seconds and 20 in-game days after her last message. You can switch
tips off or replay the tutorial from the Menu.

You win by finishing the AGI Project before any rival reaches 100 on
OmniBench. You lose if a rival gets there first, or if you run out of cash for
90 days.

**Controls:** Space pauses, keys 1–3 set the speed, Esc cancels placement.
Scroll or pinch to zoom, drag to pan, right-click to stop placing.

## Code layout

```
index.html        page shell
css/style.css     all styling
js/data.js        content and tuning: offices, items, roles, research, models, rivals, rounds, goals
js/flavor.js      chapters, staff bios, office chatter, launch reactions, rival press lines
js/progress.js    what is unlocked when: tabs, stats, build categories, chapters
js/events.js      random events and decisions
js/sim.js         game state, daily simulation and player actions (no DOM, runs in Node)
js/render.js      isometric renderer, walking staff, speech bubbles, confetti and input
js/sound.js       synthesized sound effects
js/ui.js          HUD, panels, modals, launch reveals, chapter cards and toasts
js/mentor.js      mentor dialogue: tutorial steps and one-off tips
js/report.js      compact run report for "Send this run to Claude"
js/main.js        boot, save/load and the main loop
tests/            node:test suite for the simulation (npm test)
tools/bot.js      a placement-aware bot that plays through the same actions as a player
tools/simulate.js headless balance checker
tools/analyze-runs.js  summarizes many run reports
tools/build-artifact.js  bundles the game into one HTML file (npm run build)
.github/workflows CI (tests on every push) and GitHub Pages deploys
```

## Balancing

`js/sim.js` has no DOM access, so a bot can play the whole game in Node:

```sh
npm test           # rules, save migration, seeded replays and a balance smoke test
npm run sim        # 20 bot playthroughs, prints the median year for each goal
node tools/simulate.js 10 --difficulty=hard
npm run analyze -- runs/   # summarize run reports players sent you
```

With the current numbers, the bot reaches AGI in about year 6.5 on Normal and
wins 9 of 10 games; the leading rival stands near 90 when it does and reaches
100 around year 9.5. On Hard the rival is near 94 at that point, on Relaxed
near 78. Most tuning lives in `js/data.js`. The market, valuation and rival
curves are in `js/sim.js`. All game randomness goes through one seeded
generator, so a seed replays exactly.

## Ideas for next steps

- A desktop build for Steam (Electron or Tauri wrapper around the same files)
- Hand-drawn art and a composed soundtrack
- Named rooms with bonuses (server hall, research wing)
- More rival personalities and late-game events
