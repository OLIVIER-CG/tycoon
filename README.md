# AI Boom Tycoon

An isometric management game about the AI boom in San Francisco, inspired by
the office-building loop of *E-Shop Tycoon*. You start in a garage in the Outer
Sunset in January 2023 with one gaming PC and $75,000. You build a lab, train
bigger and bigger models, win subscribers, raise money on Sand Hill Road, move
across the city, and race four rival Bay Area labs to AGI.

It runs in any modern browser, with no build step and no dependencies.

## Play

Open `index.html` in a browser. Or serve the folder:

```sh
npm start          # serves the folder with npx serve
```

Progress saves automatically to your browser every in-game month, with
milestone saves to go back to (see Saves below). Saves from older versions
are upgraded when they load.

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

## The city

Each move is a new chapter, a new view out of the windows and room for
faster hardware.

| Office | Where | Grid | What it unlocks |
| --- | --- | --- | --- |
| Outer Sunset Garage | two blocks from Ocean Beach | 6×6 | gaming rigs, fans and AC |
| Victorian Flat | 24th and Mission | 8×8 | 4-GPU workstations, the office dog |
| SoMa Warehouse Loft | under the Bay Bridge | 11×11 | kombucha tap |
| Mission Bay Floor | across from the ballpark | 14×14 | 8-GPU servers, chillers, substations |
| Financial District Tower | next to the pyramid | 17×17 | GPU racks |
| Presidio Campus | by the Golden Gate | 21×21 | SuperPods, wafer-scale engines, gas turbines |
| Treasure Island | the whole island | 26×26 | room for everything |

The rivals are Embarcadero AI (the incumbent on the waterfront), Twin Peaks
Research (careful, with a view of everything), Peninsula Cloud (a
trillion-dollar giant from down the 101) and the Telegraph Collective
(Berkeley grad students giving models away). Karl the Fog cools your GPUs for
free when he rolls in, and earthquakes, Muni strikes, Moscone conference weeks
and rent hikes all show up.

## Screens

The game looks and plays like a PC tycoon game. It opens on a **title screen**
(Continue, New game, Load game, Options, Credits) over your office. In the
game the office fills the screen and the chrome sits on top of it. The
chrome is kept quiet on purpose: dark and flat, with orange only for what is
selected or what to press next, and red or amber only when something is
wrong. Anything that isn't needed every minute lives in a window or under the
bell.

- **Top left:** the menu, the date, pause and three speeds, then a round
  button for each window: Team, Research, Models, Market, Money and the Race.
  A dot means something there needs you, a yellow dot means it is new.
- **Top right:** the bell (everything that needs you, and the news) and
  Feedback.
- **Left:** Build, Sell and Real estate. Build opens a shelf along the bottom
  with a tab per category (compute, cooling, power, office, comfort), item
  cards, and power, heat and desk meters.
- **Bottom:** five numbers. People, subscribers and usable compute on the
  left; monthly profit and cash on the right. They turn amber or red only
  when something needs you (low morale, overheating, a loss). Hover for
  details, click to open the window behind them. The company button in the
  middle opens your headquarters.
- **Over the office:** the next milestone in two lines (hover for a hint),
  and a banner only for real trouble. Toasts stack at most two, and several
  achievements at once share one toast.

**Windows** open in the middle with a slate title bar, orange tabs, a `?`
that explains the window and four key numbers along the bottom:

| Window | Tabs |
| --- | --- |
| Company | Overview (next steps, training, race, trends), Real estate (your office, the next one and all seven), Goals |
| Team | Staff, Hiring |
| Research | Available, All technologies, Path to AGI |
| Models | Train, Library, Compute split |
| Market | Pricing (revenue-by-price chart and what decides your share), Marketing, Products, Deals |
| Money | Overview (cash and revenue charts, last month's books), Funding |
| The race | Leaderboard, Alignment, News |

**Marketing** works in slots: campaigns hold a slot while they run (two in
the garage, up to four in the Financial District and later), show how long
they have left, and can renew themselves while you keep twice their cost in
the bank. Stopping one frees its slot, but it can't restart before it would
have ended.

**Saves.** Every run has an autosave, rewritten each month, plus milestone
saves at every new chapter and every new year (the last four years are
kept). Load game lists them per company with the in-game date, when each was
made, time played and the game version, like a keyframe list. When browser
storage fills up, the oldest milestones go first.

## How it plays

| Loop | What you do |
| --- | --- |
| **Build** | Place GPUs, cooling, power, desks and comfort items on an isometric grid. Keep total heat below total cooling, or every GPU glows red and slows down; where coolers stand does not matter. Whiteboards help researchers within 2 tiles, comfort items help desks within 3. Late-game hardware takes 2×2 tiles. |
| **Train** | Pick a model size (Tiny 1B to Ultra 10T, nine sizes) and training data (licensed, synthetic, human feedback). Runs consume compute measured in PF-days, with a live loss curve. |
| **Deploy** | Your live model wins market share based on its OmniBench score against rivals, your hype, your price and whether you have enough compute to serve everyone. |
| **Sell** | Besides the chat app, launch a Developer API, Image Studio, a voice assistant, Agents and robots. Each has its own customers, price and compute bill. |
| **Hire** | Researchers earn research points, engineers speed up training and serving, growth staff bring users, and safety staff prevent scandals. Everyone needs a desk and a reason to stay. |
| **Research** | 36 technologies across seven tiers, from Scaling Laws to the AGI Blueprint. They unlock bigger models, better hardware, new products and efficiency gains, and a few late ones make research itself faster. |
| **Fund** | Optional. Pitch investors for up to three competing term sheets: a top-tier VC (hype), a Big Tech partner (free cloud compute) or a founder-friendly fund (less dilution). Ask for a better price and risk the investor walking, or walk away and pay for it with lower offers for six months. Interest depends on your numbers for the stage, your runway and past walk-aways. Offices only cost money, so you can bootstrap on revenue and keep the whole company. |
| **Survive** | Random events: GPU shortages, jailbreak scandals, copyright lawsuits, poaching, Senate hearings, enterprise deals, heatwaves and bubble talk. Rivals act too: they launch free tiers, start price wars, sue you and answer your launches with their own. |
| **Stay aligned** | Safety staff, safety research and your choices in a crisis add up to an alignment score. It decides how the world greets your AGI: trusted, uneasy or reckless. |

**Pacing.** A good run takes about 14 in-game years, roughly twice as long as
v0.1. The game starts with the Models window, two stats and two items. Windows,
stats, build categories, research tiers, model sizes and funding rounds appear
as you earn them, with a dot on anything new. The shop only teases the next
thing you can unlock instead of listing everything. There are no random events
for the first 45 days. The story runs in eight chapters (The Outer Sunset,
Believers in the Avenues, 24th and Mission, South of Market, Mission Bay,
Montgomery Street, The Presidio, Treasure Island), and each opens with a title
card.

**Personality.** Staff have short bios. They talk in speech bubbles about what
is actually happening (training, overheating, a rival release, running out of
money) and get up to visit the pour-over bar, the bean bags, the pinball
machine, Sourdough the office dog, a whiteboard or the servers.
Every finished model gets a launch reveal: the score counts up, you see where
it lands on the leaderboard, and fictional users post about it. Big moments set
off confetti and a cheer. Rival releases come with press lines, and small
synthesized sound effects can be turned off in Options. The office itself is
drawn calm too: rig screens and server lights glow softly instead of
flashing, people speak up now and then rather than all at once, and a few
walk around at a time.

**Clear effects.** Every person in Team shows what they add (RP a day,
training speed, users per GPU, market share, scandal risk) and what that means
right now, such as "your current run finishes 12 days sooner" or "about 40
subscribers ($800/mo), less than their salary". Candidates show the same before
you hire them. Market breaks your share down factor by factor against
the leading rival and names the biggest drag, and its price chart shows the
subscribers and revenue you would get at every price. Models shows how training speed
is calculated and refuses runs that would take over a year. R&D and morale show
where their numbers come from. Cancelling a run refunds half the data cost.

**Guidance.** R&D tags every technology on the path to the AGI Blueprint and
counts how many are done. Models has a planner that says how much compute a
run needs to finish in 150 days and how many of your best GPUs that means. The Company window
suggests the best next run (size, expected score, days and data cost) and opens
the planner on it. The idle-GPU warning only appears when a clearly better model
is within reach, and a full-screen prompt appears the moment the AGI Blueprint
is done. The game counts real play time
(only while the page is visible) and shows it at the end.

**Extras.** 18 achievements saved in your browser, a quiet generated music
loop you can switch off in the Menu, and synthesized sound effects.

**Mentor and the first ten minutes.** Mira Castell, a founder who has built
two labs, says hello in one short message and then keeps a checklist at the
top right. It takes a new player through the first ten minutes in four parts:

1. **The garage:** build three more gaming rigs, train a Tiny model, speed up
   time, deploy it.
2. **First believers:** raise a pre-seed round (skippable), research Scaling
   Laws.
3. **Moving out:** move to the Mission, fill it with workstations until a
   Small model fits in 120 days (180 on a smaller raise, so the plan fits the
   budget), and add cooling if the GPUs overheat.
4. **A real model:** train a Small model, run a free hype campaign, ship it,
   and hire a researcher once the lab can afford one.

Every item is one line of instructions with live progress (training %, days
a Small run would take, research points), a Show me button that opens the
right window or shelf, and a pulsing highlight on the thing to press. Items
tick off the moment they are done, ones already done are skipped, and the
game never pauses for the list. On phones it shrinks to a bar along the
bottom of any open window. Afterwards Mira only speaks up with about 20
hand-written tips, each once per game and only when it applies. During the
checklist only urgent ones (out of cash, overheating) can interrupt, and
tips about a slow run or overloaded servers wait until the problem has
lasted a week, so a two-day earthquake doesn't set them off. Non-urgent tips
wait 20 in-game days after her last message, plus 45 seconds of real time at
1× (shorter at higher speeds, never under 8 seconds). You can switch tips off
or replay the checklist from Options.

Models also warns when a run would not beat your live model, the trap that
made players retrain the same Tiny model over and over, and moving office
asks for confirmation and then closes the window so you land in the new
office.

You win by finishing the AGI Project before any rival reaches 100 on
OmniBench. You lose if a rival gets there first, or if you run out of cash for
90 days.

**Controls:** Space pauses, keys 1–3 set the speed, Esc closes a window or
cancels placement. Scroll or pinch to zoom, drag to pan, right-click to stop
placing.

## Code layout

```
index.html        page shell
css/style.css     all styling
js/data.js        content and tuning: offices, items, roles, research, models, rivals, rounds, goals
js/flavor.js      chapters, staff bios, office chatter, launch reactions, rival press lines
js/progress.js    what is unlocked when: screens, stats, build categories, chapters
js/events.js      random events and decisions
js/sim.js         game state, daily simulation and player actions (no DOM, runs in Node)
js/render.js      isometric renderer: San Francisco offices and window views, fog, walking staff, speech bubbles, confetti and input
js/sound.js       synthesized sound effects
js/saves.js       save slots: autosave, milestone saves, loading and pruning
js/ui.js          title screen, HUD, windows and tabs, build toolbar and shelf, dialogs, launch reveals and toasts
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

With the current numbers, the bot reaches AGI in about year 14 on Normal and
wins 15 of 16 games. Relaxed is 15 of 16, and Hard 8 of 16, where the rivals
often reach 100 while the bot sits at 99. The pace knobs are in the `TUNING`
block at the top of `js/data.js` (rival years, market growth, research
rate); most other tuning lives in the same file. The market, valuation and rival
curves are in `js/sim.js`. All game randomness goes through one seeded
generator, so a seed replays exactly.

## Ideas for next steps

- A desktop build for Steam (Electron or Tauri wrapper around the same files)
- Hand-drawn art and a composed soundtrack
- Named rooms with bonuses (server hall, research wing)
- More rival personalities and late-game events
