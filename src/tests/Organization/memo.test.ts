import { expect, test } from "@src/fixtures/fixtures";
import { Home } from "@src/pages/home.page";

test.describe.configure({ mode: 'serial' });

test.describe('Memo: creating and updating candidate memos', () => {
  const FIRST_MEMO   = 'E2Eテスト用のメモ（初回作成）';
  const UPDATED_MEMO = 'E2Eテスト用のメモ（更新後）';

  // Unique email seeded in beforeAll — guaranteed never to have a memo.
  let seededEmail: string;

  // Full URL of the Not Started status view — used by tests 2–4 to navigate
  // back to the view where the seeded row is visible.
  let memoCandidateViewURL: string;

  // ── Data seeding ───────────────────────────────────────────────────────────
  // Creates question → flow → common link → delivers to a fresh unique email.
  // Uses the worker-scoped apiAdmin fixture — no redundant login.
  test.beforeAll(async ({ apiAdmin }) => {
    seededEmail = `product-dev_qa+ai+memo+${Date.now()}@givery.co.jp`;

    // 1. Create a question
    const questionResp = await apiAdmin.createInterviewQuestion({
      transcript: 'あなたの強みについて教えてください。',
      question_category: 'general',
      company_id: 1,
      language: 'ja',
    });
    const { interview_question_id: questionId } = await questionResp.json();

    // 2. Create an interview flow
    const flowResp = await apiAdmin.createInterviewFlow({
      registering_company_id: 1,
      interview_name: `E2E Memo Test ${Date.now()}`,
      interview_description: 'E2E test for memo — seeded stateless data',
      is_interactive: false,
      ui_version: 2,
      language: 'ja',
      questions: [{ question_id: questionId, answer_time_limit: 60 }],
      name_label: '受験者名',
      name_placeholder: '山田太郎',
      interview_instructions_page_url:
        'https://givery.notion.site/AI-2146931cc44980e28f86f5aef23d9943',
    });
    const { interview_flow_id: flowId } = await flowResp.json();

    // 3. Create a common link
    const linkResp = await apiAdmin.createInterviewCommonLink({
      interview_flow_id: flowId,
      registering_company_id: 1,
      max_uses: 1,
    });
    const { common_link: commonLink } = await linkResp.json();

    // 4. Deliver to the unique seeded email → exam appears in Not Started
    await apiAdmin.sendUniqueInterviewLink(commonLink, { email_address: seededEmail });
  });

  // ── Tests ──────────────────────────────────────────────────────────────────

  test('should create a memo and change the button icon from file-plus-corner to file-text', async ({ pageAdmin }) => {
    const home = new Home(pageAdmin);
    await home.goto();

    // Navigate to Not Started — the seeded exam always lands here.
    await home.sidebarFilterNotStarted.click();
    await expect(pageAdmin).toHaveURL(/status=not_started/);

    // Search for the exact seeded email — guarantees the row is in the viewport.
    await home.searchCandidateByEmail(seededEmail);

    // Capture URL for tests 2–4 (not_started filtered view).
    memoCandidateViewURL = pageAdmin.url();

    // Row index 0: the seeded email is the only result after the search.
    const memoRowIndex = 0;

    // Pre-condition: confirm the row starts with the no-memo icon.
    await expect(home.getMemoIconNoMemo(memoRowIndex)).toBeVisible();

    await home.getMemoButton(memoRowIndex).click();
    await expect(home.memoPopover).toBeVisible();

    await expect(home.memoAddButton).toBeEnabled();
    await home.memoAddButton.click({ force: true });

    await home.memoTextarea.fill(FIRST_MEMO);
    await home.memoSaveButton.click({ force: true });
    await home.memoConfirmButton.click({ force: true });

    await expect(home.memoPopover).not.toBeVisible();

    await expect(home.getMemoIconHasMemo(memoRowIndex)).toBeVisible();
    await expect(home.getMemoIconNoMemo(memoRowIndex)).not.toBeVisible();
  });

  test('should display the saved memo content when the popover is reopened', async ({ pageAdmin }) => {
    const home = new Home(pageAdmin);
    await home.gotoURL(memoCandidateViewURL);
    await home.searchCandidateByEmail(seededEmail);

    await home.getMemoButtonByEmail(seededEmail).click();
    await expect(home.memoPopover).toBeVisible();

    await expect(home.getMemoContentButton(FIRST_MEMO)).toBeEnabled();

    await home.memoCloseButton.click({ force: true });
    await expect(home.memoPopover).not.toBeVisible();
  });

  test('should update the memo content and persist the change', async ({ pageAdmin }) => {
    const home = new Home(pageAdmin);
    await home.gotoURL(memoCandidateViewURL);
    await home.searchCandidateByEmail(seededEmail);

    await home.getMemoButtonByEmail(seededEmail).click();
    await expect(home.memoPopover).toBeVisible();

    await expect(home.getMemoContentButton(FIRST_MEMO)).toBeEnabled();
    await home.getMemoContentButton(FIRST_MEMO).click({ force: true });

    await expect(home.memoTextarea).toHaveValue(FIRST_MEMO);

    await home.memoTextarea.fill(UPDATED_MEMO);
    await home.memoSaveButton.click({ force: true });
    await home.memoConfirmButton.click({ force: true });

    await expect(home.memoPopover).not.toBeVisible();

    await home.gotoURL(memoCandidateViewURL);
    await home.searchCandidateByEmail(seededEmail);

    await home.getMemoButtonByEmail(seededEmail).click();
    await expect(home.memoPopover).toBeVisible();
    await expect(home.getMemoContentButton(UPDATED_MEMO)).toBeEnabled();
    await home.memoCloseButton.click({ force: true });
  });

  test('should retain the file-text icon after updating the memo', async ({ pageAdmin }) => {
    const home = new Home(pageAdmin);
    await home.gotoURL(memoCandidateViewURL);
    await home.searchCandidateByEmail(seededEmail);
    await expect(home.getMemoIconHasMemoByEmail(seededEmail)).toBeVisible();
  });
});
