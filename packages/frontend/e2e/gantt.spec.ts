import { expect, test } from '@playwright/test';

test.describe('Gantt Planner tab', () => {
  test('renders the sprint board: week columns, lanes, and the bag', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('tab-gantt').click();

    await expect(page.getByTestId('gantt-board')).toBeVisible();
    await expect(page.getByTestId('gantt-sprint-select')).toBeVisible();

    // Two week columns for a two-week sprint, each with a verdict.
    await expect(page.getByTestId('gantt-week-0')).toHaveAttribute('data-verdict', /green|yellow|red/);
    await expect(page.getByTestId('gantt-week-1')).toHaveAttribute('data-verdict', /green|yellow|red/);

    // The seeded scenario opens with an over-committed first week.
    await expect(page.getByTestId('gantt-week-0')).toHaveAttribute('data-verdict', 'red');

    // Lanes and a populated bag are present.
    await expect(page.locator('[data-testid^="gantt-lane-"]').first()).toBeVisible();
    await expect(page.locator('[data-testid^="gantt-bag-item-"]').first()).toBeVisible();
  });

  test('arrow buttons step the sprint selector forward and back', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('tab-gantt').click();

    const select = page.getByTestId('gantt-sprint-select');
    const prev = page.getByTestId('gantt-sprint-prev');
    const next = page.getByTestId('gantt-sprint-next');

    // Opens on the first sprint, so "previous" is disabled and "next" is live.
    const first = await select.inputValue();
    await expect(prev).toBeDisabled();
    await expect(next).toBeEnabled();

    // Next advances one sprint; previous returns to the first.
    await next.click();
    const second = await select.inputValue();
    expect(second).not.toBe(first);
    await expect(prev).toBeEnabled();
    await prev.click();
    await expect(select).toHaveValue(first);
    await expect(prev).toBeDisabled();
  });

  test('cards carry the title and reveal full details on hover', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('tab-gantt').click();

    const card = page.getByTestId('gantt-bag-item-CKT-21');
    const title = (await card.locator('.work-card-title').innerText()).trim();
    expect(title.length).toBeGreaterThan(0);

    // Hovering surfaces a clean tooltip echoing the key and the full title.
    await card.hover();
    const tip = page.getByTestId('work-card-tooltip');
    await expect(tip).toBeVisible();
    await expect(tip).toContainText('CKT-21');
    await expect(tip).toContainText(title);
  });

  test('opens the per-engineer weekly capacity modal', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('tab-gantt').click();
    await page.getByTestId('gantt-engineer-strip').locator('button').first().click();
    const modal = page.getByTestId('gantt-engineer-modal');
    await expect(modal).toBeVisible();
    // One row per week.
    await expect(modal.locator('.modal-weeks li')).toHaveCount(2);
  });

  // Native HTML5 drag can't be driven by Playwright's real-mouse simulation in
  // headless Chromium, so we dispatch the drag events with a shared DataTransfer
  // (Playwright's recommended pattern). This drives the exact onDragStart /
  // onDrop handlers a real drag fires.
  async function drag(page: import('@playwright/test').Page, from: string, to: string) {
    const dt = await page.evaluateHandle(() => new DataTransfer());
    await page.getByTestId(from).dispatchEvent('dragstart', { dataTransfer: dt });
    await page.getByTestId(to).dispatchEvent('dragover', { dataTransfer: dt });
    await page.getByTestId(to).dispatchEvent('drop', { dataTransfer: dt });
  }

  test('dragging a backlog card into a week recomputes it live', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('tab-gantt').click();

    const week1 = page.getByTestId('gantt-week-1');
    await expect(week1).toHaveAttribute('data-verdict', 'green');

    // Drop a 5-point card into the comfortable second week, pushing it over.
    await drag(page, 'gantt-bag-item-CKT-21', 'gantt-week-1');

    await expect(page.getByTestId('gantt-bag-item-CKT-21')).toHaveCount(0);
    await expect(page.getByTestId('gantt-chip-CKT-21')).toBeVisible();
    await expect(week1).toHaveAttribute('data-verdict', 'red');
  });

  test('dragging a placed card back to the bag frees the week', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('tab-gantt').click();

    const week1 = page.getByTestId('gantt-week-1');
    await drag(page, 'gantt-bag-item-CKT-21', 'gantt-week-1');
    await expect(week1).toHaveAttribute('data-verdict', 'red');

    // Send it back to the bag; the week returns to green.
    await drag(page, 'gantt-chip-CKT-21', 'gantt-bag');
    await expect(week1).toHaveAttribute('data-verdict', 'green');
    await expect(page.getByTestId('gantt-bag-item-CKT-21')).toBeVisible();
  });
});
