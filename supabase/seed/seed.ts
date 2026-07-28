/**
 * Orbit seed.
 *
 * Deterministic: the same run produces the same UUIDs and the same data, so a
 * screenshot from last session still matches this session's database.
 *
 * Connects as `orbit_seed`, which has BYPASSRLS. That role exists only for this
 * file. The application never uses it — see src/lib/db/index.ts.
 *
 *   pnpm seed
 */
import postgres from 'postgres';

const SEED_DATABASE_URL =
  process.env.SEED_DATABASE_URL ??
  'postgres://orbit_seed:orbit_dev_password@localhost:5432/orbit';

const sql = postgres(SEED_DATABASE_URL, { max: 4, onnotice: () => {} });

// --- deterministic helpers -------------------------------------------------

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(20260727);
const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)]!;
const chance = (p: number) => rnd() < p;
const int = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1));

/** Stable UUIDs from a namespace and an index, so reruns keep the same ids. */
let uuidCounter = 0;
function uid(): string {
  uuidCounter += 1;
  const h = uuidCounter.toString(16).padStart(12, '0');
  return `00000000-0000-4000-8000-${h}`;
}

const DAY = 86_400_000;
const today = new Date('2026-07-27T00:00:00Z');
const dayOffset = (n: number) => new Date(today.getTime() + n * DAY);
const isoDate = (d: Date) => d.toISOString().slice(0, 10);
const at = (n: number, hour: number, minute = 0) => {
  const d = dayOffset(n);
  d.setUTCHours(hour, minute, 0, 0);
  return d;
};

// --- the cast --------------------------------------------------------------

const PRIYA = uid();
const DANNY = uid();

/**
 * The outsider. A member of nothing, on purpose.
 *
 * pgTAP proves that an outsider sees zero rows; this profile is what lets you
 * prove the same thing *through the running app*, over HTTP, in one click of
 * the dev user switcher. Its id is a literal rather than a uid() call so that
 * adding it does not shift every other seeded id.
 */
const OUTSIDER = '00000000-0000-4000-8000-0000000000ff';

const S_PRIYA = uid();   // Priya's personal space
const S_HOME = uid();    // the household space, shared with Danny
const S_WORK = uid();    // Priya's work space — Danny is free/busy here only
const S_DANNY = uid();   // Danny's own personal space

// --- content banks ---------------------------------------------------------

const SURNAMES = [
  'Ahmed', 'Bevan', 'Byrne', 'Chauhan', 'Cottrell', 'Dhillon', 'Doyle', 'Fletcher',
  'Griffiths', 'Hussain', 'Iqbal', 'Jarvis', 'Kaur', 'Kelly', 'Kowalski', 'Laing',
  'Mahmood', 'Mensah', 'Nolan', 'O’Shea', 'Pardoe', 'Patel', 'Quinn', 'Rahman',
  'Reeves', 'Sandhu', 'Shah', 'Sheldon', 'Tandy', 'Uddin', 'Vaughan', 'Whitehouse',
];
const FORENAMES = [
  'Aisha', 'Amrit', 'Beth', 'Callum', 'Ciara', 'Dev', 'Eleri', 'Farah', 'Gemma',
  'Hardeep', 'Imran', 'Jaz', 'Kofi', 'Leila', 'Marcus', 'Niamh', 'Omar', 'Pete',
  'Rosie', 'Sanjay', 'Tomasz', 'Uzma', 'Vikram', 'Wendy', 'Yusuf', 'Zainab',
  'Nadia', 'Joel', 'Harriet', 'Bilal', 'Saoirse', 'Ravi',
];

/** Birmingham, properly — not London with the names changed. */
const PLACES = [
  { name: 'Home — Kings Heath', city: 'Birmingham', postcode: 'B14 7SB', lat: 52.4361, lon: -1.8919, cat: 'household' },
  { name: 'Moseley Farmers’ Market', city: 'Birmingham', postcode: 'B13 8JP', lat: 52.4470, lon: -1.8860, cat: 'household' },
  { name: 'Cannon Hill Park', city: 'Birmingham', postcode: 'B12 9QH', lat: 52.4489, lon: -1.9006, cat: 'social' },
  { name: 'Bullring & Grand Central', city: 'Birmingham', postcode: 'B5 4BU', lat: 52.4776, lon: -1.8940, cat: 'admin' },
  { name: 'Digbeth — Custard Factory', city: 'Birmingham', postcode: 'B9 4AA', lat: 52.4759, lon: -1.8830, cat: 'work' },
  { name: 'Jewellery Quarter', city: 'Birmingham', postcode: 'B18 6HQ', lat: 52.4874, lon: -1.9107, cat: 'social' },
  { name: 'Selly Oak — Sainsbury’s', city: 'Birmingham', postcode: 'B29 6NA', lat: 52.4400, lon: -1.9370, cat: 'household' },
  { name: 'Queen Elizabeth Hospital', city: 'Birmingham', postcode: 'B15 2GW', lat: 52.4530, lon: -1.9380, cat: 'health' },
  { name: 'Harborne High Street', city: 'Birmingham', postcode: 'B17 9NP', lat: 52.4590, lon: -1.9540, cat: 'social' },
  { name: 'Symphony Hall', city: 'Birmingham', postcode: 'B1 2EA', lat: 52.4790, lon: -1.9090, cat: 'social' },
  { name: 'Stirchley — Loaf Bakery', city: 'Birmingham', postcode: 'B30 2XS', lat: 52.4300, lon: -1.9110, cat: 'social' },
  { name: 'Sutton Park', city: 'Sutton Coldfield', postcode: 'B74 2YT', lat: 52.5680, lon: -1.8480, cat: 'social' },
  { name: 'Edgbaston Cricket Ground', city: 'Birmingham', postcode: 'B5 7QU', lat: 52.4557, lon: -1.9020, cat: 'social' },
  { name: 'Birmingham New Street', city: 'Birmingham', postcode: 'B2 4QA', lat: 52.4778, lon: -1.8990, cat: 'admin' },
  { name: 'Moor Street Car Park', city: 'Birmingham', postcode: 'B4 7UL', lat: 52.4787, lon: -1.8918, cat: 'car' },
];

type Cat = { slug: string; name: string; colour: string; icon: string };
const CATEGORIES: Cat[] = [
  { slug: 'household', name: 'Household', colour: 'emerald', icon: 'house' },
  { slug: 'admin', name: 'Admin & money', colour: 'amber', icon: 'receipt' },
  { slug: 'health', name: 'Health', colour: 'rose', icon: 'heart' },
  { slug: 'family', name: 'Family', colour: 'violet', icon: 'users' },
  { slug: 'work', name: 'Work', colour: 'sky', icon: 'briefcase' },
  { slug: 'garden', name: 'Garden', colour: 'lime', icon: 'sprout' },
  { slug: 'car', name: 'Car', colour: 'orange', icon: 'car' },
  { slug: 'social', name: 'Social', colour: 'fuchsia', icon: 'glass' },
];

const TASK_TITLES: Record<string, string[]> = {
  household: [
    'Book the boiler service', 'Descale the kettle', 'Replace the bathroom extractor filter',
    'Order more bin bags', 'Get a spare back door key cut', 'Bleed the upstairs radiators',
    'Sort the loft boxes', 'Book a chimney sweep', 'Fix the loose stair spindle',
    'Take the old microwave to the tip', 'Clean the oven properly', 'Re-grout behind the sink',
  ],
  admin: [
    'Renew the car tax', 'Switch the broadband tariff', 'Send the meter reading',
    'Chase the council tax refund', 'File the self-assessment', 'Cancel the unused gym membership',
    'Renew both passports', 'Update the home insurance', 'Check the ISA rate',
    'Set up the standing order for Ravi', 'Print the warranty for the washing machine',
  ],
  health: [
    'Book the dentist for both of us', 'Order the repeat prescription',
    'Book a flu jab at the pharmacy', 'Ring the GP about the referral',
    'Book an eye test at Harborne', 'Physio exercises three times this week',
  ],
  family: [
    'Ring Mum about the weekend', 'Book train tickets for the Sutton visit',
    'Order Nadia’s birthday present', 'Send a card to the Iqbals',
    'Sort the photos from Cannon Hill', 'Ask Danny’s dad about the trailer',
  ],
  work: [
    'Write up the Digbeth workshop notes', 'Send the invoice for June',
    'Prep the Thursday stand-up', 'Review the contractor agreement',
    'Book the meeting room at the Custard Factory', 'Update the project one-pager',
    'Follow up with Marcus about the timeline',
  ],
  garden: [
    'Cut back the buddleia', 'Order compost for the raised beds',
    'Fix the fence panel by the shed', 'Plant the garlic', 'Clean the greenhouse glass',
  ],
  car: [
    'Book the MOT', 'Top up the screenwash', 'Get the nearside tyre checked',
    'Renew the parking permit', 'Clear the boot out',
  ],
  social: [
    'Book the Symphony Hall tickets', 'Reply to Beth about Saturday',
    'Sort a table for the Moseley thing', 'Buy a bottle for the Vaughans',
  ],
};

const EVENT_TITLES = [
  'Dentist', 'GP appointment', 'Stand-up', 'Project review', 'Lunch with Beth',
  'School pick-up', 'Physio', 'Board games at the Vaughans’', 'Bin day — recycling',
  'Bin day — general', 'Yoga at the leisure centre', 'Client call', 'Haircut',
  'Coffee with Marcus', 'Cinema — Electric', 'Swimming', 'Book club',
  'Parents’ evening', 'Car service', 'Train to London', 'Dinner at Stirchley',
  'Walk in Sutton Park', 'Farmers’ market', 'Choir practice', 'Football at Cannon Hill',
];

const NOTE_SEEDS = [
  ['Boiler — Worcester Bosch', 'Installed 2019 by Kings Heath Heating. Serviced annually, usually late September.\n\nFilter code: **WB-4471**. Pressure should sit at 1.2 bar cold.'],
  ['Bin days', 'Recycling: **Tuesday, fortnightly** (odd weeks).\nGeneral: Tuesday, the other fortnight.\nGarden waste stops at the end of November.'],
  ['Broadband options', 'Current: 67 Mb, £34/mo, out of contract in November.\n\n- Ask about the loyalty rate before switching\n- Digbeth office needs a static IP, so check that first'],
  ['Car — service history', 'Last MOT: March, advisories on the nearside front tyre.\nNext due: March. Garage on Alcester Road, ask for Pete.'],
  ['Nadia’s birthday ideas', 'She mentioned the pottery place in the Jewellery Quarter.\nAlso: the Loaf bread course at Stirchley.'],
  ['Recipe — Saturday dal', 'Chana dal, turmeric, ginger, tomatoes from the market.\nSimmer 40 min. Tempering at the end: cumin, dried chilli, curry leaves.'],
  ['Garden plan', 'Raised beds: garlic in October, broad beans in November.\nBuddleia needs hard pruning in March or it takes over the path.'],
  ['Passport renewal checklist', 'Both expire next spring. Digital photo, countersignature not needed for renewals.\nAllow 10 weeks.'],
  ['Symphony Hall — seats', 'Stalls K–M are the sweet spot. Avoid the front of the circle.'],
  ['Meter readings', 'Electric: bottom of the stairs cupboard.\nGas: outside, left of the gate. Reading goes in on the 1st.'],
  ['Danny’s work pattern', 'Tuesdays and Thursdays in the office. Home the rest.\nDon’t book anything before 09:30 on office days.'],
  ['Insurance renewals', 'Home: November. Car: March. Travel: annual, renews in July — check it covers the ferry.'],
  ['Moseley market notes', 'Fourth Saturday. Bread stall sells out by 10.\nThe cheese people take card, the veg stall doesn’t.'],
  ['Loft inventory', 'Left of the hatch: Christmas. Right: camping. Back: the boxes from Mum’s.'],
  ['Books to find', 'The Vaughans recommended two — check the Kings Heath library catalogue first.'],
];

const TAGS = ['urgent', 'waiting', 'errand', 'phone-call', 'weekend', 'money', 'reading'];

// --- writers ---------------------------------------------------------------

async function truncateAll() {
  const rows = await sql<{ tablename: string }[]>`
    select tablename from pg_tables
    where schemaname = 'public' and tablename <> 'spatial_ref_sys'
  `;
  const list = rows.map((r) => `public.${r.tablename}`).join(', ');
  await sql.unsafe(`truncate ${list} restart identity cascade`);
}

async function main() {
  console.log('▸ truncating');
  await truncateAll();

  // -- profiles -------------------------------------------------------------
  console.log('▸ profiles');
  await sql`
    insert into public.profiles (id, email, display_name, timezone, locale) values
      (${PRIYA}, 'priya@orbit.test', 'Priya Raghavan', 'Europe/London', 'en-GB'),
      (${DANNY}, 'danny@orbit.test', 'Danny Whitehouse', 'Europe/London', 'en-GB'),
      (${OUTSIDER}, 'sam@orbit.test', 'Sam Okafor (outsider)', 'Europe/London', 'en-GB')
  `;

  // -- spaces ---------------------------------------------------------------
  console.log('▸ spaces');
  await sql`
    insert into public.spaces (id, owner_id, name, kind, short_label, colour, icon, is_default) values
      (${S_PRIYA}, ${PRIYA}, 'Priya',  'personal',  'Priya', 'indigo',  'user',      true),
      (${S_HOME},  ${PRIYA}, 'Home',   'household', 'Home',  'emerald', 'house',     false),
      (${S_WORK},  ${PRIYA}, 'Work',   'work',      'Work',  'sky',     'briefcase', false),
      (${S_DANNY}, ${DANNY}, 'Danny',  'personal',  'Danny', 'amber',   'user',      true)
  `;

  await sql`
    insert into public.space_members (space_id, user_id, role) values
      (${S_PRIYA}, ${PRIYA}, 'owner'),
      (${S_HOME},  ${PRIYA}, 'owner'),
      (${S_WORK},  ${PRIYA}, 'owner'),
      (${S_DANNY}, ${DANNY}, 'owner'),
      -- Danny is a full member of Home and a free/busy participant of Work: he
      -- can see when Priya is busy, never what she is busy with.
      (${S_HOME},  ${DANNY}, 'member'),
      (${S_WORK},  ${DANNY}, 'free_busy')
  `;

  await sql`
    insert into public.free_busy_shares (space_id, owner_id, grantee_id, granularity)
    values (${S_WORK}, ${PRIYA}, ${DANNY}, 'block')
  `;

  // -- categories -----------------------------------------------------------
  console.log('▸ categories');
  const catId: Record<string, Record<string, string>> = {};
  for (const [space, owner] of [
    [S_PRIYA, PRIYA],
    [S_HOME, PRIYA],
    [S_WORK, PRIYA],
    [S_DANNY, DANNY],
  ] as const) {
    catId[space] = {};
    let order = 0;
    for (const c of CATEGORIES) {
      const id = uid();
      catId[space]![c.slug] = id;
      await sql`
        insert into public.categories (id, space_id, owner_id, name, slug, colour, icon, sort_order)
        values (${id}, ${space}, ${owner}, ${c.name}, ${c.slug}, ${c.colour}, ${c.icon}, ${order++})
      `;
    }
  }

  // -- places ---------------------------------------------------------------
  console.log('▸ places');
  const placeIds: string[] = [];
  for (const p of PLACES) {
    const id = uid();
    placeIds.push(id);
    await sql`
      insert into public.places
        (id, space_id, owner_id, category_id, name, address_text, postcode, city,
         geom, geocoded_at, geocode_source)
      values (
        ${id}, ${S_HOME}, ${PRIYA}, ${catId[S_HOME]![p.cat] ?? null},
        ${p.name}, ${`${p.name}, ${p.city}`}, ${p.postcode}, ${p.city},
        ST_SetSRID(ST_MakePoint(${p.lon}, ${p.lat}), 4326)::geography,
        now(), 'fake'
      )
    `;
  }

  // -- people ---------------------------------------------------------------
  console.log('▸ people');
  const peopleIds: string[] = [];
  const usedNames = new Set<string>();
  for (let i = 0; i < 40; i++) {
    let name = `${pick(FORENAMES)} ${pick(SURNAMES)}`;
    let guard = 0;
    while (usedNames.has(name) && guard++ < 50) name = `${pick(FORENAMES)} ${pick(SURNAMES)}`;
    usedNames.add(name);

    // Most people live in Home; a few are work contacts, a few are Priya's own.
    const space = i < 28 ? S_HOME : i < 35 ? S_WORK : S_PRIYA;
    const cat = space === S_WORK ? 'work' : chance(0.4) ? 'family' : 'social';
    const id = uid();
    peopleIds.push(id);

    await sql`
      insert into public.people (id, space_id, owner_id, category_id, display_name, notes_md)
      values (${id}, ${space}, ${PRIYA}, ${catId[space]![cat]!}, ${name},
              ${chance(0.3) ? `Met through ${pick(['the school', 'choir', 'work', 'the street WhatsApp', 'book club'])}.` : ''})
    `;

    if (chance(0.7)) {
      const handle = name.toLowerCase().replace(/[^a-z]+/g, '.');
      await sql`
        insert into public.person_contacts (space_id, owner_id, person_id, kind, label, value, is_primary)
        values (${space}, ${PRIYA}, ${id}, 'email', 'personal', ${`${handle}@example.com`}, true)
      `;
    }
    if (chance(0.5)) {
      await sql`
        insert into public.person_contacts (space_id, owner_id, person_id, kind, label, value, is_primary)
        values (${space}, ${PRIYA}, ${id}, 'phone', 'mobile',
                ${`07${int(100, 999)} ${int(100000, 999999)}`}, false)
      `;
    }
    if (chance(0.45)) {
      const d = dayOffset(int(-180, 180));
      await sql`
        insert into public.person_dates (space_id, owner_id, person_id, kind, on_date, year_known)
        values (${space}, ${PRIYA}, ${id}, 'birthday',
                ${isoDate(new Date(Date.UTC(int(1955, 2005), d.getUTCMonth(), d.getUTCDate())))},
                ${chance(0.8)})
      `;
    }
  }

  // Same-person linking (decision 4): one human, two records, permanently
  // linked and never collapsed. Dr Iqbal is in both Home and Work.
  const drHome = uid();
  const drWork = uid();
  await sql`
    insert into public.people (id, space_id, owner_id, category_id, display_name, notes_md) values
      (${drHome}, ${S_HOME}, ${PRIYA}, ${catId[S_HOME]!.health!}, 'Dr Iqbal',
       'GP at the Kings Heath surgery.'),
      (${drWork}, ${S_WORK}, ${PRIYA}, ${catId[S_WORK]!.work!}, 'Dr Iqbal',
       'Sits on the funding panel. Same person as the GP — linked, not merged.')
  `;
  {
    const [a, b] = [drHome, drWork].sort();
    await sql`
      insert into public.person_links
        (space_id, owner_id, person_a_id, person_b_id, person_b_space, confidence)
      values (${S_HOME}, ${PRIYA}, ${a!}, ${b!}, ${S_WORK}, 'confirmed')
    `;
  }
  peopleIds.push(drHome, drWork);

  // -- calendars ------------------------------------------------------------
  console.log('▸ calendars');
  const calIds: Record<string, string> = {};
  for (const [space, owner, name] of [
    [S_PRIYA, PRIYA, 'Priya'],
    [S_HOME, PRIYA, 'Home'],
    [S_WORK, PRIYA, 'Work'],
    [S_DANNY, DANNY, 'Danny'],
  ] as const) {
    const accountId = uid();
    await sql`
      insert into public.calendar_accounts (id, space_id, owner_id, provider, display_name, status)
      values (${accountId}, ${space}, ${owner}, 'local', ${`${name} (local)`}, 'connected')
    `;
    const calId = uid();
    calIds[space] = calId;
    await sql`
      insert into public.calendars (id, space_id, owner_id, account_id, name, colour, icon)
      values (${calId}, ${space}, ${owner}, ${accountId}, ${name}, 'slate', 'calendar')
    `;
  }

  // -- events ---------------------------------------------------------------
  console.log('▸ events');
  const eventIds: string[] = [];
  for (let i = 0; i < 200; i++) {
    // Weighted towards Home, with a real presence in Work so the merged
    // calendar has something to anonymise for Danny.
    const space = chance(0.55) ? S_HOME : chance(0.55) ? S_WORK : chance(0.5) ? S_PRIYA : S_DANNY;
    const owner = space === S_DANNY ? DANNY : PRIYA;
    const offset = int(-60, 60);
    const allDay = chance(0.12);
    const hour = int(8, 19);
    const mins = pick([0, 15, 30, 45]);
    const lengthMin = allDay ? 0 : pick([30, 30, 45, 60, 60, 90, 120]);
    const starts = allDay ? at(offset, 0) : at(offset, hour, mins);
    const ends = allDay ? at(offset + 1, 0) : new Date(starts.getTime() + lengthMin * 60_000);
    const cat = pick(CATEGORIES).slug;
    const id = uid();
    eventIds.push(id);

    await sql`
      insert into public.events
        (id, space_id, owner_id, calendar_id, category_id, place_id, title, body_md,
         starts_at, ends_at, all_day, status)
      values (
        ${id}, ${space}, ${owner}, ${calIds[space]!}, ${catId[space]![cat]!},
        ${space === S_HOME && chance(0.35) ? pick(placeIds) : null},
        ${pick(EVENT_TITLES)}, ${chance(0.2) ? 'Bring the folder.' : ''},
        ${starts}, ${ends}, ${allDay},
        ${chance(0.05) ? 'tentative' : 'confirmed'}
      )
    `;

    if (chance(0.3)) {
      const personId = pick(peopleIds);
      const personSpace = await sql<{ space_id: string }[]>`
        select space_id from public.people where id = ${personId}
      `;
      if (personSpace[0]?.space_id === space) {
        await sql`
          insert into public.event_attendees (space_id, owner_id, event_id, person_id, response)
          values (${space}, ${owner}, ${id}, ${personId},
                  ${pick(['accepted', 'accepted', 'needs_action', 'tentative'])})
          on conflict do nothing
        `;
      }
    }
  }

  // -- recurring events -----------------------------------------------------
  //
  // Two repeats, stored as one row plus one RRULE each rather than as expanded
  // copies. They exist so `recurrence_rules` holds rows from a fresh seed: the
  // outsider check in the pgTAP suite iterates pg_tables and cannot fail on an
  // empty table, so a table nothing writes to has an untested policy.
  //
  // Both deliberately start before the clocks change and run past them, so the
  // week view is exercised across a BST boundary by simply looking at it.
  console.log('▸ recurring events');
  for (const [space, owner, title, rrule, hour] of [
    [S_HOME, PRIYA, 'Bin day — green bin', 'FREQ=WEEKLY;INTERVAL=2;BYDAY=WE', 7],
    [S_WORK, PRIYA, 'Team stand-up', 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;COUNT=60', 9],
  ] as const) {
    const dtstart = at(-30, hour, 30);
    const rows = await sql<{ id: string }[]>`
      insert into public.recurrence_rules (space_id, owner_id, rrule, dtstart, timezone)
      values (${space}, ${owner}, ${rrule}, ${dtstart}, 'Europe/London')
      returning id
    `;
    await sql`
      insert into public.events
        (space_id, owner_id, calendar_id, category_id, recurrence_rule_id,
         title, starts_at, ends_at, all_day, status)
      values (
        ${space}, ${owner}, ${calIds[space]!}, ${catId[space]!.household ?? catId[space]!.work ?? null},
        ${rows[0]!.id}, ${title}, ${dtstart},
        ${new Date(dtstart.getTime() + 30 * 60_000)}, false, 'confirmed'
      )
    `;
  }

  // -- tasks ----------------------------------------------------------------
  console.log('▸ tasks');
  const taskIds: string[] = [];
  const titlePool = Object.entries(TASK_TITLES).flatMap(([slug, titles]) =>
    titles.map((t) => ({ slug, title: t })),
  );
  let titleIdx = 0;
  const nextTitle = () => titlePool[titleIdx++ % titlePool.length]!;

  /** Every smart list gets real rows — a list that is empty in the seed is a
   *  list nobody will notice is broken. */
  const plan: { kind: string; count: number }[] = [
    { kind: 'overdue', count: 10 },
    { kind: 'today', count: 12 },
    { kind: 'upcoming', count: 20 },
    { kind: 'someday', count: 8 },
    { kind: 'waiting', count: 6 },
    { kind: 'inbox', count: 14 },
    { kind: 'done', count: 10 },
  ];

  for (const { kind, count } of plan) {
    for (let i = 0; i < count; i++) {
      const { slug, title } = nextTitle();
      const space = chance(0.5) ? S_HOME : chance(0.5) ? S_PRIYA : chance(0.6) ? S_WORK : S_DANNY;
      const owner = space === S_DANNY ? DANNY : PRIYA;
      const id = uid();
      taskIds.push(id);

      let due: string | null = null;
      let deferred: Date | null = null;
      let status: string = 'todo';
      let completed: Date | null = null;
      let waitingOn: string | null = null;

      switch (kind) {
        case 'overdue':
          due = isoDate(dayOffset(-int(1, 21)));
          break;
        case 'today':
          due = isoDate(today);
          break;
        case 'upcoming':
          due = isoDate(dayOffset(int(1, 14)));
          break;
        case 'someday':
          deferred = at(int(30, 120), 9);
          break;
        case 'waiting':
          status = 'blocked';
          due = chance(0.5) ? isoDate(dayOffset(int(2, 20))) : null;
          waitingOn = pick(['the garage', 'Marcus', 'the council', 'Danny', 'the letting agent']);
          break;
        case 'inbox':
          break;
        case 'done':
          status = 'done';
          completed = at(-int(1, 20), int(9, 20));
          due = chance(0.6) ? isoDate(dayOffset(-int(1, 25))) : null;
          break;
      }

      await sql`
        insert into public.tasks
          (id, space_id, owner_id, category_id, title, body_md, status, priority,
           visibility, due_on, deferred_until, completed_at, assignee_id,
           waiting_on, estimate_minutes, sort_order)
        values (
          ${id}, ${space}, ${owner}, ${catId[space]![slug] ?? null}, ${title},
          ${chance(0.25) ? 'Check the note attached to this before starting.' : ''},
          ${status}, ${pick(['none', 'none', 'low', 'normal', 'normal', 'high', 'urgent'])},
          ${space === S_HOME && chance(0.12) ? 'private' : 'space'},
          ${due}, ${deferred}, ${completed},
          ${space === S_HOME && chance(0.3) ? DANNY : owner},
          ${waitingOn}, ${chance(0.4) ? pick([15, 30, 45, 60, 90]) : null},
          ${i}
        )
      `;

      if (chance(0.25)) {
        for (let s = 0; s < int(2, 4); s++) {
          await sql`
            insert into public.task_checklist_items (space_id, owner_id, task_id, label, done, sort_order)
            values (${space}, ${owner}, ${id},
                    ${pick(['Find the paperwork', 'Ring them', 'Check the price', 'Book a slot', 'Confirm by email'])},
                    ${chance(0.35)}, ${s})
          `;
        }
      }
    }
  }

  // One locked task, to prove the E2EE path is real rather than a plan.
  {
    const id = uid();
    await sql`
      insert into public.tasks (id, space_id, owner_id, title, body_md, is_locked, due_on)
      values (${id}, ${S_PRIYA}, ${PRIYA}, '', '', true, ${isoDate(dayOffset(3))})
    `;
    await sql`
      insert into public.encrypted_blobs
        (space_id, owner_id, entity_kind, entity_id, ciphertext, nonce, algorithm)
      values (${S_PRIYA}, ${PRIYA}, 'task', ${id},
              ${Buffer.from('seed placeholder ciphertext').toString('base64')},
              ${Buffer.from('seednonce0123').toString('base64')}, 'xchacha20poly1305')
    `;
    taskIds.push(id);
  }

  // -- notes ----------------------------------------------------------------
  console.log('▸ notes');
  const noteIds: string[] = [];
  for (let i = 0; i < 30; i++) {
    const seed = NOTE_SEEDS[i % NOTE_SEEDS.length]!;
    const suffix = i >= NOTE_SEEDS.length ? ` (${Math.floor(i / NOTE_SEEDS.length) + 1})` : '';
    const space = chance(0.6) ? S_HOME : chance(0.6) ? S_PRIYA : S_WORK;
    const id = uid();
    noteIds.push(id);

    await sql`
      insert into public.notes
        (id, space_id, owner_id, category_id, title, body_md, visibility, pinned_at, updated_at)
      values (
        ${id}, ${space}, ${PRIYA}, ${catId[space]![pick(CATEGORIES).slug]!},
        ${seed[0] + suffix}, ${seed[1]},
        ${space === S_PRIYA && chance(0.2) ? 'private' : 'space'},
        ${chance(0.15) ? at(-int(1, 30), 10) : null},
        ${at(-int(0, 60), int(8, 21))}
      )
    `;

    // Linked notes: the point of a note is what it hangs off.
    const links = int(1, 3);
    for (let l = 0; l < links; l++) {
      const kind = pick(['task', 'person', 'place', 'event'] as const);
      const pools: Record<string, string[]> = {
        task: taskIds, person: peopleIds, place: placeIds, event: eventIds,
      };
      const target = pick(pools[kind]!);
      const targetSpace = await sql<{ space_id: string }[]>`
        select space_id from public.${sql(
          kind === 'task' ? 'tasks' : kind === 'person' ? 'people' : kind === 'place' ? 'places' : 'events',
        )} where id = ${target}
      `;
      // A note_link is space-scoped; it cannot reach across spaces.
      if (targetSpace[0]?.space_id !== space) continue;
      await sql`
        insert into public.note_links (space_id, owner_id, note_id, entity_kind, entity_id)
        values (${space}, ${PRIYA}, ${id}, ${kind}, ${target})
        on conflict do nothing
      `;
    }
  }

  // -- tags -----------------------------------------------------------------
  // -- activity ------------------------------------------------------------
  // One real audit row, so `activity_log` is covered by the pgTAP outsider
  // check from a fresh seed rather than only after somebody moves something.
  // Note what is *not* here: nothing records that a thing was viewed. The
  // table has a check constraint refusing it, and there is a test for that.
  console.log('▸ activity');
  await sql`
    insert into public.activity_log
      (space_id, owner_id, actor_id, entity_kind, entity_id, action, summary)
    select ${S_HOME}, ${PRIYA}, ${PRIYA}, 'task', t.id, 'created',
           'Added from the weekly shop list'
    from public.tasks t where t.space_id = ${S_HOME} limit 1
  `;

  console.log('▸ tags');
  for (const space of [S_PRIYA, S_HOME, S_WORK] as const) {
    for (const t of TAGS) {
      const id = uid();
      await sql`
        insert into public.tags (id, space_id, owner_id, name, slug)
        values (${id}, ${space}, ${PRIYA}, ${t.replace(/-/g, ' ')}, ${t})
      `;
      for (const taskId of taskIds) {
        if (!chance(0.02)) continue;
        const ts = await sql<{ space_id: string }[]>`select space_id from public.tasks where id = ${taskId}`;
        if (ts[0]?.space_id !== space) continue;
        await sql`
          insert into public.taggings (space_id, owner_id, tag_id, entity_kind, entity_id)
          values (${space}, ${PRIYA}, ${id}, 'task', ${taskId})
          on conflict do nothing
        `;
      }
    }
  }

  // -- saved views, rules, reminders ---------------------------------------
  console.log('▸ views, rules, reminders');
  await sql`
    insert into public.saved_views (space_id, owner_id, name, slug, entity_kind, filter, sort_order) values
      (${S_HOME}, ${PRIYA}, 'This weekend', 'this-weekend', 'task',
       ${sql.json({ due_within_days: 3, status: ['todo', 'doing'] })}, 0),
      (${S_HOME}, ${PRIYA}, 'Danny''s jobs', 'dannys-jobs', 'task',
       ${sql.json({ assignee: 'partner', status: ['todo', 'doing'] })}, 1),
      (${S_WORK}, ${PRIYA}, 'Invoices', 'invoices', 'task',
       ${sql.json({ category: 'admin', status: ['todo', 'blocked'] })}, 0)
  `;

  await sql`
    insert into public.rules (space_id, owner_id, name, slug, description, trigger, conditions, actions, is_enabled, last_dry_run_at) values
      (${S_HOME}, ${PRIYA}, 'Bins go to Danny', 'bins-to-danny',
       'Anything mentioning the bins gets assigned to Danny.',
       ${sql.json({ kind: 'task.created' })},
       ${sql.json([{ field: 'title', op: 'contains', value: 'bin' }])},
       ${sql.json([{ kind: 'task.assign', to: 'partner' }])},
       false, null),
      (${S_HOME}, ${PRIYA}, 'Overdue admin becomes high priority', 'overdue-admin-high',
       'Admin tasks more than a week overdue move to high priority.',
       ${sql.json({ kind: 'schedule', cron: '0 7 * * *' })},
       ${sql.json([
         { field: 'category.slug', op: 'eq', value: 'admin' },
         { field: 'days_overdue', op: 'gte', value: 7 },
       ])},
       ${sql.json([{ kind: 'task.set_priority', priority: 'high' }])},
       false, null)
  `;

  const dueSoon = await sql<{ id: string; space_id: string; owner_id: string }[]>`
    select id, space_id, owner_id from public.tasks
    where due_on is not null and due_on >= ${isoDate(today)} and status = 'todo'
    order by due_on limit 8
  `;
  for (const t of dueSoon) {
    await sql`
      insert into public.reminders (space_id, owner_id, entity_kind, entity_id, remind_at, message)
      values (${t.space_id}, ${t.owner_id}, 'task', ${t.id}, ${at(int(0, 5), 8)}, '')
    `;
  }

  // -- devices, AI consent --------------------------------------------------
  await sql`
    insert into public.devices (space_id, owner_id, label, platform, last_seen_at) values
      (${S_PRIYA}, ${PRIYA}, 'Priya — laptop', 'web', now()),
      (${S_HOME},  ${PRIYA}, 'Priya — laptop', 'web', now()),
      (${S_DANNY}, ${DANNY}, 'Danny — phone',  'web', now())
  `;

  // Every AI feature ships off. These rows exist so settings can render the
  // disclosure text; is_enabled is false and consented_at is null.
  for (const [feature, disclosure] of [
    ['note_summary', 'The note’s text is sent to the model provider. Locked notes are never included.'],
    ['task_breakdown', 'The task title and body are sent to the model provider.'],
    ['weekly_review', 'Titles and due dates for the week are sent. No note bodies, no locked items.'],
  ] as const) {
    await sql`
      insert into public.ai_feature_consents (space_id, owner_id, feature, is_enabled, data_leaves_device)
      values (${S_HOME}, ${PRIYA}, ${feature}, false, ${disclosure})
    `;
  }

  // -- summary --------------------------------------------------------------
  const counts = await sql<{ what: string; n: number }[]>`
    select 'profiles' as what, count(*)::int as n from public.profiles
    union all select 'spaces', count(*)::int from public.spaces
    union all select 'people', count(*)::int from public.people
    union all select 'events', count(*)::int from public.events
    union all select 'tasks', count(*)::int from public.tasks
    union all select 'notes', count(*)::int from public.notes
    union all select 'note_links', count(*)::int from public.note_links
    union all select 'places', count(*)::int from public.places
    order by 1
  `;
  console.log('▸ seeded:');
  for (const c of counts) console.log(`    ${String(c.n).padStart(4)}  ${c.what}`);
}

main()
  .then(() => sql.end())
  .catch(async (err) => {
    console.error(err);
    await sql.end();
    process.exit(1);
  });
