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

Progress saves automatically to your browser every in-game month.

## How it plays

| Loop | What you do |
| --- | --- |
| **Build** | Place GPUs, cooling, power, desks and comfort items on an isometric grid. Heat above your cooling throttles GPUs and can start fires. Power above your capacity browns them out. |
| **Train** | Pick a model size (Tiny 1B to Ultra 10T) and training data (licensed, synthetic, human feedback). Runs consume compute measured in PF-days, with a live loss curve. |
| **Deploy** | Your live model wins market share based on its OmniBench score against rivals, your hype, your price and whether you have enough compute to serve everyone. |
| **Hire** | Researchers earn research points, engineers speed up training and serving, growth staff bring users, and safety staff prevent scandals. Everyone needs a desk and a reason to stay. |
| **Research** | 26 technologies across five tiers, from Scaling Laws to the AGI Blueprint. They unlock bigger models, better hardware and efficiency gains. |
| **Fund** | Eight funding rounds from Pre-seed to IPO. Each bigger office requires a funding round, and each round needs traction. |
| **Survive** | Random events: GPU shortages, jailbreak scandals, copyright lawsuits, poaching, Senate hearings, enterprise deals, heatwaves and bubble talk. |

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
tools/simulate.js headless balance checker
```

## Balancing

`js/sim.js` has no DOM access, so a bot can play the whole game in Node:

```sh
npm run sim        # 20 bot playthroughs, prints the median year for each goal
```

With the current numbers, an efficient bot reaches AGI around year 6.5. The
leading rival gets there around year 9.5, so slower players have to push to
win. Most tuning lives in `js/data.js`. The market, valuation and rival curves
are in `js/sim.js`.

## Ideas for next steps

- Staff who walk between desks, the coffee machine and meeting rooms
- Multi-tile items and room zoning (server hall, research wing)
- Sound effects and music
- Several product lines (chat app, API, image model, agents) with separate pricing
- Rival labs that poach from you, sue you and react to your launches
- A sandbox mode and a daily-seed challenge leaderboard
