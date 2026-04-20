import { Locator, Page } from "@playwright/test";

export class GlobalNaviMenu {
  readonly page: Page;
  readonly base: Locator;

  constructor(page: Page) {
    this.page = page;
    this.base = this.page.locator(".p-header_menu");
  }
}
