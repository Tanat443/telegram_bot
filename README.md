# Instagram -> Telegram gate

MVP аналога ManyChat для одного Instagram-аккаунта:

- ловит события Meta Webhooks по комментариям и Direct;
- отправляет подготовленный ответ в Instagram с кнопкой в Telegram;
- Telegram-бот проверяет подписку на канал;
- после успешной проверки отдает ссылку на лендинг;
- тексты и кнопки меняются через локальную страницу `/admin`.

## Важно про секреты

Токен Telegram-бота уже был отправлен в чат. Лучше перевыпустить его в BotFather:

`/revoke` или `API Token -> Revoke current token`

Новый токен положите в `.env`, не в код.

## Запуск

1. Скопируйте `.env.example` в `.env`.
2. Заполните `TELEGRAM_BOT_TOKEN`, `ADMIN_PASSWORD`, `META_VERIFY_TOKEN`, `META_ACCESS_TOKEN`.
   Если токен с экрана "API для входа в Instagram", оставьте `META_GRAPH_BASE_URL=https://graph.instagram.com`.
   Если используете старый Instagram API with Facebook Login/Page token, поставьте `META_GRAPH_BASE_URL=https://graph.facebook.com`.
3. Запустите:

```bash
npm start
```

Админка: `http://localhost:3000/admin`

## Meta webhook

В Meta Developers укажите callback:

`https://your-public-domain.example/webhooks/meta`

Verify token должен совпадать с `META_VERIFY_TOKEN`.

Для локального теста нужен публичный HTTPS URL, например ngrok/cloudflared, и этот URL надо указать в `PUBLIC_BASE_URL`.

## Vercel

Для Vercel укажите переменные окружения в Project Settings -> Environment Variables:

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_BOT_USERNAME`
- `TELEGRAM_CHANNEL_USERNAME`
- `META_VERIFY_TOKEN`
- `META_ACCESS_TOKEN`
- `META_API_VERSION`
- `META_GRAPH_BASE_URL`

После деплоя callback для Meta будет:

`https://your-vercel-project.vercel.app/webhooks/meta`

Значение поля "Подтверждение маркера" в Meta должно быть ровно таким же, как `META_VERIFY_TOKEN` в Vercel.

## Telegram

Бот должен быть админом канала `@test_tanat`, иначе Telegram не даст проверить статус подписки через `getChatMember`.

Пользователь из Instagram попадет в Telegram по ссылке вида:

`https://t.me/<bot_username>?start=ig`

## Что пока не включено

- полноценная база данных;
- несколько Instagram-аккаунтов;
- визуальный flow-builder;
- аналитика в UI.

Для MVP события пишутся в консоль, а основные настройки лежат в `data/config.json`.
