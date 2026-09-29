/* Writing that gives the game its personality: chapters, staff bios, office
   chatter, reactions to launches and rival press lines. All names and handles
   are made up. */
(function (root) {
  const AIT = (root.AIT = root.AIT || {});

  const CHAPTERS = [
    {
      id: 'garage', num: 1, title: 'The Garage',
      when: () => true,
      text: "January 2023. Everyone is suddenly talking about chatbots. You have a garage, one gaming PC and $75,000 of savings. Your parents think it's a phase.",
      news: ['Build: plug in GPUs and keep them cool', 'Models: train your first tiny model'],
    },
    {
      id: 'believers', num: 2, title: 'First Believers',
      when: (s) => s.rounds.length > 0 || s.subs >= 250,
      text: (s) => (s.rounds.length ? 'An investor wired you money after a twenty-minute call and one demo.' : 'Two hundred and fifty strangers now pay you every month.') + ' For the first time, other people are betting on you. Time to hire.',
      news: ['Team: hire people (they need desks)', 'Comfort items keep your team happy', 'R&D opens once someone is researching'],
    },
    {
      id: 'downtown', num: 3, title: 'Downtown',
      when: (s) => s.officeLevel >= 1,
      text: 'Exposed brick, fast fiber and a landlord who never asks about the humming. The neighbors are convinced you are mining crypto.',
      news: ['4-GPU Workstations', 'Battery walls for extra power', 'Room for a real team'],
    },
    {
      id: 'scaleup', num: 4, title: 'The Scale-up',
      when: (s) => s.officeLevel >= 2,
      text: 'Series A money, glass walls and standing desks. Journalists have started asking for quotes, and big companies want to talk.',
      news: ['8-GPU Servers, chillers and substations', 'Enterprise deals start coming in', 'Keynotes join the marketing plan'],
    },
    {
      id: 'campus', num: 5, title: 'Big Tech Energy',
      when: (s) => s.officeLevel >= 3,
      text: 'You have a campus, a cafeteria and a power contract bigger than some towns. The other labs have noticed you. The race is on.',
      news: ['GPU Racks and gas turbines', 'TV ads for the big launches', 'Custom silicon is within reach'],
    },
    {
      id: 'lastmile', num: 6, title: 'The Last Mile',
      when: (s) => s.officeLevel >= 4,
      text: 'A city of GPUs you can see from orbit. Whoever builds AGI first wins everything. It had better be you.',
      news: ['Wafer-scale engines, immersion tanks and reactors', 'The AGI Blueprint', 'The final race'],
    },
  ];

  const BIOS = {
    researcher: [
      'Left a PhD to "just build things."',
      'Has read every paper on attention. Twice.',
      'Writes poetry about gradient descent.',
      'Keeps a plant named Backprop on the desk.',
      'Published at every conference except the one that matters.',
      'Believes the answer is always more data.',
    ],
    engineer: [
      'Former game developer. Optimizes everything.',
      'Will not stop talking about Rust.',
      'Once fixed a production outage from a ski lift.',
      'Self-taught from YouTube at sixteen.',
      'Owns 14 mechanical keyboards.',
      'Can make any GPU go 10% faster. Do not ask how.',
    ],
    growth: [
      'Grew a meme page to two million followers.',
      'Ex-sales. Can sell ice to penguins.',
      'Has a spreadsheet for everything, including lunch.',
      'Knows every tech journalist by first name.',
      'Runs three newsletters. Nobody knows when they sleep.',
    ],
    safety: [
      'Red-teamed a chatbot into confessing to tax fraud.',
      'Reads model outputs the way others read thrillers.',
      'Former philosophy lecturer. Asks "but should we?"',
      'Keeps a list of every jailbreak ever found.',
      'Calm in a crisis. Slightly scary in a meeting.',
    ],
    any: [
      'Brings homemade kimchi on Fridays.',
      'Ex-quant. Talks about Sharpe ratios at lunch.',
      'Moved across the world for this job.',
      'Ex-Big Tech. Still misses the free massages.',
      'Plays the cello badly and loudly.',
    ],
  };

  // Things people say at their desks. Picked by the state of the company.
  const QUIPS = {
    training: ['Loss is still going down.', "Don't touch the cluster.", 'Checkpoint saved!', 'I think it is learning.', 'Look at that curve.'],
    hot: ['Is it hot in here?', 'The rigs are screaming.', 'Smells like burning money.', 'Can we get another fan?'],
    broke: ['Are we getting paid this month?', 'I brought lunch from home.', 'Maybe we sell a rig?'],
    capacity: ['Support inbox is on fire.', 'Users keep hitting errors.', 'We need more GPUs, now.'],
    nomodel: ['What if we trained it on everything?', 'Scaling is all you need.', 'Tiny model first. Then the world.'],
    live: ['Someone asked it for a recipe. It worked!', 'Our users are wild.', 'It wrote my mom a birthday poem.', 'Another thousand signups!'],
    behind: ['Cortex shipped again?', 'We need a bigger model.', 'They have more GPUs. We have heart.'],
    ahead: ['We are number one!', "Screenshot the leaderboard. Now.", 'Frame that benchmark.'],
    researcher: ['New idea for attention.', 'Reading papers. Send coffee.', 'What if we just... scaled it?', 'This result is either huge or a bug.'],
    engineer: ['Who pushed to main?', "Fixed it. Don't ask how.", 'It works on my machine.', 'Rewriting it in Rust.'],
    growth: ['We trended for four minutes!', 'Influencers want free access again.', 'Our demo hit a million views.', 'Can we name it something cooler?'],
    safety: ['I would like a word about jailbreaks.', 'Red-teaming all afternoon.', 'It refused to help. Good model.', 'Please stop teaching it sarcasm.'],
    founder: ["We're going to make it.", 'Mom, I am on the leaderboard!', 'Coffee number four.', 'One more run.'],
    break: ['Coffee time.', 'Stretching my legs.', 'Brb, thinking.', 'Anyone want anything?'],
    celebrate: ['LET\'S GO!', 'We did it!', 'Party at the office!', 'Best day ever!'],
  };

  // Reactions when a model launches. {m} = model, {c} = company, {r} = top rival.
  const REACTIONS = {
    low: [
      ['@kernel_katie', 'tried {m}. it wrote a limerick about my cat. not bad for a garage lab'],
      ['@gradient_greg', '{m} is small and polite. like a hamster that knows python'],
      ['@indie_ml', 'respect to {c} for shipping anything at all. most people just tweet'],
      ['@nlp_nora', '{m} still loses to {r}, but the vibes are immaculate'],
    ],
    mid: [
      ['@devtools_dan', 'swapped my coding helper for {m} this week. honestly close enough'],
      ['@priya_builds', '{c} is one to watch. {m} punches above its weight'],
      ['@startup_sam', 'the {m} launch thread is doing numbers'],
      ['@benchmark_ben', '{m} closes a lot of the gap with {r}. not all of it'],
    ],
    close: [
      ['@ai_weekly', '{c} is suddenly in the conversation. {m} nearly matches {r}'],
      ['@vc_vera', 'three founders texted me about {m} today. that never happens'],
      ['@ml_memes', '{r} employees refreshing the {m} leaderboard at 3am'],
    ],
    sota: [
      ['@ai_daily', 'BREAKING: {c}\'s {m} takes the top spot on OmniBench'],
      ['@vc_vince', 'I passed on their seed round. I would like to talk about something else'],
      ['@kernel_katie', 'the garage lab did it. {m} beats {r}. i am emotional'],
      ['@tech_tribune', 'Is {c} the new leader in AI? {m} says yes'],
    ],
  };

  // Lines appended to rival release news.
  const RIVAL_LINES = {
    cortex: ['"Our most capable model yet," says the CEO.', 'It launches with a two-million-person waitlist.', 'The demo video already has ten million views.'],
    helix: ['Helix says it spent six months on safety testing.', 'The release notes run to ninety pages.', 'Their fans call it "the thoughtful one."'],
    titan: ['Titan bundles it free with every cloud account.', 'It is now built into their office apps.', 'Analysts call it "good enough and everywhere."'],
    open: ['The weights hit torrent sites within minutes.', 'Hobbyists are already running it on laptops.', 'Developers love it because it costs nothing.'],
  };

  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  AIT.FLAVOR = {
    CHAPTERS, BIOS, QUIPS, REACTIONS, RIVAL_LINES, pick,
    bio(role) {
      return pick(Math.random() < 0.75 ? BIOS[role] : BIOS.any);
    },
  };
})(typeof window !== 'undefined' ? window : globalThis);
