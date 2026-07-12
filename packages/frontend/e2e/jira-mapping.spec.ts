import { expect, test } from '@playwright/test';

/**
 * Drives the guided Jira setup wizard + the freshness-aware nav Sync button
 * (project plan §7). Requires the backend running in Jira mode — start it with
 * the in-memory demo board:
 *
 *   ECP_DATA_SOURCE=jira ECP_JIRA_FAKE=true npm run dev
 *
 * The default `npm run e2e` runs against synthetic data, so this spec skips
 * itself unless `/health` reports the `jira` data source.
 */
async function jiraBackend(request: import('@playwright/test').APIRequestContext): Promise<boolean> {
  try {
    const res = await request.get('http://localhost:3001/health');
    if (!res.ok()) return false;
    return (await res.json()).dataSource === 'jira';
  } catch {
    return false;
  }
}

test.describe('Jira setup wizard & nav sync', () => {
  test('wires up a board, maps fields, and the nav sync unlocks', async ({ page, request }) => {
    test.skip(!(await jiraBackend(request)), 'backend is not in Jira mode (ECP_JIRA_FAKE=true)');

    await page.goto('/');

    // Sync starts locked until the mapping is complete.
    const sync = page.getByTestId('nav-sync');
    await expect(sync).toHaveAttribute('data-state', 'locked');

    // Clicking it while locked explains where to finish setup.
    await sync.click();
    await expect(page.getByTestId('nav-sync-locked')).toBeVisible();
    await page.getByTestId('nav-sync-locked-goto').click();

    // The wizard is now on the Configuration tab.
    const wizard = page.getByTestId('jira-wizard');
    await expect(wizard).toBeVisible();

    // Board step: pick the demo board (sets the project key too).
    await page.getByTestId('wizard-step-board').click();
    await page.getByTestId('wizard-board-search').locator('input').click();
    await page.getByTestId('typeahead-option').first().click();
    await expect(page.getByTestId('wizard-board-current')).toBeVisible();

    // Fields step: the sample auto-loads; map story points + the blocks link.
    await page.getByTestId('wizard-step-fields').click();
    const sample = page.getByTestId('cfg-jira-sample');
    await expect(sample).toBeVisible();
    const spRow = sample.locator('[data-testid="cfg-jira-field-row"]', {
      has: page.locator('code', { hasText: 'customfield_10016' }),
    });
    await spRow.getByTestId('cfg-jira-use-story-points').click();
    await page.getByTestId('cfg-jira-blocks-select').selectOption('Blocks');
    await expect(page.getByTestId('cfg-jira-summary')).toContainText('customfield_10016');

    // With the required mapping in place, the nav Sync unlocks and runs.
    await expect(sync).not.toHaveAttribute('data-state', 'locked');
    await sync.click();
    await expect(page.getByTestId('nav-sync-msg')).toContainText(/Synced \d+ items/);

    // Synced members carry their Jira avatar image (the demo board supplies a
    // self-contained data-URI avatar).
    await page.getByTestId('wizard-step-members').click();
    await expect(page.getByTestId('wizard-members').locator('.avatar-img').first()).toBeVisible();
  });
});
