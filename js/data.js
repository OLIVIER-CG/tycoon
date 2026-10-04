/* Static game content: offices, items, staff roles, research, models, rivals,
   marketing, funding and goals. Everything tunable lives here. */
(function (root) {
  const AIT = (root.AIT = root.AIT || {});

  const START_DATE = Date.UTC(2023, 0, 1);

  // Pace of the whole game. rivalYears: years until an unopposed rival reaches
  // AGI on Normal. marketRate: yearly growth of the paying market; marketStart
  // and marketCap bound it. rpRate scales the research points people earn.
  const TUNING = { rivalYears: 18, marketRate: 0.6, marketStart: 40000, marketCap: 3e9, rpRate: 1 };

  // Office levels, one San Francisco neighborhood each. Power and cooling are
  // in kW; the grid is size x size tiles. view: what the windows look out on.
  const OFFICES = [
    {
      id: 'sunset', name: 'Outer Sunset Garage', place: 'Outer Sunset', size: 6, moveCost: 0, rent: 0, power: 10, cooling: 5, view: 'ocean',
      floorA: '#cfcbc3', floorB: '#c5c0b7', wall: '#d9d6cf', wallSide: '#c4c0b8', trim: '#8e8a82',
      blurb: 'Two blocks from Ocean Beach. The fog keeps the rigs cool and your socks damp.',
    },
    {
      id: 'mission', name: 'Victorian Flat', place: 'the Mission', size: 8, moveCost: 20000, rent: 5000, power: 35, cooling: 10, view: 'victorians',
      floorA: '#caa47a', floorB: '#bf976c', wall: '#b9a7cf', wallSide: '#a693bf', trim: '#f2ece0',
      blurb: 'A painted-lady flat above a taqueria. Great bay windows, wiring from 1906.',
    },
    {
      id: 'soma', name: 'SoMa Warehouse Loft', place: 'SoMa', size: 11, moveCost: 90000, rent: 14000, power: 110, cooling: 22, view: 'baybridge',
      floorA: '#8f6a4c', floorB: '#846046', wall: '#a8553e', wallSide: '#924632', trim: '#3d3531',
      blurb: 'Brick, skylights and the Bay Bridge out the window. Half the startups in the city began on this block.',
    },
    {
      id: 'missionbay', name: 'Mission Bay Floor', place: 'Mission Bay', size: 14, moveCost: 1.2e6, rent: 100000, power: 700, cooling: 60, view: 'ballpark',
      floorA: '#dfe3e2', floorB: '#d5dad9', wall: '#a9c6d3', wallSide: '#92b0bf', trim: '#50707f',
      blurb: 'Glass walls, standing desks and the ballpark next door. You finally have a real server room.',
    },
    {
      id: 'fidi', name: 'Financial District Tower', place: 'the Financial District', size: 17, moveCost: 8e6, rent: 420000, power: 3500, cooling: 180, view: 'skyline',
      floorA: '#d4d1cb', floorB: '#cac6bf', wall: '#46525d', wallSide: '#3a4550', trim: '#b8962e',
      blurb: 'Six floors near the top of a tower, level with the pyramid. The elevators need a badge.',
    },
    {
      id: 'presidio', name: 'Presidio Campus', place: 'the Presidio', size: 21, moveCost: 45e6, rent: 1.8e6, power: 20000, cooling: 700, view: 'goldengate',
      floorA: '#d9cdb5', floorB: '#cfc2a8', wall: '#eee7d8', wallSide: '#d8d0bf', trim: '#56714f',
      blurb: 'Old army buildings under eucalyptus trees, with the Golden Gate Bridge out every window.',
    },
    {
      id: 'treasure', name: 'Treasure Island', place: 'Treasure Island', size: 26, moveCost: 250e6, rent: 6e6, power: 130000, cooling: 2800, view: 'citywater',
      floorA: '#c8ced3', floorB: '#bec5ca', wall: '#6f7b86', wallSide: '#5e6a75', trim: '#c0362c',
      blurb: 'A whole island in the middle of the bay, turned into one compute campus. The city glows across the water.',
    },
  ];

  // cat: compute | cooling | power | office | comfort
  // pf: compute in petaFLOPS. power: draw in kW. cooling: heat removed in kW.
  // powerCap: extra power capacity in kW. seats: desks. decor: comfort points.
  const ITEMS = {
    desk: { name: 'Standing Desk', cat: 'office', cost: 1500, power: 0.3, seats: 1, desc: 'Seats one person. Sit, stand or pace. Everyone on your team needs one.' },
    whiteboard: { name: 'Glass Whiteboard', cat: 'office', cost: 900, rpBonus: 0.08, radius: 2, desc: 'Researchers within 2 tiles work 8% faster (up to +40% from five boards). Covered in half-erased equations.' },

    rig: { name: 'Gaming Rig', cat: 'compute', cost: 3000, pf: 1, power: 0.8, desc: 'The tower you built in college. Loud, cheap and surprisingly useful.' },
    workstation: { name: '4-GPU Workstation', cat: 'compute', cost: 28000, pf: 6, power: 2.5, minOffice: 1, desc: 'Four workstation GPUs in one desk-side case.' },
    server: { name: '8-GPU Server', cat: 'compute', cost: 220000, pf: 45, power: 10, minOffice: 3, desc: 'The industry workhorse. Eight datacenter GPUs on a fast interconnect.' },
    rack: { name: 'GPU Rack', cat: 'compute', cost: 1.6e6, pf: 300, power: 40, minOffice: 4, desc: 'A full rack of servers with its own network fabric.' },
    superpod: { name: 'SuperPod', cat: 'compute', size: 2, cost: 56e6, pf: 12000, power: 880, minOffice: 5, tech: 'custom_silicon', desc: 'Your own chips wired into one giant accelerator. Takes 2×2 tiles.' },
    wafer: { name: 'Wafer-Scale Engine', cat: 'compute', size: 2, cost: 240e6, pf: 64000, power: 2400, minOffice: 5, tech: 'wafer_scale', desc: 'Chips the size of dinner plates, four to a cabinet. Takes 2×2 tiles.' },

    fan: { name: 'Box Fan', cat: 'cooling', cost: 80, cooling: 1, power: 0.05, desc: 'Removes 1 kW of heat. Or open the garage door and let the fog in.' },
    ac: { name: 'AC Unit', cat: 'cooling', cost: 3000, cooling: 8, power: 1, desc: 'Removes 8 kW of heat.' },
    chiller: { name: 'Industrial Chiller', cat: 'cooling', cost: 80000, cooling: 120, power: 8, minOffice: 3, desc: 'Removes 120 kW of heat.' },
    liquid: { name: 'Liquid Cooling Loop', cat: 'cooling', cost: 900000, cooling: 1200, power: 40, tech: 'liquid_cooling', desc: 'Removes 1.2 MW of heat by piping coolant straight to the chips.' },
    immersion: { name: 'Immersion Tank', cat: 'cooling', size: 2, cost: 36e6, cooling: 40000, power: 1000, tech: 'immersion', desc: 'Removes 40 MW of heat. The servers take a bath in dielectric fluid. Takes 2×2 tiles.' },

    battery: { name: 'Battery Wall', cat: 'power', cost: 12000, powerCap: 15, desc: '+15 kW capacity. Also rides out short power outages.' },
    substation: { name: 'Substation', cat: 'power', cost: 500000, powerCap: 800, minOffice: 3, desc: '+800 kW from a dedicated grid hookup.' },
    turbine: { name: 'Gas Turbine', cat: 'power', size: 2, cost: 48e6, powerCap: 60000, minOffice: 5, desc: '+60 MW of on-site generation. Takes 2×2 tiles.' },
    smr: { name: 'Modular Reactor', cat: 'power', size: 2, cost: 600e6, powerCap: 480000, tech: 'nuclear', desc: '+480 MW of steady nuclear power. Takes 2×2 tiles.' },

    plant: { name: 'Succulent', cat: 'comfort', cost: 200, decor: 1, radius: 3, desc: 'Comfort +1 for desks within 3 tiles. Needs almost nothing. Very on brand.' },
    bikes: { name: 'Bike Rack', cat: 'comfort', cost: 1200, decor: 2, radius: 3, desc: 'Comfort +2 for desks within 3 tiles. For the people who ride in from the ferry.' },
    coffee: { name: 'Pour-over Bar', cat: 'comfort', cost: 3500, decor: 4, radius: 3, desc: 'Comfort +4 for desks within 3 tiles. Single-origin beans and a twelve-minute wait.' },
    couch: { name: 'Bean Bags', cat: 'comfort', cost: 2500, decor: 3, radius: 3, desc: 'Comfort +3 for desks within 3 tiles. For deep thinking and shallow naps.' },
    dog: { name: 'Office Dog', cat: 'comfort', cost: 4000, decor: 7, radius: 3, minOffice: 1, desc: 'Comfort +7 for desks within 3 tiles. A very good dog named Sourdough.' },
    kombucha: { name: 'Kombucha Tap', cat: 'comfort', cost: 6000, decor: 5, radius: 3, minOffice: 2, desc: 'Comfort +5 for desks within 3 tiles. Four flavors on tap. Nobody knows who refills it.' },
    arcade: { name: 'Pinball Machine', cat: 'comfort', cost: 9000, decor: 6, radius: 3, desc: 'Comfort +6 for desks within 3 tiles. Someone keeps setting the high score at 4am.' },
    nap_pod: { name: 'Nap Pod', cat: 'comfort', cost: 25000, decor: 10, radius: 3, minOffice: 3, desc: 'Comfort +10 for desks within 3 tiles. Sleep is the best regularizer.' },
  };

  const ITEM_CATS = [
    { id: 'compute', name: 'Compute' },
    { id: 'cooling', name: 'Cooling' },
    { id: 'power', name: 'Power' },
    { id: 'office', name: 'Office' },
    { id: 'comfort', name: 'Comfort' },
  ];

  const ROLES = {
    researcher: { name: 'Researcher', short: 'RES', color: '#4a63d8', base: 1800, desc: 'Produces research points and raises model quality.' },
    engineer: { name: 'Engineer', short: 'ENG', color: '#e0612a', base: 1600, desc: 'Speeds up training and serves more users per GPU.' },
    growth: { name: 'Growth', short: 'GRW', color: '#2e9b67', base: 1300, desc: 'Grows your user base faster and slows hype decay.' },
    safety: { name: 'Safety', short: 'SAF', color: '#8d56c9', base: 1500, desc: 'Prevents scandals and keeps regulators calm.' },
  };

  // Research tree in seven tiers. Costs are research points (RP).
  const TECHS = [
    { id: 'scaling_laws', name: 'Scaling Laws', cost: 30, req: [], tier: 1, desc: 'Unlocks Small (8B) models.' },
    { id: 'flash_attention', name: 'FlashAttention', cost: 60, req: [], tier: 1, desc: '+20% training speed.', train: 0.2 },
    { id: 'rlhf', name: 'RLHF', cost: 90, req: ['scaling_laws'], tier: 1, desc: 'New models +12% appeal. Unlocks human feedback data.', appeal: 0.12 },

    { id: 'quantization', name: 'Quantization', cost: 220, req: [], tier: 2, desc: '+40% users served per GPU.', infer: 0.4 },
    { id: 'eval_harness', name: 'Eval Harness', cost: 300, req: ['scaling_laws'], tier: 2, desc: 'You measure what matters: new models +3% capability.', cap: 0.03 },
    { id: 'distributed', name: 'Distributed Training', cost: 380, req: ['scaling_laws'], tier: 2, desc: 'Unlocks Medium (70B) models.' },
    { id: 'code_models', name: 'Code Generation', cost: 450, req: ['rlhf'], tier: 2, desc: 'Unlocks the Developer API. Brings enterprise deals.' },
    { id: 'synthetic_data', name: 'Synthetic Data', cost: 520, req: ['distributed'], tier: 2, desc: 'Unlocks synthetic training data.' },
    { id: 'long_context', name: 'Long Context', cost: 600, req: ['distributed'], tier: 2, desc: 'New models +10% appeal.', appeal: 0.1 },

    { id: 'liquid_cooling', name: 'Liquid Cooling', cost: 2000, req: [], tier: 3, desc: 'Unlocks the Liquid Cooling Loop.' },
    { id: 'constitutional', name: 'Constitutional AI', cost: 2500, req: ['rlhf'], tier: 3, desc: 'Scandal risk -50%.', safety: 0.5 },
    { id: 'mixed_precision', name: 'Mixed Precision', cost: 3000, req: ['flash_attention', 'distributed'], tier: 3, desc: '+20% training speed.', train: 0.2 },
    { id: 'moe', name: 'Mixture of Experts', cost: 3800, req: ['distributed'], tier: 3, desc: 'Unlocks Large (400B) models. +25% users per GPU.', infer: 0.25 },
    { id: 'distillation', name: 'Distillation', cost: 3800, req: ['quantization'], tier: 3, desc: '+30% users served per GPU.', infer: 0.3 },
    { id: 'multimodal', name: 'Multimodal', cost: 4000, req: ['long_context'], tier: 3, desc: 'Unlocks Image Studio. New models +18% appeal, +3% capability.', appeal: 0.18, cap: 0.03 },

    { id: 'sparse_scaling', name: 'Sparse Scaling', cost: 14000, req: ['moe'], tier: 4, desc: 'Unlocks XL (1T) models.' },
    { id: 'voice', name: 'Realtime Voice', cost: 16000, req: ['multimodal'], tier: 4, desc: 'Unlocks the Voice Assistant. New models +6% appeal.', appeal: 0.06 },
    { id: 'speculative', name: 'Speculative Decoding', cost: 18000, req: ['distillation'], tier: 4, desc: '+25% users served per GPU.', infer: 0.25 },
    { id: 'interpretability', name: 'Interpretability', cost: 21000, req: ['constitutional'], tier: 4, desc: 'Scandal risk -40%. Regulators like you more.', safety: 0.4 },
    { id: 'custom_silicon', name: 'Custom Silicon', cost: 23000, req: ['distributed'], tier: 4, desc: 'Unlocks the SuperPod.' },
    { id: 'reasoning', name: 'Reasoning Models', cost: 28000, req: ['moe', 'synthetic_data'], tier: 4, desc: 'New models think before answering: +7% capability.', cap: 0.07 },

    { id: 'immersion', name: 'Immersion Cooling', cost: 30000, req: ['liquid_cooling'], tier: 5, desc: 'Unlocks the Immersion Tank.' },
    { id: 'tool_use', name: 'Tool Use', cost: 36000, req: ['reasoning', 'code_models'], tier: 5, desc: 'Models call APIs and run code: +5% capability, +20% research.', cap: 0.05, rp: 0.2 },
    { id: 'frontier_scaling', name: 'Frontier Scaling', cost: 42000, req: ['sparse_scaling'], tier: 5, desc: 'Unlocks Frontier (2T) models.' },
    { id: 'agents', name: 'Autonomous Agents', cost: 48000, req: ['tool_use'], tier: 5, desc: 'Unlocks Agents. New models +4% capability. Agents help your researchers: +25% research.', cap: 0.04, rp: 0.25 },
    { id: 'long_training', name: 'Fault-tolerant Training', cost: 54000, req: ['mixed_precision', 'custom_silicon'], tier: 5, desc: 'Runs survive hardware failures: +20% training speed.', train: 0.2 },

    { id: 'nuclear', name: 'Nuclear Power Deal', cost: 55000, req: ['custom_silicon'], tier: 6, desc: 'Unlocks the Modular Reactor.' },
    { id: 'data_flywheel', name: 'Data Flywheel', cost: 58000, req: ['agents'], tier: 6, desc: 'New models learn from usage: up to +6% capability with more subscribers.' },
    { id: 'planet_scale', name: 'Planet-scale Training', cost: 62000, req: ['frontier_scaling', 'long_training'], tier: 6, desc: 'Unlocks Giga (5T) models.' },
    { id: 'world_models', name: 'World Models', cost: 66000, req: ['multimodal', 'reasoning'], tier: 6, desc: 'Models that simulate the physical world: +6% capability, +20% research.', cap: 0.06, rp: 0.2 },
    { id: 'wafer_scale', name: 'Wafer-Scale Chips', cost: 70000, req: ['custom_silicon'], tier: 6, desc: 'Unlocks the Wafer-Scale Engine.' },
    { id: 'robotics', name: 'Robotics', cost: 75000, req: ['world_models', 'agents'], tier: 6, desc: 'Unlocks the Robotics Platform.' },

    { id: 'ultrascale', name: 'Ultrascale Training', cost: 85000, req: ['planet_scale'], tier: 7, desc: 'Unlocks Ultra (10T) models.' },
    { id: 'superalignment', name: 'Superalignment', cost: 90000, req: ['interpretability'], tier: 7, desc: 'Oversight that scales with the model: scandal risk -50%.', safety: 0.5 },
    { id: 'self_improvement', name: 'Recursive Self-Improvement', cost: 100000, req: ['ultrascale', 'agents'], tier: 7, desc: 'Your models help build the next one: +25% training speed, +30% research.', train: 0.25, rp: 0.3 },
    { id: 'agi_theory', name: 'AGI Blueprint', cost: 120000, req: ['self_improvement', 'interpretability'], tier: 7, desc: 'Unlocks the AGI Project.' },
  ];

  // Model sizes. pfdays: compute to train. infer: serving cost per user relative to Tiny.
  // base: expected OmniBench score before bonuses. data: optional data costs.
  const MODEL_SIZES = [
    { id: 'tiny', name: 'Tiny', params: '1B', base: 8, pfdays: 60, infer: 1, tech: null, data: { licensed: 6000, synthetic: 3000, human: 10000 } },
    { id: 'small', name: 'Small', params: '8B', base: 17, pfdays: 6000, infer: 3, tech: 'scaling_laws', data: { licensed: 60e3, synthetic: 25e3, human: 90e3 } },
    { id: 'medium', name: 'Medium', params: '70B', base: 28, pfdays: 50e3, infer: 8, tech: 'distributed', data: { licensed: 600e3, synthetic: 250e3, human: 900e3 } },
    { id: 'large', name: 'Large', params: '400B', base: 40, pfdays: 250e3, infer: 18, tech: 'moe', data: { licensed: 4e6, synthetic: 1.6e6, human: 6e6 } },
    { id: 'xl', name: 'XL', params: '1T', base: 50, pfdays: 1.2e6, infer: 26, tech: 'sparse_scaling', data: { licensed: 15e6, synthetic: 6e6, human: 22e6 } },
    { id: 'frontier', name: 'Frontier', params: '2T', base: 59, pfdays: 6e6, infer: 35, tech: 'frontier_scaling', data: { licensed: 50e6, synthetic: 20e6, human: 80e6 } },
    { id: 'giga', name: 'Giga', params: '5T', base: 67, pfdays: 25e6, infer: 50, tech: 'planet_scale', data: { licensed: 150e6, synthetic: 60e6, human: 240e6 } },
    { id: 'ultra', name: 'Ultra', params: '10T', base: 75, pfdays: 100e6, infer: 70, tech: 'ultrascale', data: { licensed: 400e6, synthetic: 160e6, human: 650e6 } },
    { id: 'agi', name: 'AGI Project', params: '???', base: 100, pfdays: 600e6, infer: 150, tech: 'agi_theory', data: { licensed: 0, synthetic: 0, human: 0 }, fixedCost: 3e9 },
  ];

  const DATA_SOURCES = [
    { id: 'licensed', name: 'Licensed data', q: 0.04, tech: null, desc: 'Paid news, books and code. Better quality, no lawsuits.' },
    { id: 'synthetic', name: 'Synthetic data', q: 0.03, tech: 'synthetic_data', desc: 'Your old models write textbooks for the new one.' },
    { id: 'human', name: 'Human feedback', q: 0.02, tech: 'rlhf', desc: 'Thousands of raters grade answers. Better manners, fewer scandals.' },
  ];

  // Rival labs around the Bay. Ids stay stable across versions; names changed in v0.2.
  const RIVALS = [
    { id: 'cortex', name: 'Embarcadero AI', model: 'Tide', color: '#2f6f95', cap0: 27, pace: 1.0, blurb: 'The incumbent on the waterfront. Ships early, ships often.' },
    { id: 'helix', name: 'Twin Peaks Research', model: 'Summit', color: '#8d62b0', cap0: 23, pace: 0.93, blurb: 'A careful research lab with a devoted following and a view of everything.' },
    { id: 'titan', name: 'Peninsula Cloud', model: 'Titan', color: '#c2553a', cap0: 21, pace: 0.88, blurb: 'A trillion-dollar giant from down the 101, playing catch-up.' },
    { id: 'open', name: 'Telegraph Collective', model: 'Commons', color: '#3f8f5f', cap0: 13, pace: 0.8, open: true, blurb: 'Berkeley grad students giving models away for free.' },
  ];

  const CAMPAIGNS = [
    { id: 'thread', name: 'Cryptic Hype Thread', cost: 0, hype: 3, cd: 12, desc: 'Post "feel the scaling" at 2am and let people guess.' },
    { id: 'influencer', name: 'Founder Podcast Tour', cost: 25000, hype: 7, cd: 20, desc: 'Three hours per show on the nature of intelligence.' },
    { id: 'launch', name: 'Launch Livestream', minOffice: 2, cost: 400000, hype: 12, cd: 30, desc: 'A live demo from the loft. Stronger within 30 days of a deploy.', deployBoost: true },
    { id: 'billboard', name: 'Billboards on the 101', minOffice: 3, cost: 1.2e6, hype: 14, cd: 40, desc: 'Every commuter between the city and San Jose reads your tagline.' },
    { id: 'keynote', name: 'Keynote at Moscone', minOffice: 4, cost: 3e6, hype: 18, cd: 45, desc: 'Black turtleneck, one slide, standing ovation.' },
    { id: 'bigad', name: 'Big Game TV Ad', minOffice: 5, cost: 20e6, hype: 28, cd: 120, desc: 'Sixty seconds in front of a hundred million people.' },
  ];
  // how many campaigns can run at once, by office: a bigger lab has a bigger marketing team
  const CAMPAIGN_SLOTS = [2, 2, 3, 3, 4, 4, 4];

  // Funding stages, raised in order. Raising is optional: investors buy a slice
  // of the company. want() is how close you are to what investors hope to see
  // at this stage (1 = exactly that); it decides how keen they are, not whether
  // you may pitch. dil: typical slice sold. min: smallest typical check.
  const ROUNDS = [
    { id: 'preseed', name: 'Pre-seed', dil: 0.1, min: 400e3, wantText: 'a working model', want: (s) => (s.models.length ? 1 : 0) },
    { id: 'seed', name: 'Seed', dil: 0.15, min: 1.5e6, wantText: '1,000 subscribers', want: (s) => s.subs / 1000 },
    { id: 'a', name: 'Series A', dil: 0.18, min: 5e6, wantText: 'OmniBench 28 or $150k a month in revenue', want: (s, v) => Math.max(v.bestCap / 28, v.mrr / 150e3) },
    { id: 'b', name: 'Series B', dil: 0.15, min: 30e6, wantText: 'OmniBench 40 or $1.5M a month in revenue', want: (s, v) => Math.max(v.bestCap / 40, v.mrr / 1.5e6) },
    { id: 'c', name: 'Series C', dil: 0.12, min: 150e6, wantText: 'OmniBench 50', want: (s, v) => v.bestCap / 50 },
    { id: 'd', name: 'Series D', dil: 0.1, min: 600e6, wantText: 'OmniBench 59', want: (s, v) => v.bestCap / 59 },
    { id: 'e', name: 'Strategic Round', dil: 0.08, min: 2e9, wantText: 'OmniBench 67', want: (s, v) => v.bestCap / 67 },
    { id: 'ipo', name: 'IPO', dil: 0.1, min: 10e9, wantText: 'OmniBench 75 and a $50B valuation', want: (s, v) => Math.min(v.bestCap / 75, v.valuation / 50e9) },
  ];

  // Who shows up when you pitch. val and size are ranges around a fair price
  // and a typical check. push shifts the odds when you ask for a better price.
  const INVESTORS = [
    { id: 'vc', kind: 'Top-tier VC', names: ['Lumen Ventures', 'Sand Hill Growth', 'Arcadia Partners', 'Northstar Ventures'], val: [0.95, 1.15], size: [1, 1.3], push: -0.1, perk: 'hype', perkText: 'A famous name on your cap table: hype +12 when you close.' },
    { id: 'fund', kind: 'Founder-friendly fund', names: ['First Light Fund', 'Kindling Capital', 'Fogline Seed', 'Long Game Partners'], val: [1.1, 1.3], size: [0.55, 0.8], push: 0.1, perk: null, perkText: 'A smaller check at a better price. You keep more of the company.' },
    { id: 'bigtech', kind: 'Big Tech partner', names: ['Titanium Cloud', 'Orbital Compute', 'Meridian Systems'], val: [0.75, 0.9], size: [0.8, 1.1], push: 0, perk: 'cloud', perkText: 'Throws in a year of free cloud compute.' },
  ];

  // Products beyond the chat app. market: share of the chat market size.
  // infer: serving cost per customer relative to a chat subscriber.
  const PRODUCTS = [
    { id: 'api', name: 'Developer API', tech: 'code_models', launch: 250e3, market: 0.03, price: 200, minPrice: 50, maxPrice: 500, infer: 6, desc: 'Developers pay monthly to build on your model. Each one needs more compute than a chat user.' },
    { id: 'images', name: 'Image Studio', tech: 'multimodal', launch: 2e6, market: 0.3, price: 10, minPrice: 3, maxPrice: 40, infer: 2, desc: 'A picture generator for everyone. Cheap plans and a huge audience.' },
    { id: 'voice', name: 'Voice Assistant', tech: 'voice', launch: 8e6, market: 0.15, price: 15, minPrice: 5, maxPrice: 40, infer: 3, desc: 'Talk to your model in real time, on phones and car dashboards.' },
    { id: 'agents', name: 'Agents', tech: 'agents', launch: 50e6, market: 0.05, price: 300, minPrice: 100, maxPrice: 1000, infer: 10, desc: 'Autonomous assistants that do real work for businesses. Expensive to run, lucrative to sell.' },
    { id: 'robots', name: 'Robotics Platform', tech: 'robotics', launch: 400e6, market: 0.004, price: 4000, minPrice: 1000, maxPrice: 12000, infer: 60, desc: 'Your model drives warehouse and home robots, licensed per robot per month.' },
  ];

  // Runway: a short roguelike run of 91-day quarters on a fixed clock. Each
  // quarter the board sets a revenue quota; miss it twice and you are out.
  const RUNWAY = {
    quarterDays: 91,
    quotas: [6e3, 20e3, 80e3, 200e3, 600e3, 1.2e6, 2e6, 3.5e6], // Q1 to Q8 (the IPO), then endless
    endlessGrowth: 1.6,
    strikes: 2, // misses before the board fires you
    downRound: 0.05, // share of your stake a down round costs after a miss
  };

  const DIFFICULTY = {
    relaxed: { name: 'Relaxed', cash: 100000, pace: 0.85, desc: 'Rivals move slower and you start with more money.' },
    normal: { name: 'Normal', cash: 75000, pace: 1, desc: 'The race as designed.' },
    hard: { name: 'Hard', cash: 50000, pace: 1.1, desc: 'Rivals move faster and money is tight.' },
  };

  // Kept per browser across runs.
  const ACHIEVEMENTS = [
    { id: 'first_light', name: 'First Light', desc: 'Deploy your first model.', check: (s) => !!s.flagshipId },
    { id: 'garage_done', name: 'Out of the Garage', desc: 'Leave the Outer Sunset garage.', check: (s) => s.officeLevel >= 1 },
    { id: 'cool_head', name: 'Cool Head', desc: 'Run 20 or more GPUs without overheating.', check: (s, v) => v.computeItems >= 20 && v.hotItems === 0 },
    { id: 'unicorn', name: 'Unicorn', desc: 'Reach a $1B valuation.', check: (s, v) => v.valuation >= 1e9 },
    { id: 'decacorn', name: 'Decacorn', desc: 'Reach a $10B valuation.', check: (s, v) => v.valuation >= 1e10 },
    { id: 'number_one', name: 'Number One', desc: 'Top the OmniBench leaderboard.', check: (s) => !!s.flags.wasSota },
    { id: 'full_house', name: 'Full House', desc: 'Employ 50 people.', check: (s) => s.staff.length >= 50 },
    { id: 'big_game', name: 'Prime Time', desc: 'Run a Big Game TV ad.', check: (s) => (s.campaignCd.bigad || 0) > 0 },
    { id: 'open_science', name: 'Open Science', desc: 'Open-source five models.', check: (s) => s.models.filter((m) => m.open).length >= 5 },
    { id: 'product_line', name: 'Product Line', desc: 'Launch every extra product.', check: (s) => PRODUCTS.every((p) => s.products && s.products[p.id] && s.products[p.id].live) },
    { id: 'ipo', name: 'Ringing the Bell', desc: 'Go public.', check: (s) => s.rounds.includes('ipo') },
    { id: 'hundred_million', name: 'Hundred Million', desc: 'Reach 100 million subscribers.', check: (s) => s.subs >= 1e8 },
    { id: 'survivor', name: 'Survivor', desc: 'Run out of cash and recover.', check: (s) => !!s.flags.recovered },
    { id: 'agi', name: 'The Finish Line', desc: 'Build AGI.', check: (s) => !!(s.over && s.over.win) },
    { id: 'safe_hands', name: 'Safe Hands', desc: 'Build AGI with alignment of 70 or more.', check: (s) => !!(s.over && s.over.win && s.over.ending === 'aligned') },
    { id: 'speedrun', name: 'Speedrun', desc: 'Build AGI before 2034.', check: (s) => !!(s.over && s.over.win && s.day < 11 * 365) },
    { id: 'island', name: 'Island Life', desc: 'Move onto Treasure Island.', check: (s) => s.officeLevel >= 6 },
    { id: 'bootstrapped', name: 'Bootstrapped', desc: 'Build AGI without selling any of the company.', check: (s) => !!(s.over && s.over.win && s.rounds.length === 0) },
    { id: 'hard_mode', name: 'Hard Mode Hero', desc: 'Build AGI on Hard.', check: (s) => !!(s.over && s.over.win && s.difficulty === 'hard') },
    { id: 'daily', name: 'Daily Grinder', desc: 'Finish a daily challenge.', check: (s) => !!(s.over && s.mode === 'daily') },
  ];

  const count = (s, type) => s.items.filter((i) => i.type === type).length;
  const hasSize = (s, id) => s.models.some((m) => m.size === id);

  // Guided goals. reward: { cash, hype, rp }.
  const GOALS = [
    { id: 'rig2', text: 'Place a second Gaming Rig', hint: 'Open Build, pick Gaming Rig, tap a free tile.', check: (s) => count(s, 'rig') >= 2 || s.items.some((i) => (ITEMS[i.type].pf || 0) > 1), reward: { cash: 2000 } },
    { id: 'train1', text: 'Train your first model', hint: 'Open Models and start a Tiny training run.', check: (s) => s.models.length >= 1, reward: { hype: 5 } },
    { id: 'deploy1', text: 'Deploy a model to the public', hint: 'In Models, press Deploy on your new model.', check: (s) => !!s.flagshipId, reward: { cash: 5000 } },
    { id: 'hire1', text: 'Hire your first employee', hint: 'Build a desk, then hire from Team.', check: (s) => s.staff.length >= 2, reward: { rp: 5 } },
    { id: 'subs500', text: 'Reach 500 subscribers', hint: 'Keep your model deployed and your GPUs cool.', check: (s) => s.subs >= 500, reward: { hype: 5 } },
    { id: 'preseed', text: 'Fund your lab', hint: 'Pitch investors in Finance, or grow on revenue to $150k in the bank.', check: (s) => s.rounds.length > 0 || s.cash >= 150e3, reward: { hype: 5 } },
    { id: 'scaling', text: 'Research Scaling Laws', hint: 'Open Research. Researchers earn RP every day.', check: (s) => !!s.techs.scaling_laws, reward: { rp: 10 } },
    { id: 'loft', text: 'Move into the Mission', hint: 'Research Scaling Laws, then raise money or reach 500 subscribers. Real estate is on the left.', check: (s) => s.officeLevel >= 1, reward: { hype: 5 } },
    { id: 'small', text: 'Train a Small model', hint: 'About 6,000 PF-days of compute, plus $25k to $175k of training data. Keep cash for the data.', check: (s) => hasSize(s, 'small'), reward: { cash: 50000 } },
    { id: 'soma', text: 'Move into a SoMa loft', hint: 'More power, more room and space for a real team.', check: (s) => s.officeLevel >= 2, reward: { hype: 6 } },
    { id: 'subs10k', text: 'Reach 10,000 subscribers', hint: 'A better model and some hype will do it.', check: (s) => s.subs >= 10000, reward: { hype: 8 } },
    { id: 'seriesa', text: 'Build a $2M war chest', hint: 'Raise a round in Finance or earn it. Mission Bay costs $1.2M to move into.', check: (s) => s.cash >= 2e6 || s.officeLevel >= 3, reward: { rp: 40 } },
    { id: 'floor', text: 'Move into Mission Bay', hint: 'Unlocks 8-GPU Servers, chillers and substations.', check: (s) => s.officeLevel >= 3, reward: { hype: 8 } },
    { id: 'sota', text: 'Top the OmniBench leaderboard', hint: 'Deploy a model that beats every rival.', check: (s) => !!s.flags.wasSota, reward: { hype: 10 } },
    { id: 'mrr1m', text: 'Reach $1M monthly revenue', hint: 'Subscribers x price, plus products and enterprise deals.', check: (s) => s.stats.peakMrr >= 1e6, reward: { rp: 150 } },
    { id: 'campus', text: 'Move into the Financial District', hint: 'Unlocks GPU Racks.', check: (s) => s.officeLevel >= 4, reward: { hype: 10 } },
    { id: 'xl', text: 'Train an XL model', hint: 'Research Sparse Scaling first.', check: (s) => hasSize(s, 'xl'), reward: { rp: 400 } },
    { id: 'presidio', text: 'Move into the Presidio', hint: 'Unlocks SuperPods and gas turbines.', check: (s) => s.officeLevel >= 5, reward: { hype: 10 } },
    { id: 'frontier', text: 'Train a Frontier model', hint: 'Research Frontier Scaling first.', check: (s) => hasSize(s, 'frontier'), reward: { rp: 1500 } },
    { id: 'hyper', text: 'Move onto Treasure Island', hint: 'The last office. Bring a lot of money.', check: (s) => s.officeLevel >= 6, reward: { hype: 10 } },
    { id: 'blueprint', text: 'Unlock the AGI Blueprint', hint: 'The final research.', check: (s) => !!s.techs.agi_theory, reward: { hype: 15 } },
    { id: 'agi', text: 'Achieve AGI before any rival', hint: 'Start the AGI Project from Models.', check: (s) => hasSize(s, 'agi'), reward: {} },
  ];

  const FIRST_NAMES = ['Ada', 'Kenji', 'Priya', 'Mateo', 'Amara', 'Lin', 'Omar', 'Sofia', 'Ravi', 'Chloe', 'Tomás', 'Yuki', 'Noor', 'Elena', 'Kwame', 'Mei', 'Diego', 'Aisha', 'Lukas', 'Zara', 'Ibrahim', 'Hana', 'Felix', 'Leila', 'Arjun', 'Inès', 'Jonas', 'Fatima', 'Nikolai', 'Rosa', 'Sam', 'Taylor', 'Jordan', 'Alex', 'Riley', 'Morgan', 'Wei', 'Oluwa', 'Camila', 'Anya'];
  const LAST_NAMES = ['Okafor', 'Tanaka', 'Sharma', 'Garcia', 'Nakamura', 'Chen', 'Haddad', 'Rossi', 'Iyer', 'Martin', 'Silva', 'Kim', 'Rahman', 'Petrova', 'Mensah', 'Wang', 'Lopez', 'Bello', 'Schmidt', 'Ali', 'Novak', 'Park', 'Costa', 'Dubois', 'Kowalski', 'Ito', 'Nguyen', 'Moreau', 'Adeyemi', 'Singh', 'Fischer', 'Morales', 'Yilmaz', 'Lindqvist', 'Abara', 'Castillo', 'Sato', 'Mehta', 'Hughes', 'Osei'];

  AIT.DATA = {
    START_DATE, TUNING, OFFICES, ITEMS, ITEM_CATS, ROLES, TECHS, MODEL_SIZES, DATA_SOURCES,
    RIVALS, CAMPAIGNS, CAMPAIGN_SLOTS, ROUNDS, INVESTORS, GOALS, FIRST_NAMES, LAST_NAMES, PRODUCTS, DIFFICULTY, ACHIEVEMENTS, RUNWAY,
    TECH_BY_ID: Object.fromEntries(TECHS.map((t) => [t.id, t])),
    SIZE_BY_ID: Object.fromEntries(MODEL_SIZES.map((m) => [m.id, m])),
  };
})(typeof window !== 'undefined' ? window : globalThis);
