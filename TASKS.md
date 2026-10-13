# Tasks

## Later

- Add persistent storage with MongoDB Atlas Free.
  - Store admin settings outside Vercel `/tmp`.
  - Store processed Instagram comment IDs to prevent duplicates across cold starts.
  - Store Telegram users and subscription check results.
  - Store funnel events for analytics.

- Add Instagram token maintenance.
  - Track token expiration date: 2026-12-12 17:17 +05:00.
  - Track data access expiration date: 2027-01-11 19:33 +05:00.
  - Add a reminder or admin warning before expiration.
  - Document the token refresh/re-generation process.
