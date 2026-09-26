# Supabase setup

The app uses the Express API as its trusted server boundary. The API stores all users, habits, completion history, and friendships in Supabase. Do not put `SUPABASE_SERVICE_ROLE_KEY` in the browser or Android app.

## 1. Create the database

1. Create a Supabase project.
2. Open **SQL Editor**.
3. Run all of [supabase-schema.sql](supabase-schema.sql).
4. Copy `.env.example` to `.env` and fill in `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and a long random `JWT_SECRET`.

The service-role key is only read by the Node server. RLS is enabled on the tables so direct public access is blocked.

## 2. Keep existing local data

Before removing `lockin.db`, run:

```text
npm run migrate:supabase
```

The migration is safe to rerun for the same IDs. After importing explicit IDs, run the sequence statements at the end of `supabase-schema.sql`.

## 3. Run the API

```text
npm start
```

For real users, deploy this Express server to a public HTTPS host. All phones and browsers must call that same API URL.

## 4. Build Android

Set the deployed API URL in both `api-config.js` and `www/api-config.js`:

```js
window.LOCKIN_API_BASE = 'https://your-api.example.com';
```

Then sync and build the Capacitor project:

```text
npx cap sync android
cd android
./gradlew assembleDebug
```

On Windows, use `gradlew.bat assembleDebug`. `localhost` inside an installed phone app means the phone itself, not your computer, so a public HTTPS API URL is required for shared access.
