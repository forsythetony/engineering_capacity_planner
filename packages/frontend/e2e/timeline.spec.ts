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

  test('renders the full-width month calendar with navigation', async ({ page }) => {
    await page.goto('/');

    // The calendar sits below the linear timeline and above the backlog.
    const calendar = page.getByTestId('projection-calendar');
    await expect(calendar).toBeVisible();
    await expect(calendar.locator('.cal-month-grid')).toBeVisible();
    await expect(calendar.locator('.cal-cell').first()).toBeVisible();

    // Opens on the month containing "today", which is highlighted exactly once.
    await expect(page.getByTestId('cal-current-month')).toHaveText('Jul 2026');
    await expect(calendar.locator('.cal-cell.is-today')).toHaveCount(1);

    // Multi-day work is drawn as spanning bars: sprints (hero) and their weeks.
    await expect(calendar.locator('.cal-bar.sprint').first()).toBeVisible();
    await expect(calendar.locator('.cal-bar.week').first()).toBeVisible();
    await expect(calendar.locator('.cal-bar.avail').first()).toBeVisible();

    // Sprint bars are shaded red/yellow/green by how loaded they are; the seeded
    // first sprint is over-committed, so it renders red.
    await expect(calendar.locator('.cal-bar.sprint[data-load]').first()).toBeVisible();
    await expect(calendar.locator('.cal-bar.sprint.load-red').first()).toBeVisible();

    // Paging forward reaches September, where the gating day and dev-complete land.
    await page.getByTestId('cal-next').click();
    await expect(page.getByTestId('cal-current-month')).toHaveText('Aug 2026');
    await page.getByTestId('cal-next').click();
    await expect(page.getByTestId('cal-current-month')).toHaveText('Sep 2026');
    await expect(calendar.locator('.cal-event.gating').first()).toBeVisible();
    await expect(calendar.locator('.cal-event.devcomplete').first()).toBeVisible();

    // The filter hides the gating pill when "Relevant days" is unchecked.
    await page.getByTestId('cal-filter-btn').click();
    await expect(page.getByTestId('cal-filter-menu')).toBeVisible();
    await page.getByTestId('cal-filter-milestones').uncheck();
    await expect(calendar.locator('.cal-event.gating')).toHaveCount(0);
    // Dev-complete is a separate layer and stays visible.
    await expect(calendar.locator('.cal-event.devcomplete').first()).toBeVisible();
    // Re-checking brings the gating pill back.
    await page.getByTestId('cal-filter-milestones').check();
    await expect(calendar.locator('.cal-event.gating').first()).toBeVisible();

    // Clicking outside the menu closes it.
    await page.getByTestId('timeline').click();
    await expect(page.getByTestId('cal-filter-menu')).toBeHidden();

    // "Today" jumps back to the current month, where the spanning bars show.
    await page.getByTestId('cal-today-btn').click();
    await expect(page.getByTestId('cal-current-month')).toHaveText('Jul 2026');
    await expect(calendar.locator('.cal-bar.avail').first()).toBeVisible();
    // The filter hides team availability and sprint weeks; the badge counts them.
    await page.getByTestId('cal-filter-btn').click();
    await page.getByTestId('cal-filter-availability').uncheck();
    await expect(calendar.locator('.cal-bar.avail')).toHaveCount(0);
    await page.getByTestId('cal-filter-sprintWeeks').uncheck();
    await expect(calendar.locator('.cal-bar.week')).toHaveCount(0);
    // Sprints stay visible; the badge reflects the two hidden layers.
    await expect(calendar.locator('.cal-bar.sprint').first()).toBeVisible();
    await expect(page.locator('.cal-filter-badge')).toHaveText('2');

    // Ordering on the page: timeline → calendar → backlog.
    const timelineY = await page.getByTestId('timeline').evaluate((el) => el.getBoundingClientRect().top);
    const calendarY = await calendar.evaluate((el) => el.getBoundingClientRect().top);
    const backlogY = await page.getByTestId('work-items').evaluate((el) => el.getBoundingClientRect().top);
    expect(timelineY).toBeLessThan(calendarY);
    expect(calendarY).toBeLessThan(backlogY);
  });

  test('renders the backlog grouped by story, without cut / mark-done controls', async ({ page }) => {
    await page.goto('/');

    const backlog = page.getByTestId('work-items');
    await expect(backlog).toBeVisible();
    // Backlog rows render from the fixture.
    await expect(page.locator('[data-testid^="work-item-"]').first()).toBeVisible();

    // The cut / mark-done affordances have been removed for now.
    await expect(page.locator('[data-testid^="toggle-cut-"]')).toHaveCount(0);
    await expect(page.locator('[data-testid^="toggle-done-"]')).toHaveCount(0);
  });
});

test.describe('Dependencies tab', () => {
  test('previews the top blockers and ranks them', async ({ page }) => {
    await page.goto('/');

    await page.getByTestId('tab-dependencies').click();

    // The inline preview renders a trimmed flowchart with at least one edge.
    const svg = page.getByTestId('dependency-svg');
    await expect(svg).toBeVisible();
    await expect(svg.locator('.graph-node')).not.toHaveCount(0);
    await expect(svg.locator('.dependency-edge')).not.toHaveCount(0);
    // A high-leverage blocker is present, and the count callout is shown.
    await expect(svg.locator('.graph-node[data-tier="high"]').first()).toBeVisible();
    await expect(page.getByTestId('graph-preview-count')).toContainText('highest-leverage');

    // The "work these next" leaderboard lists the top blockers.
    const list = page.getByTestId('leverage-list');
    await expect(list).toBeVisible();
    await expect(list.locator('li')).not.toHaveCount(0);

    // Switching back to the timeline still works.
    await page.getByTestId('tab-timeline').click();
    await expect(page.getByTestId('timeline')).toBeVisible();
  });

  test('"Show all" opens the full-graph modal with more tickets than the preview', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('tab-dependencies').click();

    const previewCount = await page.getByTestId('dependency-svg').locator('.graph-node').count();

    await page.getByTestId('graph-open-full').click();
    const modal = page.getByTestId('graph-modal');
    await expect(modal).toBeVisible();

    // The modal's full graph shows more nodes than the trimmed preview.
    const modalSvg = modal.getByTestId('dependency-svg');
    await expect(modalSvg.locator('.graph-node').first()).toBeVisible();
    expect(await modalSvg.locator('.graph-node').count()).toBeGreaterThan(previewCount);

    // Closing dismisses the overlay.
    await page.getByTestId('graph-modal-close').click();
    await expect(modal).toBeHidden();
  });

  test('a leaderboard entry opens the modal focused on that subtree', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('tab-dependencies').click();

    await page.getByTestId('leverage-list').locator('.leverage-row').first().click();

    const modal = page.getByTestId('graph-modal');
    await expect(modal).toBeVisible();
    await expect(page.getByTestId('graph-focus-banner')).toBeVisible();
    await expect(modal.locator('.graph-node.is-focused')).toHaveCount(1);

    // "Show whole graph" clears the focus but keeps the modal open.
    await page.getByTestId('graph-show-all').click();
    await expect(page.getByTestId('graph-focus-banner')).toBeHidden();
    await expect(modal).toBeVisible();
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
    // The Gantt week-yellow knob lives here too.
    await expect(page.getByTestId('cfg-week-yellow')).toBeDisabled();

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
