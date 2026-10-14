# Telegram Bot / Instagram Gate - журнал работ

Дата последнего обновления: 14 октября 2026.

## Что сделали в этом чате

### 1. Сформировали MVP-идею

- Решили делать легальный аналог ManyChat через официальные API:
  - Instagram / Meta Webhooks;
  - Instagram Messaging API;
  - Telegram Bot API;
  - проверка подписки через Telegram `getChatMember`.
- Зафиксировали основной сценарий:
  - пользователь комментирует Instagram post/Reels или пишет в Direct;
  - сервер получает webhook от Meta;
  - сервер отправляет ответ в Instagram Direct с кнопкой/ссылкой на Telegram-бота;
  - Telegram-бот проверяет подписку на канал;
  - если подписка есть, бот выдает ссылку на лендинг;
  - если подписки нет, бот не пропускает дальше.

### 2. Создали базовый Node.js проект

- Добавили `package.json`.
- Добавили `.gitignore`.
- Добавили `.env.example`.
- Добавили `README.md`.
- Добавили базовую конфигурацию в `data/config.json`.
- Сделали структуру:
  - `src/server.js`;
  - `src/config.js`;
  - `src/meta.js`;
  - `src/telegram.js`.

### 3. Реализовали Telegram-бота

- Добавили обработку `/start`.
- Добавили inline-кнопки:
  - подписаться на канал;
  - проверить подписку;
  - открыть лендинг.
- Добавили проверку подписки через Telegram `getChatMember`.
- Добавили выдачу лендинга только после успешной проверки.
- Добавили логи Telegram-событий:
  - получение update;
  - старт бота;
  - проверка подписки.

### 4. Реализовали Meta / Instagram webhook

- Добавили endpoint:
  - `/webhooks/meta`;
  - `/api/webhooks/meta`.
- Добавили Meta verification handshake:
  - `hub.mode`;
  - `hub.verify_token`;
  - `hub.challenge`.
- Добавили обработку Instagram comments.
- Добавили обработку Instagram Direct messages.
- Добавили обработку share/repost событий в Direct.
- Добавили поддержку `META_GRAPH_BASE_URL`, чтобы работать с Instagram Login API через:
  - `https://graph.instagram.com`;
  - при необходимости `https://graph.facebook.com`.
- Обновили отправку private reply на комментарий через:
  - `POST /me/messages`;
  - `recipient.comment_id`.

### 5. Подготовили проект под Vercel

- Добавили `vercel.json`.
- Добавили serverless endpoints:
  - `api/webhooks/meta.js`;
  - `api/webhooks/telegram.js`;
  - `api/ping.js`.
- Добавили rewrite:
  - `/webhooks/meta` -> `/api/webhooks/meta`;
  - `/webhooks/telegram` -> `/api/webhooks/telegram`.
- Добавили fallback-обработку этих маршрутов в `src/server.js`, потому что Vercel в проекте также запускал основной сервер.
- Добавили debug endpoint для Meta:
  - `/webhooks/meta?debug=1`.
- Добавили `/api/ping` для проверки, что deployment видит API routes.

### 6. Настроили Meta Webhooks

- Разобрали, куда вставлять:
  - Callback URL;
  - Verify token / подтверждение маркера.
- Подтвердили, что подписка Webhooks у Meta бесплатная.
- Выяснили, что реальные Instagram events не приходили в development mode.
- Перевели приложение Meta в live / working mode.
- Добавили страницы для требований Meta:
  - `/privacy`;
  - `/terms`.
- Зафиксировали, что test webhook проверяет только callback URL, а реальные events требуют live mode, permissions и роли/доступы.

### 7. Исправили дубли и петлю комментариев

- Нашли причину множества ответов под комментарием:
  - публичный reply сам создавал новый `comments` webhook.
- Отключили публичный ответ по умолчанию.
- Добавили отдельную галочку в админке:
  - "Публично отвечать под комментарием".
- Добавили пропуск reply-комментариев через `parent_id`.
- Добавили дедупликацию одного `comment_id` на 10 минут.

### 8. Перевели Telegram с polling на webhook

- Выяснили, что Vercel плохо подходит для бесконечного Telegram long polling.
- Добавили Telegram webhook:
  - `/webhooks/telegram`;
  - `/api/webhooks/telegram`.
- Добавили установку webhook:
  - `/telegram/set-webhook?password=...`.
- Добавили проверку webhook:
  - `/telegram/webhook-info?password=...`.
- Добавили `TELEGRAM_WEBHOOK_SECRET`.
- Отключили polling на Vercel.

### 9. Подключили MongoDB Atlas

- Добавили dependency:
  - `mongodb`.
- Добавили `src/db.js`.
- Подключили env:
  - `MONGODB_URI`;
  - `MONGODB_DB`.
- Сделали Mongo optional:
  - если `MONGODB_URI` есть, используем Atlas;
  - если нет, остается JSON/tmp fallback.
- Перенесли хранение настроек из Vercel `/tmp` в MongoDB.
- Добавили коллекции:
  - `config`;
  - `events`;
  - `telegram_users`;
  - `processed_events`;
  - `instagram_recipients`.

### 10. Добавили статистику

- Начали писать события в MongoDB:
  - `meta_webhook_received`;
  - `instagram_comment_received`;
  - `instagram_direct_message_received`;
  - `meta_api_sent`;
  - `meta_api_failed`;
  - `telegram_update_received`;
  - `telegram_started`;
  - `telegram_subscription_checked`;
  - `instagram_recipient_duplicate_skipped`.
- Добавили `/stats?password=...`.
- Сначала сделали JSON-статистику.
- Потом сделали полноценный dashboard:
  - общее число событий;
  - события за 24 часа;
  - Telegram users;
  - Instagram recipients;
  - воронка;
  - события по типам;
  - последние события.
- Добавили JSON-режим:
  - `/stats?password=...&format=json`.
- Перевели технические названия событий на нормальный язык для фронта:
  - `telegram_subscription_checked` -> "Проверка подписки в Telegram";
  - `instagram_comment_received` -> "Новый комментарий в Instagram";
  - `meta_api_sent` -> "Ответ отправлен через Meta";
  - и другие.

### 11. Добавили правило "один Instagram-пользователь - одно сообщение"

- Добавили коллекцию:
  - `instagram_recipients`.
- Сделали постоянную дедупликацию по Instagram user ID:
  - если пользователь уже получал automation-сообщение, повторно не отправляем.
- Сделали правило общим для комментариев и Direct:
  - если человек получил сообщение из комментария, Direct-событие ему второе сообщение не отправит.
- Дедуп фиксируется после успешной отправки, чтобы временная ошибка Meta не блокировала пользователя навсегда.

### 12. Улучшили админку

- Сначала сделали простую HTML-админку для редактирования:
  - лендинга;
  - Telegram-канала;
  - start payload;
  - ключевых слов;
  - Instagram-триггеров;
  - Direct-текста;
  - Telegram-текстов;
  - кнопок.
- Потом переделали дизайн в Liquid Glass style:
  - стеклянные панели;
  - responsive layout;
  - аккуратные секции;
  - toggles;
  - навигация на Stats и Telegram webhook.
- Исправили дефолтные triggers:
  - `directMessages: false`;
  - `shares: false`.
- Проверили, что отключенные Direct-события не включаются автоматически в коде.

### 13. Добавили страницы для Meta

- Добавили `/privacy`.
- Добавили `/terms`.
- Тексты описывают:
  - какие данные обрабатываются;
  - зачем они нужны;
  - как работает сервис;
  - ограничения ответственности;
  - контакты.

### 14. Добавили архитектурный документ по базе

- Создали `docs/DB_ARCHITECTURE.md`.
- Описали текущую MVP-схему:
  - `config`;
  - `events`;
  - `instagram_recipients`;
  - `telegram_users`.
- Описали будущую схему:
  - `app_settings`;
  - `message_templates`;
  - `campaigns`;
  - `events`;
  - `instagram_recipients`;
  - `telegram_users`.
- Зафиксировали план миграции текстов из одного `config.value` в отдельную коллекцию `message_templates`.

### 15. Добавили загрузку картинок для Telegram-приветствия

- Добавили dependency:
  - `busboy`.
- Добавили прием multipart form в админке.
- Добавили поле:
  - "Картинка приветствия".
- Добавили превью текущей картинки.
- Добавили удаление картинки через checkbox.
- Добавили хранение картинок в MongoDB GridFS:
  - `media.files`;
  - `media.chunks`.
- Добавили отдачу картинки по публичному URL:
  - `/media/:id`.
- Добавили отправку картинки в Telegram через `sendPhoto`, если картинка загружена.
- Если картинки нет, Telegram работает как раньше через `sendMessage`.
- Ограничили загрузку:
  - только `image/*`;
  - максимум 4 MB.

### 16. Добавили основу campaigns и campaign-scoped deduplication

- Добавили MongoDB helpers для коллекции:
  - `campaigns`.
- Добавили чтение активных кампаний с fallback на старый single-config:
  - если кампаний нет, код создает runtime `default` campaign из текущих настроек.
- Добавили выбор campaign для Instagram comments:
  - по `mediaId` поста/Reels;
  - по keywords;
  - пустой `mediaIds` работает как catch-all.
- Добавили выбор campaign для Instagram Direct/share:
  - по включенным trigger flags;
  - по keywords для Direct.
- Перевели deduplication Instagram recipients с глобального ключа на campaign-scoped ключ:
  - `instagram:{userId}:campaign:{campaignId}`.
- Добавили campaign context в события:
  - `campaignId`;
  - `campaignName`.
- Telegram оставили одним глобальным ботом:
  - campaign выбирается через `telegram.startPayload`;
  - `/start camp_...` сохраняет active campaign у Telegram user;
  - callback `check_subscription` использует сохраненную campaign для проверки канала и выдачи landing URL.
- Обновили `docs/DB_ARCHITECTURE.md` с фактической схемой `campaigns`.

### 17. Добавили отдельный UI для автоматизаций

- Добавили страницу:
  - `/admin/campaigns` — список автоматизаций.
- Добавили страницу:
  - `/admin/campaigns/new` — создание автоматизации.
- Добавили страницу:
  - `/admin/campaigns/:id` — редактирование автоматизации.
- В интерфейсе используем термин "Автоматизации", а в коде сохраняем техническую модель `campaigns`.
- Автоматизации сохраняются в `config.campaigns`, чтобы UI работал сразу без отдельной миграции коллекции.
- Добавили поля для:
  - status;
  - priority;
  - media IDs;
  - keywords;
  - triggers;
  - Instagram Direct text/button/image media ID;
  - Telegram channel;
  - Telegram start payload;
  - Telegram texts;
  - Telegram media IDs;
  - campaign landing URL.
- Зарезервировали страницы:
  - `/admin/posts` — будущий список Instagram постов/Reels;
  - `/admin/media` — будущая media library.

## Текущие важные env-переменные

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_BOT_USERNAME`
- `TELEGRAM_CHANNEL_USERNAME`
- `TELEGRAM_WEBHOOK_SECRET`
- `PUBLIC_BASE_URL`
- `ADMIN_PASSWORD`
- `META_VERIFY_TOKEN`
- `META_ACCESS_TOKEN`
- `META_API_VERSION`
- `META_GRAPH_BASE_URL`
- `MONGODB_URI`
- `MONGODB_DB`

## Важные URL

- `/admin`
- `/stats?password=...`
- `/stats?password=...&format=json`
- `/webhooks/meta`
- `/webhooks/telegram`
- `/telegram/set-webhook?password=...`
- `/telegram/webhook-info?password=...`
- `/privacy`
- `/terms`
- `/media/:id`

## Что осталось сделать позже

### Instagram token maintenance

- Track token expiration date: 2026-12-12 17:17 +05:00.
- Track data access expiration date: 2027-01-11 19:33 +05:00.
- Add an admin warning before expiration.
- Document the token refresh/re-generation process.

### Message templates architecture

- Move editable texts from `config.value` into `message_templates`.
- Keep backwards compatibility with current config.
- Add template versioning.
- Add locale support.
- Add campaign-specific template overrides.

### Campaigns

- Add campaign delete/archive action.
- Support campaign per specific post/Reels from synced Instagram posts.
- Support media IDs allowlist via picker instead of manual IDs.
- Add campaign-specific upload controls instead of manual media IDs.

### Better authentication

- Replace password-in-query admin auth with a safer session/cookie flow.
- Avoid putting admin password in URLs.
- Add logout.

### Productization

- Add OAuth / Instagram login flow for other users.
- Store connected Instagram accounts.
- Prepare Meta App Review materials.
- Add onboarding UI.
- Add account-level settings.

### Analytics improvements

- Add date filters.
- Add campaign filters.
- Add conversion rates.
- Add error dashboard.
- Add CSV export.

### Media improvements

- Add image compression/resizing.
- Add media library in admin.
- Add per-template images, not only welcome image.
- Add file deletion from GridFS when image is removed.
