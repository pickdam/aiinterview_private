import { expect, test } from "@src/fixtures/fixtures";
import { Home } from "@src/pages/home.page";

test.describe.configure({ mode: 'serial' });

test.describe('Evaluation: setting result on a candidate row @org', () => {
  // Each test reads live counter/row values at startup so accumulated state from prior
  // tests does not affect individual assertions. There are no revert steps: the application
  // does not reliably support backward evaluation transitions (e.g. 選考通過 → 評価待ち)
  // via the row combobox — clicking the current value is a no-op in Radix Select, and
  // existing candidates in the destination view may already show 評価待ち.
  //
  // Counter values are read immediately after home.goto() (a hard navigation that waits
  // for the load event) to avoid stale readings that can occur after SPA navigations.
  //
  // After every sidebarFilter click we wait for the URL to reflect the new status before
  // reading table rows. Without this wait the SPA navigation may still be in flight and
  // locator reads would target the previous (wrong) page content.
  //
  // Row-removal is confirmed via getRowCountWithText() rather than filter().not.toBeVisible():
  // a candidate can have multiple sessions (multiple rows with the same name/email), so the
  // old not.toBeVisible() check would fail if a second session remained in the view after the
  // first was moved to a different status.

  test('should show pending review as the default evaluation for candidates on the pending-review page', async ({ pageAdmin }) => {
    const home = new Home(pageAdmin);
    await home.goto();
    await home.sidebarFilterPendingReview.click();
    // Wait for SPA navigation to the filtered view before asserting row content.
    await expect(pageAdmin).toHaveURL(/status=pending_review/);
    await expect(home.getRowEvaluationCombobox(0)).toHaveText(/評価待ち|Pending Review/i);
  });

  test('should open the evaluation listbox with all options when the combobox is clicked', async ({ pageAdmin }) => {
    const home = new Home(pageAdmin);
    await home.goto();
    await home.sidebarFilterPendingReview.click();
    await expect(pageAdmin).toHaveURL(/status=pending_review/);
    await home.getRowEvaluationCombobox(0).click();
    await expect(home.interviewFilterListbox).toBeVisible();
    await expect(home.getInterviewFilterOption(/評価待ち|Pending Review/i)).toBeVisible();
    await expect(home.getInterviewFilterOption(/選考通過|Passed/i)).toBeVisible();
    await expect(home.getInterviewFilterOption(/不合格|Failed/i)).toBeVisible();
    await expect(home.getInterviewFilterOption(/終了|Closed/i)).toBeVisible();
  });

  test('should decrement the pending-review counter and increment the passed counter when evaluation is set to 選考通過', async ({ pageAdmin }) => {
    const home = new Home(pageAdmin);
    await home.goto();

    // Read counters while the page is fully loaded (page.goto waits for the load event).
    // Reading after a SPA navigation risks capturing a stale value mid-render.
    const pendingBefore  = await home.sidebarFilterPendingReview.textContent();
    const passedBefore   = await home.sidebarFilterPassed.textContent();
    const pendingN       = parseInt(pendingBefore!.match(/\((\d+)\)/)![1], 10);
    const passedN        = parseInt(passedBefore!.match(/\((\d+)\)/)![1], 10);

    await home.sidebarFilterPendingReview.click();
    // Wait for SPA nav to complete before reading table — without this the locator may
    // resolve against the /all table (wrong candidates) while the navigation is in flight.
    await expect(pageAdmin).toHaveURL(/status=pending_review/);
    const candidateName  = (await pageAdmin.locator('tbody tr').first().locator('td').first().textContent())!.trim();

    // Count how many rows currently show this candidate (they may have multiple sessions).
    const rowsBefore = await home.getRowCountWithText(candidateName);

    // Change evaluation
    await home.getRowEvaluationCombobox(0).click();
    await home.getInterviewFilterOption(/選考通過|Passed/i).click();

    // Wait for exactly one of this candidate's sessions to leave the pending_review view,
    // confirming the API call completed before we check the sidebar counters.
    // Timeout is extended to 15 s: the evaluation API can be slower than the default
    // 5 s under concurrent test load without this change being a genuine failure.
    await expect(pageAdmin.locator('tbody tr').filter({ hasText: candidateName })).toHaveCount(rowsBefore - 1, { timeout: 15_000 });

    // Hard-navigate back to /all so the sidebar counters are freshly fetched from the server.
    // Counters do not update reactively in-place on a SPA-navigated page; a full page load
    // is required to obtain accurate aggregated values.
    await home.goto();

    // Sidebar counters reflect the change
    await expect(home.sidebarFilterPendingReview).toHaveText(new RegExp(`\\(${pendingN - 1}\\)`));
    await expect(home.sidebarFilterPassed).toHaveText(new RegExp(`\\(${passedN + 1}\\)`));
  });

  test('should remove the row from the pending-review view after evaluation is changed', async ({ pageAdmin }) => {
    const home = new Home(pageAdmin);
    await home.goto();
    await home.sidebarFilterPendingReview.click();
    await expect(pageAdmin).toHaveURL(/status=pending_review/);

    // Record candidate name and session count of first row before change.
    const candidateName = (await pageAdmin.locator('tbody tr').first().locator('td').first().textContent())!.trim();
    const rowsBefore    = await home.getRowCountWithText(candidateName);

    // Change evaluation — one session should leave this filtered view.
    await home.getRowEvaluationCombobox(0).click();
    await home.getInterviewFilterOption(/選考通過|Passed/i).click();

    // After evaluation change, exactly one fewer session for this candidate appears
    // in the pending_review list (the other sessions, if any, remain unchanged).
    await expect(pageAdmin.locator('tbody tr').filter({ hasText: candidateName })).toHaveCount(rowsBefore - 1, { timeout: 15_000 });
  });

  test('should make the evaluated candidate appear in the passed view', async ({ pageAdmin }) => {
    const home = new Home(pageAdmin);
    await home.goto();

    // Read passed counter while page is fully loaded
    const passedBefore = await home.sidebarFilterPassed.textContent();
    const passedN      = parseInt(passedBefore!.match(/\((\d+)\)/)![1], 10);

    await home.sidebarFilterPendingReview.click();
    await expect(pageAdmin).toHaveURL(/status=pending_review/);

    const candidateName = (await pageAdmin.locator('tbody tr').first().locator('td').first().textContent())!.trim();
    const rowsBefore    = await home.getRowCountWithText(candidateName);

    // Change to 選考通過 and wait for the API call to complete before navigating away.
    await home.getRowEvaluationCombobox(0).click();
    await home.getInterviewFilterOption(/選考通過|Passed/i).click();
    await expect(pageAdmin.locator('tbody tr').filter({ hasText: candidateName })).toHaveCount(rowsBefore - 1, { timeout: 15_000 });

    // Navigate to passed — wait for URL to settle, then verify the counter increased.
    await home.sidebarFilterPassed.click();
    await expect(pageAdmin).toHaveURL(/status=passed/);
    await expect(home.sidebarFilterPassed).toHaveText(new RegExp(`\\(${passedN + 1}\\)`));
    await expect(home.getRowEvaluationCombobox(0)).toBeVisible();
  });

  test('should correctly update counters when evaluation is set to 不合格', async ({ pageAdmin }) => {
    const home = new Home(pageAdmin);
    await home.goto();

    // Read counters while the page is fully loaded
    const pendingBefore  = await home.sidebarFilterPendingReview.textContent();
    const failedBefore   = await home.sidebarFilterFailed.textContent();
    const pendingN       = parseInt(pendingBefore!.match(/\((\d+)\)/)![1], 10);
    const failedN        = parseInt(failedBefore!.match(/\((\d+)\)/)![1], 10);

    await home.sidebarFilterPendingReview.click();
    await expect(pageAdmin).toHaveURL(/status=pending_review/);
    const candidateName  = (await pageAdmin.locator('tbody tr').first().locator('td').first().textContent())!.trim();
    const rowsBefore     = await home.getRowCountWithText(candidateName);

    await home.getRowEvaluationCombobox(0).click();
    await home.getInterviewFilterOption(/不合格|Failed/i).click();

    // Wait for the specific session to leave the pending_review view.
    await expect(pageAdmin.locator('tbody tr').filter({ hasText: candidateName })).toHaveCount(rowsBefore - 1, { timeout: 15_000 });

    // Hard-navigate back to /all so the sidebar counters are freshly fetched from the server.
    await home.goto();

    await expect(home.sidebarFilterPendingReview).toHaveText(new RegExp(`\\(${pendingN - 1}\\)`));
    await expect(home.sidebarFilterFailed).toHaveText(new RegExp(`\\(${failedN + 1}\\)`));
  });
});
