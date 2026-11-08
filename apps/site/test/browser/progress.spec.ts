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

/** Waits until the drawer has slid in, so its box is where it stays. */
async function settled(drawer: Locator): Promise<void> {
  await drawer.evaluate((element) =>
    Promise.all(element.getAnimations().map((animation) => animation.finished)),
  );
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

test('shows task details in a non-modal drawer that tiles switch, and returns focus', async ({
  page,
}) => {
  await openBoard(page);

  await tile(page, 'T0009').click();
  const drawer = page.getByRole('dialog', { name: /^T0009 / });
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole('heading', { level: 2 })).toBeFocused();
  expect(await drawer.getAttribute('aria-modal')).toBeNull();
  await expect(tile(page, 'T0009')).toHaveAttribute('aria-current', 'true');
  await expect(drawer.locator('.pg-facts')).toContainText('Wave3');
  await expect(drawer.getByRole('link', { name: 'Task file' })).toHaveAttribute(
    'href',
    /^\/tasks\/T0009-/,
  );
  await expect(drawer.getByRole('link', { name: /^GitHub issue/ })).toHaveAttribute(
    'href',
    /\/issues\?q=.*T0009%3A/,
  );

  // The page stays usable: another tile switches the drawer, and the player changes its status.
  await tile(page, 'T0010').click();
  await expect(page.getByRole('dialog')).toHaveCount(1);
  const switched = page.getByRole('dialog', { name: /^T0010 / });
  await expect(switched.getByRole('heading', { level: 2 })).toBeFocused();
  await expect(tile(page, 'T0010')).toHaveAttribute('aria-current', 'true');
  await expect(tile(page, 'T0009')).not.toHaveAttribute('aria-current');
  await page.getByRole('button', { name: '|◀' }).click();
  await expect(switched.locator('.pg-badge')).toContainText('Blocked');

  // A dependency in the drawer switches it too; Escape returns the focus to the shown task's tile.
  await switched.getByRole('button', { name: /^T0009 / }).click();
  await expect(page.getByRole('dialog', { name: /^T0009 / })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(tile(page, 'T0009')).toBeFocused();

  // Enter opens it; the focus is not trapped; the close button returns the focus.
  await tile(page, 'T0010').focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: /^T0010 / })).toBeVisible();
  await page.keyboard.press('Shift+Tab');
  expect(await page.evaluate(() => document.activeElement?.closest('.pg-board') !== null)).toBe(
    true,
  );
  await page.getByRole('button', { name: 'Close' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(tile(page, 'T0010')).toBeFocused();

  // Space opens it; Escape on a tile closes it and leaves the focus on that tile.
  await page.keyboard.press(' ');
  await expect(page.getByRole('dialog', { name: /^T0010 / })).toBeVisible();
  await tile(page, 'T0001').focus();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(tile(page, 'T0001')).toBeFocused();
});

for (const theme of ['dark', 'light'] as const) {
  test(`fits the drawer on a narrow screen in the ${theme} theme`, async ({ page }) => {
    await page.addInitScript((value) => localStorage.setItem('callis-theme', value), theme);
    await page.setViewportSize({ width: 390, height: 844 });
    await openBoard(page);
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);

    await tile(page, 'T0009').click();
    const drawer = page.getByRole('dialog', { name: /^T0009 / });
    await expect(drawer).toBeVisible();
    await settled(drawer);
    // The drawer covers the viewport and its content wraps inside it. The page behind it is not
    // checked: a commit subject with a long word can still widen it (#154).
    const box = await drawer.boundingBox();
    expect(box?.x).toBe(0);
    expect(box?.width).toBe(390);
    const body = drawer.locator('.pg-drawer-body');
    const [scrollWidth, clientWidth] = await body.evaluate((element) => [
      element.scrollWidth,
      element.clientWidth,
    ]);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
    await drawer.getByRole('link', { name: /^GitHub issue/ }).scrollIntoViewIfNeeded();
    await expect(drawer.getByRole('link', { name: /^GitHub issue/ })).toBeInViewport();
  });
}

for (const theme of ['dark', 'light'] as const) {
  test(`slides the drawer in beside a scrollable board at 1280px in the ${theme} theme`, async ({
    page,
  }) => {
    await page.addInitScript((value) => localStorage.setItem('callis-theme', value), theme);
    await page.setViewportSize({ width: 1280, height: 800 });
    await openBoard(page);
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await tile(page, 'T0009').click();
    const drawer = page.locator('.pg-drawer');
    await expect(drawer).toBeVisible();
    expect(await drawer.evaluate((element) => getComputedStyle(element).animationName)).toBe(
      'pg-drawer-in',
    );
    await settled(drawer);
    const box = await drawer.boundingBox();
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeCloseTo(1280, 0);
    expect(box?.width).toBeGreaterThanOrEqual(380);
    expect(box?.width).toBeLessThanOrEqual(440);

    // Scrolled to its end, the board shows its last wave left of the drawer.
    const lastColumnRight = await page.locator('.pg-board-wrap').evaluate((wrap) => {
      wrap.scrollLeft = wrap.scrollWidth;
      return wrap.querySelector('.pg-col:last-child')?.getBoundingClientRect().right ?? 0;
    });
    expect(lastColumnRight).toBeLessThanOrEqual(box?.x ?? 0);

    await page.emulateMedia({ reducedMotion: 'reduce' });
    expect(await drawer.evaluate((element) => getComputedStyle(element).animationName)).toBe(
      'none',
    );
  });
}
