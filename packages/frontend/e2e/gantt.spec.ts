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

  test('opens the per-engineer weekly capacity modal', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('tab-gantt').click();
    await page.getByTestId('gantt-engineer-strip').locator('button').first().click();
    const modal = page.getByTestId('gantt-engineer-modal');
    await expect(modal).toBeVisible();
    // One row per week.
    await expect(modal.locator('.modal-weeks li')).toHaveCount(2);
  });

  test('dragging a backlog card into a week recomputes it live', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('tab-gantt').click();

    const week1 = page.getByTestId('gantt-week-1');
    await expect(week1).toHaveAttribute('data-verdict', 'green');

    // Drop a 5-point card into the comfortable second week, pushing it over.
    const card = page.getByTestId('gantt-bag-item-CKT-21');
    await card.dragTo(week1);

    await expect(page.getByTestId('gantt-bag-item-CKT-21')).toHaveCount(0);
    await expect(page.getByTestId('gantt-chip-CKT-21')).toBeVisible();
    await expect(week1).toHaveAttribute('data-verdict', 'red');
  });

  test('dragging a placed card back to the bag frees the week', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('tab-gantt').click();

    const week1 = page.getByTestId('gantt-week-1');
    await page.getByTestId('gantt-bag-item-CKT-21').dragTo(week1);
    await expect(week1).toHaveAttribute('data-verdict', 'red');

    // Send it back to the bag; the week returns to green.
    await page.getByTestId('gantt-chip-CKT-21').dragTo(page.getByTestId('gantt-bag'));
    await expect(week1).toHaveAttribute('data-verdict', 'green');
    await expect(page.getByTestId('gantt-bag-item-CKT-21')).toBeVisible();
  });
});
