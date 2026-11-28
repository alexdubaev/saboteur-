import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { transaction } from "./database.js";

export const SESSION_COOKIE = "gold_guest";
export const SESSION_AGE_SECONDS = 30 * 24 * 60 * 60;
export type Identity = { userId: string; name: string; avatarId: string };

function hash(token: string): Buffer {
  return createHash("sha256").update(token).digest();
}

export async function readSession(db: Pool, token?: string): Promise<Identity | undefined> {
  if (!token || !/^[\w-]{43}$/.test(token)) return undefined;
  const result = await db.query<Identity>(`
    SELECT p.user_id AS "userId", p.name, p.avatar_id AS "avatarId"
    FROM guest_sessions s JOIN profiles p USING (user_id)
    WHERE s.token_hash = $1 AND s.expires_at > now() AND s.revoked_at IS NULL
  `, [hash(token)]);
  return result.rows[0];
}

export async function activeSessions(db: Pool, tokens: readonly string[]): Promise<Set<string>> {
  const hashes = new Map(tokens.map((token) => [hash(token).toString("hex"), token]));
  const result = await db.query<{ token_hash: Buffer }>(`
    SELECT token_hash FROM guest_sessions WHERE token_hash = ANY($1::bytea[]) AND expires_at > now() AND revoked_at IS NULL
  `, [[...hashes.keys()].map((digest) => Buffer.from(digest, "hex"))]);
  return new Set(result.rows.map(({ token_hash }) => hashes.get(token_hash.toString("hex"))).filter((token) => token !== undefined));
}

export async function createSession(db: Pool, name: string): Promise<{ token: string; identity: Identity }> {
  return transaction(db, (client) => createSessionInTransaction(client, name));
}

export async function createSessionInTransaction(client: PoolClient, name: string): Promise<{ token: string; identity: Identity }> {
  const token = randomBytes(32).toString("base64url");
  const identity = { userId: randomUUID(), name, avatarId: `guest-${randomBytes(1)[0] % 10 + 1}` };
  await client.query("INSERT INTO profiles (user_id, name, avatar_id) VALUES ($1, $2, $3)", [identity.userId, name, identity.avatarId]);
  await client.query("INSERT INTO guest_sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)",
    [hash(token), identity.userId, new Date(Date.now() + SESSION_AGE_SECONDS * 1000)]);
  return { token, identity };
}
