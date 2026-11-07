import { readdirSync, readFileSync } from 'node:fs';
import { test as browserTest, expect, type Page } from '@playwright/test';

const test = browserTest.extend<{ browserErrors: readonly string[] }>({
  browserErrors: [
    async ({ page }, use) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('console', (message) => {
        if (message.type() === 'error') errors.push(message.text());
      });
      await use(errors);
      expect(errors).toEqual([]);
    },
    { auto: true },
  ],
});

async function chooseExample(page: Page, title: string): Promise<void> {
  await page.getByRole('button', { name: /Choose example/ }).click();
  await page.getByRole('option', { name: title, exact: true }).click();
  await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
}

for (const viewportWidth of [1440, 390]) {
  test(`keeps width and side margins stable at ${viewportWidth}px when results change`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: viewportWidth, height: 1000 });
    await page.goto('/playground/');
    await page.getByRole('textbox', { name: 'Input JSON', exact: true }).waitFor();
    await page.evaluate(() => document.fonts.ready);
    const bounds = () =>
      page.locator('.playground').evaluate((element) => {
        const { x, width } = element.getBoundingClientRect();
        return { x, width };
      });
    const before = await bounds();
    const expectStable = async () => {
      const after = await bounds();
      // Allow subpixel rounding, but not a content-driven horizontal shift.
      expect(after.x).toBeCloseTo(before.x, 0);
      expect(after.width).toBeCloseTo(before.width, 0);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
    };
    await page.getByRole('button', { name: 'Run expression', exact: true }).click();
    await expect(page.locator('.playground-output').getByRole('status')).toHaveText('3 items');
    await expectStable();
    await page.getByLabel('FHIRPath expression').fill('(');
    await expectStable();
    await page.getByRole('button', { name: 'Run expression', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('Expression error');
    await expectStable();
    await page.getByRole('button', { name: 'Reset example' }).click();
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expectStable();
  });
}

test('loads the editor and evaluator only after entering the playground', async ({ page }) => {
  const assets = new URL('../../build/client/assets/', import.meta.url);
  const engineFiles = readdirSync(assets).filter(
    (name) =>
      name.endsWith('.js') &&
      readFileSync(new URL(name, assets), 'utf8').includes('eval/undefined-variable'),
  );
  expect(engineFiles.length).toBeGreaterThan(0);
  const requests: string[] = [];
  page.on('request', (request) => requests.push(request.url()));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Callis', exact: true })).toBeVisible();
  expect(
    requests.some(
      (url) =>
        url.includes('playground-client-') ||
        url.includes('case-library-') ||
        engineFiles.some((name) => new URL(url).pathname.endsWith(`/${name}`)),
    ),
  ).toBe(false);
  await page.getByRole('link', { name: 'Playground', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Input JSON', exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/playground$/);
  await expect(page.getByRole('link', { name: 'Playground', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(page.getByRole('link', { name: 'Docs', exact: true })).not.toHaveAttribute(
    'aria-current',
    'page',
  );
  expect(requests.some((url) => url.includes('playground-client-'))).toBe(true);
  expect(requests.some((url) => url.includes('case-library-'))).toBe(true);
  expect(
    requests.some((url) => engineFiles.some((name) => new URL(url).pathname.endsWith(`/${name}`))),
  ).toBe(true);
});

test('prerenders a labelled shell and hydrates the direct route', async ({ page, request }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const response = await request.get('/playground');
  expect(response.ok()).toBe(true);
  expect(await response.text()).toContain('Loading the JSON editor and evaluator');
  await page.goto('/playground/');
  await expect(page.getByRole('link', { name: 'Playground', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(page.getByRole('link', { name: 'Docs', exact: true })).not.toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(page.getByRole('textbox', { name: 'Input JSON', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Run expression', exact: true }).click();
  await expect(page.locator('.playground-output pre')).toContainText('Ada');
  await page.reload();
  await expect(page.getByLabel('FHIRPath expression')).toHaveValue('Patient.name.given');
  await expect(page.locator('.playground-output pre')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('runs public-API presets and clears stale output on edit or reset', async ({ page }) => {
  await page.goto('/playground/');
  const run = page.getByRole('button', { name: 'Run expression', exact: true });
  const output = page.locator('.playground-output pre');
  for (const [name, expected] of [
    ['Given names', '[\n  "Ada",\n  "June",\n  "Alex"\n]'],
    ['First name', '[\n  "Ada",\n  "June"\n]'],
    ['Filtered names', '[\n  "Ada",\n  "June"\n]'],
    ['Name count', '[\n  2\n]'],
    ['Has Ada', '[\n  true\n]'],
    ['Filtered count', '[\n  1\n]'],
    ['Missing field', '[]'],
    ['Boolean logic', '[\n  true\n]'],
    ['Exact decimal', '[\n  "0.3"\n]'],
  ] as const) {
    await chooseExample(page, name);
    await expect(output).toHaveCount(0);
    await run.click();
    await expect(output).toHaveText(expected);
  }
  await page.getByLabel('FHIRPath expression').fill('Patient.active');
  await expect(output).toHaveCount(0);
  await run.click();
  await expect(output).toContainText('true');
  await page.getByRole('textbox', { name: 'Input JSON', exact: true }).fill('{}');
  await expect(output).toHaveCount(0);
  await page.getByRole('button', { name: 'Reset example' }).click();
  await expect(page.getByLabel('FHIRPath expression')).toHaveValue('0.1 + 0.2');
});

test('separates JSON and expression errors, recovers, and renders result text safely', async ({
  page,
}) => {
  await page.goto('/playground/');
  const json = page.getByRole('textbox', { name: 'Input JSON', exact: true });
  const expression = page.getByLabel('FHIRPath expression');
  const run = page.getByRole('button', { name: 'Run expression', exact: true });
  await json.fill('{');
  await run.click();
  await expect(page.getByRole('alert')).toContainText('Invalid JSON');
  await json.fill('{}');
  await expression.fill('unknown()');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await run.click();
  await expect(page.getByRole('alert')).toContainText('semantic/unknown-function');
  await expression.fill('(');
  await run.click();
  await expect(page.getByRole('alert')).toContainText('syntax/');
  await json.fill('{"text":"<img src=x onerror=alert(1)>"}');
  await expression.fill('text');
  await run.click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.locator('.playground-output pre')).toContainText(
    '<img src=x onerror=alert(1)>',
  );
  await expect(page.locator('.playground-output img')).toHaveCount(0);
});

test('supports keyboard exit, run and search focus in both themes and a narrow layout', async ({
  page,
}) => {
  await page.goto('/playground/');
  const json = page.getByRole('textbox', { name: 'Input JSON', exact: true });
  const expression = page.getByLabel('FHIRPath expression');
  await json.focus();
  await page.keyboard.press('Tab');
  await expect(expression).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(json).toBeFocused();
  await page.keyboard.press('ControlOrMeta+Enter');
  await expect(page.locator('.playground-output pre')).toContainText('Ada');
  await expression.focus();
  await page.keyboard.press('ControlOrMeta+k');
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('combobox')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(expression).toBeFocused();
  await page.getByRole('button', { name: 'Switch theme' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.reload();
  await expect(json).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(json).toBeVisible();
  await page.getByRole('button', { name: 'Switch theme' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(expression).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.getByRole('button', { name: 'Run expression', exact: true }).click();
  await expect(page.locator('.playground-output pre')).toContainText('Ada');
});

test('searches the library, announces empty results and loads the selected case', async ({
  page,
}) => {
  await page.goto('/playground/');
  const search = page.getByRole('searchbox', { name: 'Search examples' });
  await search.fill('clinical-data observations');
  await expect(page.locator('.playground-search-status')).toHaveText('1 example found.');
  await chooseExample(page, 'Final observations');
  await expect(page).toHaveURL(/example=final-observation-count/);
  await expect(page.getByLabel('FHIRPath expression')).toHaveValue(
    "Bundle.entry.resource.where(resourceType = 'Observation').where(status = 'final').count()",
  );
  await expect(page.locator('.playground-expected pre')).toHaveText('[\n  1\n]');
  await expect(page.locator('.playground-output pre')).toHaveCount(0);
  await page.getByRole('button', { name: 'Run expression', exact: true }).click();
  await expect(page.locator('.playground-comparison')).toHaveText('Matches original expectation.');
  await search.fill('no-example-has-this-name');
  await expect(page.locator('.playground-search-status')).toHaveText(
    'No examples match your search.',
  );
  await expect(page.getByRole('button', { name: /Choose example/ })).toBeDisabled();
  await expect(
    page.getByRole('heading', { name: 'Final observations', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Clear search', exact: true }).click();
  await expect(page.locator('.playground-search-status')).toHaveText('12 examples found.');
});

for (const [id, title, expected] of [
  ['official-given-name', 'Official given name', '[\n  "Ada"\n]'],
  ['final-observation-count', 'Final observations', '[\n  1\n]'],
  ['phone-entry', 'Phone entry', '[\n  false\n]'],
] as const) {
  test(`deep-links, compares, edits and resets ${id}`, async ({ page }) => {
    await page.goto(`/playground/?example=${id}`);
    await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
    const expression = page.getByLabel('FHIRPath expression');
    const original = await expression.inputValue();
    const run = page.getByRole('button', { name: 'Run expression', exact: true });
    await expect(page.locator('.playground-output pre')).toHaveCount(0);
    await run.click();
    await expect(page.locator('.playground-output pre')).toHaveText(expected);
    await expect(page.locator('.playground-comparison')).toHaveText(
      'Matches original expectation.',
    );
    await expression.fill('true');
    await expect(page.locator('.playground-output pre')).toHaveCount(0);
    await expect(page.locator('.playground-comparison')).toHaveText('Not compared yet.');
    await expect(page.locator('.playground-expected')).toContainText('Modified example');
    await run.click();
    await expect(page.locator('.playground-comparison')).toHaveText(
      'Modified run: original expectation shown for reference.',
    );
    await page.getByRole('button', { name: 'Reset example', exact: true }).click();
    await expect(expression).toHaveValue(original);
    await expect(page.locator('.playground-output pre')).toHaveCount(0);
    await expect(page.locator('.playground-comparison')).toHaveText('Not compared yet.');
    await page.reload();
    await expect(expression).toHaveValue(original);
    await expect(page.locator('.playground-output pre')).toHaveCount(0);
  });
}

test('handles unknown case IDs without importing a path and keeps user edits local', async ({
  page,
}) => {
  await page.goto('/playground/?example=unlisted-path');
  await expect(page.getByText('Unknown example ID. Showing the default example.')).toBeVisible();
  const json = page.getByRole('textbox', { name: 'Input JSON', exact: true });
  await expect(json).toBeVisible();
  await page.waitForLoadState('networkidle');
  const requests: string[] = [];
  page.on('request', (request) => requests.push(request.url()));
  const storage = await page.evaluate(() => ({
    local: { ...localStorage },
    session: { ...sessionStorage },
  }));
  await json.fill('{"privateExampleText":"local-only-marker"}');
  await page.getByLabel('FHIRPath expression').fill('privateExampleText');
  await page.getByRole('button', { name: 'Run expression', exact: true }).click();
  await expect(page.locator('.playground-output pre')).toContainText('local-only-marker');
  expect(requests).toEqual([]);
  expect(page.url()).not.toContain('local-only-marker');
  expect(
    await page.evaluate(() => ({ local: { ...localStorage }, session: { ...sessionStorage } })),
  ).toEqual(storage);
});

test('uses the searchable picker from the keyboard without stealing editor or docs search focus', async ({
  page,
}) => {
  await page.goto('/playground/');
  const search = page.getByRole('searchbox', { name: 'Search examples' });
  await search.fill('phone');
  await page.getByRole('button', { name: /Choose example/ }).focus();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('option', { name: 'Phone entry', exact: true })).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Phone entry', exact: true })).toBeVisible();
  const expression = page.getByLabel('FHIRPath expression');
  await expression.focus();
  await page.keyboard.press('ControlOrMeta+Enter');
  await expect(page.locator('.playground-output pre')).toContainText('false');
  await page.keyboard.press('ControlOrMeta+k');
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(expression).toBeFocused();
});
