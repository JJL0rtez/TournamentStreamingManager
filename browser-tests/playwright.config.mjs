import {defineConfig} from '@playwright/test';
import {fileURLToPath} from 'node:url';
export default defineConfig({testDir:'.',testMatch:'*.spec.mjs',use:{baseURL:'http://127.0.0.1:4179',browserName:'chromium'},webServer:{command:'npm run dev --workspace=@tournament/dashboard -- --port 4179 --strictPort',cwd:fileURLToPath(new URL('..',import.meta.url)),url:'http://127.0.0.1:4179',reuseExistingServer:false,timeout:30000}});
