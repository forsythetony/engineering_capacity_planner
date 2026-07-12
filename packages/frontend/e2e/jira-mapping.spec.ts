import { expect, test } from '@playwright/test';

/**
 * Drives the live Jira field mapper + Sync (project plan §7). Requires the
 * backend running in Jira mode — start it with the in-memory demo board:
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

test.describe('Jira mapping & sync tab', () => {
  test('loads a sample, maps a field, and syncs', async ({ page, request }) => {
    test.skip(!(await jiraBackend(request)), 'backend is not in Jira mode (ECP_JIRA_FAKE=true)');

    await page.goto('/');
    await page.getByTestId('tab-configuration').click();

    const jira = page.getByTestId('cfg-jira');
    await expect(jira).toBeVisible();

    // Pull a real sample issue's fields from the (demo) board.
    await page.getByTestId('cfg-jira-load-sample').click();
    const sample = page.getByTestId('cfg-jira-sample');
    await expect(sample).toBeVisible();
    await expect(sample.locator('[data-testid="cfg-jira-field-row"]').first()).toBeVisible();

    // Point the story-points role at the Story Points custom field.
    const spRow = sample.locator('[data-testid="cfg-jira-field-row"]', {
      has: page.locator('code', { hasText: 'customfield_10016' }),
    });
    await spRow.getByTestId('cfg-jira-use-story-points').click();

    // The mapping summary reflects the chosen field.
    await expect(page.getByTestId('cfg-jira-summary')).toContainText('customfield_10016');

    // Sync pulls Jira facts in and reports a summary.
    await page.getByTestId('cfg-jira-sync').click();
    await expect(page.getByTestId('cfg-jira-sync-msg')).toContainText(/Synced \d+ items/);
  });
});
