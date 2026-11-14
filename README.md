# songs.praiselibrary.com

Plain-HTML copy of the Praise Library song catalogue, so Google, Bing and AI crawlers (GPTBot, ClaudeBot, PerplexityBot), which don't run the Bubble app's JavaScript, can read every song. Each page links back into the app.

`build.mjs` reads the same public Supabase views the app uses (`Books`, `v_songs_full`, `Song Books`, `v_song_resources`), approved resources only, with no counts or lyrics, and writes `dist/`:

- `/song/<slug>/`: one page per song (book and number, page, first line, composer, Bible references, themes, resource links, related songs, schema.org `MusicComposition`)
- `/books/<key>/`: song list per book
- `/bible/<chapter>/`: songs by Bible chapter
- `/songs/`: A–Z list
- `/`: home page with FAQ, `sitemap.xml`, `robots.txt`, `llms.txt`, `CNAME`

GitHub Actions rebuilds it every morning and on every push. Run it by hand from **Actions → Build and publish → Run workflow**.

## One-time setup
1. In the repo: **Settings → Secrets and variables → Actions → New repository secret**, named `SUPABASE_KEY`, set to the Supabase publishable key (`sb_publishable_…`).
2. **Settings → Pages → Source: GitHub Actions.**
3. Porkbun DNS: add a `CNAME` record with host `songs`, pointing to `<your-github-username>.github.io`.
4. **Settings → Pages → Custom domain:** `songs.praiselibrary.com`, then tick **Enforce HTTPS** once the certificate is issued.
5. Google Search Console: add a **Domain** property for `praiselibrary.com` (DNS TXT record at Porkbun) and submit `https://songs.praiselibrary.com/sitemap.xml`. Do the same in Bing Webmaster Tools, which can import from Search Console.

## Local test
`node build.mjs --fixture test/fixture.json`
