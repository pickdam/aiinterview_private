import { expect, test } from "@src/fixtures/fixtures";
import { Home } from "@src/pages/home.page";

test.describe('Toolbar: interview flow filter', () => {
  test('should display "すべての面接" as the default selected value', async ({ pageAdmin }) => {
    const home = new Home(pageAdmin);
    await home.goto();
    await expect(home.interviewFilter).toHaveText(/すべての面接/);
  });

  test('should open the listbox and mark "すべての面接" as selected', async ({ pageAdmin }) => {
    const home = new Home(pageAdmin);
    await home.goto();
    await home.interviewFilter.click();
    await expect(home.interviewFilterListbox).toBeVisible();
    await expect(home.getInterviewFilterOption('すべての面接')).toHaveAttribute('aria-selected', 'true');
  });

  test('should navigate to a specific flow URL when an interview is selected from /all', async ({ pageAdmin }) => {
    const home = new Home(pageAdmin);
    await home.goto();
    await home.interviewFilter.click();
    await home.getFirstSpecificInterviewFlowOption().click();
    await expect(pageAdmin).toHaveURL(/\/company\/interview-flows\/\d+/);
  });

  test('should preserve the status filter when a flow is selected', async ({ pageAdmin }) => {
    const home = new Home(pageAdmin);
    await home.goto();
    await home.sidebarFilterNotStarted.click();
    await expect(pageAdmin).toHaveURL(/status=not_started/);
    await home.interviewFilter.click();
    await home.getFirstSpecificInterviewFlowOption().click();
    await expect(pageAdmin).toHaveURL(/\/company\/interview-flows\/\d+/);
    await expect(pageAdmin).toHaveURL(/status=not_started/);
  });

  test('should reset to /all when "すべての面接" is re-selected after a specific flow', async ({ pageAdmin }) => {
    const home = new Home(pageAdmin);
    await home.goto();
    await home.interviewFilter.click();
    await home.getFirstSpecificInterviewFlowOption().click();
    await expect(pageAdmin).toHaveURL(/\/company\/interview-flows\/\d+/);
    await home.interviewFilter.click();
    await home.getInterviewFilterOption('すべての面接').click();
    await expect(pageAdmin).toHaveURL('/company/interview-flows/all');
  });

  test('should close the listbox when Escape is pressed', async ({ pageAdmin }) => {
    const home = new Home(pageAdmin);
    await home.goto();
    await home.interviewFilter.click();
    await expect(home.interviewFilterListbox).toBeVisible();
    await pageAdmin.keyboard.press('Escape');
    await expect(home.interviewFilterListbox).toBeHidden();
  });
});

test.describe('Toolbar: candidate search', () => {
  test('should display an empty search input by default', async ({ pageAdmin }) => {
    const home = new Home(pageAdmin);
    await home.goto();
    await expect(home.candidateSearchInput).toBeVisible();
    await expect(home.candidateSearchInput).toHaveValue('');
  });

  test('should narrow results when a matching term is typed', async ({ pageAdmin }) => {
    const home = new Home(pageAdmin);
    await home.goto();

    await expect(home.resultCountHeader).toBeVisible();

    const headerBefore = (await home.resultCountHeader.textContent()) ?? '';

    await home.candidateSearchInput.fill('e2e');

    await expect(home.resultCountHeader).not.toHaveText(headerBefore);
    await expect(pageAdmin.getByText('指定された条件の受験者が見つかりません。')).toBeHidden();
  });

  test('should show the empty state when no candidates match', async ({ pageAdmin }) => {
    const home = new Home(pageAdmin);
    await home.goto();
    await expect(home.resultCountHeader).toBeVisible();
    await home.candidateSearchInput.fill('ZZZZNOEXIST');
    await expect(pageAdmin.getByText('指定された条件の受験者が見つかりません。')).toBeVisible();
  });

  test('should show empty state when searching a non-matching term on a status-filtered page', async ({ pageAdmin }) => {
    const home = new Home(pageAdmin);
    await home.goto();
    await home.sidebarFilterNotStarted.click();
    await expect(pageAdmin).toHaveURL(/status=not_started/);
    await expect(home.resultCountHeader).toBeVisible();
    await home.candidateSearchInput.fill('ZZZZNOEXIST');
    await expect(pageAdmin.getByText('指定された条件の受験者が見つかりません。')).toBeVisible();
    await expect(pageAdmin).toHaveURL(/status=not_started/);
  });
});
