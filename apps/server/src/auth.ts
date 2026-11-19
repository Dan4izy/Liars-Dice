import { betterAuth } from 'better-auth'
import { APIError } from 'better-auth/api'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { drizzle } from 'drizzle-orm/node-postgres'
import { eq } from 'drizzle-orm'
import nodemailer from 'nodemailer'
import { Pool } from 'pg'
import { z } from 'zod'
import * as schema from './schema.ts'

const config = z.object({
  DATABASE_URL: z.url(),
  BETTER_AUTH_URL: z.url(),
  BETTER_AUTH_SECRET: z.string().min(32),
  SMTP_HOST: z.string().min(1),
  SMTP_PORT: z.coerce.number().int().positive(),
  SMTP_FROM: z.string().min(1),
  SMTP_SECURE: z.enum(['true', 'false']).optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
}).parse(process.env)

export const origin = new URL(config.BETTER_AUTH_URL).origin
export const pool = new Pool({ connectionString: config.DATABASE_URL })
const db = drizzle(pool, { schema })
const mailer = nodemailer.createTransport({
  host: config.SMTP_HOST,
  port: config.SMTP_PORT,
  secure: config.SMTP_SECURE === 'true',
  auth: config.SMTP_USER ? { user: config.SMTP_USER, pass: config.SMTP_PASSWORD } : undefined,
})
async function sendLink(email: string, subject: string, url: string) {
  await mailer.sendMail({ from: config.SMTP_FROM, to: email, subject, text: subject + '\n\n' + url })
}

export const auth = betterAuth({
  baseURL: origin,
  secret: config.BETTER_AUTH_SECRET,
  trustedOrigins: [origin],
  database: drizzleAdapter(db, { provider: 'pg', schema, transaction: true }),
  advanced: {
    useSecureCookies: origin.startsWith('https:'),
    defaultCookieAttributes: { httpOnly: true, sameSite: 'lax' },
  },
  logger: { disabled: true },
  disabledPaths: [
    '/update-user', '/change-email', '/delete-user', '/set-password',
    '/sign-in/social', '/link-social', '/unlink-account',
  ],
  rateLimit: {
    enabled: true,
    customRules: {
      '/sign-in/email': { window: 60, max: 10 },
      '/sign-up/email': { window: 60, max: 10 },
      '/request-password-reset': { window: 60, max: 5 },
      '/send-verification-email': { window: 60, max: 5 },
    },
  },
  user: {
    additionalFields: {
      nickKey: { type: 'string', required: false, input: false, returned: false },
    },
  },
  databaseHooks: {
    user: {
      create: {
        before: async user => {
          const name = user.name.normalize('NFKC').trim().replace(/\s+/gu, ' ')
          if ([...name].length < 2 || [...name].length > 24 || /[\p{Cc}\p{Cf}]/u.test(name)) {
            throw new APIError('BAD_REQUEST', { code: 'INVALID_NICK', message: 'Invalid nickname' })
          }
          const nickKey = name.toLowerCase()
          const [existing] = await db.select({ id: schema.user.id }).from(schema.user)
            .where(eq(schema.user.nickKey, nickKey)).limit(1)
          if (existing) throw new APIError('CONFLICT', { code: 'NICK_TAKEN', message: 'Nickname is taken' })
          return { data: { ...user, name, nickKey } }
        },
      },
    },
  },
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
    maxPasswordLength: 128,
    requireEmailVerification: true,
    revokeSessionsOnPasswordReset: true,
    sendResetPassword: async ({ user, url }) => sendLink(user.email, 'Восстановление пароля Liar’s Dice', url),
  },
  emailVerification: {
    sendOnSignUp: true,
    autoSignInAfterVerification: false,
    sendVerificationEmail: async ({ user, url }) => sendLink(user.email, 'Подтверждение почты Liar’s Dice', url),
  },
})
