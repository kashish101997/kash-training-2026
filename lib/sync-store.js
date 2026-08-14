import { db, one } from './db.js';
import { decryptJSON, encryptJSON } from './crypto.js';
import { decodePayload, encodePayload, mergeEntity } from './merge.js';

const allowedKinds = new Set([
  'workout', 'plan_enrollment', 'plan_completion', 'plan_adjustment', 'body_measurement', 'journal',
  'daily_summary', 'weights', 'workouts', 'injuries', 'meals', 'foodLog', 'bloodSugar',
  'raceResults', 'gatewaySessions', 'hyroxSessions', 'strengthPRs', 'measurements',
  'hyroxLadderEntries', 'pwa_settings', 'whoop_profile', 'whoop_body', 'whoop_cycle',
  'whoop_recovery', 'whoop_sleep', 'training_plan', 'practice_template',
  'practice_completion', 'push_subscription',
]);

function aad(accountId, kind, entityId) { return `${accountId}:${kind}:${entityId}`; }

export async function applyMutation(accountId, actorKind, mutation) {
  const mutationID = String(mutation.mutationID || mutation.mutationId || '');
  const kind = String(mutation.kind || '');
  const entityID = String(mutation.entityID || mutation.entityId || '');
  if (!/^[0-9a-f-]{36}$/i.test(mutationID)) throw new Error('invalid_mutation_id');
  if (!allowedKinds.has(kind) || !entityID || entityID.length > 200) throw new Error('invalid_entity');
  const baseVersion = Math.max(0, Number(mutation.baseVersion || 0));
  const requestedProvenance = String(mutation.provenance || (actorKind === 'device' ? 'userEntered' : 'pwa'));
  const provenance = actorKind === 'strava' ? 'strava' : actorKind === 'whoop' ? 'whoop' : requestedProvenance;
  if (!['computed', 'strava', 'whoop', 'healthKit', 'pwa', 'userEntered'].includes(provenance)) {
    throw new Error('invalid_provenance');
  }
  const sql = await db();

  const duplicate = await one(await sql`
    SELECT result FROM sync_mutations WHERE account_id = ${accountId} AND mutation_id = ${mutationID}
  `);
  if (duplicate) return duplicate.result;

  for (let attempt = 0; attempt < 4; attempt++) {
    const row = await one(await sql`
      SELECT revision, tombstone, encrypted_payload
      FROM sync_entities WHERE account_id = ${accountId} AND kind = ${kind} AND entity_id = ${entityID}
    `);
    const currentRevision = Number(row?.revision || 0);
    const nextRevision = currentRevision + 1;
    const current = row?.encrypted_payload ? decryptJSON(row.encrypted_payload, aad(accountId, kind, entityID)) : null;
    const tombstone = Boolean(mutation.tombstone);
    const protectsUserEdit = tombstone && ['strava', 'whoop'].includes(provenance) && Object.values(current?.fieldProvenance || {})
      .some(source => source === 'userEntered' || source === 'pwa');
    if (protectsUserEdit) {
      return recordRejectedIntegrationDelete(sql, {
        accountId, actorKind, mutationID, kind, entityID, currentRevision, provenance,
      });
    }
    const merged = tombstone
      ? { data: {}, fieldRevisions: current?.fieldRevisions || {}, fieldProvenance: current?.fieldProvenance || {}, conflicts: [] }
      : mergeEntity({
          current,
          incoming: decodePayload(mutation.payloadBase64),
          baseVersion,
          nextRevision,
          provenance,
        });
    const encrypted = tombstone ? null : encryptJSON(merged, aad(accountId, kind, entityID));
    const result = { mutationID, entityID, kind, revision: nextRevision, conflicts: merged.conflicts };
    const encryptedJSON = encrypted ? JSON.stringify(encrypted) : null;
    const resultJSON = JSON.stringify(result);

    // A single data-modifying CTE makes the entity CAS, change feed, idempotency
    // record, and audit record atomic. The per-mutation advisory lock prevents two
    // concurrent deliveries of the same mutation ID from applying twice.
    const lockKey = `${accountId}:${mutationID}`;
    const atomicQuery = row
      ? sql`
          WITH existing AS MATERIALIZED (
            SELECT result FROM sync_mutations
            WHERE account_id = ${accountId} AND mutation_id = ${mutationID}
          ), applied AS (
            UPDATE sync_entities SET revision = ${nextRevision}, tombstone = ${tombstone},
              encrypted_payload = ${encryptedJSON}::jsonb, updated_at = now()
            WHERE account_id = ${accountId} AND kind = ${kind} AND entity_id = ${entityID}
              AND revision = ${currentRevision} AND NOT EXISTS (SELECT 1 FROM existing)
            RETURNING revision
          ), recorded_change AS (
            INSERT INTO sync_changes (account_id, kind, entity_id, revision, tombstone, encrypted_payload)
            SELECT ${accountId}, ${kind}, ${entityID}, revision, ${tombstone}, ${encryptedJSON}::jsonb
            FROM applied RETURNING sequence
          ), recorded_mutation AS (
            INSERT INTO sync_mutations (account_id, mutation_id, result)
            SELECT ${accountId}, ${mutationID}, ${resultJSON}::jsonb FROM applied
            ON CONFLICT DO NOTHING RETURNING mutation_id
          ), recorded_audit AS (
            INSERT INTO audit_log (account_id, actor_kind, action, entity_kind, entity_id, revision)
            SELECT ${accountId}, ${actorKind}, ${tombstone ? 'delete' : 'upsert'}, ${kind}, ${entityID}, revision
            FROM applied RETURNING id
          )
          SELECT (SELECT result FROM existing LIMIT 1) AS existing_result,
            EXISTS (SELECT 1 FROM applied) AS applied,
            (SELECT count(*) FROM recorded_change) AS change_count,
            (SELECT count(*) FROM recorded_mutation) AS mutation_count,
            (SELECT count(*) FROM recorded_audit) AS audit_count
        `
      : sql`
          WITH existing AS MATERIALIZED (
            SELECT result FROM sync_mutations
            WHERE account_id = ${accountId} AND mutation_id = ${mutationID}
          ), applied AS (
            INSERT INTO sync_entities (account_id, kind, entity_id, revision, tombstone, encrypted_payload)
            SELECT ${accountId}, ${kind}, ${entityID}, ${nextRevision}, ${tombstone}, ${encryptedJSON}::jsonb
            WHERE NOT EXISTS (SELECT 1 FROM existing)
            ON CONFLICT DO NOTHING RETURNING revision
          ), recorded_change AS (
            INSERT INTO sync_changes (account_id, kind, entity_id, revision, tombstone, encrypted_payload)
            SELECT ${accountId}, ${kind}, ${entityID}, revision, ${tombstone}, ${encryptedJSON}::jsonb
            FROM applied RETURNING sequence
          ), recorded_mutation AS (
            INSERT INTO sync_mutations (account_id, mutation_id, result)
            SELECT ${accountId}, ${mutationID}, ${resultJSON}::jsonb FROM applied
            ON CONFLICT DO NOTHING RETURNING mutation_id
          ), recorded_audit AS (
            INSERT INTO audit_log (account_id, actor_kind, action, entity_kind, entity_id, revision)
            SELECT ${accountId}, ${actorKind}, ${tombstone ? 'delete' : 'upsert'}, ${kind}, ${entityID}, revision
            FROM applied RETURNING id
          )
          SELECT (SELECT result FROM existing LIMIT 1) AS existing_result,
            EXISTS (SELECT 1 FROM applied) AS applied,
            (SELECT count(*) FROM recorded_change) AS change_count,
            (SELECT count(*) FROM recorded_mutation) AS mutation_count,
            (SELECT count(*) FROM recorded_audit) AS audit_count
        `;
    // The lock is its own statement inside a READ COMMITTED transaction. A waiter therefore receives
    // a fresh snapshot for `atomicQuery` after the first delivery commits; putting the lock inside the
    // same statement would retain a stale snapshot and could apply one mutation ID twice.
    const transaction = await sql.transaction([
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`,
      atomicQuery,
    ]);
    const atomicRows = transaction[1];
    const atomic = await one(atomicRows);
    if (atomic?.existing_result) return atomic.existing_result;
    if (atomic?.applied && Number(atomic.change_count) === 1
        && Number(atomic.mutation_count) === 1 && Number(atomic.audit_count) === 1) return result;
  }
  throw new Error('concurrent_update_retry_exhausted');
}

async function recordRejectedIntegrationDelete(sql, values) {
  const { accountId, actorKind, mutationID, kind, entityID, currentRevision, provenance } = values;
  const lockKey = `${accountId}:${mutationID}`;
  const result = {
    mutationID, entityID, kind, revision: currentRevision,
    conflicts: [{ field: '*', kept: 'userEntered', rejected: `${provenance}_delete` }],
  };
  const resultJSON = JSON.stringify(result);
  const transaction = await sql.transaction([
    sql`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`,
    sql`
      WITH existing AS MATERIALIZED (
        SELECT result FROM sync_mutations
        WHERE account_id = ${accountId} AND mutation_id = ${mutationID}
      ), recorded_mutation AS (
        INSERT INTO sync_mutations (account_id, mutation_id, result)
        SELECT ${accountId}, ${mutationID}, ${resultJSON}::jsonb
        WHERE NOT EXISTS (SELECT 1 FROM existing)
        ON CONFLICT DO NOTHING RETURNING mutation_id
      ), recorded_audit AS (
        INSERT INTO audit_log (account_id, actor_kind, action, entity_kind, entity_id, revision)
        SELECT ${accountId}, ${actorKind}, 'integration_delete_rejected', ${kind}, ${entityID}, ${currentRevision}
        WHERE EXISTS (SELECT 1 FROM recorded_mutation)
        RETURNING id
      )
      SELECT (SELECT result FROM existing LIMIT 1) AS existing_result,
        (SELECT count(*) FROM recorded_mutation) AS mutation_count,
        (SELECT count(*) FROM recorded_audit) AS audit_count
    `,
  ]);
  const recorded = await one(transaction[1]);
  if (recorded?.existing_result) return recorded.existing_result;
  if (Number(recorded?.mutation_count) === 1 && Number(recorded?.audit_count) === 1) return result;
  throw new Error('rejected_delete_record_failed');
}

export async function pullChanges(accountId, cursor = 0, limit = 250) {
  const sql = await db();
  const rows = await sql`
    SELECT sequence, kind, entity_id, revision, tombstone, encrypted_payload, updated_at
    FROM sync_changes
    WHERE account_id = ${accountId} AND sequence > ${cursor}
    ORDER BY sequence ASC LIMIT ${limit + 1}
  `;
  const page = rows.slice(0, limit);
  return {
    cursor: String(page.at(-1)?.sequence || cursor),
    hasMore: rows.length > limit,
    changes: page.map(row => {
      const inner = row.encrypted_payload
        ? decryptJSON(row.encrypted_payload, aad(accountId, row.kind, row.entity_id))
        : null;
      return {
        entityID: row.entity_id,
        kind: row.kind,
        revision: Number(row.revision),
        tombstone: row.tombstone,
        provenance: inner ? dominantProvenance(inner.fieldProvenance) : 'userEntered',
        payloadBase64: inner ? encodePayload(inner.data) : null,
        updatedAt: row.updated_at,
      };
    }),
  };
}

function dominantProvenance(fields = {}) {
  const ranks = { computed: 1, strava: 2, whoop: 2, healthKit: 3, pwa: 4, userEntered: 5 };
  return Object.values(fields).sort((a, b) => (ranks[b] || 0) - (ranks[a] || 0))[0] || 'computed';
}
