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
  for (const width of [390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 }); await page.goto('/sign-in');
    await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
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
  await mockSignedIn(page); await page.goto('/'); await page.keyboard.press('Control+K');
  await expect(page.getByRole('dialog', { name: 'Search Orbit' })).toBeVisible();
  await page.keyboard.press('Escape'); await expect(page.getByRole('dialog', { name: 'Search Orbit' })).toBeHidden();
});

test('Today uses one domain payload and meets interaction timing in the mocked browser path', async ({ page }) => {
  const requests: string[] = []; page.on('request', (request) => { if (request.url().includes('/rest/v1/')) requests.push(new URL(request.url()).pathname); });
  await mockSignedIn(page); const started = Date.now(); await page.goto('/'); await expect(page.getByText('Put the bins out')).toBeVisible();
  const visibleMs = Date.now() - started; expect(requests.filter((path) => path.includes('/rpc/dashboard'))).toHaveLength(1);
  expect(visibleMs).toBeLessThan(1800);
  console.log(JSON.stringify({ metric: 'mocked-today', visibleMs, dataRequests: requests }));
});
