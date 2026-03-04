# Kids Reading Tracker

Static GitHub Pages app (plain HTML/CSS/JS) to track finished books for two kids: Isa and Josh.

## Features (V1)
- Tabs: Isa / Josh / All
- Add finished books (kid + title required; author, rating, notes optional)
- Date finished defaults to today
- List sorted by newest finished date first
- Edit and delete entries
- Stats for selected tab: total books + books finished this year
- Seeds 4 sample books on first load
- Data stored in `localStorage` key: `kidsReadingTracker.v1`

## Run locally
Open `index.html` in a browser.

## Deploy to GitHub Pages
1. Push these files to your repository.
2. In GitHub: **Settings > Pages**.
3. Set source to your branch (for example `main`) and `/ (root)`.
4. Save and open the published URL.

This app uses only relative paths (`./styles.css`, `./app.js`) so it works on GitHub Pages.
