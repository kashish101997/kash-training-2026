let sqlPromise;

export async function db() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not configured');
  if (!sqlPromise) {
    sqlPromise = import('@neondatabase/serverless').then(({ neon }) => neon(process.env.DATABASE_URL));
  }
  return sqlPromise;
}

export async function one(rows) { return rows && rows[0] ? rows[0] : null; }

