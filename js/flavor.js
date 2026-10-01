/* Writing that gives the game its personality: chapters, staff bios, office
   chatter, reactions to launches and rival press lines. The places are real
   San Francisco; every name and handle is made up. */
(function (root) {
  const AIT = (root.AIT = root.AIT || {});

  // One chapter per office, plus one for the first people to believe in you.
  // news: what the new office actually unlocks (see minOffice in data.js).
  const CHAPTERS = [
    {
      id: 'sunset', num: 1, title: 'The Outer Sunset',
      when: () => true,
      text: 'January 2023, and every coffee line in the city is talking about chatbots. You have a garage in the Outer Sunset two blocks from Ocean Beach, one gaming PC and $75,000 of savings.',
      news: ['Build: plug in GPUs and keep them cool', 'Models: train your first Tiny model', 'Deploy it and find your first subscribers'],
    },
    {
      id: 'believers', num: 2, title: 'Believers in the Avenues',
      when: (s) => s.rounds.length > 0 || s.subs >= 1000,
      text: (s) => (s.rounds.length ? 'An investor drove up from Sand Hill Road, watched one demo and wired money before the fog lifted.' : 'A thousand strangers now pay you every month, and one of them lives on your block.') + ' For the first time, other people are betting on you. Time to hire.',
      news: (s) => ['Team: hire people (each needs a Standing Desk)', 'Comfort items keep the team happy', s.techs.scaling_laws ? 'A flat in the Mission is up for rent' : 'Research Scaling Laws and a flat in the Mission opens up'],
    },
    {
      id: 'mission', num: 3, title: '24th and Mission',
      when: (s) => s.officeLevel >= 1,
      text: 'Bay windows, a taqueria downstairs and wiring from 1906. The neighbors are convinced you are mining crypto.',
      news: ['4-GPU Workstations', 'An Office Dog named Sourdough', 'Room for a real team'],
    },
    {
      id: 'soma', num: 4, title: 'South of Market',
      when: (s) => s.officeLevel >= 2,
      text: 'Brick walls, skylights and the Bay Bridge out the window. Journalists have started asking for quotes, and every other loft on the block is building a chatbot too.',
      news: ['A Kombucha Tap', 'Launch Livestreams in Market', 'Room for twice the team'],
    },
    {
      id: 'missionbay', num: 5, title: 'Mission Bay',
      when: (s) => s.officeLevel >= 3,
      text: 'Glass walls, a real server room and the ballpark next door. On game days you can hear the crowd over the chillers.',
      news: ['8-GPU Servers, chillers and substations', 'Nap Pods', 'Billboards on the 101'],
    },
    {
      id: 'fidi', num: 6, title: 'Montgomery Street',
      when: (s) => s.officeLevel >= 4,
      text: 'Six floors near the top of a tower, level with the pyramid. The bankers in the elevator have stopped asking what you do.',
      news: ['GPU Racks', 'Keynotes at Moscone', 'Room for a much bigger team'],
    },
    {
      id: 'presidio', num: 7, title: 'The Presidio',
      when: (s) => s.officeLevel >= 5,
      text: 'Old army buildings under the eucalyptus, with the Golden Gate Bridge out every window. You have a campus, a cafeteria and a power contract bigger than some towns.',
      news: ['Gas Turbines for on-site power', 'SuperPods and Wafer-Scale Engines, once researched', 'Big Game TV ads'],
    },
    {
      id: 'treasure', num: 8, title: 'Treasure Island',
      when: (s) => s.officeLevel >= 6,
      text: 'A whole island in the middle of the bay, wired into one compute campus. Whoever builds AGI first wins everything, and the city is watching from across the water.',
      news: ['The biggest floor yet, 26 by 26 tiles', '130 MW of grid power before turbines', 'Space for reactors and immersion tanks'],
    },
  ];

  const BIOS = {
    researcher: [
      'Left a Berkeley PhD to "just build things" and still has the parking permit.',
      'Finished a Stanford PhD and moved north, which their advisor took personally.',
      'Keeps a sourdough starter named Backprop on the desk.',
      'Has read every paper on attention twice, mostly on the N-Judah.',
      'Lived in a Hayes Valley hacker house with eleven researchers and one bathroom.',
      'Writes poetry about gradient descent in Dolores Park on Sundays.',
    ],
    engineer: [
      'Bikes up the Wiggle every morning and arrives already debugging.',
      'Ex-big-tech, gave up the free shuttle and never looked back.',
      'Once fixed a production outage from the ferry, halfway to Oakland.',
      'Spends weekends at a Dogpatch climbing gym and weeknights in the profiler.',
      'Owns fourteen mechanical keyboards and one rent-controlled studio.',
      'Will not stop talking about Rust, not even at Burning Man.',
    ],
    growth: [
      'Grew a meme account about Karl the Fog to two million followers.',
      'Ex-sales who once talked a Muni driver into waiting.',
      'Has a spreadsheet for everything, including every burrito in the Mission.',
      'Knows every tech reporter in the city and where they get coffee.',
      'Runs three newsletters from a Hayes Valley cafe and never seems to sleep.',
    ],
    safety: [
      'Red-teamed a chatbot into confessing to tax fraud during a Caltrain delay.',
      'Reads model outputs on BART the way other people read thrillers.',
      'Former Berkeley philosophy lecturer who still asks "but should we?"',
      'Keeps a list of every jailbreak ever found, taped next to the earthquake kit.',
      'Calm in a crisis, calm in an earthquake and slightly scary in a meeting.',
    ],
    any: [
      'Brings bread from their own sourdough starter every Friday.',
      'Rides the ferry in from Oakland and finishes the crossword before the Ferry Building.',
      'Still finds Burning Man dust in their keyboard every spring.',
      'Ex-quant who talks about Sharpe ratios at Dolores Park.',
      'Moved across the world for this job and now pays $3,000 for a room in Noe Valley.',
    ],
  };

  // Things people say at their desks. Picked by the state of the company.
  // Keep lines short: they show in speech bubbles.
  const QUIPS = {
    training: ['Loss is still going down.', "Don't touch the cluster.", 'Checkpoint saved. Burrito time.', 'I think it is learning.', 'That curve is steeper than Filbert St.'],
    hot: ['Is it hot in here?', 'Where is Karl when you need him?', 'Smells like burning money.', 'Open the door. Let the fog in.', 'The rigs are screaming.'],
    broke: ['Are we getting paid this month?', 'Rent is due. Again.', 'Splitting one burrito three ways.', 'Maybe we sell a rig?'],
    capacity: ['Support inbox is on fire.', 'Fuller than the N-Judah at 8am.', 'We need more GPUs, now.'],
    nomodel: ['What if we trained it on everything?', 'Scaling is all you need.', 'Tiny model first. Then Moscone.'],
    live: ['It found me a rent-controlled flat!', 'Someone asked it for the best burrito.', 'It wrote my mom a birthday poem.', 'Another thousand signups!', 'It explained Muni delays. Sort of.'],
    behind: ['Embarcadero shipped again?', 'We need a bigger model.', 'They have more GPUs. We have Karl.'],
    ahead: ['We are number one!', 'Screenshot the leaderboard. Now.', 'Put it on a billboard on the 101.'],
    researcher: ['New idea for attention.', 'Reading papers. Send pour-over.', 'Thought of it on the N-Judah.', 'This result is either huge or a bug.'],
    engineer: ['Who pushed to main?', "Fixed it on BART. Don't ask.", 'It works on my machine.', 'Rewriting it in Rust.'],
    growth: ['We trended for four minutes!', 'Everyone at Dolores Park uses us.', 'Our demo hit a million views.', 'Can we name it something cooler?'],
    safety: ['I would like a word about jailbreaks.', 'Red-teaming until the fog lifts.', 'It refused to help. Good model.', 'Please stop teaching it sarcasm.'],
    founder: ["We're going to make it.", 'Mom, I am on the leaderboard!', 'Pour-over number four.', 'One more run.', 'Rent first. Then AGI.'],
    break: ['Pour-over time.', 'Burrito run. Anyone?', 'Brb, thinking.', 'Anyone want kombucha?'],
    celebrate: ["LET'S GO!", 'We did it!', 'Burritos on me!', 'Party at Dolores Park!', 'Best day ever!'],
    // said on the way to the Office Dog
    dog: ['Who is a good boy? Sourdough is.', 'Sourdough ate a whiteboard marker.', 'Taking Sourdough to Ocean Beach.', 'Sourdough approved the PR.'],
  };

  // Reactions when a model launches. {m} = model, {c} = company, {r} = top rival.
  const REACTIONS = {
    low: [
      ['@kernel_katie', 'tried {m} on the n-judah. it wrote a limerick about the fog. not bad for a garage lab'],
      ['@gradient_greg', '{m} is small and polite. like a hamster that knows python and rents in the sunset'],
      ['@indie_ml', 'respect to {c} for shipping anything at all. most of this city just posts'],
      ['@nlp_nora', '{m} still loses to {r}, but the vibes are very ocean beach'],
    ],
    mid: [
      ['@devtools_dan', 'swapped my coding helper for {m} on the caltrain this week. honestly close enough'],
      ['@priya_builds', '{c} is one to watch. {m} punches above its weight for a lab with no sign on the door'],
      ['@startup_sam', 'every table at this valencia st coffee shop is talking about {m}'],
      ['@benchmark_ben', '{m} closes a lot of the gap with {r}. not all of it'],
    ],
    close: [
      ['@ai_weekly', '{c} is suddenly in the conversation. {m} nearly matches {r}'],
      ['@vc_vera', 'three founders pitched me {m} wrappers at dolores park today. that never happens'],
      ['@ml_memes', '{r} employees refreshing the {m} leaderboard at 3am from the embarcadero'],
    ],
    sota: [
      ['@ai_daily', 'BREAKING: {c}\'s {m} takes the top spot on OmniBench'],
      ['@vc_vince', 'I passed on their seed round. I would like to talk about the weather. karl looks nice today'],
      ['@kernel_katie', 'the lab that started in a sunset garage did it. {m} beats {r}. i am emotional on the 38 geary'],
      ['@fogcity_tech', 'Is {c} the new leader in AI? {m} says yes'],
    ],
  };

  // Lines appended to rival release news.
  const RIVAL_LINES = {
    cortex: ['"Our most capable model yet," says the CEO, on a stage at the Embarcadero.', 'It launches with a two-million-person waitlist.', 'The demo video already has ten million views.', 'The launch party closed two blocks of the waterfront.'],
    helix: ['Twin Peaks says it spent six months on safety testing.', 'The release notes run to ninety pages.', 'Their fans call it "the thoughtful one."', 'They announced it with a long essay and no demo.'],
    titan: ['Peninsula Cloud bundles it free with every cloud account.', 'It is now built into their office apps.', 'Analysts call it "good enough and everywhere."', 'Their shuttles up the 101 now carry ads for it.'],
    open: ['The weights hit torrent sites within minutes.', 'Grad students in Berkeley are already running it on laptops.', 'Developers love it because it costs nothing.', 'It was announced on a flyer stapled to a pole on Telegraph Avenue.'],
  };

  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  AIT.FLAVOR = {
    CHAPTERS, BIOS, QUIPS, REACTIONS, RIVAL_LINES, pick,
    bio(role) {
      return pick(Math.random() < 0.75 ? BIOS[role] : BIOS.any);
    },
  };
})(typeof window !== 'undefined' ? window : globalThis);
