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
js/events.js      random events and decisions
js/sim.js         game state, daily simulation and player actions (no DOM, runs in Node)
js/render.js      isometric canvas renderer and input
js/ui.js          HUD, panels, modals and toasts
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
