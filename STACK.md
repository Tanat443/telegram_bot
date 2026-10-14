# Project Stack and Architecture

This project is an Instagram-to-Telegram funnel automation app. It reacts to Instagram activity, sends prepared replies, moves users into a Telegram bot, checks Telegram channel subscription, and then gives access to a landing page.

## Main Stack

- Runtime: Node.js 20+
- Module system: native ES modules (`"type": "module"`)
- Backend server: native `node:http`, no Express
- Hosting: Vercel serverless deployment
- Database: MongoDB Atlas
- Media storage: MongoDB GridFS
- Frontend: plain HTML, CSS, and vanilla JavaScript rendered from the Node server
- Form upload parser: `busboy`
- Instagram integration: Meta / Instagram Graph API and Webhooks
- Telegram integration: Telegram Bot API and Telegram Webhooks
- Deployment flow: GitHub repository connected to Vercel
- Configuration: Vercel environment variables plus MongoDB-stored admin config

## Core Dependencies

- `mongodb`: connects to MongoDB Atlas, stores app config, events, users, deduplication records, and GridFS media files.
- `busboy`: parses admin `multipart/form-data` uploads for images and videos.

## Important Files

- `src/server.js`: main HTTP server, routes, admin UI, stats UI, media upload, media serving, privacy page, terms page, webhook routing.
- `src/config.js`: reads default config, MongoDB config, runtime config, and environment variable overrides.
- `src/db.js`: MongoDB connection, collections, event logging, user records, deduplication, GridFS media save/read.
- `src/meta.js`: Instagram / Meta webhook handling and Graph API calls.
- `src/telegram.js`: Telegram bot logic, `/start`, subscription checks, media messages, inline buttons.
- `api/webhooks/meta.js`: Vercel serverless entry for Meta webhook.
- `api/webhooks/telegram.js`: Vercel serverless entry for Telegram webhook.
- `api/ping.js`: Vercel ping/health style endpoint.
- `data/config.json`: local/default fallback config.
- `docs/DB_ARCHITECTURE.md`: database structure notes.
- `TASKS.md`: chronological implementation notes from development.

## External Services

- Meta Developers app:
  - Instagram webhook callback URL points to `/webhooks/meta`.
  - Verify token comes from `META_VERIFY_TOKEN`.
  - Uses Instagram permissions for comments and messages.

- Telegram Bot API:
  - Bot token is stored in `TELEGRAM_BOT_TOKEN`.
  - Webhook points to `/webhooks/telegram`.
  - Bot must be admin in the target channel to check subscription status.

- MongoDB Atlas:
  - Connection string is stored in `MONGODB_URI`.
  - Database name can be set with `MONGODB_DB`.
  - Stores persistent config and media so Vercel's read-only filesystem is not used for runtime data.

- Vercel:
  - Hosts the app and webhook endpoints.
  - Stores all secrets and runtime environment variables.
  - Redeploys from GitHub pushes.

## Environment Variables

Required or commonly used variables:

- `TELEGRAM_BOT_TOKEN`: Telegram bot token.
- `TELEGRAM_BOT_USERNAME`: Telegram bot username.
- `TELEGRAM_WEBHOOK_SECRET`: optional Telegram webhook secret header.
- `META_ACCESS_TOKEN`: Instagram / Meta access token.
- `META_VERIFY_TOKEN`: webhook verification token used by Meta.
- `META_API_VERSION`: Graph API version, for example `v26.0`.
- `META_GRAPH_BASE_URL`: usually `https://graph.instagram.com`.
- `PUBLIC_BASE_URL`: public Vercel URL, for example `https://telegram-bot-mu-beige.vercel.app`.
- `ADMIN_PASSWORD`: password for `/admin` and `/stats`.
- `MONGODB_URI`: MongoDB Atlas connection string.
- `MONGODB_DB`: optional database name.
- `LANDING_URL`: landing page URL override.
- `TELEGRAM_CHANNEL_USERNAME`: channel username override.

## Database Collections

- `config`: stores the main editable admin configuration under `_id: "main"`.
- `events`: stores analytics events for stats.
- `telegram_users`: stores Telegram users and subscription-related data.
- `instagram_recipients`: prevents sending the Instagram greeting more than once to the same recipient.
- `processed_events`: deduplicates webhook events for a limited time.
- `campaigns`: stores active automation rules for specific Instagram posts/Reels, keywords, campaign-specific copy, Telegram start payloads, and landing URLs.
- `media.files` and `media.chunks`: MongoDB GridFS collections for uploaded images/videos.

## Media Flow

Admin uploads images and videos from `/admin`.

Images and videos are saved to MongoDB GridFS, not to the Vercel filesystem. The app serves them through:

```text
/media/:id
```

Debug information for a media file is available through:

```text
/media/:id?info=1
```

Admin config stores only media IDs, for example:

- `instagram.directMedia.imageId`
- `telegramMedia.welcomePhoto1Id`
- `telegramMedia.welcomeCircleVideoId`
- `telegramMedia.welcomePhoto2Id`
- `telegramMedia.subscribedPhotoId`

## Main User Flow

1. A user comments, sends a message, or triggers a configured Instagram event.
2. Meta sends the event to the app webhook.
3. The app selects the matching active campaign by Instagram media ID and keywords.
4. The app checks campaign-scoped deduplication for that Instagram user.
5. The app replies in Instagram with campaign-specific text and a Telegram bot link/button.
6. User opens Telegram bot and sends `/start` with the campaign payload.
7. Telegram bot stores the active campaign and sends the configured welcome sequence:
   - photo + welcome text;
   - Telegram video note;
   - photo + subscription instruction text + buttons.
8. User clicks the subscription button and then `Жазылдым`.
9. Bot checks whether the user is subscribed to the campaign's configured Telegram channel.
10. If subscribed, bot sends final photo/text/button with the campaign landing page URL.
11. If not subscribed, bot keeps the user blocked before the landing page.

## Admin and Stats

- `/admin`: editable admin panel for texts, trigger toggles, buttons, landing URL, channel username, and media uploads.
- `/admin/campaigns`: list of automation campaigns.
- `/admin/campaigns/new`: create an automation campaign.
- `/admin/campaigns/:id`: edit an automation campaign.
- `/admin/posts`: reserved page for synced Instagram posts/Reels.
- `/admin/media`: reserved page for the GridFS media library.
- `/stats`: dashboard for funnel analytics and recent events.
- `/admin/media-debug`: debug endpoint showing currently configured media IDs.
- `/health`: environment and service health information.

## Design Direction

The admin UI and stats UI are built with plain HTML/CSS. The visual style is a modern Liquid Glass style: translucent panels, soft borders, blur, clean spacing, and dashboard-like layout.

## Verification Command

Use this command after code changes:

```bash
npm run check
```

It validates JavaScript syntax for the main server and Vercel API entry files.
