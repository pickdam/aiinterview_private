import { expect, test } from "@src/fixtures/fixtures";
import { Home } from "@src/pages/home.page";

test.describe('Organization filtering tests @org', () => {
  test('should filter candidates by not-started status', async ({ pageAdmin }) => {
    const home = new Home(pageAdmin);
    await home.goto();
    await home.sidebarFilterNotStarted.click();
    await expect(pageAdmin).toHaveURL(/status=not_started/);
    await expect(home.sidebarFilterNotStarted).toHaveAttribute('data-active', 'true');
  });

  test('should filter candidates by in-progress status', async ({ pageAdmin }) => {
    const home = new Home(pageAdmin);
    await home.goto();
    await home.sidebarFilterInProgress.click();
    await expect(pageAdmin).toHaveURL(/status=in_progress/);
    await expect(home.sidebarFilterInProgress).toHaveAttribute('data-active', 'true');
  });

  test('should filter candidates by pending-review status', async ({ pageAdmin }) => {
    const home = new Home(pageAdmin);
    await home.goto();
    await home.sidebarFilterPendingReview.click();
    await expect(pageAdmin).toHaveURL(/status=pending_review/);
    await expect(home.sidebarFilterPendingReview).toHaveAttribute('data-active', 'true');
  });

  test('should filter candidates by passed status', async ({ pageAdmin }) => {
    const home = new Home(pageAdmin);
    await home.goto();
    await home.sidebarFilterPassed.click();
    await expect(pageAdmin).toHaveURL(/status=passed/);
    await expect(home.sidebarFilterPassed).toHaveAttribute('data-active', 'true');
  });

  test('should filter candidates by failed status', async ({ pageAdmin }) => {
    const home = new Home(pageAdmin);
    await home.goto();
    await home.sidebarFilterFailed.click();
    await expect(pageAdmin).toHaveURL(/status=failed/);
    await expect(home.sidebarFilterFailed).toHaveAttribute('data-active', 'true');
  });

  test('should filter candidates by closed status', async ({ pageAdmin }) => {
    const home = new Home(pageAdmin);
    await home.goto();
    await home.sidebarFilterClosed.click();
    await expect(pageAdmin).toHaveURL(/status=closed/);
    await expect(home.sidebarFilterClosed).toHaveAttribute('data-active', 'true');
  });

  test('should show all candidates when sidebar top-level link is clicked', async ({ pageAdmin }) => {
    const home = new Home(pageAdmin);
    await home.goto();
    await home.sidebarFilterNotStarted.click();
    await home.sidebarCandidateListLink.click();
    await expect(pageAdmin).toHaveURL('/company/interview-flows/all');
    await expect(home.sidebarCandidateListLink).toHaveAttribute('data-active', 'true');
  });
});
