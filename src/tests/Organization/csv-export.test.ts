import { readFileSync } from 'fs';

import { Page } from '@playwright/test';
import { expect, test } from '@src/fixtures/fixtures';
import { Home } from '@src/pages/home.page';

// Columns that always appear at the start of every CSV export, regardless of
// which interview flows or evaluation categories exist in the environment.
const FIXED_PREFIX =
  'ID,面接名,受験者,メールアドレス,レポートURL,ステータス,完了日時,メモ,文字起こし,' +
  '要約,AIサマリー_概要,AIサマリー_強み,AIサマリー_弱み';

// Columns that always appear at the end of every CSV export.
// Between the prefix and suffix the server emits dynamic per-flow evaluation columns
// (e.g. コミュニケーション_点数 / _根拠) whose names and count vary by environment.
const FIXED_SUFFIX =
  '独自評価_合計点数,' +
  '思考力_点数,思考力_根拠,' +
  'マインド_点数,マインド_根拠,' +
  'ビジネスリテラシー_点数,ビジネスリテラシー_根拠,' +
  'コンピテンシー_合計点数,次回質問案';

/** Trigger the export, wait for the download, and return the CSV text. */
async function triggerExport(pageAdmin: Page, home: Home): Promise<string> {
  const downloadPromise = pageAdmin.waitForEvent('download');
  await home.exportButton.click();
  await home.exportConfirmOkButton.click();
  const download = await downloadPromise;
  const filePath = await download.path();
  // Strip UTF-8 BOM (U+FEFF) that Excel-compatible CSV files include
  return readFileSync(filePath!, 'utf-8').replace(/^\uFEFF/, '');
}

test.describe('CSV Export: toolbar button @org', () => {
  test('should be visible on the candidate list page', async ({ pageAdmin }) => {
    const home = new Home(pageAdmin);
    await home.goto();
    await expect(home.exportButton).toBeVisible();
  });

  test('should be visible when a status filter is active', async ({ pageAdmin }) => {
    const home = new Home(pageAdmin);
    await home.goto();
    await home.sidebarFilterPendingReview.click();
    await expect(home.exportButton).toBeVisible();
  });
});

test.describe('CSV Export: confirmation dialog @org', () => {
  test('should show OK and Cancel buttons after clicking エクスポート', async ({ pageAdmin }) => {
    const home = new Home(pageAdmin);
    await home.goto();
    await home.exportButton.click();
    await expect(home.exportConfirmOkButton).toBeVisible();
    await expect(home.exportConfirmCancelButton).toBeVisible();
  });

  test('should dismiss the dialog without downloading when Cancel is clicked', async ({ pageAdmin }) => {
    const home = new Home(pageAdmin);
    await home.goto();
    await home.exportButton.click();
    await expect(home.exportConfirmOkButton).toBeVisible();
    await home.exportConfirmCancelButton.click();
    await expect(home.exportConfirmOkButton).not.toBeVisible();
  });
});

// All download tests use a 90 s timeout: the server generates the CSV on demand
// and a full export (all records, no filter) can take longer than the default 30 s,
// especially under concurrent test load.
test.describe('CSV Export: downloaded file @org', () => {
  test('should trigger a download with a .csv filename when OK is clicked', { timeout: 90_000 }, async ({ pageAdmin }) => {
    const home = new Home(pageAdmin);
    await home.goto();
    const downloadPromise = pageAdmin.waitForEvent('download');
    await home.exportButton.click();
    await home.exportConfirmOkButton.click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.csv$/i);
  });

  test('should contain the correct headers as the first row', { timeout: 90_000 }, async ({ pageAdmin }) => {
    const home = new Home(pageAdmin);
    await home.goto();
    const csv = await triggerExport(pageAdmin, home);
    // Trim to strip any \r from Windows-style line endings before asserting.
    const firstLine = csv.split('\n')[0].trim();
    expect(firstLine).toMatch(new RegExp(`^${FIXED_PREFIX}.*${FIXED_SUFFIX}$`));
  });

  test('should contain data rows beyond the header', { timeout: 90_000 }, async ({ pageAdmin }) => {
    const home = new Home(pageAdmin);
    await home.goto();
    const csv = await triggerExport(pageAdmin, home);
    const dataLines = csv.split('\n').filter(l => l.trim()).slice(1);
    expect(dataLines.length).toBeGreaterThan(0);
  });

  test('should export the correct headers when a status filter is active', { timeout: 90_000 }, async ({ pageAdmin }) => {
    const home = new Home(pageAdmin);
    await home.goto();
    await home.sidebarFilterPendingReview.click();
    await expect(pageAdmin).toHaveURL(/status=pending_review/);
    const csv = await triggerExport(pageAdmin, home);
    const firstLine = csv.split('\n')[0].trim();
    expect(firstLine).toMatch(new RegExp(`^${FIXED_PREFIX}.*${FIXED_SUFFIX}$`));
  });

  test('should export the correct headers when a search filter is active', { timeout: 90_000 }, async ({ pageAdmin }) => {
    const home = new Home(pageAdmin);
    await home.goto();
    await home.candidateSearchInput.fill('givery');
    const csv = await triggerExport(pageAdmin, home);
    const firstLine = csv.split('\n')[0].trim();
    expect(firstLine).toMatch(new RegExp(`^${FIXED_PREFIX}.*${FIXED_SUFFIX}$`));
  });
});
