/* Random events. Modal events pause the game and ask for a decision; the rest
   apply immediately and show up in the news feed. All randomness goes through
   U().random() so seeded games replay the same way. */
(function (root) {
  const AIT = (root.AIT = root.AIT || {});

  const S = () => AIT.Sim;
  const U = () => AIT.Sim.util;
  const money = (n) => AIT.fmt ? AIT.fmt.money(n) : '$' + Math.round(n);
  const openRival = (s) => s.rivals.find((r) => S().RIVAL_BY_ID[r.id].open);
  const closedRivals = (s) => s.rivals.filter((r) => !S().RIVAL_BY_ID[r.id].open);
  const hasBackup = (v) => !!(v.counts.battery || v.counts.turbine || v.counts.smr);
  const CLIENTS = ['Sutro Savings Bank', 'Lands End Health', 'Bayshore Freight', 'Fort Point Insurance', 'Marina Green Retail', 'Portola Aerospace', 'Kearny & Pine LLP', 'Mission Rock Pharma', 'Tamalpais Telecom', 'Cable Car Media', 'Hunters Point Robotics', 'Fogbank Security'];

  const EVENTS = [
    {
      id: 'gpu_shortage', cd: 300, kind: 'warn',
      weight: (s) => (s.day > 60 ? 0.6 : 0),
      run: (s) => {
        S().addEffect(s, 'hwPrice', 1.6, 60, 'GPU shortage');
        return 'GPU shortage: every lab in the Bay is bidding for the same chips. Compute hardware costs 60% more for the next 60 days.';
      },
    },
    {
      id: 'chip_sale', cd: 300, kind: 'good',
      weight: (s) => (s.day > 90 ? 0.5 : 0),
      run: (s) => {
        S().addEffect(s, 'hwPrice', 0.8, 90, 'New chip generation');
        return 'A new chip generation launched on stage at Moscone. Compute hardware is 20% cheaper for 90 days.';
      },
    },
    {
      id: 'viral', cd: 90, kind: 'good',
      weight: (s, v) => (v.flagship ? 0.8 : 0),
      run: (s, v) => {
        s.hype = Math.min(100, s.hype + 12);
        return `A clip of ${v.flagship.name} explaining Muni delays as a pirate went viral. Hype +12.`;
      },
    },
    {
      id: 'ceo_post', cd: 60,
      weight: (s, v) => (v.flagship ? 0.6 : 0),
      run: (s, v) => {
        if (U().random() < 0.55) {
          s.hype = Math.min(100, s.hype + 8);
          return `A famous founder called ${v.flagship.name} "genuinely useful," and half of SoMa reposted it. Hype +8.`;
        }
        s.hype = Math.max(0, s.hype - 5);
        return `A famous founder called ${v.flagship.name} "mid" on a podcast recorded in Palo Alto. Hype -5.`;
      },
    },
    {
      id: 'outage', cd: 150, kind: 'warn',
      weight: (s) => (s.day > 30 ? 0.5 : 0),
      run: (s, v) => {
        if (hasBackup(v)) return 'The utility lost a substation and half the city went dark. Your backup power kept every GPU running.';
        S().addEffect(s, 'compute', 0.4, 3, 'Power outage');
        return 'The utility cut power to your block. Most of your compute is down for 3 days. Battery walls prevent this.';
      },
    },
    {
      id: 'heatwave', cd: 200, kind: 'warn',
      weight: (s) => {
        const m = S().dateOf(s.day).getUTCMonth();
        return m >= 5 && m <= 7 ? 1.2 : 0;
      },
      run: (s) => {
        S().addEffect(s, 'cooling', 0.75, 12, 'Heat dome');
        return 'A heat dome settled over the Bay and even the fog left town. Cooling is 25% weaker for 12 days. Watch your temperatures.';
      },
    },
    {
      id: 'fog', cd: 200, kind: 'good',
      // Karl mostly shows up in summer, but he visits all year.
      weight: (s) => {
        if (s.day <= 45) return 0;
        const m = S().dateOf(s.day).getUTCMonth();
        return m >= 4 && m <= 8 ? 0.45 : 0.15;
      },
      run: (s) => {
        S().addEffect(s, 'cooling', 1.25, 14, 'Fog');
        return 'Karl the Fog rolled in off Ocean Beach and parked over the city. Cooling +25% for 14 days.';
      },
    },
    {
      id: 'quake', cd: 300, kind: 'warn',
      weight: (s) => (s.day > 45 ? 0.25 : 0),
      run: (s, v) => {
        const mag = U().rand(3.6, 4.9).toFixed(1);
        if (hasBackup(v)) return `A magnitude ${mag} earthquake rattled the city. The lights flickered, your backup power held, and everyone posted "was that a quake?"`;
        S().addEffect(s, 'compute', 0.7, 2, 'Earthquake');
        return `A magnitude ${mag} earthquake tripped breakers all over the lab. Compute is 30% lower for 2 days while you reset everything. Battery walls prevent this.`;
      },
    },
    {
      id: 'fire', cd: 30, kind: 'bad',
      weight: (s, v) => (v.thermal < 0.8 && v.pf > 0 ? 3 : 0),
      run: (s) => {
        const hot = s.items.filter((i) => AIT.DATA.ITEMS[i.type].cat === 'compute');
        if (!hot.length) return null;
        const it = U().pick(hot);
        s.items = s.items.filter((i) => i !== it);
        return `An overheating ${AIT.DATA.ITEMS[it.type].name} caught fire and was destroyed. The firefighters from down the street were very nice about it. Add more cooling.`;
      },
    },
    {
      id: 'open_leap', cd: 200, kind: 'warn',
      weight: (s) => (s.day > 120 ? 0.4 : 0),
      run: (s) => {
        const r = openRival(s);
        const def = S().RIVAL_BY_ID[r.id];
        const top = Math.max(...closedRivals(s).map((c) => c.cap));
        r.cap = Math.max(r.cap, U().round1(Math.min(top - 2, r.cap + U().rand(4, 8))));
        r.version++;
        return `${def.name} surprise-dropped ${def.model}-${r.version} (OmniBench ${r.cap.toFixed(1)}) from a basement in Berkeley. Free models just got better.`;
      },
    },
    {
      id: 'bubble', cd: 200, kind: 'bad',
      weight: (s) => (s.sentiment > 1.3 ? 0.8 : 0),
      run: (s) => {
        s.sentiment = Math.max(0.45, s.sentiment - 0.3);
        return 'Analysts are calling AI a bubble, and the old-timers in SoMa keep saying "1999." Market sentiment drops and valuations wobble.';
      },
    },
    {
      id: 'boom', cd: 150, kind: 'good',
      weight: () => 0.5,
      run: (s) => {
        s.sentiment = Math.min(1.8, s.sentiment + 0.15);
        return 'A new report says AI could add trillions to the economy. Sand Hill Road is excited again.';
      },
    },
    {
      id: 'hackathon', cd: 180, kind: 'good',
      weight: (s) => (s.staff.length >= 2 ? 0.4 : 0),
      run: (s) => {
        const rp = Math.max(10, Math.round(s.rp * 0.1 + 20 * (1 + s.officeLevel * 2)));
        s.rp += rp;
        S().refreshCandidates(s);
        return `You hosted a weekend hackathon: forty strangers, sixty pizzas and one clever new trick. +${rp} RP, and a few of the best hackers want jobs.`;
      },
    },
    {
      id: 'star', cd: 250, kind: 'good',
      weight: (s) => (s.day > 200 ? 0.3 : 0),
      run: (s) => {
        const role = U().random() < 0.6 ? 'researcher' : 'engineer';
        const c = S().makeCandidate(s, role, U().randi(9, 10));
        c.salary = Math.round(c.salary * 1.3);
        c.star = true;
        s.candidates.unshift(c);
        return `A legendary ${role}, ${c.name}, just left a big lab down the Peninsula and is taking meetings in the city. Check Team this week.`;
      },
    },
    {
      id: 'leak', cd: 300, kind: 'warn',
      weight: (s, v) => (v.flagship && v.flagship.cap >= 20 ? 0.25 : 0),
      run: (s, v) => {
        const r = openRival(s);
        r.cap = Math.max(r.cap, U().round1(v.flagship.cap - 4));
        s.hype = Math.min(100, s.hype + 5);
        return `Someone left a laptop with the weights of ${v.flagship.name} in a SoMa bar, and now they are on every forum. Open models got a boost, and so did your fame.`;
      },
    },
    {
      id: 'energy', cd: 300, kind: 'warn',
      weight: (s) => (s.day > 180 ? 0.35 : 0),
      run: (s) => {
        S().addEffect(s, 'energy', 1.8, 60, 'Energy crisis');
        return 'After a dry winter, the utility raised its rates. Your power bill is 80% higher for 60 days.';
      },
    },
    {
      id: 'agi_rumor', cd: 200, kind: 'warn',
      weight: (s, v) => (v.topRival && v.topRival.cap >= 80 ? 0.5 : 0),
      run: (s, v) => {
        s.sentiment = Math.min(1.8, s.sentiment + 0.1);
        s.hype = Math.max(0, s.hype - 4);
        return `The rumor in every Valencia Street bar: ${S().RIVAL_BY_ID[v.topRival.id].name} has something close to AGI in the lab.`;
      },
    },

    // ---------- decisions ----------
    {
      id: 'jailbreak', cd: 100, modal: true, kind: 'bad',
      weight: (s, v) => (v.flagship ? 1.0 * v.scandalMult * (v.flagship.human ? 0.6 : 1) : 0),
      make: (s, v) => ({ model: v.flagship.name, cost: Math.max(5000, Math.round(v.mrr * 0.3)) }),
      title: () => 'Jailbreak scandal',
      body: (s, p) => `Users tricked ${p.model} into writing a step-by-step guide to hopping BART fare gates. Screenshots are everywhere and reporters want a comment.`,
      choices: (s, p) => [
        {
          label: 'Patch it and apologize', note: `Costs ${money(p.cost)}, hype -3, alignment +3`,
          run: (s) => {
            S().align(s, 3);
            s.cash -= p.cost;
            s.month.other += p.cost;
            s.hype = Math.max(0, s.hype - 3);
            return 'You shipped a fix within 48 hours. The internet moved on to a video of the Pier 39 sea lions.';
          },
        },
        {
          label: 'Call it a feature', note: 'Hype +6, alignment -8, may upset regulators',
          run: (s) => {
            S().align(s, -8);
            s.hype = Math.min(100, s.hype + 6);
            if (U().random() < 0.5) {
              S().addEffect(s, 'market', 0.9, 60, 'Regulator scrutiny');
              return 'Regulators in Sacramento were not amused. New scrutiny shrinks the market 10% for 60 days.';
            }
            return 'The edgy reply played well online. Nobody important noticed.';
          },
        },
        {
          label: 'Say nothing', note: 'Hype -10, lose 5% of subscribers, alignment -4',
          run: (s) => {
            S().align(s, -4);
            s.hype = Math.max(0, s.hype - 10);
            s.subs *= 0.95;
            return 'Silence read as guilt. Some subscribers cancelled.';
          },
        },
      ],
    },
    {
      id: 'lawsuit', cd: 365, modal: true, kind: 'bad',
      weight: (s) => (s.models.some((m) => m.scraped && m.cap >= 18) ? 0.5 : 0),
      make: (s, v) => ({ amount: Math.round(Math.max(50000, Math.min(v.valuation * 0.006, v.mrr * 4)) / 1000) * 1000, plaintiff: U().pick(['The Bay Ledger', 'a group of Bay Area novelists', 'a stock photo giant', 'a music label coalition']) }),
      title: () => 'Copyright lawsuit',
      body: (s, p) => `${p.plaintiff[0].toUpperCase() + p.plaintiff.slice(1)} is suing ${s.company} in federal court on Golden Gate Avenue for training on scraped data without permission. They will settle for ${money(p.amount)}. Licensed data prevents this.`,
      choices: (s, p) => [
        {
          label: 'Settle', note: `Pay ${money(p.amount)}`,
          run: (s) => {
            s.cash -= p.amount;
            s.month.other += p.amount;
            return `You settled with ${p.plaintiff}.`;
          },
        },
        {
          label: 'Fight it in court', note: `55% win. Lose: pay ${money(p.amount * 2.5)}, hype -6`,
          run: (s) => {
            if (U().random() < 0.55) {
              s.hype = Math.min(100, s.hype + 4);
              return 'The judge ruled your training was fair use. Hype +4.';
            }
            s.cash -= p.amount * 2.5;
            s.month.other += p.amount * 2.5;
            s.hype = Math.max(0, s.hype - 6);
            return `You lost the case and paid ${money(p.amount * 2.5)} in damages.`;
          },
          kind: 'warn',
        },
      ],
    },
    {
      id: 'poach', cd: 90, modal: true, kind: 'warn',
      weight: (s) => (s.staff.some((p) => !p.founder && p.skill >= 5) ? 0.7 : 0),
      make: (s) => {
        const top = s.staff.filter((p) => !p.founder).sort((a, b) => b.skill - a.skill)[0];
        return { staffId: top.id, name: top.name, rival: U().pick(closedRivals(s)).id, salary: top.salary };
      },
      title: () => 'Poaching attempt',
      body: (s, p) => `${S().RIVAL_BY_ID[p.rival].name} offered ${p.name} twice their current salary and a signing bonus big enough for a condo in Noe Valley. They are tempted.`,
      choices: (s, p) => [
        {
          label: 'Counter-offer', note: `Salary +40% (to ${money(p.salary * 1.4)}/mo), morale up`,
          run: (s) => {
            const st = s.staff.find((x) => x.id === p.staffId);
            if (!st) return null;
            st.salary = Math.round(st.salary * 1.4);
            st.perk = (st.perk || 0) + 20;
            st.morale = Math.min(100, st.morale + 20);
            return `${p.name} is staying.`;
          },
        },
        {
          label: 'Wish them well', note: 'They leave and help a rival',
          run: (s) => {
            s.staff = s.staff.filter((x) => x.id !== p.staffId);
            const r = s.rivals.find((x) => x.id === p.rival);
            if (r) r.progress += 0.08;
            return `${p.name} left for ${S().RIVAL_BY_ID[p.rival].name}.`;
          },
          kind: 'warn',
        },
      ],
    },
    {
      id: 'transit_strike', cd: 400, modal: true, kind: 'warn',
      weight: (s) => (s.day > 45 && s.staff.length >= 3 ? 0.3 : 0),
      make: (s) => ({ staff: s.staff.length, cost: s.staff.length * 400 }),
      title: () => 'BART and Muni strike',
      body: (s, p) => `BART and Muni workers walked out this morning, and nobody knows for how long. Most of your ${p.staff} people live across the bay or out in the Avenues.`,
      choices: (s, p) => [
        {
          label: 'Pay for rideshares', note: `Costs ${money(p.cost)}, morale unaffected`,
          run: (s) => {
            s.cash -= p.cost;
            s.month.other += p.cost;
            return 'You covered rides all week. Everyone got in on time, a little carsick from the hills.';
          },
        },
        {
          label: 'Work from home for a week', note: 'Everyone loses 10 morale',
          run: (s) => {
            for (const st of s.staff) st.morale = U().clamp(st.morale - 10, 0, 100);
            return 'Everyone worked from home for a week. The code held up. Morale did not.';
          },
          kind: 'warn',
        },
      ],
    },
    {
      id: 'conference', cd: 300, modal: true, kind: 'good',
      weight: (s) => (s.day > 45 && s.officeLevel >= 2 ? 0.35 : 0),
      make: (s) => ({ cost: Math.round((40000 * Math.pow(3, s.officeLevel - 1)) / 1000) * 1000 }),
      title: () => 'Conference week at Moscone',
      body: (s, p) => `The biggest AI conference of the year has taken over Moscone Center and every hotel south of Market. A booth on the main floor costs ${money(p.cost)}.`,
      choices: (s, p) => [
        {
          label: 'Sponsor a booth', note: `Costs ${money(p.cost)}, hype +10, fresh job candidates`,
          run: (s) => {
            s.cash -= p.cost;
            s.month.marketing += p.cost;
            s.hype = Math.min(100, s.hype + 10);
            S().refreshCandidates(s);
            return 'Your booth had the longest line at Moscone and the best stickers. Hype +10, and you came home with a stack of resumes.';
          },
          kind: 'good',
        },
        { label: 'Skip it', note: 'Keep the money', run: () => 'You skipped the conference. Half the team went anyway for the free coffee.' },
      ],
    },
    {
      id: 'rent_hike', cd: 540, modal: true, kind: 'warn',
      weight: (s) => (s.day > 45 && s.officeLevel >= 1 ? 0.3 : 0),
      make: (s) => {
        const office = AIT.DATA.OFFICES[s.officeLevel];
        return { rent: office.rent, place: office.place };
      },
      title: () => 'Rent hike',
      body: (s, p) => `Your landlord in ${p.place} wants 20% more rent, citing "the market" and a fresh coat of paint. You can lock in today's rate with a longer lease if you pay three months up front.`,
      choices: (s, p) => [
        {
          label: 'Sign a longer lease', note: `Pay ${money(p.rent * 3)} now, rent stays the same`,
          run: (s) => {
            s.cash -= p.rent * 3;
            s.month.rent += p.rent * 3;
            return 'You signed a longer lease at the old rate. The landlord seemed a little disappointed.';
          },
        },
        {
          label: 'Accept the increase', note: 'Rent +20% for a year',
          run: (s) => {
            S().addEffect(s, 'rent', 1.2, 365, 'Rent hike');
            return 'Your rent is 20% higher for the next year. The landlord sent a nice card.';
          },
          kind: 'warn',
        },
      ],
    },
    {
      id: 'hearing', cd: 400, modal: true, kind: 'warn',
      weight: (s, v) => (v.bestCap >= 40 ? 0.45 : 0),
      make: (s, v) => ({ lobby: U().clamp(Math.round(v.valuation * 0.002), 1e6, 500e6) }),
      title: () => 'Senate hearing on AI',
      body: (s) => `Lawmakers want the CEO of ${s.company} to fly to Washington and testify about AI risk. The cameras will be rolling, and you will have to wear real shoes.`,
      choices: (s, p) => [
        {
          label: 'Testify and cooperate', note: (s.techs.interpretability ? 'Hype +8 (your interpretability work impresses)' : 'Hype +4, sentiment dips slightly') + ', alignment +6',
          run: (s) => {
            S().align(s, 6);
            s.hype = Math.min(100, s.hype + (s.techs.interpretability ? 8 : 4));
            s.sentiment = Math.max(0.45, s.sentiment - 0.03);
            return 'Your calm testimony earned respect on both sides of the aisle.';
          },
        },
        {
          label: 'Hire lobbyists', note: `Costs ${money(p.lobby)}, alignment -4`,
          run: (s) => {
            S().align(s, -4);
            s.cash -= p.lobby;
            s.month.other += p.lobby;
            return 'The proposed AI bill quietly stalled in committee.';
          },
        },
        {
          label: 'Skip the hearing', note: 'Hype -8, market -15% for 120 days, alignment -10',
          run: (s) => {
            S().align(s, -10);
            s.hype = Math.max(0, s.hype - 8);
            S().addEffect(s, 'market', 0.85, 120, 'New AI rules');
            return 'Lawmakers passed strict new rules without you. Adoption slows for a while.';
          },
          kind: 'bad',
        },
      ],
    },
    {
      id: 'bigtech', cd: 365, modal: true, kind: 'good',
      weight: (s, v) => (v.bestCap >= 30 && !s.flags.partner ? 0.6 : 0),
      make: (s, v) => ({ cash: Math.round(v.valuation * 0.1), pf: Math.max(50, Math.round(v.effPF * 0.6)) }),
      title: () => 'Big Tech partnership',
      body: (s, p) => `Orbital Compute, a cloud giant down the 101, wants a strategic partnership: ${money(p.cash)} in cash plus ${AIT.fmt ? AIT.fmt.pf(p.pf) : p.pf + ' PF'} of cloud compute for one year. In exchange they take 10% of ${s.company}.`,
      choices: (s, p) => [
        {
          label: 'Take the deal', note: `+${money(p.cash)}, +cloud compute, -10% equity`,
          run: (s) => {
            s.cash += p.cash;
            s.month.funding += p.cash;
            s.equity *= 0.9;
            s.cloud = { pf: p.pf, until: s.day + 365 };
            s.flags.partner = true;
            return 'Partnership signed. Cloud compute is online.';
          },
          kind: 'good',
        },
        {
          label: 'Stay independent', note: 'Hype +3',
          run: (s) => {
            s.hype = Math.min(100, s.hype + 3);
            return 'You turned down Orbital Compute. The city loves an underdog.';
          },
        },
      ],
    },
    {
      id: 'enterprise', cd: 45, modal: true, kind: 'good',
      weight: (s, v) => (v.flagship && (s.techs.code_models || v.flagship.cap >= 28) && s.contracts.length < 4 ? 0.9 : 0),
      make: (s, v) => {
        const months = U().randi(6, 18);
        return {
          client: U().pick(CLIENTS.filter((c) => !s.contracts.some((k) => k.client === c))),
          monthly: Math.round(Math.max(30000, v.subRevenue * U().rand(0.12, 0.3)) / 1000) * 1000,
          months,
          pf: Math.max(1, Math.round(v.serveNeed * U().rand(0.08, 0.2) * 10) / 10),
        };
      },
      title: () => 'Enterprise deal',
      body: (s, p, v) => `${p.client} wants ${v.flagship ? v.flagship.name : 'your model'} deployed company-wide: ${money(p.monthly)} per month for ${p.months} months. Serving them needs ${AIT.fmt ? AIT.fmt.pf(p.pf) : p.pf + ' PF'} of compute. Frequent outages will cancel the deal.`,
      choices: (s, p) => [
        {
          label: 'Sign the contract', note: `+${money(p.monthly)}/mo`,
          run: (s) => {
            s.contracts.push({ client: p.client, monthly: p.monthly, pf: p.pf, until: s.day + p.months * 30, strikes: 0 });
            return `Signed a ${p.months}-month deal with ${p.client}.`;
          },
          kind: 'good',
        },
        { label: 'Pass', note: 'Keep your compute free', run: () => null },
      ],
    },
    {
      id: 'data_deal', cd: 300, modal: true, kind: 'info',
      weight: (s, v) => (v.flagship && !s.flags.dataDeal ? 0.3 : 0),
      make: (s, v) => ({ cost: Math.round(U().clamp(v.mrr * 1.5, 20000, 400e6) / 1000) * 1000 }),
      title: () => 'Data for sale',
      body: (s, p) => `A struggling social network with an empty office on Market Street offers ten years of posts for training, for ${money(p.cost)}. It would make your next model about 3% smarter.`,
      choices: (s, p) => [
        {
          label: 'Buy the data', note: `Costs ${money(p.cost)}, alignment -3`,
          run: (s) => {
            S().align(s, -3);
            s.cash -= p.cost;
            s.month.data += p.cost;
            s.flags.dataDeal = true;
            return 'Data acquired. Your next model will benefit.';
          },
        },
        { label: 'Decline', note: 'No thanks', run: () => null },
      ],
    },

    // ---------- rivals that act ----------
    {
      id: 'free_tier', cd: 300, kind: 'warn',
      weight: (s, v) => (s.day > 300 && v.flagship ? 0.35 : 0),
      run: (s) => {
        const r = U().pick(closedRivals(s));
        r.boost = { mult: 1.3, until: s.day + 60 };
        return `${S().RIVAL_BY_ID[r.id].name} made its model free for two months and wrapped every Muni bus in ads. Expect some of your users to wander off.`;
      },
    },
    {
      id: 'price_war', cd: 400, modal: true, kind: 'warn',
      weight: (s, v) => (v.flagship && s.share > 0.12 && s.day > 400 ? 0.5 : 0),
      make: (s, v) => {
        const r = U().pick(closedRivals(s));
        r.boost = { mult: 1.4, until: s.day + 120 };
        return { rival: r.id, cost: Math.max(25000, Math.round(v.mrr * 0.5 / 1000) * 1000), price: Math.max(5, Math.round(s.price * 0.75)) };
      },
      title: () => 'Price war',
      body: (s, p) => `${S().RIVAL_BY_ID[p.rival].name} just cut its prices by 40% to take your users, and the billboards on the 101 already say so. The cut lasts about four months.`,
      choices: (s, p) => [
        {
          label: 'Match their price', note: `Your price drops to $${p.price}/mo. You keep more users but earn less from each`,
          run: (s) => {
            S().actions.setPrice(s, p.price);
            return `You cut your price to $${p.price}/mo.`;
          },
        },
        {
          label: 'Answer with a campaign', note: `Costs ${money(p.cost)}, hype +10`,
          run: (s) => {
            s.cash -= p.cost;
            s.month.marketing += p.cost;
            s.hype = Math.min(100, s.hype + 10);
            return 'Your campaign reminded everyone why they pay for your model.';
          },
        },
        { label: 'Hold your price', note: 'Some users will leave for a while', run: () => 'You held your price and waited it out.' },
      ],
    },
    {
      id: 'rival_suit', cd: 500, modal: true, kind: 'bad',
      weight: (s, v) => (v.flagship && v.topRival && v.flagship.cap > v.topRival.cap && s.day > 600 ? 0.4 : 0),
      make: (s, v) => {
        const r = closedRivals(s).reduce((a, x) => (x.cap > a.cap ? x : a));
        return { rival: r.id, amount: Math.round(U().clamp(v.valuation * 0.004, 1e6, 5e9) / 1000) * 1000 };
      },
      title: () => 'Patent lawsuit',
      body: (s, p) => `${S().RIVAL_BY_ID[p.rival].name} says your training method copies one of its patents and wants ${money(p.amount)}. Its lawyers filed before lunch and posted about it after. It looks like a way to slow you down.`,
      choices: (s, p) => [
        {
          label: 'Settle', note: `Pay ${money(p.amount)}`,
          run: (s) => {
            s.cash -= p.amount;
            s.month.other += p.amount;
            return `You settled with ${S().RIVAL_BY_ID[p.rival].name}.`;
          },
        },
        {
          label: 'Fight it', note: `50% win and hype +4. Lose: pay ${money(p.amount * 3)}`,
          run: (s) => {
            if (U().random() < 0.5) {
              s.hype = Math.min(100, s.hype + 4);
              return 'The court threw the case out. The press loved it.';
            }
            s.cash -= p.amount * 3;
            s.month.other += p.amount * 3;
            return `You lost the patent case and paid ${money(p.amount * 3)}.`;
          },
          kind: 'warn',
        },
      ],
    },

    // ---------- regulation ----------
    {
      id: 'ai_act', cd: 99999, modal: true, kind: 'warn',
      weight: (s, v) => (v.bestCap >= 45 && s.day > 900 ? 0.6 : 0),
      make: (s, v) => ({ lobby: Math.round(U().clamp(v.valuation * 0.003, 2e6, 1e9) / 1000) * 1000 }),
      title: () => 'The AI Safety Act',
      body: () => 'Congress proposes audits for every frontier model before release. The labs around the Bay are split, and everyone wants to know where you stand.',
      choices: (s, p) => [
        {
          label: 'Support it publicly', note: 'Alignment +12, hype +3, audits slow the market 5% for a year',
          run: (s) => {
            S().align(s, 12);
            s.hype = Math.min(100, s.hype + 3);
            S().addEffect(s, 'market', 0.95, 365, 'AI Safety Act audits');
            return 'The AI Safety Act passed with your support. Audits are now part of every launch.';
          },
        },
        {
          label: 'Lobby against it', note: `Costs ${money(p.lobby)}, alignment -6, may still pass`,
          run: (s) => {
            S().align(s, -6);
            s.cash -= p.lobby;
            s.month.other += p.lobby;
            if (U().random() < 0.5) return 'Your lobbyists killed the bill. Safety researchers are not happy with you.';
            S().addEffect(s, 'market', 0.92, 180, 'AI Safety Act');
            return 'The bill passed anyway, and lawmakers remember who fought it.';
          },
          kind: 'warn',
        },
        {
          label: 'Stay quiet', note: 'Alignment -3, it will probably pass',
          run: (s) => {
            S().align(s, -3);
            if (U().random() < 0.7) {
              S().addEffect(s, 'market', 0.9, 180, 'AI Safety Act');
              return 'The AI Safety Act passed. Compliance slows adoption for a while.';
            }
            return 'The bill stalled without you.';
          },
        },
      ],
    },
  ];

  AIT.EVENTS = EVENTS;
})(typeof window !== 'undefined' ? window : globalThis);
