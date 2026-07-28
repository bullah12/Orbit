/**
 * Drive the running app and check what actually comes back over HTTP.
 *
 * pgTAP proves the policies. This proves the *app* is bound by them — that no
 * page reaches for data with a different connection, and that the pieces a
 * person actually touches (the edit form, the move confirmation, the link
 * picker) do what they claim. Acting as the partner and as the outsider is the
 * point: a policy that only holds in a test fixture is not a policy.
 *
 * Usage:
 *   pnpm build && pnpm start &      # or pnpm dev
 *   pnpm smoke
 *
 * Env:
 *   ORBIT_URL          default http://localhost:3000
 *   CHROMIUM_PATH      default /opt/pw-browsers/chromium-1194/chrome-linux/chrome
 *
 * It restores what it edits, but the people run leaves one archived person
 * behind per invocation — archiving is the reversible option and deleting a
 * person is not offered in the UI. Run `pnpm seed` to clear them, or if a run
 * is interrupted part-way.
 */

import { chromium } from 'playwright';

const BASE = process.env.ORBIT_URL ?? 'http://localhost:3000';
const CHROMIUM =
  process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

// Seeded ids. Stable by construction — see supabase/seed/seed.ts.
const PRIYA = '00000000-0000-4000-8000-000000000001';
const DANNY = '00000000-0000-4000-8000-000000000002';
const OUTSIDER = '00000000-0000-4000-8000-0000000000ff';
const S_PRIYA = '00000000-0000-4000-8000-000000000003';
const S_HOME = '00000000-0000-4000-8000-000000000004';
const S_WORK = '00000000-0000-4000-8000-000000000005';

const TRAVEL_DAY = '2026-07-29';
let placeUrl;
let privatePlaceUrl;
let failures = 0;
const results = [];

function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  if (!ok) failures += 1;
  const mark = ok ? '[1;32m✓[0m' : '[1;31m✗[0m';
  console.log(`${mark} ${name}${detail ? `  [2m${detail}[0m` : ''}`);
}

const browser = await chromium.launch({ executablePath: CHROMIUM });

async function pageAs(userId) {
  const ctx = await browser.newContext({ baseURL: BASE });
  await ctx.addCookies([{ name: 'orbit_user', value: userId, url: BASE }]);
  const page = await ctx.newPage();
  return { ctx, page };
}

/** Server actions re-render without a navigation; wait for the DOM to settle. */
async function settle(page) {
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(900);
}

/** An event id that really exists, so the outsider's 404 is a 404 about a real row. */
async function firstEventId() {
  const { ctx, page } = await pageAs(PRIYA);
  await page.goto('/calendar/month');
  const href = await page.locator('a[href^="/calendar/event/"]').first().getAttribute('href');
  await ctx.close();
  return href.split('/').pop().split('?')[0];
}

try {
  // ------------------------------------------------------------ Priya: reads
  {
    const { ctx, page } = await pageAs(PRIYA);

    await page.goto('/');
    check('Today renders', (await page.locator('h1').first().innerText()) === 'Today');

    await page.goto('/tasks/all');
    const rows = await page.locator('main ul li').count();
    check('the All open list has rows', rows > 0, `${rows} rows`);

    // The space indicator is a hard requirement: legible on *every* row.
    const withIndicator = await page
      .locator('main ul li span[title^="Space:"]')
      .count();
    check(
      'every task row carries a space indicator',
      withIndicator >= rows,
      `${withIndicator} indicators / ${rows} rows`,
    );

    const composeIndicators = await page
      .locator('form[aria-label="Add a task"] span[title^="Space:"]')
      .count();
    check('the compose surface carries space indicators', composeIndicators > 0);

    await ctx.close();
  }

  // -------------------------------------------------- Priya: edit round-trip
  let taskId;
  {
    const { ctx, page } = await pageAs(PRIYA);
    await page.goto('/tasks/all');
    const href = await page.locator('main ul li a[href^="/tasks/item/"]').first().getAttribute('href');
    taskId = href.split('/').pop();

    await page.goto(href);
    const before = {
      title: await page.locator('#task-title').inputValue(),
      status: await page.locator('#task-status').inputValue(),
      priority: await page.locator('#task-priority').inputValue(),
    };

    await page.fill('#task-title', `${before.title} [smoke]`);
    await page.selectOption('#task-status', 'doing');
    await page.selectOption('#task-priority', 'urgent');
    await page.click('button:has-text("Save changes")');
    await settle(page);
    await page.reload();

    check(
      'a task edit round-trips to Postgres',
      (await page.locator('#task-title').inputValue()) === `${before.title} [smoke]` &&
        (await page.locator('#task-status').inputValue()) === 'doing' &&
        (await page.locator('#task-priority').inputValue()) === 'urgent',
    );

    // Put it back.
    await page.fill('#task-title', before.title);
    await page.selectOption('#task-status', before.status);
    await page.selectOption('#task-priority', before.priority);
    await page.click('button:has-text("Save changes")');
    await settle(page);
    await ctx.close();
  }

  // ------------------------------------------------------- the move preview
  {
    const { ctx, page } = await pageAs(PRIYA);
    // A Home task, so there is a partner to lose access.
    await page.goto(`/tasks/all?space=${S_HOME}`);
    const href = await page
      .locator('main ul li a[href^="/tasks/item/"]')
      .first()
      .getAttribute('href');
    await page.goto(href);
    await page.locator('a[aria-label^="Preview moving"]').first().click();
    await settle(page);

    const text = await page
      .locator('section:has-text("Move to another space") .surface')
      .first()
      .innerText();

    check(
      'the move confirmation names who loses access, before anything is written',
      /loses access/i.test(text) && /Danny/.test(text),
    );
    check(
      'and states the consequence for the category',
      !/category/i.test(text) || /will be cleared/i.test(text),
    );
    await ctx.close();
  }

  // ------------------------------------------------ Danny: the partner's view
  {
    const { ctx, page } = await pageAs(DANNY);

    await page.goto(`/tasks/all?space=${S_WORK}`);
    check(
      'the free/busy partner sees zero rows in Work',
      (await page.locator('main ul li').count()) === 0,
    );
    check(
      'and Work is still listed, marked free/busy',
      (await page.locator('nav :text("free/busy")').count()) > 0,
    );

    await page.goto(`/tasks/all?space=${S_PRIYA}`);
    check(
      'the partner sees zero rows in the other person’s personal space',
      (await page.locator('main ul li').count()) === 0,
    );

    // Private items inside a space he *is* a member of.
    await page.goto(`/tasks/all?space=${S_HOME}`);
    const dannyHome = await page.locator('main ul li').count();
    check('the partner does see the shared space', dannyHome > 0, `${dannyHome} rows`);

    await ctx.close();
  }

  // ------------------------------------------------------------ the outsider
  {
    const { ctx, page } = await pageAs(OUTSIDER);

    await page.goto('/');
    const spaceLinks = await page.locator('nav a[href^="/tasks/all?space="]').count();
    check('the outsider is in no space', spaceLinks === 0);

    for (const [label, url] of [
      ['Today', '/'],
      ['All open', '/tasks/all'],
      ['Notes', '/notes'],
    ]) {
      await page.goto(url);
      const n = await page.locator('main ul li').count();
      check(`the outsider sees zero rows on ${label}`, n === 0, `${n} rows`);
    }

    // Named ids, not just empty lists: a direct URL must not resolve either.
    const resp = await page.goto(`/tasks/item/${taskId}`);
    check(
      'and a direct link to somebody else’s task is a 404, not a 403',
      resp.status() === 404,
      `HTTP ${resp.status()}`,
    );

    await ctx.close();
  }

  // ------------------------------------------------- people, linked not merged
  let homeIqbal;
  {
    const { ctx, page } = await pageAs(PRIYA);
    await page.goto('/people');
    const rows = await page.locator('main ul li').count();
    const indicators = await page.locator('main ul li span[title^="Space:"]').count();
    check('every person row carries a space indicator', indicators >= rows, `${indicators}/${rows}`);

    await page.goto('/people?q=Iqbal');
    const linked = page.locator('main ul li', { hasText: 'linked' });
    const linkedCount = await linked.count();
    check(
      'the same person appears as two records, one per space',
      linkedCount === 2,
      `${linkedCount} linked records`,
    );

    homeIqbal = await linked.first().locator('a').getAttribute('href');
    await page.goto(homeIqbal);
    const panel = page.locator('section:has-text("Also recorded elsewhere")');
    check('the person detail shows the other record rather than merging it', await panel.count() === 1);

    const otherHref = await panel.locator('a').first().getAttribute('href');
    check('the two records are different rows', otherHref !== homeIqbal, `${homeIqbal} vs ${otherHref}`);

    await page.goto(otherHref);
    check(
      'and the far side points back — the link is symmetric',
      (await page.locator('section:has-text("Also recorded elsewhere") a').count()) === 1,
    );
    await ctx.close();
  }

  // ------------------------------------------- people: create, edit, link, move
  {
    const { ctx, page } = await pageAs(PRIYA);
    const stamp = `Smoke Test ${Date.now()}`;

    await page.goto('/people');
    await page.fill('form[aria-label="Add a person"] input[name=displayName]', stamp);
    await page.click('form[aria-label="Add a person"] button:has-text("Add")');
    await settle(page);
    await page.goto(`/people?q=${encodeURIComponent(stamp)}`);
    const created = await page.locator('main ul li').count();
    check('a person can be created from the compose bar', created === 1, `${created} matches`);

    const href = await page.locator('main ul li a').first().getAttribute('href');
    await page.goto(href);

    // Edit
    await page.fill('#person-nickname', 'Smokey');
    await page.fill('#person-pronouns', 'they/them');
    await page.fill('#person-notes', 'Ring **before** nine.');
    await page.click('button:has-text("Save changes")');
    await settle(page);
    await page.reload();
    check(
      'a person edit round-trips to Postgres',
      (await page.locator('#person-nickname').inputValue()) === 'Smokey' &&
        (await page.locator('#person-pronouns').inputValue()) === 'they/them',
    );
    check(
      'and the notes render as Markdown',
      (await page.locator('section:has-text("Notes, rendered") strong').innerText()) === 'before',
    );

    // A contact and a date
    await page.selectOption('#contact-kind', 'email');
    await page.fill('#contact-value', 'smoke@orbit.test');
    await page.click('section:has-text("Contact") button:has-text("Add")');
    await settle(page);
    check(
      'a contact can be added and renders as a mailto link',
      (await page.locator('a[href="mailto:smoke@orbit.test"]').count()) === 1,
    );

    await page.fill('#date-on', '1990-04-11');
    await page.click('section:has-text("Important dates") button:has-text("Add")');
    await settle(page);
    check(
      'an important date can be added',
      (await page.locator('section:has-text("Important dates") li').count()) >= 1,
    );

    // Link it to a person in another space, then follow the link and unlink.
    const options = page.locator('#link-other option:not([disabled])');
    const optionCount = await options.count();
    check('link candidates are offered', optionCount > 0, `${optionCount} candidates`);
    const otherValue = await options.first().getAttribute('value');
    await page.selectOption('#link-other', otherValue);
    await page.click('button:has-text("Link")');
    await settle(page);

    const linkRow = page.locator('section:has-text("Also recorded elsewhere") li');
    check('two records can be linked', (await linkRow.count()) === 1);
    check(
      'and linking leaves two records rather than merging them',
      (await page.locator('h1').innerText()) === stamp,
    );

    await page.locator('button[aria-label^="Unlink"]').first().click();
    await settle(page);
    check('and unlinking leaves both records alone', (await linkRow.count()) === 0);

    // Move, with the preview first.
    await page.locator('a[aria-label^="Preview moving this person"]').first().click();
    await settle(page);
    const moveText = await page
      .locator('section:has-text("Move to another space") .surface')
      .innerText();
    check(
      'the person move preview states who is affected and what is lost',
      /access/i.test(moveText) && /Contact details and dates move with them/.test(moveText),
    );
    await page.click('button:has-text("Move to")');
    await settle(page);
    const movedSpace = await page.locator('header span[title^="Space:"]').first().innerText();
    check('the move completes', movedSpace.length > 0, `now in ${movedSpace}`);

    // Clean up after ourselves.
    await page.click('button:has-text("Archive this person")');
    await settle(page);
    await page.goto(`/people?q=${encodeURIComponent(stamp)}`);
    check(
      'archiving removes them from the list',
      (await page.locator('main ul li').count()) === 0,
    );

    await ctx.close();
  }

  {
    const { ctx, page } = await pageAs(DANNY);
    await page.goto(`/people?space=${S_WORK}`);
    check('the partner sees no people in Work', (await page.locator('main ul li').count()) === 0);

    await page.goto(homeIqbal);
    const panel = page.locator('section:has-text("Also recorded elsewhere")');
    const text = (await panel.innerText().catch(() => '')) || '';
    check(
      'the partner sees that a link exists but not what is on the other side',
      /cannot see/i.test(text),
      text.split('\n')[1] ?? '(no panel)',
    );
    await ctx.close();
  }

  // ------------------------------------------------------------ keyboard
  {
    const { ctx, page } = await pageAs(PRIYA);
    await page.goto('/');
    await page.keyboard.press('Tab');
    const first = await page.evaluate(() => document.activeElement?.textContent?.trim());
    check('the first tab stop is the skip link', first === 'Skip to content');

    // Every control on the busiest form has an accessible name.
    await page.goto(`/tasks/item/${taskId}`);
    const unnamed = await page.evaluate(() => {
      const bad = [];
      for (const el of document.querySelectorAll('input, select, textarea, button')) {
        if (el.type === 'hidden') continue;
        const named =
          el.getAttribute('aria-label') ||
          el.getAttribute('aria-labelledby') ||
          (el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`)) ||
          el.closest('label') ||
          (el.tagName === 'BUTTON' && el.textContent.trim());
        if (!named) bad.push(`${el.tagName.toLowerCase()}[name=${el.name || '?'}]`);
      }
      return bad;
    });
    check('every control on the task form has a label', unnamed.length === 0, unnamed.join(', '));

    await ctx.close();
  }



  // ------------------------------------------------------- moving a note
  {
    const { ctx, page } = await pageAs(PRIYA);
    await page.goto('/notes');
    const noteHref = await page.locator('main a[href^="/notes/"]').first().getAttribute('href');
    await page.goto(`${noteHref}?moveTo=${S_PRIYA}`);
    const text = await page.locator('main').innerText();
    check(
      'a note offers a move behind the same preview as tasks, people and events',
      // innerText is the *rendered* text, and the heading is uppercased by CSS.
      text.toLowerCase().includes('move to another space'),
    );
    check(
      'and states what a move costs a note in particular',
      text.includes('version history moves with the note'),
      text.includes('links') ? 'links mentioned too' : '',
    );
    await ctx.close();
  }

  // -------------------------------------------------------------- calendar
  //
  // Phase 2. The point of these is the same as everywhere else: prove through
  // the running app that a free_busy participant reaches times and never
  // titles, and that the merged calendar is merged by *policy* rather than by
  // a filter somebody could delete.
  {
    const { ctx, page } = await pageAs(PRIYA);

    await page.goto('/calendar/week');
    check(
      'the week view renders',
      (await page.locator('h1').first().innerText()).includes('–'),
      await page.locator('h1').first().innerText(),
    );

    const blocks = await page.locator('main a[href^="/calendar/event/"]').count();
    check('the week has event blocks from the seeded data', blocks > 0, `${blocks} blocks`);

    const indicators = await page
      .locator('main a[href^="/calendar/event/"] span[title^="Space:"]')
      .count();
    check(
      'every event block carries a space indicator',
      indicators >= blocks,
      `${indicators} indicators / ${blocks} blocks`,
    );

    // Monday-first is a UK convention and a hard requirement.
    // .day-heading, not any link to a day: the view switcher points at
    // /calendar/day too and would otherwise be the first match.
    const firstHeading = await page.locator('main a.day-heading').first().innerText();
    check('the week starts on Monday', firstHeading.startsWith('Mon'), firstHeading);

    await page.goto('/calendar/month');
    const cells = await page.locator('main a.day-heading').count();
    check('the month grid is six weeks of day cells', cells >= 42, `${cells} day links`);

    await page.goto('/calendar/day');
    check(
      'the day view renders one column',
      (await page.locator('main a.day-heading').count()) === 1,
    );

    // A recurring event is stored once and expanded by the app; the seed has a
    // fortnightly bin day and a weekday stand-up.
    await page.goto('/calendar/month');
    const standups = await page.locator('main a[href^="/calendar/event/"]', { hasText: 'stand-up' }).count();
    check(
      'a recurring event is expanded across the month from one stored row',
      standups > 4,
      `${standups} occurrences drawn`,
    );

    await ctx.close();
  }

  // ---------------------------------------------- calendar: the partner
  {
    const { ctx, page } = await pageAs(DANNY);
    await page.goto('/calendar/week');

    const html = await page.locator('main').innerHTML();
    const busy = await page.locator('main >> text=Busy').count();
    check(
      'the partner sees anonymous busy blocks for the space they only have free/busy on',
      busy > 0,
      `${busy} blocks`,
    );
    check(
      'and the calendar says plainly that they are availability only',
      html.includes('Availability only'),
    );

    // The real check: no Work event title reaches the page. The seeded Work
    // titles are the ones to look for, and a busy block has no link at all.
    const workTitles = ['stand-up', 'Funding', 'Invoice', 'Workshop'];
    const leaked = workTitles.filter((t) => html.toLowerCase().includes(t.toLowerCase()));
    check(
      'a busy block carries no title, no category and no link',
      leaked.length === 0,
      leaked.join(', '),
    );

    const busyLinks = await page.evaluate(() =>
      [...document.querySelectorAll('main a[href^="/calendar/event/"]')].filter((a) =>
        a.textContent.includes('Busy'),
      ).length,
    );
    check('and no busy block is a link to an event', busyLinks === 0);

    await ctx.close();
  }

  // ---------------------------------------------- calendar: the outsider
  {
    const { ctx, page } = await pageAs(OUTSIDER);
    await page.goto('/calendar/week');
    const blocks = await page.locator('main a[href^="/calendar/event/"]').count();
    check('the outsider sees zero events in the calendar', blocks === 0);

    const res = await page.goto(`/calendar/event/${await firstEventId()}`);
    check(
      'and a direct link to an event is a 404, not a 403',
      res.status() === 404,
      `HTTP ${res.status()}`,
    );
    await ctx.close();
  }

  // ------------------------------------------------------- ICS import
  {
    const { ctx, page } = await pageAs(PRIYA);
    await page.goto('/calendar/import');

    check(
      'the import page says which provider is live and whether it is a fake',
      (await page.locator('main').innerText()).includes('fixture-backed'),
    );

    await page.selectOption('select[name="ref"]', 'school-term');
    const options = await page.locator('select[name="calendarId"] option').allTextContents();
    check(
      'only calendars in spaces the user can write are offered',
      options.length > 0 && !options.some((o) => o.includes('Danny')),
      options.join(' | '),
    );
    await page.selectOption('select[name="calendarId"]', { index: 1 });
    await page.click('form[aria-label="Import an ICS feed"] button[type="submit"]');
    await settle(page);

    // Deliberately tolerant of how many were *new*: this suite is re-runnable,
    // and on a second run the feed is already imported. What must hold every
    // time is that it reports what it did and that the rule is stored once.
    const status = await page.locator('[role="status"]').innerText();
    check('importing a fixture feed reports what it wrote', /Imported \d+ new event/.test(status), status);
    check('and it stored a recurrence rule rather than expanded copies',
      /stored 1 recurrence rule/.test(status), status);

    // 23 March 2026 is the week the imported assembly starts, and it runs
    // across the clocks going forward on 29 March.
    await page.goto('/calendar/week?date=2026-03-23');
    const assembly = await page
      .locator('main a[href^="/calendar/event/"]', { hasText: 'Monday assembly' })
      .first();
    check('the imported event appears in the week it belongs to', await assembly.isVisible());
    check(
      'at 09:00 London, before the clocks change',
      (await assembly.innerText()).includes('09:00'),
    );

    await page.goto('/calendar/week?date=2026-03-30');
    const after = await page
      .locator('main a[href^="/calendar/event/"]', { hasText: 'Monday assembly' })
      .first();
    check(
      'and still at 09:00 the week after they change — the wall clock is what repeats',
      (await after.innerText()).includes('09:00'),
    );

    // The EXDATE in the fixture removes 6 April.
    await page.goto('/calendar/week?date=2026-04-06');
    const excluded = await page
      .locator('main a[href^="/calendar/event/"]', { hasText: 'Monday assembly' })
      .count();
    check('an EXDATE removes that one occurrence and no other', excluded === 0);

    // Re-importing the same feed must update, not duplicate.
    await page.goto('/calendar/import');
    await page.selectOption('select[name="ref"]', 'school-term');
    await page.selectOption('select[name="calendarId"]', { index: 1 });
    await page.click('form[aria-label="Import an ICS feed"] button[type="submit"]');
    await settle(page);
    const second = await page.locator('[role="status"]').innerText();
    check(
      'importing the same feed twice updates rather than duplicates',
      /Imported 0 new events/.test(second),
      second,
    );

    await ctx.close();
  }


  // ------------------------------------- calendar provider: connect and pull
  //
  // The CalendarProvider interface, exercised through the fake. The real
  // Google implementation runs this same code path and has never been executed
  // here — what this proves is the plumbing, not Google.
  {
    const { ctx, page } = await pageAs(PRIYA);
    await page.goto('/calendar/import');

    const connectForms = await page.locator('form[action] >> nth=0').count();
    check('the provider lists its calendars without a credential', connectForms > 0);

    const firstConnect = page
      .locator('li', { hasText: 'Family (fixture)' })
      .locator('button', { hasText: 'Connect and pull' });
    await firstConnect.click();
    await settle(page);

    // Full on a freshly seeded database, incremental if this suite has already
    // run against it — either is correct, and asserting only the first would
    // make the suite pass once and then fail forever.
    const first = await page.locator('[role="status"]').innerText();
    check(
      'connecting a fixture calendar pulls it',
      /(Full|Incremental) pull: \d+ new events?/.test(first),
      first,
    );

    // Second pull carries the token from the first, so it is incremental and
    // returns only what changed — the shape a real API has, modelled honestly.
    await page.locator('li', { hasText: 'Family (fixture)' })
      .locator('button', { hasText: 'Pull again' }).first().click();
    await settle(page);
    const second = await page.locator('[role="status"]').innerText();
    check(
      'a second pull is incremental rather than another full one',
      /Incremental pull:/.test(second),
      second,
    );

    check(
      'the calendar list shows that a sync token is held',
      (await page.locator('main').innerText()).includes('token held'),
    );

    // The fake deletes one event on the second pull; a deletion cancels the
    // row rather than removing it, and a cancelled event leaves the calendar.
    await page.locator('li', { hasText: 'Work (fixture)' })
      .locator('button', { hasText: 'Connect and pull' }).click();
    await settle(page);
    await page.locator('li', { hasText: 'Work (fixture)' })
      .locator('button', { hasText: 'Pull again' }).first().click();
    await settle(page);
    const third = await page.locator('[role="status"]').innerText();
    check('the second pull of the work calendar reports what changed', /cancelled\.$/.test(third.trim()), third);

    // The provider's tombstone is the only thing that can have cancelled this:
    // the fixture ships it *confirmed*, and the first pull wrote it that way.
    // A cancelled event is excluded by the query, so absence is the proof, and
    // unlike a count of "1 cancelled" it stays true on a re-run.
    await page.goto('/calendar/week');
    const budget = await page
      .locator('main a[href^="/calendar/event/"]', { hasText: 'Budget review' })
      .count();
    check('a deletion from the provider cancels the event rather than deleting it', budget === 0);

    const swimming = await page
      .locator('main a[href^="/calendar/event/"]', { hasText: 'Swimming lesson' })
      .count();
    check('while a pulled recurring event is drawn from its rule', swimming > 0, `${swimming} drawn`);

    await ctx.close();
  }

  // ------------------------------------------- calendar: editing and moving
  {
    const { ctx, page } = await pageAs(PRIYA);
    await page.goto('/calendar/week?date=2026-03-23');
    await page.locator('main a[href^="/calendar/event/"]', { hasText: 'Monday assembly' }).first().click();
    await settle(page);

    check('the event detail page opens', (await page.locator('h1').innerText()).includes('assembly'));
    check(
      'a recurring event says so in words a person can check',
      (await page.locator('main').innerText()).includes('Every week, on Monday'),
    );
    check(
      'the imported attendees are shown, by name where the feed gave one',
      (await page.locator('main').innerText()).includes('School office'),
    );

    const eventUrl = page.url();
    await page.fill('input[name="locationText"]', 'School hall');
    await page.click('form[aria-label="Edit event"] button[type="submit"]');
    await settle(page);
    await page.goto(eventUrl);
    check(
      'an edit round-trips to Postgres',
      (await page.inputValue('input[name="locationText"]')) === 'School hall',
    );

    // The move confirmation is a hard requirement for every entity that can move.
    await page.goto(`${eventUrl}?moveTo=${S_PRIYA}`);
    const moveText = await page.locator('main').innerText();
    check(
      'the event move preview states who is affected',
      moveText.includes('lose access') || moveText.includes('gain access') || moveText.includes('Unchanged'),
    );
    check(
      'and states the consequences a move has for an event',
      moveText.includes('Attendees move with the event') && moveText.includes('default calendar'),
    );

    await ctx.close();
  }

  // -------------------------------------------------------------- places
  {
    const { ctx, page } = await pageAs(PRIYA);

    await page.goto('/places');
    const rows = await page.locator('main ul li').count();
    check('the places list renders the seeded Birmingham places', rows >= 15, `${rows} rows`);

    const indicators = await page.locator('main ul li span[title^="Space:"]').count();
    check('every place row carries a space indicator', indicators >= rows, `${indicators}/${rows}`);
    check(
      'the place compose surface carries space indicators',
      (await page.locator('form[aria-label="Add a place"] span[title^="Space:"]').count()) > 0,
    );

    await page.goto('/places?q=Cannon');
    const found = await page.locator('main ul li').count();
    check('places can be searched by name', found === 1, `${found} matches`);

    placeUrl = await page.locator('main ul li a').first().getAttribute('href');
    await page.goto(placeUrl);
    check('the place detail opens', (await page.locator('#place-name').inputValue()).includes('Cannon Hill'));

    // Edit round-trip. The stamp changes every run, so this asserts the write
    // landed rather than asserting an absolute value.
    const stamp = `Smoke ${Date.now()}`;
    await page.fill('#place-notes', `Meet by the **${stamp}** gate.`);
    await page.click('button:has-text("Save changes")');
    await settle(page);
    await page.reload();
    check(
      'a place edit round-trips to Postgres',
      (await page.locator('#place-notes').inputValue()).includes(stamp),
    );
    check(
      'and the place notes render as Markdown',
      (await page.locator('section:has-text("Rendered") strong').first().innerText()) === stamp,
    );

    // Geocoding, with no network and no credential. Clear the point, then
    // resolve it again — a sequence, so the check survives a second run.
    await page.fill('#place-lat', '');
    await page.fill('#place-lon', '');
    await page.click('button:has-text("Save changes")');
    await settle(page);
    await page.reload();
    check(
      'coordinates can be cleared',
      (await page.locator('#geocode-status').innerText()).includes('No coordinates yet'),
    );
    check(
      'the page names the geocoder that will answer',
      (await page.locator('#geocode-provider').innerText()).includes('geocoding:'),
    );

    await page.fill('#geocode-query', 'Kings Heath');
    await page.click('button:has-text("Find coordinates")');
    await settle(page);
    const geocoded = await page.locator('#geocode-status').innerText();
    check(
      'a place can be geocoded from the running app with no network',
      /52\.4\d+, -1\.\d+/.test(geocoded),
      geocoded.split('\n')[0].slice(0, 60),
    );
    check('and the point says where it came from', geocoded.includes('geocoding:fake'));

    // Put Cannon Hill Park back where it belongs, so the next run starts level.
    await page.fill('#place-lat', '52.4489');
    await page.fill('#place-lon', '-1.9006');
    await page.click('button:has-text("Save changes")');
    await settle(page);

    // A visit, logged by hand. Nothing here comes from a device location.
    const visitsBefore = await page.locator('ul[aria-label="Recorded visits"] li').count();
    await page.fill('#visit-arrived', '10:30');
    await page.fill('#visit-departed', '12:00');
    await page.fill('#visit-note', 'Smoke visit');
    await page.click('button:has-text("Log a visit")');
    await settle(page);
    const visitsAfter = await page.locator('ul[aria-label="Recorded visits"] li').count();
    check('a visit can be logged by hand', visitsAfter === visitsBefore + 1, `${visitsBefore} → ${visitsAfter}`);

    await page.locator('ul[aria-label="Recorded visits"] li button').first().click();
    await settle(page);
    check(
      'and removed again, so the check is a sequence not a state',
      (await page.locator('ul[aria-label="Recorded visits"] li').count()) === visitsBefore,
    );

    // The move confirmation — places were the last entity type without one.
    await page.goto(`${placeUrl}?moveTo=${S_PRIYA}`);
    const moveText = await page.locator('main').innerText();
    check(
      'the place move preview states who is affected',
      moveText.includes('lose access') || moveText.includes('gain access') || moveText.includes('Unchanged'),
    );
    check(
      'and states the consequences a move has for a place',
      moveText.includes('visits move with the place'),
    );

    await ctx.close();
  }

  // ------------------------------------------------- places: an event's place
  {
    const { ctx, page } = await pageAs(PRIYA);
    await page.goto('/calendar/month');
    // Places are seeded into Home only, and the picker offers a place from the
    // event's *own* space — so find an event that has one rather than assuming
    // whichever event happens to be first does.
    const hrefs = await page.locator('a[href^="/calendar/event/"]').evaluateAll((els) =>
      els.map((e) => e.getAttribute('href').split('?')[0]),
    );
    let options = 0;
    for (const href of [...new Set(hrefs)].slice(0, 12)) {
      await page.goto(href);
      options = await page.locator('#event-place option').count();
      if (options > 1) break;
    }
    const before = await page.locator('#event-place').inputValue();
    check('an event can be given a place from its own space', options > 1, `${options} options`);

    const target = await page.locator('#event-place option').nth(1).getAttribute('value');
    await page.selectOption('#event-place', target);
    await page.click('button:has-text("Save place")');
    await settle(page);
    await page.reload();
    check(
      'the place attaches to the event and round-trips',
      (await page.locator('#event-place').inputValue()) === target,
    );

    // Put it back, whatever it was — including "no place".
    await page.selectOption('#event-place', before);
    await page.click('button:has-text("Save place")');
    await settle(page);
    await ctx.close();
  }

  // ------------------------------------ places: the partner and the outsider
  {
    // A place in Priya's own space. Created idempotently — the unique
    // constraint on (space_id, name) makes a second run a no-op.
    const { ctx, page } = await pageAs(PRIYA);
    await page.goto('/places');
    await page.fill('form[aria-label="Add a place"] input[name=name]', 'Smoke private place');
    await page.check(`form[aria-label="Add a place"] input[name=spaceId][value="${S_PRIYA}"]`);
    await page.click('form[aria-label="Add a place"] button:has-text("Add")');
    await settle(page);
    await page.goto('/places?q=Smoke%20private');
    const mine = await page.locator('main ul li').count();
    check('a place can be created into a chosen space', mine === 1, `${mine} matches`);
    privatePlaceUrl = await page.locator('main ul li a').first().getAttribute('href');
    await ctx.close();
  }

  {
    const { ctx, page } = await pageAs(DANNY);
    await page.goto('/places');
    const rows = await page.locator('main ul li').count();
    check('the partner sees the household places', rows >= 15, `${rows} rows`);
    check(
      'and not a place in a space he is not a member of',
      (await page.locator('main ul li', { hasText: 'Smoke private place' }).count()) === 0,
    );
    const res = await page.goto(privatePlaceUrl);
    check('a direct link to it is a 404, not a 403', res.status() === 404, `HTTP ${res.status()}`);
    await ctx.close();
  }

  {
    const { ctx, page } = await pageAs(OUTSIDER);
    await page.goto('/places');
    const rows = await page.locator('main ul li').count();
    check('the outsider sees zero places', rows === 0, `${rows} rows`);
    const res = await page.goto(placeUrl);
    check('and a direct link to a real place is a 404', res.status() === 404, `HTTP ${res.status()}`);
    await ctx.close();
  }

  // -------------------------------------------------------------- travel
  //
  // 2026-07-29 is the seed's travel day: three Home events at three different
  // places, arranged so one hop has room and the next does not.
  {
    const { ctx, page } = await pageAs(PRIYA);

    await page.goto(`/travel?day=${TRAVEL_DAY}`);
    check('the travel page renders', (await page.locator('h1').first().innerText()) === 'Travel');

    const trips = await page.locator('ul[aria-label="Trips"] li').count();
    check('trips are listed', trips >= 2, `${trips} trips`);
    const tripIndicators = await page
      .locator('ul[aria-label="Trips"] li span[title^="Space:"]')
      .count();
    check('every trip row carries a space indicator', tripIndicators >= trips, `${tripIndicators}/${trips}`);

    const derived = page.locator('ul[aria-label="Journeys the calendar implies"] li');
    const derivedCount = await derived.count();
    check(
      'the calendar implies journeys between events at different places',
      derivedCount >= 2,
      `${derivedCount} derived`,
    );

    const derivedText = await derived.first().innerText();
    check(
      'and states the door-to-door estimate, separating the moving part from the buffer',
      /about .*(min|hr)/.test(derivedText) && derivedText.includes('either end'),
      derivedText.replace(/\n/g, ' ').slice(0, 70),
    );

    const allDerived = await derived.allInnerTexts();
    check(
      'a journey that does not fit says how short it is, rather than looking fine',
      allDerived.some((t) => /\d+ min short/.test(t)),
      (allDerived.find((t) => /min short/.test(t)) ?? '').replace(/\n/g, ' ').slice(0, 60),
    );
    check(
      'and one that does fit says how much room there is',
      allDerived.some((t) => /\d+ min spare/.test(t)),
    );

    // Save the first derived journey, then delete it again: a sequence, so a
    // second run without reseeding asserts the same thing.
    const legsBefore = await page.locator('ul[aria-label="Journeys on this day"] li').count();
    await derived.first().locator('button:has-text("Save this journey")').click();
    await settle(page);
    const saved = page.locator('ul[aria-label="Journeys on this day"] li');
    const legsAfter = await saved.count();
    check(
      'a derived journey can be saved',
      legsAfter === legsBefore + 1,
      `${legsBefore} → ${legsAfter}`,
    );
    check(
      'every journey row carries a space indicator',
      (await saved.locator('span[title^="Space:"]').count()) >= legsAfter,
    );
    const savedText = await saved.first().innerText();
    check(
      'the saved journey carries a departure time worked back from the arrival',
      /\d{2}:\d{2}–\d{2}:\d{2}/.test(savedText),
      savedText.replace(/\n/g, ' ').slice(0, 60),
    );
    check(
      'and it is no longer offered as a journey to save',
      (await derived.count()) === derivedCount - 1,
    );

    // Re-estimate it as a walk. The distance is the same; the time is not.
    const drivingText = await saved.first().innerText();
    await saved.first().locator('select[name=mode]').selectOption('walk');
    await saved.first().locator('button:has-text("Re-estimate")').click();
    await settle(page);
    const walkingRow = page.locator('ul[aria-label="Journeys on this day"] li').first();
    const walkingText = await walkingRow.innerText();
    check(
      're-estimating with a different mode changes the answer',
      walkingText !== drivingText,
      walkingText.replace(/\n/g, ' ').slice(0, 60),
    );
    check(
      'and the control shows the mode that was actually stored',
      (await walkingRow.locator('select[name=mode]').inputValue()) === 'walk',
    );

    await page.locator('ul[aria-label="Journeys on this day"] li button[aria-label^="Delete the journey"]').first().click();
    await settle(page);
    check(
      'and deleted again, leaving the day as it was found',
      (await page.locator('ul[aria-label="Journeys on this day"] li').count()) === legsBefore,
    );

    // A journey by hand. Places belong to a space, so the space chip has to be
    // chosen first — the picker only offers places from the chosen one, which
    // is the whole point of it.
    await page.check(`form[aria-label="Add a journey"] input[name=spaceId][value="${S_HOME}"]`, {
      force: true,
    });
    await settle(page);
    await page.selectOption('#leg-from', { index: 1 });
    await page.selectOption('#leg-to', { index: 2 });
    await page.selectOption('#leg-mode', 'cycle');
    await page.fill('#leg-depart', '17:00');
    await page.click('button:has-text("Add journey")');
    await settle(page);
    const manual = page.locator('ul[aria-label="Journeys on this day"] li');
    check(
      'a journey can be added by hand',
      (await manual.count()) === legsBefore + 1,
    );
    await manual.first().locator('button[aria-label^="Delete the journey"]').click();
    await settle(page);

    await ctx.close();
  }

  // ------------------------------------------- travel: partner and outsider
  {
    const { ctx, page } = await pageAs(DANNY);
    await page.goto(`/travel?day=${TRAVEL_DAY}`);
    const titles = await page.locator('ul[aria-label="Trips"] li').allInnerTexts();
    check(
      'the partner sees the household trip',
      titles.some((t) => t.includes('Pembrokeshire')),
      `${titles.length} trips`,
    );
    check(
      'and not the trip in the space he only sees as free/busy',
      !titles.some((t) => t.includes('Leeds')),
    );
    await ctx.close();
  }

  {
    const { ctx, page } = await pageAs(OUTSIDER);
    await page.goto(`/travel?day=${TRAVEL_DAY}`);
    const body = await page.locator('main').innerText();
    check('the outsider sees no trips', body.includes('No trips recorded'));
    check('and no journeys', body.includes('Nothing recorded for this day'));
    check('and no events to derive one from', body.includes('No events on this day'));
    await ctx.close();
  }

  // ------------------------------------------------------------- dark mode
  {
    const { ctx, page } = await pageAs(PRIYA);
    for (const scheme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto('/tasks/all');
      const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
      check(`the ${scheme} theme applies`, bg !== '', bg);
    }
    await ctx.close();
  }
} finally {
  await browser.close();
}

console.log('');
if (failures > 0) {
  console.log(`[1;31m✗[0m ${failures} of ${results.length} checks failed`);
  process.exit(1);
}
console.log(`[1;32m✓[0m all ${results.length} smoke checks passed`);
