import {test,expect} from '@playwright/test'
test('private route requires sign-in; account entry remains accessible on mobile',async({page})=>{
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message))
 await page.goto('/estimates/new');await expect(page).toHaveURL(/\/login\?next=/)
 await expect(page.getByRole('heading',{name:'Sign in',exact:true})).toBeVisible()
 await expect(page.locator('input[name=email]')).toHaveAttribute('type','email')
 await expect(page.locator('input[name=password]')).toHaveAttribute('type','password')
 await page.getByRole('link',{name:'Create an account'}).click();await expect(page).toHaveURL(/\/signup/)
 await page.setViewportSize({width:390,height:844});await expect(page.locator('input[name=email]')).toBeVisible()
 await expect(page.getByText('Your jobs, estimates, and company memory stay in your private workspace.')).toBeVisible()
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true)
 expect(errors).toEqual([])
})
