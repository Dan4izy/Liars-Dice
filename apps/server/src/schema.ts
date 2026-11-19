import { boolean, pgTable, text, timestamp, index } from 'drizzle-orm/pg-core'

const stamp = (name: string) => timestamp(name, { withTimezone: true })
export const user = pgTable('users', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  nickKey: text('nick_key').notNull().unique(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  createdAt: stamp('created_at').notNull(),
  updatedAt: stamp('updated_at').notNull(),
})
export const session = pgTable('sessions', {
  id: text('id').primaryKey(),
  token: text('token').notNull().unique(),
  expiresAt: stamp('expires_at').notNull(),
  createdAt: stamp('created_at').notNull(),
  updatedAt: stamp('updated_at').notNull(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
}, table => [index('sessions_user_idx').on(table.userId)])
export const account = pgTable('accounts', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  idToken: text('id_token'),
  accessTokenExpiresAt: stamp('access_token_expires_at'),
  refreshTokenExpiresAt: stamp('refresh_token_expires_at'),
  scope: text('scope'),
  password: text('password'),
  createdAt: stamp('created_at').notNull(),
  updatedAt: stamp('updated_at').notNull(),
}, table => [index('accounts_user_idx').on(table.userId)])
export const verification = pgTable('verifications', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: stamp('expires_at').notNull(),
  createdAt: stamp('created_at').notNull(),
  updatedAt: stamp('updated_at').notNull(),
}, table => [index('verifications_identifier_idx').on(table.identifier)])
