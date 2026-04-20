import { expect, test } from '@src/fixtures/fixtures';
import { ExamIssueLink } from '@src/pages/exam-issue-link.page';

test.describe('Exam Link issue - self delivery @org', () => {

    let commonLink: string;

    test.beforeEach(async ({ apiAdmin }) => {
        // 1. Create a question
        const questionResp = await apiAdmin.createInterviewQuestion({
            transcript: 'あなたの強みについて教えてください。',
            question_category: 'general',
            company_id: 1,
            language: 'ja',
        });
        const { interview_question_id: questionId } = await questionResp.json();

        // 2. Create an interview flow with that question
        const flowResp = await apiAdmin.createInterviewFlow({
            registering_company_id: 1,
            interview_name: `E2E Exam Link ${Date.now()}`,
            interview_description: 'E2E test for exam link self-delivery',
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

        // 3. Create a common link (reusable for self-delivery)
        const linkResp = await apiAdmin.createInterviewCommonLink({
            interview_flow_id: flowId,
            registering_company_id: 1,
            max_uses: 100,
        });
        const { common_link } = await linkResp.json();

        commonLink = common_link;
    });

    test('candidate should be able to deliver an exam to themselves', async ({page}) => {
        // Pre-condition - the common link should be available
        expect(commonLink).toBeTruthy();
        const examLinkPage = new ExamIssueLink(page)

        await test.step('Navigate to the exam link issue page', async ()=>{
            await examLinkPage.goto(commonLink)
            await examLinkPage.emailInput.isVisible()
        })

        await test.step('The Submit button should remain inactive until all conditions are met', async ()=>{
            await expect(examLinkPage.submitBtn).toBeDisabled()
        })

        await test.step('The Terms and Services input should remain inactive until both links are clicked', async ()=>{
            await expect(examLinkPage.termsAgreeBtn).toBeDisabled()
        })

        await test.step('The Terms and Services input should become active once both links are clicked', async()=>{
            await examLinkPage.clickTOSLink()
            await examLinkPage.clickPrivacyPolicyLink()
            await expect(examLinkPage.termsAgreeBtn).toBeEnabled()
        })

        await test.step('The user enters their email address', async() => {
            const email = `product-dev_qa+ai+${Date.now()}@givery.co.jp`
            await examLinkPage.fillEmailField(email)
        })

        await test.step('When the user accepts the Terms and conditions, the submit button should turn active', async() => {
            await examLinkPage.checkTermsAndConditions()
            await examLinkPage.checkThirdParty()
            await expect(examLinkPage.submitBtn).toBeEnabled()
        })

        await test.step('When the submit button is clicked the user should be navigated to confirmation page', async ()=>{
             await examLinkPage.clickSubmit()
             await expect(page).toHaveURL(/step=complete/)
             await expect(examLinkPage.successMessage).toBeVisible()
        })
        
    });

});
