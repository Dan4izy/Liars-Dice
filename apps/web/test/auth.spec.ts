import { randomUUID } from 'node:crypto'
import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

const mailpit = process.env.MAILPIT_URL ?? 'http://localhost:8025'
const firstPassword = 'demo-first-password'
const newPassword = 'demo-updated-password'

async function mailLink(request: APIRequestContext, email: string, path: string): Promise<string> {
  let result = ''
  await expect.poll(async () => {
    const response = await request.get(mailpit + '/api/v1/search', { params: { query: 'to:' + email } })
    const { messages } = await response.json()
    for (const { ID } of messages ?? []) {
      const message = await request.get(mailpit + '/api/v1/message/' + ID)
      const { Text } = await message.json()
      const link = Text.match(/https?:\/\/\S+/)?.[0]
      if (link && new URL(link).pathname.startsWith(path)) {
        result = link
        return true
      }
    }
    return false
  }).toBe(true)
  return result
}

async function signIn(page: Page, email: string, password: string) {
  await page.getByLabel('Электронная почта').fill(email)
  await page.getByLabel('Пароль', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Войти', exact: true }).click()
}

test('two accounts confirm email, sign in and reset a password', async ({ browser, request, baseURL }) => {
  const contexts = await Promise.all([
    browser.newContext({ baseURL }),
    browser.newContext({ baseURL, viewport: { width: 360, height: 800 } }),
  ])
  const suffix = randomUUID().slice(0, 8)
  const users = [
    { name: 'Анна ' + suffix, email: 'anna-' + suffix + '@example.test', route: '/r/ABCD2345' },
    { name: 'Борис ' + suffix, email: 'boris-' + suffix + '@example.test', route: '/' },
  ]
  const profile = (page: Page) => page.request.get('/api/me')
  try {
    const pages = await Promise.all(contexts.map(context => context.newPage()))
    for (const [index, user] of users.entries()) {
      const page = pages[index]
      await page.goto(user.route)
      await page.getByRole('button', { name: 'Создать аккаунт' }).click()
      await page.getByLabel('Игровой ник').fill(user.name)
      await page.getByLabel('Электронная почта').fill(user.email)
      await page.getByLabel('Пароль', { exact: true }).fill(firstPassword)
      await page.getByRole('button', { name: 'Создать аккаунт' }).click()
      await expect(page.getByRole('status')).toContainText('Проверьте почту')
      expect((await profile(page)).status()).toBe(401)

      await page.getByRole('button', { name: 'Войти', exact: true }).click()
      await signIn(page, user.email, firstPassword)
      await expect(page.getByRole('alert')).toContainText('Подтвердите почту')

      await page.goto(await mailLink(request, user.email, '/api/auth/verify-email'))
      await expect(page).toHaveURL(new URL(user.route, baseURL).href)
      await signIn(page, user.email, firstPassword)
      await expect(page.getByRole('heading', { name: 'Игровой профиль' })).toBeVisible()
      const response = await profile(page)
      expect(response.headers()['cache-control']).toBe('no-store')
      expect(await response.json()).toMatchObject({ profile: { name: user.name, email: user.email, emailVerified: true } })
    }

    const foreignOrigin = await request.post('/api/auth/sign-out', {
      headers: { Origin: 'https://example.test' },
    })
    expect(foreignOrigin.status()).toBe(403)

    const duplicate = await request.post('/api/auth/sign-up/email', {
      headers: { Origin: new URL(baseURL!).origin },
      data: { name: '  ' + users[0].name.toUpperCase() + '  ', email: 'duplicate-' + suffix + '@example.test', password: firstPassword },
    })
    expect(duplicate.status()).toBe(409)
    expect(await duplicate.json()).toMatchObject({ code: 'NICK_TAKEN' })

    const resetContext = await browser.newContext({ baseURL })
    try {
      const reset = await resetContext.newPage()
      await reset.goto('/')
      await reset.getByRole('button', { name: 'Восстановить пароль' }).click()
      await reset.getByLabel('Электронная почта').fill(users[0].email)
      await reset.getByRole('button', { name: 'Отправить письмо', exact: true }).click()
      await expect(reset.getByRole('status')).toContainText('Если аккаунт существует')
      await reset.goto(await mailLink(request, users[0].email, '/api/auth/reset-password/'))
      await reset.getByLabel('Новый пароль', { exact: true }).fill(newPassword)
      await reset.getByRole('button', { name: 'Сохранить новый пароль' }).click()
      await expect(reset.getByRole('status')).toContainText('Пароль обновлён')
      expect((await profile(pages[0])).status()).toBe(401)
      expect((await profile(pages[1])).status()).toBe(200)
      await signIn(reset, users[0].email, firstPassword)
      await expect(reset.getByRole('alert')).toContainText('Проверьте адрес почты и пароль')
      await signIn(reset, users[0].email, newPassword)
      await expect(reset.getByRole('heading', { name: 'Игровой профиль' })).toBeVisible()
      await reset.getByRole('button', { name: 'Выйти' }).click()
      await expect(reset.getByRole('heading', { name: 'Войти', exact: true })).toBeVisible()
      expect((await profile(reset)).status()).toBe(401)
    } finally {
      await resetContext.close()
    }
  } finally {
    await Promise.all(contexts.map(context => context.close()))
  }
})
