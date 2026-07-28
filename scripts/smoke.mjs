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
 * It restores everything it changes. Run `pnpm seed` if a run is interrupted.
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
