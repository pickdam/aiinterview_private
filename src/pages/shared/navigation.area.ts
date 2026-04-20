import { Locator, Page } from "@playwright/test";
import { GlobalNaviMenu } from "./global-navi.menu";

export class NavigationArea {
  readonly page: Page;
  readonly base: Locator;

  readonly globalNaviButton: Locator;

  constructor(page: Page) {
    this.page = page;

    this.base = this.page.locator("header.p-header");
    this.globalNaviButton = this.base.getByRole("button", {
      name: "グローバルナビの開閉",
    });
  }

  async clickGlobalNaviButton() {
    await this.globalNaviButton.click();
    // Wait for the menu to be visible by referencing its Page Object
    await new GlobalNaviMenu(this.page).base.waitFor();
  }
}
