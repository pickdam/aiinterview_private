import { Locator, Page, expect } from "@playwright/test";

export class Home {
  readonly page: Page;

  readonly headerProfile: Locator;

  readonly sidebar: Locator;

  readonly sidebarCandidateListLink: Locator;
  readonly sidebarFilterNotStarted: Locator;
  readonly sidebarFilterInProgress: Locator;
  readonly sidebarFilterPendingReview: Locator;
  readonly sidebarFilterPassed: Locator;
  readonly sidebarFilterFailed: Locator;
  readonly sidebarFilterClosed: Locator;

  readonly interviewFilter: Locator;
  readonly interviewFilterListbox: Locator;
  readonly candidateSearchInput: Locator;
  readonly exportButton: Locator;
  readonly resultCountHeader: Locator;

  readonly exportConfirmOkButton: Locator;
  readonly exportConfirmCancelButton: Locator;

  readonly memoPopover: Locator;

  readonly memoCloseButton: Locator;   
  readonly memoAddButton: Locator;    
  readonly memoTextarea: Locator; 
  readonly memoCancelButton: Locator;
  readonly memoSaveButton: Locator;

  readonly memoConfirmDialog: Locator;
  readonly memoConfirmButton: Locator;

  readonly openReportLink: Locator

  constructor(page: Page) {
    this.page = page;

    this.headerProfile = this.page.getByRole('button', { name: 'Header Menu' });

    this.sidebar = this.page.locator('[data-sidebar="sidebar"]');
    this.sidebarCandidateListLink   = this.sidebar.getByRole('link', { name: /受験者一覧|Candidate List/i });
    this.sidebarFilterNotStarted    = this.sidebar.getByRole('link', { name: /未受験|Not Started/i });
    this.sidebarFilterInProgress    = this.sidebar.getByRole('link', { name: /受験中|In Progress/i });
    this.sidebarFilterPendingReview = this.sidebar.getByRole('link', { name: /評価待ち|Pending Review/i });
    this.sidebarFilterPassed        = this.sidebar.getByRole('link', { name: /選考通過|Passed/i });
    this.sidebarFilterFailed        = this.sidebar.getByRole('link', { name: /不合格|Failed/i });
    this.sidebarFilterClosed        = this.sidebar.getByRole('link', { name: /終了|Closed/i });

    this.interviewFilter        = this.page.locator('[role="combobox"]:not([data-slot="select-trigger"])');
    this.interviewFilterListbox = this.page.getByRole('listbox');
    this.candidateSearchInput   = this.page.getByPlaceholder(/受験者名・メールアドレスで検索|Search by name or email/i);
    this.exportButton           = this.page.getByRole('button', { name: /エクスポート|Export/i });
    this.resultCountHeader      = this.page.getByText(/^表示:/);
    this.exportConfirmOkButton     = this.page.getByRole('button', { name: 'OK' });
    this.exportConfirmCancelButton = this.page.getByRole('button', { name: /キャンセル|Export/i });

    this.memoPopover      = this.page.getByRole('dialog');
    this.memoCloseButton   = this.memoPopover.getByLabel('閉じる');
    this.memoAddButton     = this.memoPopover.getByRole('button', { name: /メモを追加|Add Memo/i });
    this.memoTextarea      = this.memoPopover.getByPlaceholder(/メモを追加|Add Memo/i);
    this.memoCancelButton  = this.memoPopover.getByRole('button', { name: /キャンセル|Cancel/i });
    this.memoSaveButton    = this.memoPopover.getByRole('button', { name: /保存する|Save/ });
    this.memoConfirmDialog = this.page.getByRole('alertdialog');
    this.memoConfirmButton = this.memoConfirmDialog.getByRole('button', { name: /更新する|Update/i });

    this.openReportLink = this.page.getByRole('link', { name: /Open|開く/i })
  }

  getInterviewFilterOption(name: string | RegExp): Locator {
    return this.interviewFilterListbox.getByRole('option', { name });
  }

  getFirstSpecificInterviewFlowOption(): Locator {
    return this.interviewFilterListbox
      .getByRole('option', { selected: false })
      .first();
  }

  getRowEvaluationCombobox(rowIndex: number = 0): Locator {
    return this.page.locator('tbody tr').nth(rowIndex).getByRole('combobox');
  }

  getMemoButton(rowIndex: number = 0): Locator {
    return this.page.locator('tbody tr').nth(rowIndex).getByRole('button', { name: /メモを開く|Open/i });
  }

  getMemoIconHasMemo(rowIndex: number = 0): Locator {
    return this.getMemoButton(rowIndex).locator('.lucide-file-text');
  }

  getMemoIconNoMemo(rowIndex: number = 0): Locator {
    return this.getMemoButton(rowIndex).locator('.lucide-file-plus-corner');
  }

  getMemoContentButton(memoText: string): Locator {
    return this.memoPopover.getByRole('button', { name: memoText });
  }

  getMemoButtonByCandidate(candidateName: string): Locator {
    return this.page.locator('tbody tr')
      .filter({ hasText: candidateName })
      .filter({ has: this.page.locator('.lucide-file-text') })
      .getByRole('button', { name: /メモを開く|Open/i });
  }

  getMemoIconHasMemoByCandidate(candidateName: string): Locator {
    return this.page.locator('tbody tr')
      .filter({ hasText: candidateName })
      .filter({ has: this.page.locator('.lucide-file-text') })
      .locator('.lucide-file-text');
  }

  async getRowCountWithText(text: string): Promise<number> {
    return this.page.locator('tbody tr').filter({ hasText: text }).count();
  }

  async getFirstRowIndexWithoutMemo(): Promise<number> {
    const rows = this.page.locator('tbody tr');
    const count = await rows.count();
    for (let i = 0; i < count; i++) {
      if (await rows.nth(i).locator('.lucide-file-plus-corner').isVisible()) return i;
    }
    return -1;
  }

  async getCandidateNameForRow(rowIndex: number): Promise<string> {
    return (await this.page.locator('tbody tr').nth(rowIndex).locator('td').first().textContent() ?? '').trim();
  }

  async getRowCandidateEmail(rowIndex: number): Promise<string> {
    const text = await this.page
      .locator('tbody tr')
      .nth(rowIndex)
      .locator('td')
      .first()
      .innerText();
    const match = text.match(/\S+@\S+\.\S+/);
    return match ? match[0] : '';
  }

  getMemoButtonByEmail(email: string): Locator {
    return this.page
      .locator('tbody tr')
      .filter({ hasText: email })
      .getByRole('button', { name: 'メモを開く' });
  }

  getMemoIconHasMemoByEmail(email: string): Locator {
    return this.page
      .locator('tbody tr')
      .filter({ hasText: email })
      .locator('.lucide-file-text');
  }

  async gotoURL(url: string) {
    await this.page.goto(url);
  }

  async searchCandidateByEmail(email: string): Promise<void> {
    await this.candidateSearchInput.clear();
    await this.candidateSearchInput.fill(email);
    await expect(this.page.locator('tbody tr')).toHaveCount(1);
    await this.page
      .locator('tbody tr')
      .filter({ hasText: email })
      .first()
      .waitFor({ state: 'visible' });
  }

  async openReport(){
    await this.openReportLink.click()
  }

  async goto() {
    await this.page.goto('/company/interview-flows/all');
  }

}
