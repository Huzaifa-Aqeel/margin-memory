import {defineConfig} from '@playwright/test'
export default defineConfig({
 testDir:'tests/browser',fullyParallel:false,
 use:{baseURL:'http://127.0.0.1:3100',headless:true,launchOptions:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE}:{}},
 webServer:{command:'npm run start -- --port 3100',url:'http://127.0.0.1:3100/login',reuseExistingServer:false,timeout:60000,env:{NEXT_PUBLIC_SUPABASE_URL:process.env.NEXT_PUBLIC_SUPABASE_URL||'http://127.0.0.1:54321',NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY||'sb_publishable_browser_test'}},
})
