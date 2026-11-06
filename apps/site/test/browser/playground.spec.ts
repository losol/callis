import { expect, test } from '@playwright/test';

test('loads the editor and evaluator only after entering the playground', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', (request) => requests.push(request.url()));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Callis', exact: true })).toBeVisible();
  expect(requests.some((url) => url.includes('playground-client-'))).toBe(false);
  await page.getByRole('link', { name: 'Playground', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Input JSON', exact: true })).toBeVisible();
  expect(requests.some((url) => url.includes('playground-client-'))).toBe(true);
});

test('prerenders a labelled shell and hydrates the direct route', async ({ page, request }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const response = await request.get('/playground/');
  expect(response.ok()).toBe(true);
  expect(await response.text()).toContain('Loading the JSON editor and evaluator');
  await page.goto('/playground/');
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
    ['Missing field', '[]'],
    ['Boolean logic', '[\n  true\n]'],
    ['Exact decimal', '[\n  "0.3"\n]'],
  ] as const) {
    await page.getByRole('button', { name, exact: true }).click();
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
