import { expect, test } from '@playwright/test'

test('shows the safe signed-out task-pane entry without exposing privileged actions',async({page})=>{
 await page.goto('/integrations/excel')
 await expect(page.getByText('Margin Memory',{exact:true}).first()).toBeVisible()
 await expect(page.getByRole('heading',{name:'Sign in to Margin Memory'})).toBeVisible()
 await expect(page.getByRole('button',{name:/Sign in/})).toBeVisible()
 await expect(page.getByText(/service role|AWS secret|Bedrock credential/i)).toHaveCount(0)
})
