# Free deployment setup

The free architecture is:

```text
GitHub Pages / Android APK -> Supabase Auth + Database
```

There is no Railway or Express backend in the browser path. Supabase stores accounts, habits, completion history, and friend requests.

## 1. Create Supabase tables

Run all of [supabase-schema.sql](supabase-schema.sql) in Supabase SQL Editor.

In Supabase Auth settings, disable **Confirm email**. This app uses username login by mapping each username to an internal synthetic email address.

## 2. Configure the public client key

Open **Project Settings -> API** in Supabase. Copy the public **anon/publishable key** into both:

- `api-config.js`
- `www/api-config.js`

Set:

```js
window.LOCKIN_SUPABASE_URL = 'https://your-project.supabase.co';
window.LOCKIN_SUPABASE_ANON_KEY = 'your-public-anon-key';
```

The anon key is intended for browser apps. Never put a `service_role` key in these files.

## 3. Enable GitHub Pages

The repository includes `.github/workflows/pages.yml`.

1. Open the GitHub repository settings.
2. Open **Pages**.
3. Set the source to **GitHub Actions**.
4. Push the configured public anon key to `main`.
5. GitHub Actions will publish the `www` folder.

The Pages URL will look like:

```text
https://kishoresbk247.github.io/lockin-system/
```

## 4. Build Android

After configuring the public anon key:

```text
npx cap sync android
cd android
gradlew.bat assembleDebug
```

The APK will be at:

```text
android/app/build/outputs/apk/debug/app-debug.apk
```

The APK contains the same Supabase-connected frontend, so different phones share the same cloud data.

## Limitations

This avoids monthly backend hosting, but free plans still have quotas and may pause inactive projects. For roughly 50 users, monitor Supabase usage and backups. No service can promise unlimited free hosting forever.
