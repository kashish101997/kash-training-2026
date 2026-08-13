import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { neon } from '@neondatabase/serverless';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const sql = neon(process.env.DATABASE_URL);
const migrationDirectory = fileURLToPath(new URL('../db/migrations/', import.meta.url));
const files = fs.readdirSync(migrationDirectory)
  .filter(file => /^\d+_.+\.sql$/.test(file))
  .sort();
let applied = 0;
for (const file of files) {
  const source = fs.readFileSync(path.join(migrationDirectory, file), 'utf8');
  const statements = source.split(/;\s*(?:\n|$)/).map(value => value.trim()).filter(Boolean);
  for (const statement of statements) await sql.query(statement);
  applied += statements.length;
  console.log(`Applied ${file} (${statements.length} statements).`);
}
console.log(`Applied ${applied} idempotent migration statements from ${files.length} files.`);
