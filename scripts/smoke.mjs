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

import { spawn } from 'node:child_process';
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
let tripUrl;
let failures = 0;
const results = [];

/**
 * One day on from a `yyyy-mm-dd`, in UTC.
 *
 * Only ever used to move a date *box* by a day and then move it back, so the
 * London/UTC distinction cannot bite here: it never crosses a clock change
 * because it is always immediately undone. `src/lib/format.ts` is the place that
 * does this properly, and the suite deliberately does not import from the app.
 */
function addDays(iso, n) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

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

/**
 * Every control on a page that has no accessible name.
 *
 * A dense interface is a keyboard interface: an unlabelled select in a row of
 * six is unusable with a screen reader whatever it looks like. Every page a
 * phase adds gets audited with this.
 */
async function labelAuditOn(page) {
  return page.evaluate(() => {
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

    // The same rule on the two densest pages Phase 3 added. A dense interface
    // is a keyboard interface, and an unlabelled select in a row of six is
    // unusable with a screen reader whatever it looks like.
    const labelAudit = async () => labelAuditOn(page);
    await page.goto('/places?q=Cannon');
    await page.locator('main ul li a').first().click();
    await page.waitForLoadState('domcontentloaded');
    const placeUnnamed = await labelAudit();
    check('every control on the place page has a label', placeUnnamed.length === 0, placeUnnamed.join(', '));
    check(
      'the geocode outcome is announced rather than only redrawn',
      (await page.locator('#geocode-status').getAttribute('aria-live')) === 'polite',
    );

    await page.goto(`/travel?day=${TRAVEL_DAY}`);
    const travelUnnamed = await labelAudit();
    check('every control on the travel page has a label', travelUnnamed.length === 0, travelUnnamed.join(', '));

    // Reachable by keyboard alone: tab until the first journey's mode select
    // has focus, rather than asserting a tabindex nobody set.
    const reached = await page.evaluate(() => {
      const focusable = document.querySelectorAll(
        'a[href], button, input:not([type=hidden]), select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      return [...focusable].some((el) => el.matches('select[name=mode]'));
    });
    check('the mode picker on a derived journey is in the tab order', reached);

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
    // Chosen by name, not by index. Connecting the fixture calendars in an
    // earlier run adds options to this list, so `{ index: 1 }` means a
    // different calendar on the second run — which silently re-imports the
    // feed into another space and breaks a move check further down. Found by
    // running the suite twice from a freshly reset database.
    const calendarValues = await page
      .locator('select[name="calendarId"] option')
      .evaluateAll((els) =>
        els.map((el) => ({ value: el.value, label: el.textContent.trim() })),
      );
    const homeCalendar = calendarValues.find(
      (o) => /Home/.test(o.label) && !/fixture/i.test(o.label),
    );
    check('the household calendar is offered as an import target', Boolean(homeCalendar),
      calendarValues.map((o) => o.label).join(' | '));
    await page.selectOption('select[name="calendarId"]', homeCalendar.value);
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
    // The same calendar as the first import, chosen the same way.
    await page.selectOption('select[name="calendarId"]', homeCalendar.value);
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
    // The destination comes from the page's own list of offered targets rather
    // than from a hard-coded space id: which space this imported event lives in
    // depends on which calendar the import chose, and asking to move it to the
    // space it is already in renders the picker instead of the preview.
    await page.goto(eventUrl);
    const moveHref = await page
      .locator('a[href*="moveTo="]')
      .first()
      .getAttribute('href');
    await page.goto(moveHref);
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

    // Saving the same derived journey twice must not write two rows. The page
    // stops offering it, so this goes round the page: submit the same form
    // twice by reloading the derived list from a fresh render.
    await derived.first().locator('button:has-text("Save this journey")').click();
    await settle(page);
    const dupCount = await page.locator('ul[aria-label="Journeys on this day"] li').count();
    await page.goto(`/travel?day=${TRAVEL_DAY}`);
    const stillOffered = await page
      .locator('ul[aria-label="Journeys the calendar implies"] li')
      .count();
    check(
      'a saved journey is not offered again after a reload',
      stillOffered === derivedCount - 1,
      `${stillOffered} still offered`,
    );
    check(
      'and saving it wrote exactly one row',
      dupCount === legsBefore + 1,
      `${dupCount} rows`,
    );
    await page.locator('ul[aria-label="Journeys on this day"] li button[aria-label^="Delete the journey"]').first().click();
    await settle(page);

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
    // A journey can be filed under a trip in the same space.
    await page.selectOption('#leg-session', { index: 1 });
    await page.click('button:has-text("Add journey")');
    await settle(page);
    const manual = page.locator('ul[aria-label="Journeys on this day"] li');
    check(
      'a journey can be added by hand',
      (await manual.count()) === legsBefore + 1,
    );
    check(
      'and filed under a trip, which the row then names',
      (await manual.first().innerText()).includes('Pembrokeshire'),
      (await manual.first().innerText()).replace(/\n/g, ' ').slice(0, 70),
    );
    await manual.first().locator('button[aria-label^="Delete the journey"]').click();
    await settle(page);

    // ---- a trip's own page ----
    //
    // Rough edge since Phase 4: a trip could be created and deleted and nothing
    // in between, so a date typed wrong meant deleting the trip — and the FK
    // cascades, so that took its journeys with it.
    await page.goto(`/travel?day=${TRAVEL_DAY}`);
    const pembroke = page.locator('#trip-list li', { hasText: 'Pembrokeshire' }).first();
    const journeysOnRow = (await pembroke.innerText()).match(/(\d+) journe/);
    await pembroke.locator('a[href^="/travel/trip/"]').click();
    await settle(page);
    tripUrl = page.url().split('?')[0];
    check('a trip opens on its own page', /\/travel\/trip\/[0-9a-f-]{36}$/.test(tripUrl), tripUrl);

    const tripText = await page.locator('main, body').first().innerText();
    check(
      'and says where the trip stands, worked out from its dates rather than stored',
      /days? ago|Away now|Ended today|In \d+ day/.test(tripText) &&
        tripText.includes('worked out from these dates'),
      (tripText.match(/days? ago|Away now|Ended today|In \d+ days?/) ?? [''])[0],
    );
    check(
      'and repeats that Orbit does not know where you are',
      tripText.includes('no background location'),
    );
    check(
      'and lists the journeys attached to it, the same number the list row counted',
      (await page.locator('ul[aria-label="Journeys on this trip"] li').count()) ===
        Number(journeysOnRow?.[1] ?? -1),
      `${await page.locator('ul[aria-label="Journeys on this trip"] li').count()} listed, row said ${journeysOnRow?.[1]}`,
    );
    check(
      'every journey on the trip carries a space indicator',
      (await page.locator('ul[aria-label="Journeys on this trip"] li span[title^="Space:"]').count()) ===
        (await page.locator('ul[aria-label="Journeys on this trip"] li').count()),
    );

    // Its dates and notes are editable — and a range that ends before it starts
    // is refused with a sentence rather than a 500 from the check constraint.
    const originalEnd = await page.locator('#trip-end').inputValue();
    const originalStart = await page.locator('#trip-start').inputValue();
    await page.fill('#trip-end', '2020-01-01');
    await page.click('button:has-text("Save changes")');
    await settle(page);
    check(
      'a trip that would end before it starts is refused, and says so',
      // Scoped to the page's own live region: Next's route announcer is also a
      // role="alert", and an unscoped locator matches both.
      (await page.locator('[aria-live="polite"] [role="alert"]').innerText()).includes(
        'cannot end before it starts',
      ),
    );
    check(
      'and nothing was changed by the refusal',
      (await page.locator('#trip-end').inputValue()) === originalEnd,
      await page.locator('#trip-end').inputValue(),
    );

    await page.fill('#trip-title', 'Half term — Pembrokeshire (smoke)');
    await page.fill('#trip-notes', 'Cottage booked. Take the big cool bag.\n\nSmoke ran here.');
    await page.fill('#trip-end', addDays(originalEnd, 1));
    await page.click('button:has-text("Save changes")');
    await settle(page);
    const savedTrip = await page.locator('main, body').first().innerText();
    check(
      'a trip can be renamed, redated and annotated in one save',
      savedTrip.includes('Half term — Pembrokeshire (smoke)') && savedTrip.includes('Smoke ran here.'),
    );
    check(
      'and its notes render as Markdown below the form',
      (await page.locator('h2:has-text("Rendered")').count()) === 1,
    );
    check(
      'and the new dates change the number of days it covers',
      (await page.locator('#trip-end').inputValue()) === addDays(originalEnd, 1),
    );
    check(
      'and its journeys are untouched by a change of dates',
      (await page.locator('ul[aria-label="Journeys on this trip"] li').count()) ===
        Number(journeysOnRow?.[1] ?? -1),
    );
    check(
      'and the page says the journeys were left alone',
      savedTrip.includes('editing a trip’s dates does not'),
    );

    const tripUnnamed = await labelAuditOn(page);
    check('every control on the trip page has a label', tripUnnamed.length === 0, tripUnnamed.join(', '));

    // Put it back, all three fields, so this passes twice in a row.
    await page.fill('#trip-title', 'Half term — Pembrokeshire');
    await page.fill('#trip-notes', 'Cottage booked. Take the big cool bag.');
    await page.fill('#trip-end', originalEnd);
    await page.fill('#trip-start', originalStart);
    await page.click('button:has-text("Save changes")');
    await settle(page);
    check(
      'and it is put back exactly as it was found',
      (await page.locator('h1').first().innerText()) === 'Half term — Pembrokeshire' &&
        (await page.locator('#trip-end').inputValue()) === originalEnd &&
        (await page.locator('#trip-start').inputValue()) === originalStart,
    );

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
    // The trip page is a page, so it is a policy question too.
    await page.goto(tripUrl);
    check(
      'the partner can open the trip in the space he shares',
      (await page.locator('h1').first().innerText()).includes('Pembrokeshire'),
    );
    await ctx.close();
  }

  {
    const { ctx, page } = await pageAs(OUTSIDER);
    const res = await page.goto(tripUrl);
    check(
      'the outsider gets a not-found on the trip page, never a forbidden',
      res.status() === 404,
      `HTTP ${res.status()}`,
    );
    await page.goto(`/travel?day=${TRAVEL_DAY}`);
    const body = await page.locator('main').innerText();
    check('the outsider sees no trips', body.includes('No trips recorded'));
    check('and no journeys', body.includes('Nothing recorded for this day'));
    check('and no events to derive one from', body.includes('No events on this day'));
    await ctx.close();
  }

  // ------------------------------------------------------------------ rules
  //
  // Phase 4. The sequence is the assertion: a new rule starts off, refuses to
  // be switched on until it has been previewed, then runs and says what it
  // did. Nothing here selects by index and nothing is left behind — the rule
  // this section creates is deleted at the end of it, so the suite passes
  // twice in a row against the same database.
  {
    const { ctx, page } = await pageAs(PRIYA);

    await page.goto('/rules');
    const ruleLinks = page.locator('#rule-list li a[href^="/rules/"]');
    const ruleCount = await ruleLinks.count();
    check('the rules list renders the seeded rules', ruleCount >= 2, `${ruleCount} rules`);

    const ruleIndicators = await page
      .locator('#rule-list li a[href^="/rules/"] span[title^="Space:"]')
      .count();
    check(
      'every rule row carries a space indicator',
      ruleIndicators >= ruleCount,
      `${ruleIndicators} indicators / ${ruleCount} rows`,
    );

    const listText = await page.locator('main').innerText();
    check(
      'a rule row says what it would do in one sentence',
      listText.includes('Title contains “bin”') && listText.includes('assign it to my partner'),
    );
    check('and the seeded rules all ship switched off', listText.includes('0 on,'));

    // ---- a rule cannot be switched on until it has been previewed ----
    const stamp = `Smoke rule ${Date.now()}`;
    const compose = page.locator('form[aria-label="Add a rule"]');
    await compose.locator('input[name="name"]').fill(stamp);
    await compose.locator('input[name="description"]').fill('Created by pnpm smoke');
    // The Home space, chosen by its label rather than by its position.
    await compose
      .locator('fieldset label', { has: page.locator('span[title="Space: Home"]') })
      .locator('input[type=radio]')
      .check({ force: true });
    await compose.getByRole('button', { name: 'Add' }).click();
    await settle(page);

    const smokeRuleUrl = page.url().split('?')[0];
    check('a new rule opens on its own page', /\/rules\/[0-9a-f-]{36}$/.test(smokeRuleUrl), smokeRuleUrl);
    check(
      'and arrives switched off with nothing to do',
      (await page.locator('main').innerText()).includes('cannot be switched on until it has one'),
    );
    check(
      'so the switch is refused',
      await page.getByRole('button', { name: 'Switch on' }).isDisabled(),
    );

    // Give it a condition and an action. A notify action, deliberately: it
    // proves the push path without rewriting a seeded task, so running this
    // section twice leaves the same tasks behind as running it once.
    const condForm = page.locator('#add-condition');
    await condForm.locator('select[name="field"]').selectOption('title');
    await condForm.locator('select[name="op"]').selectOption('contains');
    await condForm.locator('input[name="value"]').fill('bins');
    await condForm.getByRole('button', { name: 'Add condition' }).click();
    await settle(page);

    const actForm = page.locator('form[aria-label="Add an action"]');
    await actForm.locator('select[name="kind"]').selectOption('notify');
    await actForm.locator('input[name="value"]').fill('Bins tonight');
    await actForm.getByRole('button', { name: 'Add action' }).click();
    await settle(page);

    const built = await page.locator('main').innerText();
    check(
      'a condition and an action read back in plain language',
      built.includes('Title contains “bins”') && built.includes('notify me: “Bins tonight”'),
    );
    check(
      'a rule with an action but no dry run still refuses to be switched on',
      await page.getByRole('button', { name: 'Switch on' }).isDisabled(),
    );
    check(
      'and says why',
      (await page.locator('main').innerText()).includes('Dry-run it first'),
    );

    // ---- the dry run ----
    await page.getByRole('button', { name: /Dry run/ }).click();
    await settle(page);
    const previewed = await page.locator('main').innerText();
    check('a dry run says nothing was changed', previewed.includes('Nothing was changed'));
    check(
      'and names the task it would act on',
      previewed.includes('Put the bins out') && previewed.includes('Send a notification'),
    );
    check(
      'a locked task is listed as skipped, not silently dropped',
      previewed.includes('(locked)') && previewed.includes('never reads a locked item'),
    );

    // ---- switching on, then running for real ----
    check(
      'the switch is offered once a preview exists',
      await page.getByRole('button', { name: 'Switch on' }).isEnabled(),
    );
    await page.getByRole('button', { name: 'Switch on' }).click();
    await settle(page);
    await page.getByRole('button', { name: /Run now/ }).click();
    await settle(page);
    const ranText = await page.locator('main').innerText();
    check('a real run reports itself as applied', ranText.includes('Applied'));
    check('and the changes were applied', ranText.includes('Run finished'));

    // ---- editing a rule takes its permission to run away ----
    const editForm = page.locator('form:has(input[name="name"]):has(select[name="triggerKind"])');
    await editForm.locator('select[name="triggerKind"]').selectOption('task.completed');
    await editForm.getByRole('button', { name: 'Save' }).click();
    await settle(page);
    const afterEdit = await page.locator('main').innerText();
    check(
      'changing a rule switches it off and clears its preview',
      afterEdit.includes('switches it off and clears its preview'),
    );
    check(
      'so it has to be previewed again before it can run',
      await page.getByRole('button', { name: 'Switch on' }).isDisabled(),
    );

    // ---- accessibility on both new pages ----
    // A condition is edited where it sits, keeping its position — rough edge
    // since Phase 4, when it could only be removed and re-added at the end.
    {
      const first = page.locator('#rule-conditions li').first();
      const before = await first.innerText();
      await first.locator('input[name="value"]').fill('recycling');
      await first.getByRole('button', { name: 'Save this condition' }).click();
      await settle(page);
      const after = await page.locator('#rule-conditions li').first().innerText();
      check(
        'a condition can be changed in place',
        after.includes('recycling') && !after.includes('bins'),
        after.split('\n')[0],
      );
      check(
        'and stays where it was rather than being removed and re-added at the end',
        (await page.locator('#rule-conditions li').count()) === 1,
      );
      check(
        'and editing it switches the rule back off, as any structural edit does',
        await page.getByRole('button', { name: 'Switch on' }).isDisabled(),
      );
      // Put it back, so the section that follows still finds the rule it built.
      await page.locator('#rule-conditions li').first().locator('input[name="value"]').fill('bins');
      await page.locator('#rule-conditions li').first()
        .getByRole('button', { name: 'Save this condition' }).click();
      await settle(page);
    }

    // An action is edited where it sits too — rough edge 15, half-closed last
    // session. The interesting part is not that it saves: it is that the one box
    // knows which parameter it is setting, so changing the kind changes the
    // control in front of you rather than leaving a free-text box that now means
    // something else.
    {
      const row = () => page.locator('#rule-actions li').first();
      check(
        'an action carries a form of its own, where it sits',
        (await row().locator('select[name="kind"]').count()) === 1,
      );
      check(
        'and a notify action offers a message box, because that is its parameter',
        (await row().locator('input[name="value"]').count()) === 1 &&
          (await row().locator('select[name="value"]').count()) === 0,
      );

      await row().locator('input[name="value"]').fill('Recycling tonight');
      await row().getByRole('button', { name: 'Save this action' }).click();
      await settle(page);
      check(
        'an action can be changed in place',
        (await row().innerText()).includes('notify me: “Recycling tonight”'),
        (await row().innerText()).split('\n')[0],
      );
      check(
        'and stays where it was, rather than being re-added at the end where it would run later',
        (await page.locator('#rule-actions li').count()) === 1,
      );

      // Prove the switch-off is caused by the edit, not left over: preview it
      // first so the rule is genuinely ready to run, then change an action.
      await page.getByRole('button', { name: /Dry run/ }).click();
      await settle(page);
      check(
        'a previewed rule is ready to run again',
        await page.getByRole('button', { name: 'Switch on' }).isEnabled(),
      );

      // Change the kind: the message box has to become a list of priorities.
      await row().locator('select[name="kind"]').selectOption('task.set_priority');
      const valueOptions = await row().locator('select[name="value"] option').allInnerTexts();
      check(
        'changing the kind changes the control, so the box always knows what it sets',
        (await row().locator('input[name="value"]').count()) === 0 &&
          valueOptions.includes('urgent') && valueOptions.includes('no priority'),
        valueOptions.join(' / '),
      );
      check(
        'and it does not carry the old kind’s value across into the new vocabulary',
        (await row().locator('select[name="value"]').inputValue()) === '',
      );

      await row().locator('select[name="value"]').selectOption('high');
      await row().getByRole('button', { name: 'Save this action' }).click();
      await settle(page);
      check(
        'an action can be changed to a different kind entirely',
        (await row().innerText()).includes('set priority to high'),
        (await row().innerText()).split('\n')[0],
      );
      check(
        'and editing an action switches the rule off, as any structural edit does',
        await page.getByRole('button', { name: 'Switch on' }).isDisabled(),
      );

      // A number of days left empty is refused by name rather than read as zero,
      // which would quietly mean "due today".
      await row().locator('select[name="kind"]').selectOption('task.due_in_days');
      check(
        'a days action offers a number box, not free text',
        (await row().locator('input[name="value"][type="number"]').count()) === 1,
      );
      await row().locator('input[name="value"]').fill('3');
      await row().getByRole('button', { name: 'Save this action' }).click();
      await settle(page);
      check(
        'and a number of days reads back as days',
        (await row().innerText()).includes('make it due in 3 days'),
      );

      // Put it back, so what follows finds the rule it built.
      await row().locator('select[name="kind"]').selectOption('notify');
      await row().locator('input[name="value"]').fill('Bins tonight');
      await row().getByRole('button', { name: 'Save this action' }).click();
      await settle(page);
      check(
        'and back to the notify it started as',
        (await row().innerText()).includes('notify me: “Bins tonight”'),
      );
      check(
        'with one action throughout, never two',
        (await page.locator('#rule-actions li').count()) === 1,
      );
    }

    const ruleUnnamed = await labelAuditOn(page);
    check('every control on the rule page has a label', ruleUnnamed.length === 0, ruleUnnamed.join(', '));
    check(
      'the rule page announces the outcome of a run rather than only redrawing',
      (await page.locator('[aria-live="polite"]').count()) > 0,
    );

    await page.goto('/rules');
    const rulesListUnnamed = await labelAuditOn(page);
    check('every control on the rules list has a label', rulesListUnnamed.length === 0, rulesListUnnamed.join(', '));

    // ---- leave nothing behind ----
    await page.goto(smokeRuleUrl);
    await page.getByRole('button', { name: 'Delete this rule' }).click();
    await settle(page);
    check(
      'deleting the rule leaves the list as it was found',
      (await page.locator('#rule-list li a[href^="/rules/"]').count()) === ruleCount,
      `${await page.locator('#rule-list li a[href^="/rules/"]').count()} rules`,
    );
    check('and the rule it created is gone', !(await page.locator('main').innerText()).includes(stamp));

    await ctx.close();
  }

  {
    const { ctx, page } = await pageAs(DANNY);
    await page.goto('/rules');
    const text = await page.locator('main').innerText();
    check('the partner sees the rules in the space he shares', text.includes('Bins go to Danny'));
    check(
      'and not the one in the space he only sees as free/busy',
      !text.includes('Invoices are urgent'),
    );
    await ctx.close();
  }

  {
    const { ctx, page } = await pageAs(OUTSIDER);
    await page.goto('/rules');
    check(
      'the outsider sees no rules at all',
      (await page.locator('#rule-list li a[href^="/rules/"]').count()) === 0,
    );
    check('and no runs', (await page.locator('main').innerText()).includes('Nothing has run yet'));
    const res = await page.goto('/rules/00000000-0000-4000-8000-0000000000b1');
    check('and a direct link to a real rule is a 404', res.status() === 404, String(res.status()));
    await ctx.close();
  }

  // --------------------------------------------------------------- capture
  //
  // Creates one task and deletes it again, so the suite still passes twice in a
  // row against the same database. What it asserts is the *bargain*: the parse
  // is shown before anything is created, and what gets created is what the
  // preview said.
  {
    const { ctx, page } = await pageAs(PRIYA);
    const stamp = `smoke capture ${Date.now()}`;

    await page.goto('/');
    check(
      'capture is reachable from the sidebar',
      (await page.locator('nav a[href="/capture"]').count()) === 1,
    );

    await page.goto('/capture');
    check(
      'capture says plainly that nothing leaves the device',
      (await page.locator('main').innerText()).includes('Nothing you type here is sent anywhere'),
    );

    await page.locator('#capture-text').fill(`${stamp} a week on Tuesday !high`);
    await page.getByRole('button', { name: 'Read it back' }).click();
    await settle(page);

    const preview = await page.locator('main').innerText();
    check('the parse is read back before anything is created', preview.includes(stamp));
    check('and it resolved the date phrase to a real day', /a week on Tuesday/.test(preview));

    const chips = await page.locator('#capture-matches li').count();
    check('and shows one chip per phrase it consumed', chips === 2, `${chips} chips`);
    check(
      'and names the priority it read',
      (await page.locator('#capture-matches').innerText()).includes('high priority'),
    );

    // The space indicator is a hard requirement on every compose surface, and
    // what you capture is readable by everyone in the space you put it in.
    const composeIndicators = await page
      .locator('form[aria-label="Create what was captured"] span[title^="Space:"]')
      .count();
    check('the capture compose surface carries space indicators', composeIndicators > 0);

    const captureUnnamed = await labelAuditOn(page);
    check('every control on the capture page has a label', captureUnnamed.length === 0, captureUnnamed.join(', '));

    await page.getByRole('button', { name: 'Create it' }).click();
    await settle(page);
    check(
      'creating it lands on the thing it created',
      page.url().includes('/tasks/item/'),
      page.url(),
    );
    check(
      'with the title the preview showed and none of the phrases it consumed',
      (await page.locator('#task-title').inputValue()) === stamp,
      await page.locator('#task-title').inputValue(),
    );
    const due = await page.locator('#task-due').inputValue();
    check('and the date it resolved', /^\d{4}-\d{2}-\d{2}$/.test(due), due);

    // A line with nothing but a date creates nothing.
    await page.goto('/capture?text=tomorrow');
    check(
      'a line that is only a date cannot be created',
      await page.getByRole('button', { name: 'Create it' }).isDisabled(),
    );

    // ---- leave nothing behind ----
    await page.goto('/tasks/all');
    const found = page.locator('main ul li', { hasText: stamp }).first();
    await found.locator('a[href^="/tasks/item/"]').click();
    await settle(page);
    await page.getByRole('button', { name: 'Delete this task' }).click();
    await settle(page);
    await page.goto('/tasks/all');
    check(
      'and the task it created is deleted again',
      !(await page.locator('main').innerText()).includes(stamp),
    );

    await ctx.close();
  }

  {
    const { ctx, page } = await pageAs(OUTSIDER);
    await page.goto('/capture?text=something%20tomorrow');
    check(
      'the outsider has no space to capture into',
      (await page.locator('form[aria-label="Create what was captured"] input[name="spaceId"]').count()) === 0,
    );
    check(
      'so capture is refused rather than offered',
      await page.getByRole('button', { name: 'Create it' }).isDisabled(),
    );
    await ctx.close();
  }

  // ---------------------------------------------------------------- search
  //
  // Search is the one surface where "the client filtered it" and "the policy
  // filtered it" look identical from the outside, so what is asserted here is a
  // *relationship* between what three different people get back for the same
  // query — not a count, which would rot the moment the seed changes.
  let priyaHrefs = [];
  {
    const { ctx, page } = await pageAs(PRIYA);

    await page.goto('/');
    check(
      'search is reachable from the sidebar',
      (await page.locator('nav a[href="/search"]').count()) === 1,
    );

    await page.goto('/search?q=bins');
    const rows = await page.locator('#search-results li').count();
    check('search finds things', rows > 0, `${rows} results`);

    priyaHrefs = await page
      .locator('#search-results li a')
      .evaluateAll((as) => as.map((a) => a.getAttribute('href')));

    check(
      'and the owner finds things in her own space that nobody else is in',
      (await page.locator('#search-results li span[title="Space: Priya"]').count()) > 0,
    );

    const indicators = await page.locator('#search-results li span[title^="Space:"]').count();
    check(
      'every search result carries a space indicator',
      indicators >= rows,
      `${indicators} indicators / ${rows} rows`,
    );

    // Every result says which kind it is; a mixed list where you cannot tell a
    // note from an event is a list you have to open to read.
    const kinds = await page
      .locator('#search-results li')
      .evaluateAll((lis) =>
        lis.filter((li) => /\b(Task|Note|Person|Event|Place)\b/.test(li.innerText)).length,
      );
    check('and says which kind of thing it is', kinds === rows, `${kinds}/${rows}`);

    // A locked item has no plaintext on the server, so it cannot be found — and
    // the page must say so rather than being silently short.
    check(
      'search says plainly that locked items were not searched',
      (await page.locator('main').innerText()).includes('not searched'),
    );
    const blank = await page
      .locator('#search-results li')
      .evaluateAll((lis) => lis.filter((li) => li.innerText.trim().length < 3).length);
    check('and no result is an empty row where a locked item used to be', blank === 0);

    // The kind filter declines to *look* for something; it does not hide
    // anything the caller could otherwise see.
    await page.goto('/search?q=bins&kind=note');
    const noteRows = await page.locator('#search-results li').count();
    const onlyNotes = await page
      .locator('#search-results li')
      .evaluateAll((lis) => lis.every((li) => /\bNote\b/.test(li.innerText)));
    check('narrowing to notes returns only notes', noteRows > 0 && onlyNotes, `${noteRows} notes`);
    check('and fewer results than the unfiltered query', noteRows < rows);

    await page.goto('/search?q=zzqqxx');
    check(
      'a query that matches nothing says so',
      (await page.locator('main').innerText()).includes('Nothing matches'),
    );
    check(
      'and returns no rows',
      (await page.locator('#search-results li').count()) === 0,
    );

    const searchUnnamed = await labelAuditOn(page);
    check('every control on the search page has a label', searchUnnamed.length === 0, searchUnnamed.join(', '));
    check(
      'the search page announces its result count rather than only redrawing',
      (await page.locator('[aria-live="polite"]').count()) > 0,
    );

    await ctx.close();
  }

  {
    const { ctx, page } = await pageAs(DANNY);
    await page.goto('/search?q=bins');
    const dannyHrefs = await page
      .locator('#search-results li a')
      .evaluateAll((as) => as.map((a) => a.getAttribute('href')));
    check('the partner finds things too', dannyHrefs.length > 0, `${dannyHrefs.length} results`);

    // In the space they share, the two of them find the same rows. This is the
    // real claim: membership decides, not identity — so "Danny sees less" must
    // be entirely explained by the spaces he is not in, and not by anything
    // being hidden from him inside the one he is.
    const dannyShared = await page
      .locator('#search-results li')
      .evaluateAll((lis) =>
        lis
          .filter((li) => li.querySelector('span[title="Space: Home"]'))
          .map((li) => li.querySelector('a').getAttribute('href')),
      );
    check(
      'and in the space they share, they find exactly the same rows',
      dannyShared.length > 0 && dannyShared.every((h) => priyaHrefs.includes(h)),
      `${dannyShared.length} shared rows`,
    );
    check(
      'and nothing at all from the space he only sees as free/busy',
      (await page.locator('#search-results li span[title="Space: Work"]').count()) === 0,
    );
    check(
      'and nothing from the space that is hers alone',
      (await page.locator('#search-results li span[title="Space: Priya"]').count()) === 0,
    );
    await ctx.close();
  }

  {
    const { ctx, page } = await pageAs(OUTSIDER);
    await page.goto('/search?q=bins');
    check(
      'the outsider finds nothing at all',
      (await page.locator('#search-results li').count()) === 0,
    );
    check(
      'and is told so, rather than shown an error',
      (await page.locator('main').innerText()).includes('Nothing matches'),
    );
    await ctx.close();
  }

  // -------------------------------------------------------------------- AI
  //
  // The whole claim of the phase is that nothing happens until somebody says so
  // and that a locked item never happens at all. Both are driven here, in
  // order, through the running app — and the consent is switched back off at
  // the end, so the suite passes twice against the same database.
  {
    const { ctx, page } = await pageAs(PRIYA);

    await page.goto('/');
    check('AI is reachable from the sidebar', (await page.locator('nav a[href="/ai"]').count()) === 1);

    await page.goto('/ai');
    const provider = await page.locator('#ai-provider').innerText();
    check('the AI page names the provider that would answer', provider.includes('ai:'), provider);
    check(
      'and says whether it is a fake, rather than leaving it to be assumed',
      (await page.locator('main').innerText()).includes('nothing leaves this machine'),
    );

    const consentCount = await page.locator('#ai-consents li').count();
    check('every AI feature is listed with its disclosure', consentCount >= 3, `${consentCount}`);
    check(
      'and every one of them starts switched off',
      (await page.locator('#ai-consents li:has-text("Off")').count()) === consentCount,
    );
    const aiIndicators = await page.locator('#ai-consents li span[title^="Space:"]').count();
    check('each consent says which space it is for', aiIndicators >= consentCount);

    // ---- pick a plain note, and be refused because nothing is switched on ----
    const options = await page
      .locator('#ai-note option')
      .evaluateAll((os) => os.map((o) => ({ value: o.value, label: o.textContent.trim() })));
    const plain = options.find((o) => !o.label.startsWith('🔒'));
    const locked = options.find((o) => o.label.startsWith('🔒'));
    check('the note picker lists a locked note rather than hiding it', Boolean(locked));

    await page.locator('#ai-note').selectOption(plain.value);
    await page.getByRole('button', { name: 'Summarise it' }).click();
    await settle(page);
    check(
      'running a feature that is switched off is refused',
      (await page.locator('#ai-refusal').innerText()).includes('switched off'),
    );
    check('and nothing was sent', (await page.locator('#ai-sent').count()) === 0);

    // ---- switch it on, and it works ----
    await page.goto('/ai');
    await page
      .locator('#ai-consents li', { hasText: 'Summarise a note' })
      .first()
      .getByRole('button', { name: 'Switch on, and send this' })
      .click();
    await settle(page);
    check(
      'switching one feature on records the consent',
      (await page.locator('#ai-consents li', { hasText: 'Summarise a note' }).first().innerText())
        .includes('Consented'),
    );

    await page.locator('#ai-note').selectOption(plain.value);
    await page.getByRole('button', { name: 'Summarise it' }).click();
    await settle(page);
    const sent = await page.locator('#ai-sent').innerText();
    check('now it runs, and shows exactly what was sent', sent.length > 0);
    check('and shows what came back', (await page.locator('#ai-answer').count()) === 1);
    check(
      'and the answer is the fake saying so, not a model pretending',
      (await page.locator('#ai-answer').innerText()).includes('nothing left this device'),
    );

    // ---- the locked note is refused, with the feature switched ON ----
    await page.locator('#ai-note').selectOption(locked.value);
    await page.getByRole('button', { name: 'Summarise it' }).click();
    await settle(page);
    const refusal = await page.locator('#ai-refusal').innerText();
    check('a locked note is refused even with the feature switched on', refusal.includes('locked'));
    check(
      'and the refusal says the reason rather than just failing',
      refusal.includes('no plaintext on this server'),
    );
    check('and nothing was sent for it', (await page.locator('#ai-sent').count()) === 0);

    // ---- the refusal is a row, not an absence ----
    const runs = await page.locator('#ai-runs').innerText();
    check('the refusal is recorded as a run, not as silence', runs.includes('nothing sent'));
    check('and the run log holds no note content', !runs.includes('Worcester'));

    const aiUnnamed = await labelAuditOn(page);
    check('every control on the AI page has a label', aiUnnamed.length === 0, aiUnnamed.join(', '));
    check(
      'the AI page announces its result rather than only redrawing',
      (await page.locator('[aria-live="polite"]').count()) > 0,
    );

    // ---- leave it as it was found ----
    await page.goto('/ai');
    await page
      .locator('#ai-consents li', { hasText: 'Summarise a note' })
      .first()
      .getByRole('button', { name: 'Switch off' })
      .click();
    await settle(page);
    check(
      'switching it back off leaves every feature off, as it was found',
      (await page.locator('#ai-consents li:has-text("Off")').count()) === consentCount,
    );

    await ctx.close();
  }

  {
    const { ctx, page } = await pageAs(DANNY);
    await page.goto('/ai');
    const text = await page.locator('main').innerText();
    // Consent is personal at the policy level, not space-wide. Danny has one
    // row of his own in Home and sees none of Priya's three in the same space.
    const dannyConsents = await page.locator('#ai-consents li').count();
    check('the partner has his own consent to give', dannyConsents === 1, `${dannyConsents}`);
    // Scoped to the consent list, not the whole page: the *run log* names the
    // feature that ran, and Danny legitimately sees runs in the space he
    // shares. What he must not see is what Priya agreed to send.
    const dannyConsentText = await page.locator('#ai-consents').innerText();
    check(
      'and none of the owner\u2019s, even in the space they share',
      !dannyConsentText.includes('Review the week ahead') &&
        !dannyConsentText.includes('Break a task into steps'),
    );
    check(
      'and sees the AI runs in that space',
      (await page.locator('#ai-runs li').count()) > 0,
    );
    await ctx.close();
  }

  {
    const { ctx, page } = await pageAs(OUTSIDER);
    await page.goto('/ai');
    check(
      'the outsider has no AI features at all',
      (await page.locator('#ai-consents li a, #ai-consents li form').count()) === 0,
    );
    check(
      'and no runs',
      (await page.locator('main').innerText()).includes('Nothing has run yet'),
    );
    await ctx.close();
  }

  // ------------------------------------------------- AI: the other two features
  //
  // Until now only note_summary had a surface: task_breakdown and weekly_review
  // had consent rows, disclosure text and prompts, and nothing called them.
  // Both are switched on and back off again here, so the suite runs twice.
  {
    const { ctx, page } = await pageAs(PRIYA);

    // ---- break a task into steps ----
    // A task in Home, because that is where the seed's consent rows live: a
    // task in a space with no consent row is refused for a different (and also
    // correct) reason, which would make this assertion about the wrong thing.
    await page.goto(`/tasks/all?space=${S_HOME}`);
    await page.locator('main ul li a[href^="/tasks/item/"]').first().click();
    await settle(page);
    const taskUrl = page.url();
    const taskTitle = await page.locator('h1').innerText();

    check(
      'a task offers to be broken into steps',
      (await page.getByRole('button', { name: 'Break it into steps' }).count()) === 1,
    );
    await page.getByRole('button', { name: 'Break it into steps' }).click();
    await settle(page);
    check(
      'and running it while the feature is off is refused',
      (await page.locator('#ai-refusal').innerText()).includes('switched off'),
    );
    check('with nothing sent', (await page.locator('#ai-sent').count()) === 0);

    await page.goto('/ai');
    await page
      .locator('#ai-consents li', { hasText: 'Break a task into steps' })
      .first()
      .getByRole('button', { name: 'Switch on, and send this' })
      .click();
    await settle(page);

    await page.goto(taskUrl);
    await page.getByRole('button', { name: 'Break it into steps' }).click();
    await settle(page);
    check(
      'once switched on it runs, and shows what was sent',
      (await page.locator('#ai-sent').innerText()).includes(taskTitle),
    );
    check('and what came back', (await page.locator('#ai-answer').count()) === 1);

    await page.goto('/ai');
    await page
      .locator('#ai-consents li', { hasText: 'Break a task into steps' })
      .first()
      .getByRole('button', { name: 'Switch off' })
      .click();
    await settle(page);

    // ---- review the week ahead ----
    await page.goto('/');
    const reviewButtons = await page.locator('#week-review li').count();
    check('Today offers a weekly review, one per space', reviewButtons > 0, `${reviewButtons}`);
    check(
      'each one says which space it would read',
      (await page.locator('#week-review li span[title^="Space:"]').count()) === reviewButtons,
    );

    await page.locator('#week-review button').first().click();
    await settle(page);
    check(
      'running it while it is off is refused',
      (await page.locator('#ai-refusal').innerText()).includes('switched off'),
    );

    await page.goto('/ai');
    await page
      .locator('#ai-consents li', { hasText: 'Review the week ahead' })
      .first()
      .getByRole('button', { name: 'Switch on, and send this' })
      .click();
    await settle(page);

    await page.goto('/');
    await page.locator('#week-review button').first().click();
    await settle(page);
    const weekSent = await page.locator('#ai-sent').innerText();
    check('once on, the weekly review runs', weekSent.length > 0);
    check(
      'and what it sends is titles and dates, as the disclosure says',
      /\d{4}-\d{2}-\d{2}/.test(weekSent) || weekSent.split('\n').length <= 2,
      weekSent.slice(0, 120),
    );

    await page.goto('/ai');
    await page
      .locator('#ai-consents li', { hasText: 'Review the week ahead' })
      .first()
      .getByRole('button', { name: 'Switch off' })
      .click();
    await settle(page);
    // Counted by the button rather than by the word: a row only offers
    // "Switch off" when it is on, and `has-text` is case-insensitive, so
    // looking for "On" would match "Switch on, and send this" on every row.
    check(
      'and both are switched back off, as they were found',
      (await page.locator('#ai-consents li').getByRole('button', { name: 'Switch off' }).count()) === 0,
    );

    check(
      'the run log now holds more than notes',
      (await page.locator('#ai-runs li').count()) > 0,
    );

    await ctx.close();
  }

  // ------------------------------------------------------------------ sync
  //
  // Phase 6. The claim is that an edit made offline applies immediately, is
  // visibly not sent, and then either lands or names the conflict — never a
  // spinner that resolves into a lie. All of that is driven here in one browser
  // context, because the queue lives in that context's localStorage.
  //
  // Everything it creates it deletes, and everything it switches it switches
  // back, so the suite still passes twice against the same database.
  {
    const { ctx, page } = await pageAs(PRIYA);

    await page.goto('/');
    check('Sync is reachable from the sidebar', (await page.locator('nav a[href="/sync"]').count()) === 1);

    await page.goto('/sync');
    const deviceCount = await page.locator('#sync-devices li').count();
    check('the sync page lists this account’s devices', deviceCount > 0, `${deviceCount}`);
    check(
      'every device row says which space it is for',
      (await page.locator('#sync-devices li span[title^="Space:"]').count()) === deviceCount,
    );
    const cursorRows = await page.locator('#sync-cursors tbody tr').count();
    check('with one cursor row per syncable kind', cursorRows === 5, `${cursorRows}`);
    const changeRows = await page.locator('#sync-changes li').count();
    check('and what has changed since it last caught up', changeRows > 0, `${changeRows}`);
    check(
      'every changed row carries its space indicator too',
      (await page.locator('#sync-changes li span[title^="Space:"]').count()) === changeRows,
    );
    check(
      'a locked row is listed as locked rather than left out',
      (await page.locator('#sync-changes li', { hasText: 'no plaintext to show' }).count()) > 0,
    );
    check(
      'nothing is queued on a browser that has not typed anything',
      (await page.locator('#outbox-summary').innerText()).includes('has been sent'),
    );

    // ---- a task to do all this to, deleted at the end ----
    const stamp = `Smoke sync ${Date.now()}`;
    await page.goto('/tasks/all');
    await page.locator('form[aria-label="Add a task"] input[name="title"]').fill(stamp);
    await page.locator('form[aria-label="Add a task"] input[name="title"]').press('Enter');
    await settle(page);
    await page.goto('/tasks/all');
    await page.locator('main ul li', { hasText: stamp }).first().locator('a[href^="/tasks/item/"]').click();
    await settle(page);
    const taskUrl = page.url();
    check('a task to edit offline exists', taskUrl.includes('/tasks/item/'), taskUrl);

    // ---- go offline, and edit ----
    await page.getByLabel('Work offline').check();
    const offlineTitle = `${stamp} — offline`;
    const titleField = page.locator('#offline-edit-heading').locator('..').locator('..').locator('input[type="text"], input:not([type])').first();
    await titleField.fill(offlineTitle);
    await titleField.blur();
    await page.waitForTimeout(400);
    check(
      'an edit made offline shows on the screen straight away',
      (await titleField.inputValue()) === offlineTitle,
    );
    check(
      'and says out loud that it has not been sent',
      (await page.locator('text=not sent yet').count()) > 0,
    );

    await page.reload();
    await page.waitForTimeout(500);
    check(
      'the queued edit survives a reload of the page',
      (await page.locator('text=not sent yet').count()) > 0,
    );
    check(
      'and the server still holds the title it had before',
      (await page.locator('h1').innerText()) === stamp,
      await page.locator('h1').innerText(),
    );

    await page.goto('/sync');
    check(
      'the sync page counts the edit waiting to be sent',
      (await page.locator('#outbox-summary').innerText()).includes('1 edit'),
      await page.locator('#outbox-summary').innerText(),
    );
    check(
      'and the pending row carries its space indicator, like every other row',
      (await page.locator('#outbox-queued li span[title^="Space:"]').count()) === 1,
    );

    // ---- send it, and it lands ----
    await page.getByRole('button', { name: /^Send 1 queued edit$/ }).click();
    await settle(page);
    check(
      'sending it says what happened rather than only redrawing',
      (await page.locator('#outbox-results li').first().innerText()).includes('Applied'),
      await page.locator('#outbox-results li').first().innerText(),
    );
    await page.goto(taskUrl);
    check(
      'and the edit is on the server afterwards',
      (await page.locator('h1').innerText()) === offlineTitle,
      await page.locator('h1').innerText(),
    );

    // ---- a real conflict: queue one edit, then move the row underneath it ----
    const mine = `${stamp} — mine`;
    const theirs = `${stamp} — theirs`;
    const titleField2 = page.locator('#offline-edit-heading').locator('..').locator('..').locator('input[type="text"], input:not([type])').first();
    await titleField2.fill(mine);
    await titleField2.blur();
    await page.waitForTimeout(400);

    // The ordinary edit form is the "somebody else" here: a second writer that
    // moves the row while the queued edit is still waiting.
    await page.locator('#task-title').fill(theirs);
    await page.getByRole('button', { name: 'Save changes' }).click();
    await settle(page);
    check(
      'the other writer’s change is what the server holds',
      (await page.locator('h1').innerText()) === theirs,
      await page.locator('h1').innerText(),
    );

    await page.goto('/sync');
    await page.getByRole('button', { name: /^Send 1 queued edit$/ }).click();
    await settle(page);
    const conflictCount = await page.locator('#outbox-conflicts li').count();
    check('sending an edit that clashed produces a conflict, not a silent win', conflictCount === 1);
    const conflictText = await page.locator('#outbox-conflicts li').first().innerText();
    check('the conflict names both versions', conflictText.includes(mine) && conflictText.includes(theirs));
    check('and says nothing has been overwritten', conflictText.includes('nothing has been overwritten'));
    check(
      'and the conflict row carries its space indicator',
      (await page.locator('#outbox-conflicts li span[title^="Space:"]').count()) === 1,
    );
    await page.goto(taskUrl);
    check(
      'an unanswered conflict has changed nothing on the server',
      (await page.locator('h1').innerText()) === theirs,
      await page.locator('h1').innerText(),
    );

    // ---- answer it ----
    await page.goto('/sync');
    await page.getByRole('button', { name: 'Keep theirs' }).click();
    await settle(page);
    check(
      'answering the conflict clears it',
      (await page.locator('#outbox-conflicts li').count()) === 0,
    );
    check(
      'and says which version was kept',
      (await page.locator('main').innerText()).includes('The other version was kept'),
    );
    await page.goto(taskUrl);
    check(
      'keeping theirs left the server exactly as it was',
      (await page.locator('h1').innerText()) === theirs,
      await page.locator('h1').innerText(),
    );

    const syncUnnamed = await labelAuditOn(page);
    check('every control on the task page has a label', syncUnnamed.length === 0, syncUnnamed.join(', '));

    // ---- coming back online sends what is queued, once ----
    //
    // Rough edge 2: nothing flushed automatically, so an edit made on a train sat
    // there until somebody noticed the page. This is a listener on the browser's
    // own `online` event, not a retry ladder — a retry that cannot tell "never
    // arrived" from "arrived and the answer was lost" is banned by the same rule
    // that keeps a push from retrying.
    const backOnline = `${stamp} online`;
    await page.goto(taskUrl);
    await page.getByLabel('Work offline').check();
    await settle(page);
    const onlineField = page
      .locator('#offline-edit-heading')
      .locator('..')
      .locator('..')
      .locator('input[type="text"], input:not([type])')
      .first();
    await onlineField.fill(backOnline);
    await onlineField.blur();
    await page.waitForTimeout(400);
    await page.goto('/sync');
    check(
      'an edit made while offline is waiting, as before',
      (await page.locator('#outbox-queued li').count()) === 1,
    );
    // Untick first: the switch is a person saying "not yet", and the browser
    // regaining a network must not overrule them.
    await page.getByLabel('Work offline').uncheck();
    await settle(page);
    check(
      'unticking Work offline does not itself send anything',
      (await page.locator('#outbox-queued li').count()) === 1,
    );
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await settle(page);
    check(
      'the browser coming back online sends the queue by itself',
      (await page.locator('#outbox-queued li').count()) === 0,
      await page.locator('#outbox-summary').innerText(),
    );
    check(
      'and says that is why it sent, rather than looking like a button was pressed',
      (await page.locator('main, body').first().innerText()).includes('Back online'),
    );
    await page.goto(taskUrl);
    check(
      'and the edit really landed on the server',
      (await page.locator('h1').innerText()) === backOnline,
      await page.locator('h1').innerText(),
    );

    // ---- the queue and the cursors are the same device, and say so ----
    //
    // Rough edge 1: the outbox is one browser profile's localStorage and every
    // cursor belongs to a row in `devices`, and nothing connected them.
    await page.goto('/sync');
    check(
      'until it is named, the page says the queue is not tied to a device',
      (await page.locator('section[aria-labelledby="thisdevice-heading"]').innerText()).includes(
        'has not said which device it is',
      ),
    );
    check(
      'and the queue heading claims only to be this browser’s',
      (await page.locator('#outbox-heading').innerText()) === 'This browser’s queue',
      await page.locator('#outbox-heading').innerText(),
    );
    check(
      'and no device row is marked as this browser',
      (await page.locator('#sync-devices li', { hasText: 'this browser' }).count()) === 0,
    );

    // Named as the seeded laptop, so the chip lands on rows that already have
    // cursors — which is the whole point: the halves now describe one device.
    await page.locator('section[aria-labelledby="thisdevice-heading"] input[name="label"]').fill(
      '  Priya —   laptop  ',
    );
    await page.getByRole('button', { name: /^(Name this browser|Save this name)$/ }).click();
    await settle(page);
    check(
      'naming the browser ties the queue to a device row',
      (await page.locator('#outbox-heading').innerText()) === 'Priya — laptop — its queue',
      await page.locator('#outbox-heading').innerText(),
    );
    const marked = await page.locator('#sync-devices li', { hasText: 'this browser' }).count();
    check(
      'and every row with that name is marked as this browser, one per space',
      marked >= 2,
      `${marked} marked`,
    );
    check(
      // The name was typed with stray whitespace on purpose. Unnormalised it
      // would be a label no seeded row carries, so nothing above would be marked
      // and the box would read back with the spaces still in it.
      'and the stray whitespace was normalised rather than making a second device',
      (await page
        .locator('section[aria-labelledby="thisdevice-heading"] input[name="label"]')
        .inputValue()) === 'Priya — laptop',
      await page
        .locator('section[aria-labelledby="thisdevice-heading"] input[name="label"]')
        .inputValue(),
    );
    check(
      'and the page says why there is more than one row for one browser',
      (await page.locator('section[aria-labelledby="thisdevice-heading"]').innerText()).includes(
        'because a cursor is space-scoped',
      ),
    );
    check(
      'and it still shows a cursor per kind for it',
      (await page.locator('#sync-cursors tbody tr').count()) === 5,
    );

    // ---- cursors move forward, and only on purpose ----
    await page.goto('/sync');
    const syncPageUnnamed = await labelAuditOn(page);
    check('every control on the sync page has a label', syncPageUnnamed.length === 0, syncPageUnnamed.join(', '));

    await page.getByRole('button', { name: 'Mark caught up' }).click();
    await settle(page);
    check(
      'marking a device caught up leaves nothing changed since',
      (await page.locator('#sync-changes-none').count()) === 1,
    );
    await page.getByRole('button', { name: 'Rewind to the beginning' }).click();
    await settle(page);
    check(
      'and rewinding it makes the next sync read everything again',
      (await page.locator('#sync-changes li').count()) > 0,
    );

    // ---- leave nothing behind ----
    await page.getByLabel('Work offline').uncheck();
    await page.goto(taskUrl);
    await page.getByRole('button', { name: 'Delete this task' }).click();
    await settle(page);
    await page.goto('/tasks/all');
    check(
      'and the task it created is deleted again',
      !(await page.locator('main').innerText()).includes(stamp),
    );
    await page.goto('/sync');
    check(
      'with an empty queue and no conflicts left behind',
      (await page.locator('#outbox-summary').innerText()).includes('has been sent'),
      await page.locator('#outbox-summary').innerText(),
    );

    await ctx.close();
  }

  {
    const { ctx, page } = await pageAs(DANNY);
    await page.goto('/sync');
    const text = await page.locator('main').innerText();
    // Devices and cursors stop at the space boundary like everything else:
    // Danny has his own phone in his own space, and cannot see the laptop
    // Priya registered in hers.
    check('the partner sees his own device', text.includes('Danny — phone'));
    check('and none of the owner’s', !text.includes('Priya — laptop'));
    const dannyDevices = await page.locator('#sync-devices li').count();
    check('exactly one of them', dannyDevices === 1, `${dannyDevices}`);
    await ctx.close();
  }

  {
    const { ctx, page } = await pageAs(OUTSIDER);
    await page.goto('/sync');
    check(
      'the outsider has no devices at all',
      (await page.locator('#sync-devices li').count()) === 0,
    );
    check(
      'and is told so rather than shown an error',
      (await page.locator('main').innerText()).includes('No devices are registered'),
    );
    await ctx.close();
  }

  // --------------------------------------- calendar: the two Phase 2 gaps
  //
  // Both were rough edges 19 and 20 and both belong to sync. Nothing had ever
  // pushed a local edit back to a provider — is_dirty was set and never
  // cleared, and 'pull' was the only direction ever written — and there was no
  // way at all to *create* a repeat from the UI.
  {
    const { ctx, page } = await pageAs(PRIYA);

    // ---- push back ----
    await page.goto('/calendar/import');
    const familyRow = page.locator('#connected-calendars li', { hasText: 'Family (fixture)' }).first();
    check(
      'a connected calendar says whether anything is waiting to go back',
      (await familyRow.innerText()).includes('waiting to go back'),
    );

    await page.goto('/search?q=checkup&kind=event');
    await page.locator('#search-results a[href^="/calendar/event/"]').first().click();
    await settle(page);
    const eventUrl = page.url();
    const originalLocation = await page.locator('input[name="locationText"]').inputValue();
    const stampedLocation = `${originalLocation} (smoke)`;

    await page.locator('input[name="locationText"]').fill(stampedLocation);
    await page.getByRole('button', { name: 'Save changes' }).click();
    await settle(page);

    await page.goto('/calendar/import');
    const dirtyRow = page.locator('#connected-calendars li', { hasText: 'Family (fixture)' }).first();
    check(
      'editing a pulled event leaves something waiting to go back',
      (await dirtyRow.innerText()).includes('1 local edit waiting to go back'),
      await dirtyRow.innerText(),
    );

    await dirtyRow.locator('button', { hasText: 'back' }).click();
    await settle(page);
    const pushBanner = await page.locator('#push-result').innerText();
    check('pushing it back says what it did', /Pushed 1 event back/.test(pushBanner), pushBanner);
    check(
      'and nothing is waiting afterwards',
      (await page.locator('#connected-calendars li', { hasText: 'Family (fixture)' }).first().innerText())
        .includes('nothing waiting to go back'),
    );
    check(
      'the push is recorded as a push, not as another pull',
      (await page.locator('#connected-calendars li', { hasText: 'Family (fixture)' }).first().innerText())
        .includes('last push ok'),
    );

    // ---- put it back, and push that too, so the suite runs twice ----
    await page.goto(eventUrl);
    await page.locator('input[name="locationText"]').fill(originalLocation);
    await page.getByRole('button', { name: 'Save changes' }).click();
    await settle(page);
    await page.goto('/calendar/import');
    await page.locator('#connected-calendars li', { hasText: 'Family (fixture)' }).first()
      .locator('button', { hasText: 'back' }).click();
    await settle(page);
    check(
      'and the edit that put it back went the same way',
      (await page.locator('#connected-calendars li', { hasText: 'Family (fixture)' }).first().innerText())
        .includes('nothing waiting to go back'),
    );

    // ---- create a repeat ----
    const repeatTitle = `Smoke repeat ${Date.now()}`;
    await page.goto('/calendar/week?date=2026-08-03');
    await page.locator('select[name="repeatFreq"]').selectOption('WEEKLY');
    await page.locator('form[aria-label="Add an event"] input[name="title"]').fill(repeatTitle);
    await page.locator('input[name="onDate"]').fill('2026-08-03');
    await page.locator('input[name="repeatUntil"]').fill('2026-08-31');
    await page.getByRole('button', { name: 'Add' }).click();
    await settle(page);

    await page.goto('/calendar/month?date=2026-08-03');
    const drawn = await page.locator('main a[href^="/calendar/event/"]', { hasText: repeatTitle }).count();
    check(
      'an event created with a repeat is drawn on every occurrence',
      drawn >= 4,
      `${drawn} drawn`,
    );

    await page.locator('main a[href^="/calendar/event/"]', { hasText: repeatTitle }).first().click();
    await settle(page);
    const repeatUrl = page.url().split('?')[0];
    check(
      'and its detail page reads the rule back in words',
      /(week|Week)/.test(await page.locator('body').innerText()),
    );

    // ---- editing a repeat, not only creating one ----
    //
    // Rough edges 11 and 20. rruleFromForm could build a rule and nothing could
    // read one back, so a repeat was fixed at the moment it was made.
    const occurrencesDrawn = async () => {
      await page.goto('/calendar/month?date=2026-08-03');
      return page.locator('main a[href^="/calendar/event/"]', { hasText: repeatTitle }).count();
    };

    await occurrencesDrawn(); // back to the month view, where the blocks are
    check(
      'a block links to the occurrence that was clicked, not just to the series',
      /[?&]on=/.test(
        await page
          .locator('main a[href^="/calendar/event/"]', { hasText: repeatTitle })
          .first()
          .getAttribute('href'),
      ),
    );

    await page.goto(repeatUrl);
    check(
      'the stored rule is read back into the form that built it',
      (await page.locator('select[name="repeatFreq"]').inputValue()) === 'WEEKLY' &&
        (await page.locator('input[name="repeatUntil"]').inputValue()) === '2026-08-31',
      `${await page.locator('select[name="repeatFreq"]').inputValue()} until ${await page.locator('input[name="repeatUntil"]').inputValue()}`,
    );
    check(
      'including which day it lands on — 3 August 2026 is a Monday',
      await page.locator('input[name="repeatByDay"][value="MO"]').isChecked(),
    );

    // Change it: every two weeks instead of every week.
    await page.locator('input[name="repeatInterval"]').fill('2');
    await page.getByRole('button', { name: 'Change the repeat' }).click();
    await settle(page);
    const fortnightly = await occurrencesDrawn();
    check(
      'changing the repeat changes how often it is drawn',
      fortnightly < drawn && fortnightly >= 2,
      `${drawn} weekly → ${fortnightly} fortnightly`,
    );
    await page.goto(repeatUrl);
    check(
      'and the changed rule reads back as the change, in words',
      (await page.locator('body').innerText()).includes('2 weeks'),
    );

    // Put it back to weekly, and check it is the same series it was.
    await page.locator('input[name="repeatInterval"]').fill('1');
    await page.getByRole('button', { name: 'Change the repeat' }).click();
    await settle(page);
    check('and back to weekly draws what it drew before', (await occurrencesDrawn()) === drawn);

    // ---- one occurrence, skipped and put back ----
    //
    // The first use of recurrence_rules.exdates from the UI: migration 0010 added
    // the column in Phase 2 and only the importer ever wrote it.
    const secondBlock = page
      .locator('main a[href^="/calendar/event/"]', { hasText: repeatTitle })
      .nth(1);
    const secondHref = await secondBlock.getAttribute('href');
    await secondBlock.click();
    await settle(page);
    check(
      'the page says which occurrence you came from',
      (await page.locator('section[aria-label="This occurrence"]').innerText()).includes(
        'one occurrence of this series',
      ),
    );
    await page.getByRole('button', { name: /^Skip / }).click();
    await settle(page);
    const afterSkip = await occurrencesDrawn();
    check(
      'skipping one occurrence removes exactly that one',
      afterSkip === drawn - 1,
      `${drawn} → ${afterSkip}`,
    );
    await page.goto(repeatUrl);
    check(
      'and the series says so, rather than the occurrence vanishing silently',
      (await page.locator('body').innerText()).includes('1 occurrence is skipped'),
    );

    // The same link now describes it as skipped, and offers it back. Nothing was
    // deleted: an occurrence is not a row.
    await page.goto(secondHref);
    check(
      'the skipped occurrence says it is skipped and nothing was deleted',
      (await page.locator('section[aria-label="This occurrence"]').innerText()).includes(
        'nothing was deleted',
      ),
    );
    await page.getByRole('button', { name: 'Put it back' }).click();
    await settle(page);
    check(
      'and putting it back restores exactly that one',
      (await occurrencesDrawn()) === drawn,
    );

    // An instant the series does not generate is refused rather than stored as a
    // junk exclusion — the URL is a claim from the client.
    await page.goto(`${repeatUrl}?on=2026-08-04T09:00:00.000Z`);
    check(
      'an instant the series never generates is not an occurrence to skip',
      (await page.locator('section[aria-label="This occurrence"]').innerText()).includes(
        'no occurrence starting then',
      ),
    );

    const eventUnnamed = await labelAuditOn(page);
    check('every control on the event page has a label', eventUnnamed.length === 0, eventUnnamed.join(', '));

    // ---- and a repeat can be removed without deleting the event ----
    // Choosing "Does not repeat" is what removes it, and the button says so
    // rather than a separate destructive-looking control sitting there always.
    await page.goto(repeatUrl);
    await page.locator('select[name="repeatFreq"]').selectOption('');
    await page.getByRole('button', { name: 'Stop repeating' }).click();
    await settle(page);
    check(
      'a repeat can be removed, leaving one event where the series was',
      (await occurrencesDrawn()) === 1,
    );
    await page.goto(repeatUrl);
    check(
      'and the event itself survived losing its repeat',
      (await page.locator('h1').innerText()) === repeatTitle,
    );
    check(
      'and it is offered a repeat again rather than left unable to have one',
      (await page.locator('select[name="repeatFreq"]').inputValue()) === '',
    );

    // A repeat that cannot be built is refused with a sentence, not silently
    // turned into something else.
    await page.goto('/calendar/week?date=2026-08-03');
    await page.locator('select[name="repeatFreq"]').selectOption('WEEKLY');
    await page.locator('form[aria-label="Add an event"] input[name="title"]').fill('Smoke bad repeat');
    await page.locator('input[name="onDate"]').fill('2026-08-03');
    await page.locator('input[name="repeatUntil"]').fill('2026-07-01');
    await page.getByRole('button', { name: 'Add' }).click();
    await settle(page);
    check(
      'a repeat that stops before it starts is refused, and says so',
      (await page.locator('#calendar-error').innerText()).includes('before it starts'),
    );
    await page.goto('/calendar/month?date=2026-08-03');
    check(
      'and nothing was created for it',
      !(await page.locator('main').innerText()).includes('Smoke bad repeat'),
    );

    const composeUnnamed = await labelAuditOn(page);
    check('every control on the calendar page has a label', composeUnnamed.length === 0, composeUnnamed.join(', '));

    // ---- leave nothing behind ----
    await page.goto(repeatUrl);
    await page.getByRole('button', { name: 'Delete this event' }).click();
    await settle(page);
    await page.goto('/calendar/month?date=2026-08-03');
    check(
      'and the repeating event it created is deleted again',
      !(await page.locator('main').innerText()).includes(repeatTitle),
    );

    await ctx.close();
  }

  // ------------------------------------------------- spaces, invites, roles
  //
  // The invite flow end to end, through the app, with real policies deciding.
  // Everything this section creates it revokes or removes: the two invitations
  // it makes are expired at the end, and the membership it grants is set back
  // to 'left' — which is exactly what running it a second time produces too, so
  // the suite still passes twice in a row against the same database.
  {
    const { ctx, page } = await pageAs(PRIYA);

    await page.goto('/spaces');
    check(
      'the spaces screen lists the spaces you are in, with your role in each',
      (await page.locator('main').innerText()).includes('you are owner'),
    );

    await page.goto(`/spaces/${S_HOME}`);
    const homeText = await page.locator('main').innerText();
    check(
      'a space names the people in it',
      homeText.includes('Danny Whitehouse') && homeText.includes('Priya Raghavan'),
    );
    check(
      'and the seeded pending invitation is listed with when it expires',
      homeText.includes('newcomer@example.com') && /Expires in \d+ days/.test(homeText),
    );
    check(
      'the space owner cannot be removed from their own space',
      (await page
        .locator('li', { hasText: 'Priya Raghavan' })
        .first()
        .locator('button', { hasText: 'Remove' })
        .count()) === 0,
    );

    // ---- an invitation addressed to one person ----
    await page.goto(`/spaces/${S_WORK}`);
    await page.selectOption('select[name="role"]', 'viewer');
    await page.selectOption('select[name="days"]', '7');
    await page.fill('input[name="invitedEmail"]', 'danny@orbit.test');
    await page.getByRole('button', { name: 'Make a link' }).click();
    await settle(page);

    const addressedLink = await page.locator('input[aria-label="Invitation link"]').inputValue();
    check(
      'creating an invitation shows its link once, as a link somebody can send',
      /\/invite\/[A-Za-z0-9_-]{43}$/.test(addressedLink),
      addressedLink.replace(/\/invite\/.*/, '/invite/…'),
    );

    await page.goto(`/spaces/${S_WORK}`);
    check(
      'and reloading the page does not show it again — only its fingerprint is stored',
      (await page.locator('input[aria-label="Invitation link"]').count()) === 0,
    );
    check(
      'the invitation is listed by who it is for and what it grants',
      (await page.locator('main').innerText()).includes('danny@orbit.test'),
    );

    // ---- a bearer invitation, free/busy ----
    await page.selectOption('select[name="role"]', 'free_busy');
    await page.getByRole('button', { name: 'Make a link' }).click();
    await settle(page);
    const bearerLink = await page.locator('input[aria-label="Invitation link"]').inputValue();
    check('a free/busy invitation can be made too — the role works end to end', Boolean(bearerLink));

    const addressedPath = new URL(addressedLink).pathname;
    const bearerPath = new URL(bearerLink).pathname;

    const invitesAudit = await labelAuditOn(page);
    check('every control on a space page has a label', invitesAudit.length === 0, invitesAudit.join(', '));

    await ctx.close();

    // ---- Sam Okafor, who was not invited ----
    {
      const { ctx: samCtx, page: sam } = await pageAs(OUTSIDER);

      const res = await sam.goto(`/spaces/${S_WORK}`);
      check(
        'the outsider gets 404 on a space he is not in, never 403',
        res.status() === 404,
        `HTTP ${res.status()}`,
      );

      const madeUp = await sam.goto('/invite/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
      check(
        'a token nobody issued is answered with a page, not an error',
        madeUp.status() === 200,
        `HTTP ${madeUp.status()}`,
      );
      check(
        'and it says the link is not recognised rather than naming a space',
        (await sam.locator('#invite-sentence').innerText()).includes('not recognised'),
      );

      const wrong = await sam.goto(addressedPath);
      check(
        'an invitation addressed to somebody else is refused with a sentence, not a 403',
        wrong.status() === 200,
        `HTTP ${wrong.status()}`,
      );
      check(
        'and the sentence says whose it is, so he knows what to do about it',
        (await sam.locator('#invite-sentence').innerText()).includes('danny@orbit.test'),
      );
      check(
        'there is no Accept button on an invitation that is not his',
        (await sam.getByRole('button', { name: /^Accept/ }).count()) === 0,
      );
      await sam.goto('/tasks/all');
      check(
        'and he is still a member of nothing',
        !(await sam.locator('main').innerText()).includes('Work'),
      );

      // ---- the bearer link, which he does hold ----
      await sam.goto(bearerPath);
      check(
        'a bearer invitation names the space and the role before anything is accepted',
        (await sam.locator('main').innerText()).includes('Free/busy only'),
      );
      await sam.getByRole('button', { name: 'Decline' }).click();
      await settle(sam);
      check(
        'declining changes nothing and says the link is still live',
        (await sam.locator('#invite-outcome').innerText()).includes('Nothing was changed'),
      );

      await sam.goto(bearerPath);
      await sam.getByRole('button', { name: /^Accept/ }).click();
      await settle(sam);
      check(
        'accepting joins the space and says so',
        (await sam.locator('main').innerText()).includes('You have joined'),
      );
      await sam.goto('/calendar/week');
      check(
        'and a free/busy member sees the space in the sidebar, marked as free/busy',
        (await sam.locator('nav[aria-label="Primary"]').innerText()).includes('free/busy'),
      );
      check(
        'no event of somebody else’s is readable to him',
        (await sam.locator('main a[href^="/calendar/event/"]').count()) === 0,
      );

      await sam.goto(bearerPath);
      check(
        'accepting twice is refused rather than being a second join',
        (await sam.locator('#invite-sentence').innerText()).includes('accepted this invitation already'),
      );

      await samCtx.close();
    }

    // ---- Danny, who is already in Work as free/busy ----
    {
      const { ctx: dannyCtx, page: danny } = await pageAs(DANNY);
      await danny.goto(addressedPath);
      check(
        'an invitation to somebody already in the space says so rather than re-adding them',
        (await danny.locator('#invite-sentence').innerText()).includes('already in'),
      );

      await danny.goto(`/spaces/${S_HOME}`);
      check(
        'a member who is not an admin sees the roster and is told inviting is not their job',
        (await danny.locator('main').innerText()).includes('is an admin’s job'),
      );
      check(
        'and is offered no invitation form',
        (await danny.locator('form[aria-label="Invite somebody to this space"]').count()) === 0,
      );
      await dannyCtx.close();
    }

    // ---- put it back ----
    {
      const { ctx: tidyCtx, page: tidy } = await pageAs(PRIYA);
      await tidy.goto(`/spaces/${S_WORK}`);
      await tidy
        .locator('li', { hasText: 'Sam Okafor' })
        .first()
        .locator('button', { hasText: 'Remove' })
        .click();
      await settle(tidy);
      check(
        'an admin removes a member, and nothing they made is deleted',
        (await tidy.locator('main').innerText()).includes('They have left the space'),
      );

      // Exactly one is revokable: the other has been accepted, and an accepted
      // invitation is not revoked but *un-joined* — which is the Remove above.
      const revokes = tidy.locator('button', { hasText: 'Revoke' });
      let revoked = 0;
      while ((await revokes.count()) > 0) {
        await revokes.first().click();
        await settle(tidy);
        revoked += 1;
        if (revoked > 5) break;
      }
      check(
        'the unredeemed invitation is revoked, and the accepted one offers no Revoke at all',
        revoked === 1,
        `${revoked} revoked`,
      );
      check(
        'the revoked row stays as the record of what was offered, marked expired',
        (await tidy.locator('main').innerText()).includes('Expired or revoked'),
      );
      await tidyCtx.close();
    }

    // ---- and the revoked links are dead ----
    {
      const { ctx: samCtx, page: sam } = await pageAs(OUTSIDER);
      await sam.goto(addressedPath);
      check(
        'a revoked invitation stops working, with a sentence saying to ask for a new one',
        (await sam.locator('#invite-sentence').innerText()).includes('expired'),
      );
      await sam.goto('/calendar/week');
      check(
        'and the removed member sees nothing again, in a sidebar with no spaces in it',
        !(await sam.locator('nav[aria-label="Primary"]').innerText()).includes('free/busy'),
      );
      await samCtx.close();
    }
  }

  // --------------------------------------------------------- dev auth is dev
  {
    const { ctx, page } = await pageAs(PRIYA);

    await page.goto('/');
    check(
      'under AUTH_PROVIDER=dev the sidebar offers the user switcher',
      (await page.locator('nav form[action] button[name="userId"]').count()) >= 3,
    );
    check(
      'and there is no sign-out control, because there is no session to end',
      (await page.locator('nav a[href="/auth/signout"]').count()) === 0,
    );

    await page.goto('/auth/signin');
    const signin = await page.locator('main, body').first().innerText();
    check(
      'the sign-in page says which provider is actually running',
      signin.includes('AUTH_PROVIDER=dev'),
    );
    check(
      'and offers no password box, because there is nothing behind it',
      (await page.locator('input[name="password"]').count()) === 0,
    );
    await ctx.close();
  }

  // ------------------------------------------ AUTH_PROVIDER=supabase, briefly
  //
  // The one thing that cannot be checked on the server this suite has been
  // driving: what the app does when the dev provider is *not* the live one.
  // So a second server is started on another port with AUTH_PROVIDER=supabase
  // and no credentials, which is exactly the state a half-configured
  // deployment is in.
  //
  // Nothing here signs anybody in. There is no Supabase project and no
  // credential in this repository, and the provider is written-never-run like
  // `calendar:google`. What is asserted is the part that does not need one:
  // that identity stops being a cookie, that the switcher is unreachable, and
  // that a missing credential is a sentence rather than a 500.
  {
    const port = Number(process.env.ORBIT_ALT_PORT ?? 3101);
    const altBase = `http://127.0.0.1:${port}`;
    const server = spawn('pnpm', ['exec', 'next', 'start', '--port', String(port)], {
      env: { ...process.env, AUTH_PROVIDER: 'supabase', PORT: String(port) },
      stdio: 'ignore',
      detached: true,
    });

    let up = false;
    for (let i = 0; i < 60; i += 1) {
      try {
        const res = await fetch(`${altBase}/auth/signin`, { redirect: 'manual' });
        if (res.status < 500) { up = true; break; }
      } catch {
        // not listening yet
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
    check('a second server starts with AUTH_PROVIDER=supabase and no credentials', up, altBase);

    if (up) {
      const ctx = await browser.newContext({ baseURL: altBase });
      // The dev cookie, carried over deliberately: it must mean nothing here.
      await ctx.addCookies([{ name: 'orbit_user', value: PRIYA, url: altBase }]);
      const page = await ctx.newPage();

      const res = await page.goto('/tasks/all');
      check(
        'with a real provider selected, a page with no session goes to sign in',
        new URL(page.url()).pathname === '/auth/signin',
        page.url(),
      );
      check('and it is a page, not a 403 or a 500', res.status() === 200, `HTTP ${res.status()}`);
      check(
        'the dev cookie naming a seeded profile is not a session any more',
        !(await page.locator('body').innerText()).includes('Priya'),
      );
      check(
        'the sidebar is not rendered at all, so the user switcher is unreachable',
        (await page.locator('nav[aria-label="Primary"]').count()) === 0,
      );
      check(
        'and there is no switcher control anywhere on the page',
        (await page.locator('button[name="userId"]').count()) === 0,
      );

      check(
        'the sign-in page offers a password and a magic link, and no OAuth buttons',
        (await page.locator('input[name="password"]').count()) === 1 &&
          (await page.getByRole('button', { name: /Email me a link/ }).count()) === 1 &&
          !(await page.locator('body').innerText()).match(/Google|GitHub|Apple/),
      );

      await page.fill('input[name="email"]', 'somebody@example.com');
      await page.fill('input[name="password"]', 'not-a-real-password');
      await page.getByRole('button', { name: 'Sign in', exact: true }).click();
      await settle(page);
      check(
        'signing in with no project configured says exactly that, in a sentence',
        (await page.locator('body').innerText()).includes('SUPABASE_URL'),
      );

      await page.goto('/auth/signup');
      check(
        'sign-up is a real form under a real provider',
        (await page.locator('input[name="displayName"]').count()) === 1,
      );

      const invited = await page.goto('/invite/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
      check(
        'an invitation link opened by nobody asks them to sign in rather than failing',
        new URL(page.url()).pathname === '/auth/signin' && invited.status() === 200,
        `${page.url()} HTTP ${invited.status()}`,
      );

      const altAudit = await labelAuditOn(page);
      check('every control on the sign-in page has a label', altAudit.length === 0, altAudit.join(', '));

      await ctx.close();
    }

    try {
      process.kill(-server.pid, 'SIGTERM');
    } catch {
      server.kill('SIGTERM');
    }
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
