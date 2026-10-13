import { MongoClient } from "mongodb";

let clientPromise;

export function hasMongo() {
  return Boolean(process.env.MONGODB_URI);
}

export async function getDb() {
  if (!process.env.MONGODB_URI) return null;

  if (!clientPromise) {
    const client = new MongoClient(process.env.MONGODB_URI);
    clientPromise = client.connect();
  }

  const client = await clientPromise;
  return client.db(process.env.MONGODB_DB || "instagram_telegram_gate");
}

export async function getStoredConfig() {
  const db = await getDb();
  if (!db) return null;
  const record = await db.collection("config").findOne({ _id: "main" });
  return record?.value || null;
}

export async function saveStoredConfig(config) {
  const db = await getDb();
  if (!db) return false;

  await db.collection("config").updateOne(
    { _id: "main" },
    {
      $set: {
        value: config,
        updatedAt: new Date()
      }
    },
    { upsert: true }
  );
  return true;
}

export async function recordEvent(type, payload = {}) {
  const db = await getDb();
  if (!db) return;

  await db.collection("events").insertOne({
    type,
    ...payload,
    createdAt: new Date()
  });
}

export async function markEventOnce(key, ttlSeconds = 600) {
  const db = await getDb();
  if (!db) return null;

  await ensureIndexes(db);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlSeconds * 1000);

  try {
    await db.collection("processed_events").insertOne({
      _id: key,
      createdAt: now,
      expiresAt
    });
    return true;
  } catch (error) {
    if (error.code === 11000) return false;
    throw error;
  }
}

export async function markInstagramRecipientOnce(key, payload = {}) {
  const db = await getDb();
  if (!db) return null;

  await ensureIndexes(db);

  try {
    await db.collection("instagram_recipients").insertOne({
      _id: key,
      ...payload,
      createdAt: new Date()
    });
    return true;
  } catch (error) {
    if (error.code === 11000) return false;
    throw error;
  }
}

export async function hasInstagramRecipient(key) {
  const db = await getDb();
  if (!db) return null;

  const record = await db.collection("instagram_recipients").findOne(
    { _id: key },
    { projection: { _id: 1 } }
  );
  return Boolean(record);
}

export async function upsertTelegramUser(user, extra = {}) {
  const db = await getDb();
  if (!db || !user?.id) return;

  await db.collection("telegram_users").updateOne(
    { _id: String(user.id) },
    {
      $set: {
        telegramId: user.id,
        username: user.username || "",
        firstName: user.first_name || "",
        lastName: user.last_name || "",
        ...extra,
        updatedAt: new Date()
      },
      $setOnInsert: {
        createdAt: new Date()
      }
    },
    { upsert: true }
  );
}

export async function getStats() {
  const db = await getDb();
  if (!db) return null;

  await ensureIndexes(db);
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [totalEvents, events24h, users, instagramRecipients, byType] = await Promise.all([
    db.collection("events").countDocuments(),
    db.collection("events").countDocuments({ createdAt: { $gte: since24h } }),
    db.collection("telegram_users").countDocuments(),
    db.collection("instagram_recipients").countDocuments(),
    db.collection("events").aggregate([
      { $group: { _id: "$type", count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]).toArray()
  ]);

  return {
    totalEvents,
    events24h,
    users,
    instagramRecipients,
    byType: byType.map((item) => ({ type: item._id, count: item.count }))
  };
}

let indexesEnsured = false;

async function ensureIndexes(db) {
  if (indexesEnsured) return;

  await Promise.all([
    db.collection("processed_events").createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    db.collection("instagram_recipients").createIndex({ createdAt: -1 }),
    db.collection("events").createIndex({ createdAt: -1 }),
    db.collection("events").createIndex({ type: 1, createdAt: -1 }),
    db.collection("telegram_users").createIndex({ updatedAt: -1 })
  ]);

  indexesEnsured = true;
}
