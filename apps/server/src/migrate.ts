import { readdir, readFile } from 'node:fs/promises'
import { Pool } from 'pg'

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required')
const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const client = await pool.connect()
try {
  await client.query('BEGIN')
  await client.query('SELECT pg_advisory_xact_lock(917482)')
  await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY)')
  const applied = new Set((await client.query<{ name: string }>('SELECT name FROM schema_migrations')).rows.map(row => row.name))
  const directory = new URL('../migrations/', import.meta.url)
  for (const name of (await readdir(directory)).filter(entry => /^\d+_.*\.sql$/.test(entry)).sort()) {
    if (applied.has(name)) continue
    await client.query(await readFile(new URL(name, directory), 'utf8'))
    await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [name])
    console.log('Applied', name)
  }
  await client.query('COMMIT')
} catch (error) {
  await client.query('ROLLBACK')
  throw error
} finally {
  client.release()
  await pool.end()
}
