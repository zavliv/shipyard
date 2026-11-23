import "server-only";
import { MongoClient, type Db, type Collection, type ObjectId } from "mongodb";
import { env } from "./env";

export type UserDoc = {
  _id?: ObjectId;
  email: string;
  createdAt: Date;
  lastLoginAt: Date;
};

export type SessionDoc = {
  _id?: ObjectId;
  tokenHash: string;
  userId: ObjectId;
  ip: string;
  userAgent: string;
  createdAt: Date;
  lastSeenAt: Date;
  expiresAt: Date;
};

export type LoginCodeDoc = {
  _id?: ObjectId;
  email: string;
  codeHash: string;
  ip: string;
  attempts: number;
  createdAt: Date;
  expiresAt: Date;
};

export type LoginAttemptDoc = {
  _id?: ObjectId;
  ip: string;
  ok: boolean;
  at: Date;
};

export type AuditDoc = {
  _id?: ObjectId;
  at: Date;
  actor: string;
  action: string;
  target?: string;
  result: "ok" | "failed" | "refused";
  detail?: string;
  ip?: string;
};

type Collections = {
  db: Db;
  users: Collection<UserDoc>;
  sessions: Collection<SessionDoc>;
  loginCodes: Collection<LoginCodeDoc>;
  loginAttempts: Collection<LoginAttemptDoc>;
  auditLog: Collection<AuditDoc>;
};

const globalForMongo = globalThis as unknown as {
  mongo?: { client: MongoClient; ready: Promise<Collections> };
};

async function init(client: MongoClient): Promise<Collections> {
  await client.connect();
  const db: Db = client.db(env.mongoDb());
  const c: Collections = {
    db,
    users: db.collection<UserDoc>("users"),
    sessions: db.collection<SessionDoc>("sessions"),
    loginCodes: db.collection<LoginCodeDoc>("loginCodes"),
    loginAttempts: db.collection<LoginAttemptDoc>("loginAttempts"),
    auditLog: db.collection<AuditDoc>("auditLog"),
  };
  await Promise.all([
    c.users.createIndex({ email: 1 }, { unique: true }),
    c.sessions.createIndex({ tokenHash: 1 }, { unique: true }),
    c.sessions.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    c.loginCodes.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    c.loginCodes.createIndex({ email: 1, createdAt: -1 }),
    c.loginAttempts.createIndex({ at: 1 }, { expireAfterSeconds: 60 * 60 * 24 }),
    c.loginAttempts.createIndex({ ip: 1, at: -1 }),
    c.auditLog.createIndex({ at: -1 }),
  ]);
  return c;
}

export function collections(): Promise<Collections> {
  if (!globalForMongo.mongo) {
    const client = new MongoClient(env.mongoUri(), { appName: "shipyard" });
    const ready = init(client).catch((err) => {
      globalForMongo.mongo = undefined;
      throw err;
    });
    globalForMongo.mongo = { client, ready };
  }
  return globalForMongo.mongo.ready;
}
