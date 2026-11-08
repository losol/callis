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

/** Checks that a control is visible and that no other element covers its centre. */
async function expectUncovered(control: Locator): Promise<void> {
  await expect(control).toBeVisible();
  const uncovered = await control.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
    return hit !== null && element.contains(hit);
  });
  expect(uncovered).toBe(true);
}

/**
 * Checks that the drawer starts below the sticky site header and reaches the bottom of the
 * window, and that the header's links and theme toggle stay visible and uncovered.
 */
async function expectBelowHeader(page: Page, drawer: Locator): Promise<void> {
  const header = page.locator('.site-header');
  const headerBox = await header.boundingBox();
  const box = await drawer.boundingBox();
  const viewport = page.viewportSize();
  expect(box?.y).toBeCloseTo((headerBox?.y ?? 0) + (headerBox?.height ?? 0), 0);
  expect((box?.y ?? 0) + (box?.height ?? 0)).toBeCloseTo(viewport?.height ?? 0, 0);
  for (const control of [
    header.getByRole('link', { name: 'Docs', exact: true }),
    header.getByRole('link', { name: 'Playground', exact: true }),
    header.getByRole('link', { name: 'Progress', exact: true }),
    header.getByRole('link', { name: 'GitHub', exact: true }),
    header.getByRole('button', { name: 'Switch theme' }),
  ]) {
    await expectUncovered(control);
  }
}

/** Checks that the page does not scroll sideways: nothing on it is wider than the viewport. */
async function expectNoSidewaysScroll(page: Page): Promise<void> {
  const [scrollWidth, clientWidth] = await page.evaluate(() => [
    document.documentElement.scrollWidth,
    document.documentElement.clientWidth,
  ]);
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
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

test('starts at the top when the drawer switches from a scrolled task', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 500 });
  await openBoard(page);
  await tile(page, 'T0008').click();
  const drawer = page.getByRole('dialog', { name: /^T0008 / });
  await expect(drawer).toBeVisible();
  const body = drawer.locator('.pg-drawer-body');

  // Scroll T0008 down to its "Needed by" list, then open T0014, which depends on it.
  const next = drawer.getByRole('button', { name: /^T0014 / });
  await next.scrollIntoViewIfNeeded();
  expect(await body.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  await next.click();

  const switched = page.getByRole('dialog', { name: /^T0014 / });
  await expect(switched.getByRole('heading', { level: 2 })).toBeFocused();
  expect(await switched.locator('.pg-drawer-body').evaluate((element) => element.scrollTop)).toBe(
    0,
  );
  await expect(switched.locator('.pg-badge')).toBeInViewport();
  await expect(switched.locator('.pg-facts')).toBeInViewport();
});

test('keeps the keyboard in the drawer and the header while the drawer covers a narrow screen', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openBoard(page);
  await tile(page, 'T0009').focus();
  await page.keyboard.press('Enter');
  const drawer = page.getByRole('dialog', { name: /^T0009 / });
  const title = drawer.getByRole('heading', { level: 2 });
  await expect(title).toBeFocused();
  const focusIn = (selector: string) =>
    page.evaluate((within) => document.activeElement?.closest(within) != null, selector);

  // Backwards from the title the focus goes to the header, not to the board behind the drawer.
  await page.keyboard.press('Shift+Tab');
  expect(await focusIn('.site-header')).toBe(true);

  // Forwards through the drawer and past its end, the focus never reaches the page it covers.
  await drawer.getByRole('button', { name: 'Close' }).focus();
  for (let step = 0; step < 30; step += 1) {
    await page.keyboard.press('Tab');
    const allowed = await page.evaluate(
      () =>
        document.activeElement === document.body ||
        document.activeElement?.closest('.pg-drawer, .site-header') != null,
    );
    expect(allowed, `Tab ${step + 1}`).toBe(true);
  }

  // The page is inert only while the drawer covers it.
  await page.setViewportSize({ width: 1280, height: 844 });
  await expect(page.locator('main [inert]')).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('main [inert]').first()).toBeAttached();

  // Escape returns the focus to the tile, which is usable again.
  await title.focus();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('main [inert]')).toHaveCount(0);
  await expect(tile(page, 'T0009')).toBeFocused();
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
    // The drawer spans the width of the viewport below the header, and its content wraps inside
    // it. The page behind it fits the viewport too, whatever the selected commit's subject is.
    const box = await drawer.boundingBox();
    expect(box?.x).toBe(0);
    expect(box?.width).toBe(390);
    await expectNoSidewaysScroll(page);
    await expectBelowHeader(page, drawer);
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
    await expectBelowHeader(page, drawer);
    // Beside the board, the drawer leaves the page usable.
    await expect(page.locator('main [inert]')).toHaveCount(0);

    // The header stays usable while the drawer is open.
    const other = theme === 'dark' ? 'light' : 'dark';
    await page.locator('.site-header').getByRole('button', { name: 'Switch theme' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', other);
    await expect(drawer).toBeVisible();

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

const PLAYER_VIEWPORTS = [
  { width: 390, height: 844 },
  { width: 1280, height: 800 },
] as const;

/** Opens the progress page in a viewport and a theme. */
async function openProgress(
  page: Page,
  viewport: (typeof PLAYER_VIEWPORTS)[number],
  theme: 'dark' | 'light',
): Promise<void> {
  await page.addInitScript((value) => localStorage.setItem('callis-theme', value), theme);
  await page.setViewportSize(viewport);
  await openBoard(page);
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
}

// The subjects in the history are short, except the merge commit that a pull request build
// checks out: `Merge <40-character SHA> into <40-character SHA>`. It is the last commit, which the
// player selects first. This subject has that shape and a long path as well, so it is wider than
// the viewport at both sizes (#154).
const LONG_SUBJECT = `Merge ${'a1b2c3d4e5'.repeat(4)} into ${'f6a7b8c9d0'.repeat(4)} ${'/very/long/path'.repeat(20)}`;

for (const viewport of PLAYER_VIEWPORTS) {
  for (const theme of ['dark', 'light'] as const) {
    test(`wraps a long word in the commit subject at ${viewport.width}px in the ${theme} theme`, async ({
      page,
    }) => {
      await openProgress(page, viewport, theme);
      // Add the long word after the hydration: React renders the text nodes it owns and leaves
      // this one alone.
      const subject = page.locator('.pg-subject');
      await subject.evaluate((element, text) => element.append(` ${text}`), LONG_SUBJECT);
      await expect(subject).toContainText('/very/long/path');

      // The page does not scroll sideways, and the whole subject stays inside the player.
      await expectNoSidewaysScroll(page);
      const playerBox = await page.locator('.pg-player').boundingBox();
      const subjectBox = await subject.boundingBox();
      expect((subjectBox?.x ?? 0) + (subjectBox?.width ?? 0)).toBeLessThanOrEqual(
        (playerBox?.x ?? 0) + (playerBox?.width ?? 0),
      );
      const [scrollWidth, clientWidth] = await subject.evaluate((element) => [
        element.scrollWidth,
        element.clientWidth,
      ]);
      expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
    });

    test(`keeps the commit player below the site header when scrolled at ${viewport.width}px in the ${theme} theme`, async ({
      page,
    }) => {
      await openProgress(page, viewport, theme);
      // Scroll until the player is stuck. The header wraps on narrow screens, so its height
      // differs between the viewports: the player follows it (#157).
      await page.evaluate(() => {
        const top = document.querySelector('.pg-player')?.getBoundingClientRect().top ?? 0;
        window.scrollTo(0, top + window.scrollY + 300);
      });
      expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);

      const headerBox = await page.locator('.site-header').boundingBox();
      const playerBox = await page.locator('.pg-player').boundingBox();
      expect(playerBox?.y).toBeCloseTo((headerBox?.y ?? 0) + (headerBox?.height ?? 0), 0);
      // The buttons and the slider stay visible and usable.
      const controls = await page
        .locator('.pg-player')
        .locator('button, input[type="range"]')
        .all();
      expect(controls).toHaveLength(5);
      for (const control of controls) {
        await expectUncovered(control);
      }
    });
  }
}
