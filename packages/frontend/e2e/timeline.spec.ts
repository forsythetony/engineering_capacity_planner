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

  test('clicking a leaderboard entry focuses the graph on that subtree', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('tab-dependencies').click();

    const svg = page.getByTestId('dependency-svg');
    const before = await svg.locator('.graph-node').count();

    // Focus the top blocker via the leaderboard.
    await page.getByTestId('leverage-list').locator('.leverage-row').first().click();

    const banner = page.getByTestId('graph-focus-banner');
    await expect(banner).toBeVisible();
    // The focused view shows a strict subset of the full graph.
    await expect(svg.locator('.graph-node.is-focused')).toHaveCount(1);
    const after = await svg.locator('.graph-node').count();
    expect(after).toBeLessThan(before);

    // "Show all" restores the full graph.
    await page.getByTestId('graph-show-all').click();
    await expect(banner).toBeHidden();
    await expect(svg.locator('.graph-node')).toHaveCount(before);
  });
});

test.describe('Jira link affordance', () => {
  test('renders an inert Jira link icon on the epic and work items', async ({ page }) => {
    await page.goto('/');
    // Epic header link.
    await expect(page.getByTestId('jira-link-CKT')).toBeVisible();
    // Backlog rows each carry one.
    await expect(page.locator('[data-testid^="jira-link-CKT-"]').first()).toBeVisible();
  });
});

test.describe('Configuration tab', () => {
  test('renders the knobs dashboard; read-only without a backend', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('tab-configuration').click();

    const config = page.getByTestId('configuration');
    await expect(config).toBeVisible();
    // Core sections are present.
    await expect(page.getByTestId('cfg-members')).toBeVisible();
    await expect(page.getByTestId('cfg-milestones')).toBeVisible();

    // The e2e harness runs without a backend, so editing is disabled and the
    // read-only notice explains why.
    await expect(page.getByTestId('config-readonly')).toBeVisible();
    await expect(page.getByTestId('cfg-knobs-save')).toBeDisabled();
    await expect(page.getByTestId('cfg-oncall-mult')).toBeDisabled();

    // The gating relevant day is flagged in the list.
    await expect(page.locator('.config-row.gating')).toHaveCount(1);
  });

  test('availability has calendar + list views with member avatars', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('tab-configuration').click();

    // Calendar view renders bands from the fixture, each with a member avatar.
    const calendar = page.getByTestId('availability-calendar');
    await expect(calendar).toBeVisible();
    await expect(calendar.locator('.cal-band')).not.toHaveCount(0);
    await expect(calendar.locator('.avatar').first()).toBeVisible();

    // The Add button is disabled (no backend), so the modal can't open here.
    await expect(page.getByTestId('avail-add')).toBeDisabled();

    // Switch to the searchable list view.
    await page.getByTestId('avail-view-list').click();
    await expect(page.getByTestId('availability-list')).toBeVisible();
    const rowsBefore = await page.locator('[data-testid^="avail-row-"]').count();
    expect(rowsBefore).toBeGreaterThan(0);

    // Notes from the fixture are shown and are searchable.
    await expect(page.locator('.avail-note').first()).toBeVisible();
    await page.getByTestId('availability-search').fill('Summer holiday');
    await expect(page.locator('[data-testid^="avail-row-"]')).toHaveCount(1);

    // Searching a non-existent member filters everything out.
    await page.getByTestId('availability-search').fill('zzzznobody');
    await expect(page.locator('[data-testid^="avail-row-"]')).toHaveCount(0);
  });
});
