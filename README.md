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

## Required RLS (Family Shared Library)
Enable RLS and allow all authenticated users to read/write the same library rows.

```sql
alter table public.books enable row level security;

-- remove old user-scoped policies
drop policy if exists "books_select_own" on public.books;
drop policy if exists "books_insert_own" on public.books;
drop policy if exists "books_update_own" on public.books;
drop policy if exists "books_delete_own" on public.books;

create policy "books_select_shared"
on public.books
for select
using (auth.role() = 'authenticated');

create policy "books_insert_shared"
on public.books
for insert
with check (auth.role() = 'authenticated');

create policy "books_update_shared"
on public.books
for update
using (auth.role() = 'authenticated')
with check (auth.role() = 'authenticated');

create policy "books_delete_shared"
on public.books
for delete
using (auth.role() = 'authenticated');
```

## Auth mode
The app uses Supabase Email Magic Link sign-in:
- User enters email and receives a sign-in link.
- After opening the link, session is restored and cloud books load.
- All signed-in users share one library and can read/write the same rows.

Required Supabase Auth settings:
- Enable provider: Email
- Enable magic links / OTP sign-in
- Add redirect URLs for each environment you use, for example:
  - GitHub Pages URL (your deployed site)
  - Local URL (for local testing)

Note: any authenticated user can edit shared data.

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

## Google Books lookup
The app tries direct Google Books lookup first, then falls back to the Supabase Edge Function if direct access fails.

Function source is in:
- `supabase/functions/google-books-lookup/index.ts`

Deploy steps:
1. Install and login to Supabase CLI.
2. Link project:
   - `supabase link --project-ref rzcpicnwtvwsspgdhgbb`
3. Deploy function:
   - `supabase functions deploy google-books-lookup --no-verify-jwt`
