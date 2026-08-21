import { expect, test, type Page } from 'playwright/test';

const userId = '11111111-1111-1111-1111-111111111111';
const session = () => {
  const payload = btoa(JSON.stringify({ sub: userId, aud: 'authenticated', role: 'authenticated', email: 'priya@example.com', exp: Math.floor(Date.now() / 1000) + 3600 }));
  return { access_token: `eyJhbGciOiJIUzI1NiJ9.${payload}.test`, token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'test-refresh', user: { id: userId, aud: 'authenticated', role: 'authenticated', email: 'priya@example.com', app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: {}, created_at: '2026-08-19T00:00:00Z' } };
};

async function mockSignedIn(page: Page) {
  await page.addInitScript((stored) => localStorage.setItem('sb-127-auth-token', JSON.stringify(stored)), session());
  await page.route('http://127.0.0.1:54321/**', async (route) => {
    const url = new URL(route.request().url()); let body: unknown = [];
    if (url.pathname.endsWith('/profiles')) body = { id: userId, email: 'priya@example.com', display_name: 'Priya', avatar_url: null, timezone: 'Europe/London', locale: 'en-GB', week_starts_on: 1, theme: 'system', default_space_id: 'space-1' };
    else if (url.pathname.endsWith('/spaces')) body = [{ id: 'space-1', owner_id: userId, name: 'Home', kind: 'household', colour: 'orange', icon: 'home', short_label: 'Home', is_default: true, protected: true, archived_at: null }];
    else if (url.pathname.includes('/rpc/dashboard')) body = { tasks: [{ id: 'task-1', space_id: 'space-1', owner_id: userId, category_id: null, recurrence_rule_id: null, title: 'Put the bins out', body_md: '', status: 'todo', priority: 'normal', visibility: 'space', is_locked: false, due_on: new Date().toISOString().slice(0, 10), due_at: null, deferred_until: null, assignee_id: userId, waiting_on: null, completed_at: null, updated_at: new Date().toISOString() }], events: [], dates: [] };
    else if (url.pathname.endsWith('/tasks')) body = [{ id: 'task-1', space_id: 'space-1', owner_id: userId, category_id: null, recurrence_rule_id: null, title: 'Put the bins out', body_md: '', status: 'todo', priority: 'normal', visibility: 'space', is_locked: false, due_on: new Date().toISOString().slice(0, 10), due_at: null, deferred_until: null, assignee_id: userId, waiting_on: null, completed_at: null, updated_at: new Date().toISOString() }];
    else if (url.pathname.endsWith('/events')) body = [];
    else if (url.pathname.endsWith('/person_dates')) body = [];
    else if (url.pathname.includes('/rpc/ensure_account')) body = { profile: 'exists', spaces_created: 0 };
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body), headers: { 'content-range': '0-0/1' } });
  });
}

test('sign-in is keyboard-ready and has no horizontal overflow at required widths', async ({ page }) => {
  await page.goto('/sign-in');
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
  for (const width of [390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.getByLabel('Email')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  }
});

test('signed-in Today shows exact mocked counts and responsive shell', async ({ page }) => {
  await mockSignedIn(page); await page.setViewportSize({ width: 390, height: 844 }); await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible();
  await expect(page.getByText('Put the bins out')).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Mobile navigation' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});

test('command palette opens from the keyboard and restores navigation', async ({ page }) => {
  await mockSignedIn(page); await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible();
  await page.keyboard.press('Control+K');
  await expect(page.getByRole('dialog', { name: 'Search Orbit' })).toBeVisible();
  await page.keyboard.press('Escape'); await expect(page.getByRole('dialog', { name: 'Search Orbit' })).toBeHidden();
});

test('focus is visible and the command palette traps and restores focus', async ({ page }) => {
  await page.goto('/sign-in');
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
  await page.keyboard.press('Tab');
  expect(await page.evaluate(() => getComputedStyle(document.activeElement!).outlineStyle)).toBe('solid');
  await mockSignedIn(page);
  await page.goto('/');
  const trigger = page.getByRole('button', { name: 'Search Orbit' });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'Search Orbit' });
  await expect(dialog.getByRole('textbox', { name: 'Search query' })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(dialog.getByRole('button', { name: 'Close search' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('textbox', { name: 'Search query' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
});

test('Today uses one domain payload and meets interaction timing in the mocked browser path', async ({ page }) => {
  const requests: string[] = []; page.on('request', (request) => { if (request.url().includes('/rest/v1/')) requests.push(new URL(request.url()).pathname); });
  await mockSignedIn(page); const started = Date.now(); await page.goto('/'); await expect(page.getByText('Put the bins out')).toBeVisible();
  const visibleMs = Date.now() - started; expect(requests.filter((path) => path.includes('/rpc/dashboard'))).toHaveLength(1);
  expect(visibleMs).toBeLessThan(1800);
  console.log(JSON.stringify({ metric: 'mocked-today', visibleMs, dataRequests: requests }));
});

test('all task smart-list URLs select their own list', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'Route matrix is browser-independent and runs once.');
  await mockSignedIn(page);
  for (const list of ['mine', 'today', 'upcoming', 'inbox', 'waiting', 'someday', 'done', 'all']) {
    await page.goto(`/tasks/${list}`);
    await expect(page.getByRole('heading', { name: 'Tasks' })).toBeVisible();
    await expect(page.getByLabel('Smart lists').getByRole('link', { name: new RegExp(`^${list}$`, 'i') })).toHaveAttribute('aria-current', 'page');
  }
});

test('authenticated major routes have no horizontal overflow at required widths', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'Responsive matrix runs once; functional checks run in all engines.');
  await mockSignedIn(page);
  const routes = [
    ['/', 'Today'], ['/tasks/today', 'Tasks'], ['/calendar?view=day', 'Calendar'],
    ['/calendar?view=week', 'Calendar'], ['/calendar?view=month', 'Calendar'], ['/people', 'People'],
    ['/places', 'Places'], ['/notes', 'Notes'], ['/search', 'Search'], ['/settings', 'Settings'],
  ] as const;
  for (const width of [390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const [path, heading] of routes) {
      await page.goto(path);
      await expect(page.getByRole('heading', { name: heading })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), `${path} overflowed at ${width}px`).toBe(true);
    }
  }
});

test('every major route stays within one domain request', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'Request instrumentation runs once.');
  const requests: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/rest/v1/')) requests.push(new URL(request.url()).pathname);
  });
  await mockSignedIn(page);
  const measurements: Record<string, string[]> = {};
  for (const [name, path, heading] of [
    ['today', '/', 'Today'], ['tasks', '/tasks/today', 'Tasks'], ['calendar', '/calendar', 'Calendar'],
    ['people', '/people', 'People'], ['places', '/places', 'Places'], ['notes', '/notes', 'Notes'],
    ['settings', '/settings', 'Settings'],
  ] as const) {
    requests.length = 0;
    await page.goto(path);
    await expect(page.getByRole('heading', { name: heading })).toBeVisible();
    await page.waitForLoadState('networkidle');
    measurements[name] = requests.filter((item) => !item.endsWith('/profiles') && !item.endsWith('/spaces'));
    expect(measurements[name], `${name} domain requests`).toHaveLength(name === 'settings' ? 0 : 1);
  }
  requests.length = 0;
  await page.goto('/search');
  await expect(page.getByRole('heading', { name: 'Search' })).toBeVisible();
  await page.getByPlaceholder('Search Orbit').fill('home');
  await page.waitForLoadState('networkidle');
  measurements.search = requests.filter((item) => !item.endsWith('/profiles') && !item.endsWith('/spaces'));
  expect(measurements.search).toEqual(['/rest/v1/rpc/search']);
  console.log(JSON.stringify({ metric: 'route-request-counts', measurements }));
});

test('mocked production path records browser paint, layout and interaction metrics', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'Core Web Vital instrumentation runs in Chromium.');
  await page.addInitScript(() => {
    const metrics = { lcp: 0, cls: 0, inp: 0 };
    Object.assign(window, { __orbitVitals: metrics });
    new PerformanceObserver((list) => { for (const entry of list.getEntries()) metrics.lcp = entry.startTime; }).observe({ type: 'largest-contentful-paint', buffered: true });
    new PerformanceObserver((list) => { for (const entry of list.getEntries() as unknown as { value: number; hadRecentInput: boolean }[]) if (!entry.hadRecentInput) metrics.cls += entry.value; }).observe({ type: 'layout-shift', buffered: true });
    new PerformanceObserver((list) => { for (const entry of list.getEntries() as unknown as { duration: number; interactionId: number }[]) if (entry.interactionId) metrics.inp = Math.max(metrics.inp, entry.duration); }).observe({ type: 'event', buffered: true, durationThreshold: 16 });
  });
  await mockSignedIn(page);
  await page.goto('/');
  await expect(page.getByText('Put the bins out')).toBeVisible();
  const started = await page.evaluate(() => performance.now());
  await page.getByRole('button', { name: '7 days' }).click();
  await expect(page.getByRole('button', { name: '7 days' })).toHaveAttribute('aria-pressed', 'true');
  const interactionFeedbackMs = await page.evaluate((before) => performance.now() - before, started);
  await page.waitForTimeout(100);
  const vitals = await page.evaluate(() => (window as unknown as { __orbitVitals: { lcp: number; cls: number; inp: number } }).__orbitVitals);
  expect(vitals.lcp).toBeGreaterThan(0);
  expect(vitals.lcp).toBeLessThan(1800);
  expect(vitals.cls).toBeLessThan(0.05);
  expect(interactionFeedbackMs).toBeLessThan(150);
  if (vitals.inp) expect(vitals.inp).toBeLessThan(150);
  console.log(JSON.stringify({ metric: 'mocked-browser-vitals', ...vitals, interactionFeedbackMs }));
});
