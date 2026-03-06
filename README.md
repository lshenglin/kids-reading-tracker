# Kids Reading Tracker

Static GitHub Pages app (plain HTML/CSS/JS) for tracking finished books.

## Runtime stack
- Plain `index.html` + `styles.css` + `app.js`
- Supabase JS from CDN (`@supabase/supabase-js@2`)
- No framework, no build step

## Supabase config in app
`app.js` contains:
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`

Current values are already set in the file.

## Required Supabase table
Create `public.books`:

```sql
create table if not exists public.books (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  kid_name text not null,
  title text not null,
  author text,
  date_finished date not null,
  rating int,
  notes text,
  created_at timestamptz default now()
);
```

## Required RLS
Enable RLS and add user-scoped policies:

```sql
alter table public.books enable row level security;

create policy "books_select_own"
on public.books
for select
using (auth.uid() = user_id);

create policy "books_insert_own"
on public.books
for insert
with check (auth.uid() = user_id);

create policy "books_update_own"
on public.books
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "books_delete_own"
on public.books
for delete
using (auth.uid() = user_id);
```

## Auth mode
The app uses Supabase Email Magic Link sign-in:
- User enters email and receives a sign-in link.
- After opening the link, session is restored and cloud books load.
- All book rows remain scoped by `user_id` (`auth.uid()`).

Required Supabase Auth settings:
- Enable provider: Email
- Enable magic links / OTP sign-in
- Add redirect URLs for each environment you use, for example:
  - GitHub Pages URL (your deployed site)
  - Local URL (for local testing)

Note: users can access the same cloud books across devices/browsers by signing into the same email account.

## LocalStorage usage
LocalStorage is only used for:
- `kidsReadingTracker.view` (UI view preference)
- `kidsReadingTracker.migratedToCloud` (one-time migration flag)
- Optional read-only migration source: `kidsReadingTracker.v1`

## Local migration helper
If local legacy data exists under `kidsReadingTracker.v1` and migration flag is not set, the app shows:
- `Migrate local data to cloud`

Clicking it inserts valid local books to Supabase, sets migration flag, then reloads cloud data.

## GitHub Pages
Works on GitHub Pages with relative paths.

`index.html` script order:
1. Supabase CDN script
2. `./app.js`

## Reliable Google Books lookup (Edge Function proxy)
The app now calls a Supabase Edge Function first for title suggestions:
- Endpoint: `/functions/v1/google-books-lookup`
- This avoids browser/network blocks against direct Google API calls from GitHub Pages.

Function source is in:
- `supabase/functions/google-books-lookup/index.ts`

Deploy steps:
1. Install and login to Supabase CLI.
2. Link project:
   - `supabase link --project-ref rzcpicnwtvwsspgdhgbb`
3. Deploy function without JWT verification (app already sends anon key/session, but this keeps it publicly callable from Pages):
   - `supabase functions deploy google-books-lookup --no-verify-jwt`

Notes:
- The function performs server-side fetches to Google Books and returns `{ items: [...] }`.
- App fallback behavior: if function is unavailable, it tries direct Google API calls.