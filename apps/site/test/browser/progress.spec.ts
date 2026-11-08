import { test as browserTest, expect, type Locator, type Page } from '@playwright/test';

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

/** A tile of the roadmap board, by task ID. */
function tile(page: Page, id: string): Locator {
  return page.locator('.pg-board').getByRole('button', { name: new RegExp(`^${id} `) });
}

/** Opens the progress page and waits until the board responds to the pointer (hydrated). */
async function openBoard(page: Page): Promise<void> {
  await page.goto('/progress/');
  const probe = tile(page, 'T0001');
  await expect(async () => {
    await probe.hover();
    await expect(probe).toHaveClass(/\bcurrent\b/, { timeout: 500 });
  }).toPass();
  await page.mouse.move(0, 0);
}

// T0009 depends on T0003–T0006, and T0010 depends on T0009 (docs/roadmap.md).
test('highlights the hovered or focused task apart from its dependencies and dependents', async ({
  page,
}) => {
  await openBoard(page);
  const hovered = tile(page, 'T0009');
  await hovered.hover();
  await expect(hovered).toHaveClass(/\bcurrent\b/);
  await expect(page.locator('.pg-tile.current')).toHaveCount(1);
  await expect(tile(page, 'T0003')).toHaveClass(/\bdep\b/);
  await expect(tile(page, 'T0003')).not.toHaveClass(/\bcurrent\b/);
  await expect(tile(page, 'T0010')).toHaveClass(/\bdependent\b/);
  await expect(tile(page, 'T0001')).not.toHaveClass(/\b(current|dep|dependent)\b/);
  // The details live in the dialog, not in a native tooltip.
  await expect(page.locator('.pg-tile[title]')).toHaveCount(0);

  await page.mouse.move(0, 0);
  await expect(page.locator('.pg-tile.current')).toHaveCount(0);
  await tile(page, 'T0010').focus();
  await expect(tile(page, 'T0010')).toHaveClass(/\bcurrent\b/);
  await expect(hovered).toHaveClass(/\bdep\b/);
});

test('opens task details from a click or the keyboard, switches tasks and returns focus', async ({
  page,
}) => {
  await openBoard(page);
  const position = await page.locator('.pg-pos').textContent();

  await tile(page, 'T0009').click();
  const dialog = page.getByRole('dialog', { name: /^T0009 / });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('heading', { level: 2 })).toBeFocused();
  await expect(dialog).toContainText('Wave3');
  await expect(dialog.getByRole('link', { name: 'Task file' })).toHaveAttribute(
    'href',
    /^\/tasks\/T0009-/,
  );
  await expect(dialog.getByRole('link', { name: /^GitHub issue/ })).toHaveAttribute(
    'href',
    /\/issues\?q=.*T0009%3A/,
  );
  // The page's own arrow-key and space shortcuts stay off while the dialog is open.
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press(' ');
  await expect(page.locator('.pg-pos')).toHaveText(position ?? '');

  await dialog.getByRole('button', { name: /^T0003 / }).click();
  const switched = page.getByRole('dialog', { name: /^T0003 / });
  await expect(switched).toBeVisible();
  await expect(switched.getByRole('heading', { level: 2 })).toBeFocused();
  await expect(switched.getByRole('button', { name: /^T0009 / })).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(tile(page, 'T0009')).toBeFocused();

  await tile(page, 'T0010').focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: /^T0010 / })).toBeVisible();
  await page.getByRole('button', { name: 'Close' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(tile(page, 'T0010')).toBeFocused();

  await page.keyboard.press(' ');
  await expect(page.getByRole('dialog', { name: /^T0010 / })).toBeVisible();
  // A click on the backdrop, outside the dialog box, closes it.
  await page.mouse.click(4, 4);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(tile(page, 'T0010')).toBeFocused();
  await expect(page.locator('.pg-pos')).toHaveText(position ?? '');
});

for (const theme of ['dark', 'light'] as const) {
  test(`fits the task details on a narrow screen in the ${theme} theme`, async ({ page }) => {
    await page.addInitScript((value) => localStorage.setItem('callis-theme', value), theme);
    await page.setViewportSize({ width: 390, height: 844 });
    await openBoard(page);
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);

    await tile(page, 'T0009').click();
    const dialog = page.getByRole('dialog', { name: /^T0009 / });
    await expect(dialog).toBeVisible();
    const box = await dialog.boundingBox();
    expect(box).not.toBeNull();
    expect(box?.x ?? -1).toBeGreaterThanOrEqual(0);
    expect((box?.x ?? 0) + (box?.width ?? Number.POSITIVE_INFINITY)).toBeLessThanOrEqual(390);
    expect(
      await page.evaluate(() => {
        const body = document.querySelector('dialog[open] .pg-dialog-body');
        return (
          body !== null &&
          body.scrollWidth <= body.clientWidth &&
          document.documentElement.scrollWidth <= window.innerWidth
        );
      }),
    ).toBe(true);
    await dialog.getByRole('link', { name: /^GitHub issue/ }).scrollIntoViewIfNeeded();
    await expect(dialog.getByRole('link', { name: /^GitHub issue/ })).toBeInViewport();
  });
}
