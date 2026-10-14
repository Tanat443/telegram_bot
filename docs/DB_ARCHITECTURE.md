# MongoDB Architecture

This is the target data model for evolving the MVP into a small ManyChat-like product without turning the admin settings into one giant document forever.

## Current MVP

The app currently stores the full admin configuration in:

```text
config
```

Document:

```json
{
  "_id": "main",
  "value": {
    "landingUrl": "...",
    "telegram": {},
    "instagram": {},
    "telegramTexts": {}
  },
  "updatedAt": "..."
}
```

This is simple and safe for one account. It keeps the admin page fast and avoids migrations while the flow is still changing.

## Target Collections

### app_settings

Global settings for one workspace/account.

```json
{
  "_id": "main",
  "landingUrl": "https://www.partners.tatti-app.win",
  "telegram": {
    "botUsername": "my_bot",
    "channelUsername": "@test_tanat",
    "startPayload": "ig"
  },
  "instagram": {
    "accountId": "17841400079763059",
    "enabledTriggers": {
      "comments": true,
      "directMessages": false,
      "shares": false
    },
    "keywords": ["access", "start"]
  },
  "updatedAt": "..."
}
```

### message_templates

All editable texts from the admin page. This should eventually replace `telegramTexts` and `instagram.directMessage` inside the single config document.

Recommended IDs:

```text
instagram.direct.initial
instagram.comment.public_reply
telegram.start.welcome
telegram.subscription.not_subscribed
telegram.subscription.subscribed
button.instagram.open_telegram
button.telegram.check_subscription
button.telegram.open_channel
button.telegram.open_landing
```

Document:

```json
{
  "_id": "telegram.subscription.not_subscribed",
  "channel": "telegram",
  "purpose": "subscription_failed",
  "text": "Чтобы получить доступ, подпишитесь на канал, затем нажмите кнопку проверки.",
  "buttonText": null,
  "locale": "ru",
  "version": 1,
  "updatedAt": "..."
}
```

Why this is better later:

- texts can be versioned;
- each campaign can override only the texts it needs;
- app review examples and production copy can be separated;
- admin UI can show a dedicated "Messages" section.

### campaigns

Campaign model for specific posts/Reels/keywords. If this collection is empty, the app builds a backwards-compatible `default` campaign from `config.value`.

```json
{
  "_id": "reels_oct_14",
  "name": "Reels Oct 14",
  "instagramAccountId": "17841400079763059",
  "mediaIds": ["180..."],
  "keywords": ["хочу", "курс"],
  "instagram": {
    "enabledTriggers": {
      "comments": true,
      "directMessages": false,
      "shares": false
    },
    "publicReplyEnabled": false,
    "publicCommentReply": "Отправил(а) подробности в Direct.",
    "directMessage": {
      "text": "Салем! Нажмите кнопку ниже, чтобы получить доступ.",
      "buttonText": "Получить доступ"
    },
    "directMedia": {
      "imageId": ""
    }
  },
  "telegram": {
    "channelUsername": "@test_tanat",
    "startPayload": "camp_reels_oct_14"
  },
  "telegramTexts": {
    "welcome": "Салем! Сейчас проверю подписку на канал.",
    "notSubscribed": "Чтобы получить доступ, подпишитесь на канал, затем нажмите кнопку проверки.",
    "subscribed": "Готово! Вы подписаны. Вот ссылка:"
  },
  "telegramMedia": {
    "welcomePhoto1Id": "",
    "welcomeCircleVideoId": "",
    "welcomePhoto2Id": "",
    "subscribedPhotoId": ""
  },
  "landingUrl": "https://www.partners.tatti-app.win",
  "status": "active",
  "priority": 0,
  "createdAt": "...",
  "updatedAt": "..."
}
```

Runtime behavior:

- comment webhooks choose the first active campaign whose `mediaIds` contains the Instagram post/Reels media ID and whose `keywords` match the comment text;
- empty `mediaIds` means the campaign can match any post;
- empty `keywords` means every comment text matches;
- Direct/share events choose the first active campaign whose Direct/share trigger and keywords match;
- Instagram replies use one global Telegram bot, but campaign-specific `telegram.startPayload` routes the user into the right Telegram flow.

### events

Append-only analytics stream.

Examples:

```text
instagram_comment_received
meta_api_sent
meta_api_failed
telegram_started
telegram_subscription_checked
instagram_recipient_duplicate_skipped
```

### instagram_recipients

Campaign-scoped deduplication: one Instagram user receives the same campaign once, but can still receive a different campaign.

```json
{
  "_id": "instagram:123456789:campaign:reels_oct_14",
  "instagramUserId": "123456789",
  "campaignId": "reels_oct_14",
  "campaignName": "Reels Oct 14",
  "source": "comment",
  "firstCommentId": "178...",
  "mediaId": "180...",
  "createdAt": "..."
}
```

### telegram_users

Telegram-side users and subscription checks.

```json
{
  "_id": "123456789",
  "telegramId": 123456789,
  "username": "user",
  "activeCampaignId": "reels_oct_14",
  "activeCampaignName": "Reels Oct 14",
  "activeStartPayload": "camp_reels_oct_14",
  "lastSubscriptionStatus": true,
  "channelUsername": "@test_tanat",
  "createdAt": "...",
  "updatedAt": "..."
}
```

## Migration Plan

1. Keep `config` as the compatibility source.
2. Add read/write helpers for `message_templates`.
3. On admin save, write both `config` and `message_templates`.
4. Once stable, read texts from `message_templates` and keep `config` only for global settings.
5. Add `campaigns` when multiple posts/Reels or multiple funnels are needed.

## Media Storage

Uploaded admin images are stored in MongoDB GridFS using the `media` bucket:

```text
media.files
media.chunks
```

The current MVP stores the Telegram welcome image ID in:

```json
{
  "config.value.telegramMedia": {
    "welcomeImageId": "..."
  }
}
```

The app serves images through:

```text
/media/:id
```

Telegram receives this public URL in `sendPhoto`. This keeps Vercel stateless and avoids storing uploaded files on its read-only filesystem.
