import { Locator, Page } from "@playwright/test";

export class InterviewFlowEntryPage {
    readonly page: Page

    readonly nextBtn: Locator
    readonly acceptTOSBtn: Locator
    readonly nameInput: Locator
    readonly submitBtn: Locator

    constructor(page: Page){
        this.page = page

        this.nextBtn = this.page.getByRole('button',{name: /Next|次へ/i})
        this.acceptTOSBtn = this.page.locator('button[id="approve-terms"]')
        this.nameInput = this.page.locator('input[name="name"]')
        this.submitBtn = this.page.getByRole('button', {name: /Submit/i})
    }

    async clickNext(){
        await this.nextBtn.click()
    }

    async clickSubmit(){
        await this.submitBtn.click()
    }

    async acceptTOS(){
        await this.acceptTOSBtn.click()
    }

    async fillName(name: string){
        await this.nameInput.fill(name)
    }
}