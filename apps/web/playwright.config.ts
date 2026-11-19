import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './test',
  webServer: process.env.APP_URL ? undefined : {
    command: 'node --env-file-if-exists=.env apps/server/src/index.ts',
    cwd: '../..',
    url: 'http://localhost:3000/health/ready',
  },
  use: {
    baseURL: process.env.APP_URL ?? 'http://localhost:3000',
    launchOptions: { executablePath: process.env.CHROMIUM_PATH },
  },
})
