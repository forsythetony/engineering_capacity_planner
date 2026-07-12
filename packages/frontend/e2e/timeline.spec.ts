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

  test('recomputes live: cutting the backlog and adjusting the threshold', async ({ page }) => {
    await page.goto('/');
    const strip = page.getByTestId('status-strip');
    const remaining = page.getByTestId('remaining-points');
    expect(Number(await remaining.textContent())).toBeGreaterThan(0);

    // Cut every ticket → nothing remains → green. Re-query the first remaining
    // "cut" button each time (rows re-render as their label flips to "restore").
    const cutButtons = page.getByRole('button', { name: 'cut', exact: true });
    for (let guard = 0; guard < 100 && (await cutButtons.count()) > 0; guard++) {
      await cutButtons.first().click();
    }
    await expect(remaining).toHaveText('0');
    await expect(strip).toHaveAttribute('data-verdict', 'green');

    // Demanding an impossibly large buffer downgrades it live…
    await page.getByTestId('green-min-input').fill('999');
    await expect(strip).not.toHaveAttribute('data-verdict', 'green');

    // …and relaxing the threshold brings it back to green.
    await page.getByTestId('green-min-input').fill('0');
    await expect(strip).toHaveAttribute('data-verdict', 'green');
  });
});

test.describe('Dependencies tab', () => {
  test('renders the graph, highlights high-leverage blockers, and ranks them', async ({ page }) => {
    await page.goto('/');

    await page.getByTestId('tab-dependencies').click();

    // The flowchart renders with a node per ticket and at least one edge.
    const svg = page.getByTestId('dependency-svg');
    await expect(svg).toBeVisible();
    await expect(svg.locator('.graph-node')).not.toHaveCount(0);
    await expect(svg.locator('.dependency-edge').first()).toBeVisible();

    // At least one node is flagged as high leverage.
    await expect(svg.locator('.graph-node[data-tier="high"]').first()).toBeVisible();

    // The "work these next" leaderboard lists the top blockers.
    const list = page.getByTestId('leverage-list');
    await expect(list).toBeVisible();
    await expect(list.locator('li')).not.toHaveCount(0);

    // Switching back to the timeline still works.
    await page.getByTestId('tab-timeline').click();
    await expect(page.getByTestId('timeline')).toBeVisible();
  });
});
