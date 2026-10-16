import { GridFSBucket, MongoClient, ObjectId } from "mongodb";

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

export function toObjectId(id) {
  if (!ObjectId.isValid(id)) return null;
  return new ObjectId(id);
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

export async function getActiveCampaigns() {
  const db = await getDb();
  if (!db) return [];

  await ensureIndexes(db);
  return db.collection("campaigns")
    .find({ status: "active" })
    .sort({ priority: -1, updatedAt: -1, createdAt: -1 })
    .toArray();
}

export async function getCampaignById(id) {
  const db = await getDb();
  if (!db || !id) return null;

  await ensureIndexes(db);
  return db.collection("campaigns").findOne({ _id: String(id), status: "active" });
}

export async function getCampaignByStartPayload(payload) {
  const db = await getDb();
  if (!db || !payload) return null;

  await ensureIndexes(db);
  return db.collection("campaigns").findOne({
    status: "active",
    "telegram.startPayload": String(payload)
  });
}

export async function upsertInstagramMedia(items = []) {
  const db = await getDb();
  if (!db || !items.length) return 0;

  await ensureIndexes(db);
  const now = new Date();
  const operations = items
    .filter((item) => item?.id)
    .map((item) => ({
      updateOne: {
        filter: { _id: String(item.id) },
        update: {
          $set: {
            instagramAccountId: item.instagramAccountId || "me",
            caption: item.caption || "",
            mediaType: item.media_type || item.mediaType || "",
            mediaUrl: item.media_url || item.mediaUrl || "",
            thumbnailUrl: item.thumbnail_url || item.thumbnailUrl || "",
            permalink: item.permalink || "",
            timestamp: item.timestamp || "",
            syncedAt: now
          },
          $setOnInsert: {
            createdAt: now
          }
        },
        upsert: true
      }
    }));

  if (!operations.length) return 0;
  const result = await db.collection("instagram_media").bulkWrite(operations);
  return result.upsertedCount + result.modifiedCount;
}

export async function listInstagramMedia(limit = 80) {
  const db = await getDb();
  if (!db) return [];

  await ensureIndexes(db);
  const items = await db.collection("instagram_media")
    .find({})
    .sort({ timestamp: -1, syncedAt: -1 })
    .limit(limit)
    .toArray();

  return items.map((item) => ({
    ...item,
    id: String(item._id),
    _id: String(item._id),
    syncedAt: item.syncedAt?.toISOString?.() || item.syncedAt,
    createdAt: item.createdAt?.toISOString?.() || item.createdAt
  }));
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

export async function saveConsultationLead(lead) {
  const db = await getDb();
  if (!db) return null;
  await ensureIndexes(db);

  const result = await db.collection("consultation_leads").insertOne({
    ...lead,
    status: "new",
    source: "lesson",
    createdAt: new Date()
  });
  return String(result.insertedId);
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

export async function getTelegramUser(userId) {
  const db = await getDb();
  if (!db || !userId) return null;

  return db.collection("telegram_users").findOne({ _id: String(userId) });
}

export async function getStats(filters = {}) {
  const db = await getDb();
  if (!db) return null;

  await ensureIndexes(db);
  const query = statsQuery(filters);
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const events24hQuery = mergeCreatedAt(query, { $gte: since24h });
  const [totalEvents, events24h, users, instagramRecipients, byType, byCampaign, recentEvents, availableEventTypes] = await Promise.all([
    db.collection("events").countDocuments(query),
    db.collection("events").countDocuments(events24hQuery),
    db.collection("events").distinct("telegramId", query),
    db.collection("instagram_recipients").countDocuments(filters.campaignId ? { campaignId: filters.campaignId } : {}),
    db.collection("events").aggregate([
      { $match: query },
      { $group: { _id: "$type", count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]).toArray(),
    db.collection("events").aggregate([
      { $match: query },
      {
        $group: {
          _id: { $ifNull: ["$campaignId", "unattributed"] },
          campaignName: { $last: { $ifNull: ["$campaignName", "Без кампании"] } },
          totalEvents: { $sum: 1 },
          comments: { $sum: { $cond: [{ $eq: ["$type", "instagram_comment_received"] }, 1, 0] } },
          repliesSent: { $sum: { $cond: [{ $eq: ["$type", "meta_api_sent"] }, 1, 0] } },
          metaErrors: { $sum: { $cond: [{ $eq: ["$type", "meta_api_failed"] }, 1, 0] } },
          telegramStarts: { $sum: { $cond: [{ $eq: ["$type", "telegram_started"] }, 1, 0] } },
          subscribed: {
            $sum: { $cond: [{ $and: [{ $eq: ["$type", "telegram_subscription_checked"] }, { $eq: ["$subscribed", true] }] }, 1, 0] }
          },
          notSubscribed: {
            $sum: { $cond: [{ $and: [{ $eq: ["$type", "telegram_subscription_checked"] }, { $eq: ["$subscribed", false] }] }, 1, 0] }
          },
          landingClicks: { $sum: { $cond: [{ $eq: ["$type", "landing_clicked"] }, 1, 0] } }
        }
      },
      { $sort: { comments: -1, telegramStarts: -1, totalEvents: -1 } }
    ]).toArray(),
    db.collection("events")
      .find(query, { projection: { type: 1, createdAt: 1, label: 1, status: 1, subscribed: 1, commentId: 1, telegramId: 1, instagramUserId: 1, campaignId: 1, campaignName: 1, mediaId: 1 } })
      .sort({ createdAt: -1 })
      .limit(30)
      .toArray(),
    db.collection("events").distinct("type")
  ]);

  const funnel = metricsFromTypeCounts(byType);
  const subscriptionCounts = filters.eventType && filters.eventType !== "telegram_subscription_checked"
    ? []
    : await db.collection("events").aggregate([
      { $match: { ...query, type: "telegram_subscription_checked" } },
      { $group: { _id: "$subscribed", count: { $sum: 1 } } }
    ]).toArray();

  return {
    totalEvents,
    events24h,
    users: users.filter((value) => value !== null && value !== undefined && value !== "").length,
    instagramRecipients,
    byType: byType.map((item) => ({ type: item._id, count: item.count })),
    metrics: {
      ...funnel,
      subscribed: countType(subscriptionCounts, true),
      notSubscribed: countType(subscriptionCounts, false)
    },
    funnel,
    byCampaign: byCampaign.map((item) => ({
      campaignId: item._id,
      campaignName: item.campaignName,
      totalEvents: item.totalEvents,
      comments: item.comments,
      repliesSent: item.repliesSent,
      metaErrors: item.metaErrors,
      telegramStarts: item.telegramStarts,
      subscribed: item.subscribed,
      notSubscribed: item.notSubscribed,
      landingClicks: item.landingClicks
    })),
    availableEventTypes: availableEventTypes.filter(Boolean).sort(),
    recentEvents: recentEvents.map((event) => ({
      ...event,
      _id: String(event._id),
      createdAt: event.createdAt?.toISOString?.() || event.createdAt
    }))
  };
}

export async function clearStats(filters = {}) {
  const db = await getDb();
  if (!db) return 0;

  const result = await db.collection("events").deleteMany(statsQuery(filters));
  return result.deletedCount || 0;
}

function statsQuery(filters) {
  const query = {};
  if (filters.campaignId) query.campaignId = String(filters.campaignId);
  if (filters.mediaId) query.mediaId = String(filters.mediaId);
  if (filters.eventType) query.type = String(filters.eventType);

  const createdAt = {};
  const dateFrom = validDate(filters.dateFrom);
  const dateTo = validDate(filters.dateTo);
  if (dateFrom) createdAt.$gte = dateFrom;
  if (dateTo) createdAt.$lt = dateTo;
  if (Object.keys(createdAt).length) query.createdAt = createdAt;
  return query;
}

function validDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function mergeCreatedAt(query, range) {
  const existing = query.createdAt || {};
  const existingFrom = validDate(existing.$gte);
  const rangeFrom = validDate(range.$gte);
  return {
    ...query,
    createdAt: {
      ...existing,
      ...range,
      ...((existingFrom || rangeFrom) ? {
        $gte: new Date(Math.max(existingFrom?.getTime() || 0, rangeFrom?.getTime() || 0))
      } : {})
    }
  };
}

function metricsFromTypeCounts(byType) {
  return {
    comments: countType(byType, "instagram_comment_received"),
    repliesSent: countType(byType, "meta_api_sent"),
    metaErrors: countType(byType, "meta_api_failed"),
    telegramStarts: countType(byType, "telegram_started"),
    subscriptionChecks: countType(byType, "telegram_subscription_checked"),
    landingClicks: countType(byType, "landing_clicked")
  };
}

export async function saveMediaFile({ buffer, filename, contentType, metadata = {} }) {
  const db = await getDb();
  if (!db) return null;

  const bucket = new GridFSBucket(db, { bucketName: "media" });
  return new Promise((resolve, reject) => {
    const upload = bucket.openUploadStream(filename || "upload", {
      metadata: {
        ...metadata,
        contentType
      }
    });
    upload.on("error", reject);
    upload.on("finish", () => resolve(String(upload.id)));
    upload.end(buffer);
  });
}

export async function listMediaFiles(limit = 60) {
  const db = await getDb();
  if (!db) return [];

  await ensureIndexes(db);
  const files = await db.collection("media.files")
    .find({})
    .sort({ uploadDate: -1 })
    .limit(limit)
    .toArray();

  return files.map((file) => ({
    id: String(file._id),
    filename: file.filename || "media",
    contentType: mediaFileContentType(file),
    length: file.length || 0,
    uploadDate: file.uploadDate,
    metadata: file.metadata || {}
  }));
}

function mediaFileContentType(file) {
  const declaredType = String(
    file.contentType
      || file.metadata?.contentType
      || file.metadata?.originalContentType
      || ""
  ).trim().toLowerCase();

  if (declaredType && declaredType !== "application/octet-stream") {
    return declaredType;
  }

  const extension = String(file.filename || "")
    .toLowerCase()
    .split(".")
    .pop();
  const typesByExtension = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
    gif: "image/gif",
    heic: "image/heic",
    heif: "image/heif",
    mp4: "video/mp4",
    m4v: "video/x-m4v",
    mov: "video/quicktime",
    webm: "video/webm"
  };

  return typesByExtension[extension] || declaredType;
}

export async function getMediaFile(id) {
  const db = await getDb();
  const objectId = toObjectId(id);
  if (!db || !objectId) return null;

  const file = await db.collection("media.files").findOne({ _id: objectId });
  if (!file) return null;

  const bucket = new GridFSBucket(db, { bucketName: "media" });
  return {
    file,
    stream: bucket.openDownloadStream(objectId)
  };
}

function countType(items, type) {
  return items.find((item) => item._id === type)?.count || 0;
}

let indexesEnsured = false;

async function ensureIndexes(db) {
  if (indexesEnsured) return;

  await Promise.all([
    db.collection("processed_events").createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    db.collection("instagram_recipients").createIndex({ createdAt: -1 }),
    db.collection("instagram_recipients").createIndex({ campaignId: 1, instagramUserId: 1 }),
    db.collection("campaigns").createIndex({ status: 1, priority: -1, updatedAt: -1 }),
    db.collection("campaigns").createIndex({ status: 1, "telegram.startPayload": 1 }),
    db.collection("campaigns").createIndex({ status: 1, mediaIds: 1 }),
    db.collection("instagram_media").createIndex({ timestamp: -1, syncedAt: -1 }),
    db.collection("instagram_media").createIndex({ mediaType: 1 }),
    db.collection("media.files").createIndex({ uploadDate: -1 }),
    db.collection("events").createIndex({ createdAt: -1 }),
    db.collection("events").createIndex({ type: 1, createdAt: -1 }),
    db.collection("events").createIndex({ campaignId: 1, createdAt: -1 }),
    db.collection("events").createIndex({ campaignId: 1, mediaId: 1, type: 1, createdAt: -1 }),
    db.collection("consultation_leads").createIndex({ createdAt: -1 }),
    db.collection("consultation_leads").createIndex({ status: 1, createdAt: -1 }),
    db.collection("telegram_users").createIndex({ updatedAt: -1 })
  ]);

  indexesEnsured = true;
}
