import { expect, test } from '@playwright/test';

test.describe('Calendar / timeline tab', () => {
  test('renders the epic, status strip, and timeline markers', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByRole('heading', { name: 'Engineering Capacity Planner' })).toBeVisible();
    const strip = page.getByTestId('status-strip');
    await expect(strip).toBeVisible();
    await expect(strip).toHaveAttribute('data-verdict', /green|yellow|red/);

    // The data-source indicator reflects the plumbing (API vs bundled fallback).
    await expect(page.getByTestId('data-source')).toBeVisible();

    // The timeline shows a today marker, the gating relevant day, and dev-complete.
    await expect(page.getByTestId('timeline')).toBeVisible();
    await expect(page.locator('.marker.today')).toBeVisible();
    await expect(page.locator('.marker.gating')).toBeVisible();
    await expect(page.getByTestId('marker-devcomplete')).toBeVisible();
  });

  test('the buffer threshold re-runs the projection live', async ({ page }) => {
    await page.goto('/');
    const strip = page.getByTestId('status-strip');

    // A zero buffer requirement means any non-negative buffer is green.
    await page.getByTestId('green-min-input').fill('0');
    await expect(strip).toHaveAttribute('data-verdict', 'green');

    // An extreme requirement can no longer be green.
    await page.getByTestId('green-min-input').fill('999');
    await expect(strip).not.toHaveAttribute('data-verdict', 'green');
  });

  test('cutting the whole backlog drives the plan green', async ({ page }) => {
    await page.goto('/');
    const remaining = page.getByTestId('remaining-points');
    const before = Number(await remaining.textContent());
    expect(before).toBeGreaterThan(0);

    // Cut every visible ticket; remaining points must reach zero and go green.
    // Each cut re-renders the row (label flips to "restore"), so re-query the
    // first remaining "cut" button rather than iterating a stale snapshot.
    const cutButtons = page.getByRole('button', { name: 'cut', exact: true });
    for (let guard = 0; guard < 100 && (await cutButtons.count()) > 0; guard++) {
      await cutButtons.first().click();
    }
    await expect(remaining).toHaveText('0');
    await expect(page.getByTestId('status-strip')).toHaveAttribute('data-verdict', 'green');
  });
});
