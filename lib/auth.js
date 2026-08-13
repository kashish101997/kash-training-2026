import { db, one } from './db.js';

// Kash OS is a single-user personal app. HTTP requests are assigned to its
// one internal account without a password or browser session.
export async function authenticate() {
  const sql = await db();
  return one(await sql`
    INSERT INTO accounts (handle) VALUES ('kash')
    ON CONFLICT (handle) DO UPDATE SET handle = excluded.handle
    RETURNING id AS account_id, 'web' AS actor_kind
  `);
}

export async function requireAuth() {
  return authenticate();
}
