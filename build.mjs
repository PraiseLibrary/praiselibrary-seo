// Praise Library — static, crawlable song pages for songs.praiselibrary.com
// Reads the public Supabase views the app already uses and writes plain HTML
// that search engines and AI crawlers can read without running JavaScript.
//
// Usage:
//   SUPABASE_URL=... SUPABASE_KEY=<publishable key> node build.mjs
//   node build.mjs --fixture test/fixture.json      (offline test)
// Output: ./dist

import { mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";

const SITE = "https://songs.praiselibrary.com";
const APP = "https://praiselibrary.com";
const OUT = "dist";
const TODAY = new Date().toISOString().slice(0, 10);

// ---------- data ----------
async function fetchAll(path) {
  const base = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_KEY;
  if (!base || !key) throw new Error("Set SUPABASE_URL and SUPABASE_KEY");
  const rows = [];
  for (let offset = 0; ; offset += 1000) {
    const sep = path.includes("?") ? "&" : "?";
    const res = await fetch(`${base}/rest/v1/${path}${sep}limit=1000&offset=${offset}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    });
    if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text()}`);
    const page = await res.json();
    rows.push(...page);
    if (page.length < 1000) return rows;
  }
}

async function loadData() {
  const i = process.argv.indexOf("--fixture");
  if (i > -1) return JSON.parse(await readFile(process.argv[i + 1], "utf8"));
  const [books, songs, song_books, resources] = await Promise.all([
    fetchAll("Books?select=id,title,short_name,description,publisher,publish_date,website,image_url&order=id"),
    fetchAll("v_songs_full?select=id,slug,title,alternate_title,first_line,year_written,description,composers,lyricists,themes,bible_references,copyright_notes&status=eq.published&order=id"),
    fetchAll("Song%20Books?select=song_id,book_id,song_number,page_number&order=id"),
    fetchAll("v_song_resources?select=song_id,resource_type,source,title,artist_name,channel_name,external_link,album_title,section_rank,type_rank,source_rank&order=resource_id"),
  ]);
  return { books, songs, song_books, resources };
}

// ---------- helpers ----------
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const list = (s) => String(s ?? "").split(",").map((x) => x.trim()).filter(Boolean);
const bookKey = (b) => String((b.short_name || "").trim() || b.title).trim().replace(/[^A-Za-z0-9]+/g, "-").toLowerCase();
const trim = (s, n) => (s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s);
const chapterOf = (ref) => ref.replace(/:.*$/, "").trim(); // "Psalm 23:1-4" -> "Psalm 23"
const refSlug = (ref) => ref.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const songUrl = (s) => `${SITE}/song/${s.slug}/`;
const appSongUrl = (s) => `${APP}/?view=detail&song=${s.id}`;

// Green Hymn Book songs are stored as "Hymn N": show the first line so the page has a real name.
function displayTitle(s) {
  if (/^Hymn \d+$/.test(s.title) && s.first_line) return s.first_line.replace(/[,;:.]+$/, "");
  return s.title;
}

const TYPE_LABEL = {
  "Official Recording": "Recordings", Video: "Videos", "Backing Track": "Backing tracks",
  "Piano Only Track": "Piano-only tracks", Instrumental: "Instrumentals", "Vocal Parts": "Vocal parts",
  "Sheet Music": "Sheet music", Lyrics: "Lyrics",
};

// ---------- layout ----------
const CSS = `
:root{--navy:#1f2a54;--gold:#c99a37;--paper:#faf6ee;--card:#f3ede0;--line:#d9d1bd;--ink:#1d1f2b;--muted:#5d5a52}
@media (prefers-color-scheme:dark){:root{--paper:#14161f;--card:#1a1d29;--line:#2c3042;--ink:#ece8de;--muted:#a9a596;--navy:#9fb0e8}}
*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:16px/1.6 Inter,system-ui,-apple-system,Segoe UI,sans-serif}
header,main,footer{max-width:820px;margin:0 auto;padding:0 20px}
header{display:flex;justify-content:space-between;align-items:center;padding-top:18px;padding-bottom:18px;border-bottom:1px solid var(--line)}
header a.brand{font:600 24px/1 "Cormorant Garamond",Georgia,serif;color:var(--navy);text-decoration:none}
h1,h2{font-family:"Cormorant Garamond",Georgia,serif;font-weight:600;color:var(--navy);line-height:1.2}
h1{font-size:34px;margin:28px 0 6px}h2{font-size:24px;margin:28px 0 8px}
a{color:var(--navy)}.muted{color:var(--muted)}.first-line{font-style:italic;font-size:18px}
.btn{display:inline-block;background:var(--gold);color:#1f2a54;font-weight:600;padding:10px 16px;border-radius:8px;text-decoration:none}
.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:14px 18px;margin:12px 0}
dl{display:grid;grid-template-columns:max-content 1fr;gap:6px 16px;margin:0}dt{color:var(--muted)}dd{margin:0}
ul.plain{list-style:none;padding:0;margin:0}ul.plain li{padding:6px 0;border-bottom:1px solid var(--line)}ul.plain li:last-child{border:0}
.num{display:inline-block;min-width:3em;color:var(--muted);font-variant-numeric:tabular-nums}
nav.crumbs{font-size:14px;margin-top:18px}footer{margin-top:40px;padding-top:18px;padding-bottom:40px;border-top:1px solid var(--line);font-size:14px;color:var(--muted)}
`;

function page({ path, title, description, body, jsonld = [], crumbs = [] }) {
  const url = SITE + path;
  const crumbHtml = crumbs.length
    ? `<nav class="crumbs" aria-label="Breadcrumb">${crumbs.map((c, i) => (i < crumbs.length - 1 ? `<a href="${esc(c.path)}">${esc(c.name)}</a> › ` : esc(c.name))).join("")}</nav>`
    : "";
  if (crumbs.length) {
    jsonld.push({
      "@context": "https://schema.org", "@type": "BreadcrumbList",
      itemListElement: crumbs.map((c, i) => ({ "@type": "ListItem", position: i + 1, name: c.name, item: SITE + c.path })),
    });
  }
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(url)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Praise Library">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(url)}">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@600&family=Inter:wght@400;600&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/style.css">
${jsonld.map((j) => `<script type="application/ld+json">${JSON.stringify(j).replace(/</g, "\\u003c")}</script>`).join("\n")}
</head>
<body>
<header><a class="brand" href="/">Praise Library</a><a class="btn" href="${APP}/">Open the app</a></header>
<main>
${crumbHtml}
${body}
</main>
<footer>
<p>Praise Library is a free, community-run library of Christadelphian song resources. It links to recordings, backing tracks, sheet music and lyrics hosted by their owners; it does not host audio. Contact: <a href="mailto:contact@praiselibrary.com">contact@praiselibrary.com</a> · <a href="${APP}/about">About</a></p>
</footer>
</body>
</html>`;
}

// ---------- build ----------
async function write(path, content) {
  const file = join(OUT, path.endsWith("/") ? path + "index.html" : path);
  await mkdir(join(file, ".."), { recursive: true });
  await writeFile(file, content);
}

const data = await loadData();

const books = data.books.map((b) => ({ ...b, key: bookKey(b) }));
const bookById = new Map(books.map((b) => [b.id, b]));
const songs = data.songs.map((s) => ({ ...s, name: displayTitle(s), books: [], resources: [], refs: list(s.bible_references) }));
const songById = new Map(songs.map((s) => [s.id, s]));

for (const sb of data.song_books) {
  const s = songById.get(sb.song_id), b = bookById.get(sb.book_id);
  if (s && b) s.books.push({ book: b, number: sb.song_number, page: sb.page_number });
}
for (const s of songs) s.books.sort((a, b) => a.book.id - b.book.id);
for (const r of data.resources) {
  const s = songById.get(r.song_id);
  if (s && r.external_link) s.resources.push(r);
}
for (const s of songs) s.resources.sort((a, b) => a.section_rank - b.section_rank || a.type_rank - b.type_rank || a.source_rank - b.source_rank);

// songs sharing each Bible chapter, for related links
const byChapter = new Map();
for (const s of songs) for (const ref of new Set(s.refs.map(chapterOf))) {
  if (!byChapter.has(ref)) byChapter.set(ref, []);
  byChapter.get(ref).push(s);
}

const bookLabel = (e) => `${e.book.title} #${e.number ?? "–"}${e.page ? ` (p. ${e.page})` : ""}`;
const songLine = (s) => `<a href="/song/${esc(s.slug)}/">${esc(s.name)}</a>${s.books[0] ? ` <span class="muted">· ${esc(s.books[0].book.short_name || s.books[0].book.title)} #${esc(s.books[0].number ?? "")}</span>` : ""}`;

await rm(OUT, { recursive: true, force: true });
await write("style.css", CSS.trim());

// Song pages
for (const s of songs) {
  const where = s.books.map(bookLabel).join("; ");
  const types = [...new Set(s.resources.map((r) => TYPE_LABEL[r.resource_type] || r.resource_type))];
  const description = trim(
    `${s.name}${where ? ` — ${s.books.map((e) => `${e.book.title} #${e.number}`).join(", ")}` : ""}.` +
      (s.first_line ? ` First line: “${s.first_line}”.` : "") +
      (s.refs.length ? ` Bible: ${s.refs.join(", ")}.` : "") +
      (types.length ? ` Free links to ${types.join(", ").toLowerCase()}.` : ""),
    300,
  );

  const groups = new Map();
  for (const r of s.resources) {
    const g = TYPE_LABEL[r.resource_type] || r.resource_type || "Other";
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(r);
  }
  const resHtml = [...groups].map(([g, rs]) => `<h3>${esc(g)}</h3><ul class="plain">${rs.map((r) => {
    const who = r.artist_name || r.channel_name;
    return `<li><a href="${esc(r.external_link)}" rel="noopener">${esc(r.title)}</a> <span class="muted">· ${esc(r.source)}${who ? ` · ${esc(who)}` : ""}${r.album_title ? ` · album “${esc(r.album_title)}”` : ""}</span></li>`;
  }).join("")}</ul>`).join("");

  const related = [];
  for (const ref of new Set(s.refs.map(chapterOf))) {
    const others = (byChapter.get(ref) || []).filter((o) => o.id !== s.id).slice(0, 8);
    if (others.length) related.push(`<h3>Other songs on ${esc(ref)}</h3><ul class="plain">${others.map((o) => `<li>${songLine(o)}</li>`).join("")}</ul>`);
  }

  const composers = list(s.composers), lyricists = list(s.lyricists);
  const recordings = s.resources.filter((r) => ["Official Recording", "Video"].includes(r.resource_type)).slice(0, 10);
  const jsonld = [{
    "@context": "https://schema.org", "@type": "MusicComposition",
    name: s.name, url: songUrl(s),
    ...(s.name !== s.title || s.alternate_title ? { alternateName: [s.name !== s.title ? s.title : null, s.alternate_title].filter(Boolean) } : {}),
    ...(composers.length ? { composer: composers.map((n) => ({ "@type": "Person", name: n })) } : {}),
    ...(lyricists.length ? { lyricist: lyricists.map((n) => ({ "@type": "Person", name: n })) } : {}),
    ...(s.year_written ? { dateCreated: String(s.year_written) } : {}),
    ...(s.description ? { description: s.description } : {}),
    ...(s.first_line ? { abstract: s.first_line } : {}),
    ...(s.refs.length ? { about: s.refs.map((r) => ({ "@type": "CreativeWork", name: `Bible: ${r}` })) } : {}),
    ...(s.themes ? { genre: list(s.themes) } : {}),
    ...(s.books.length ? { includedInDataCatalog: s.books.map((e) => ({ "@type": "Book", name: e.book.title, url: `${SITE}/books/${e.book.key}/` })) } : {}),
    ...(recordings.length ? { recordedAs: recordings.map((r) => ({ "@type": "MusicRecording", name: r.title, url: r.external_link, ...(r.artist_name || r.channel_name ? { byArtist: { "@type": "MusicGroup", name: r.artist_name || r.channel_name } } : {}) })) } : {}),
  }];

  const body = `
<h1>${esc(s.name)}</h1>
${s.first_line && s.name !== s.first_line.replace(/[,;:.]+$/, "") ? `<p class="first-line">“${esc(s.first_line)}”</p>` : ""}
${s.description ? `<p>${esc(s.description)}</p>` : ""}
<p><a class="btn" href="${esc(appSongUrl(s))}">Listen and play in Praise Library</a></p>
<div class="card"><dl>
${s.books.length ? `<dt>Song book</dt><dd>${s.books.map((e) => `<a href="/books/${esc(e.book.key)}/">${esc(e.book.title)}</a> #${esc(e.number ?? "–")}${e.page ? ` <span class="muted">(page ${esc(e.page)})</span>` : ""}`).join("<br>")}</dd>` : ""}
${composers.length ? `<dt>Composer</dt><dd>${esc(composers.join(", "))}</dd>` : ""}
${lyricists.length ? `<dt>Words</dt><dd>${esc(lyricists.join(", "))}</dd>` : ""}
${s.year_written ? `<dt>Written</dt><dd>${esc(s.year_written)}</dd>` : ""}
${s.refs.length ? `<dt>Bible references</dt><dd>${esc(s.refs.join(", "))}</dd>` : ""}
${s.themes ? `<dt>Themes</dt><dd>${esc(s.themes)}</dd>` : ""}
${types.length ? `<dt>Resources</dt><dd>${esc(types.join(", "))}</dd>` : ""}
</dl></div>
${s.resources.length ? `<h2>Where to find it</h2>${resHtml}` : ""}
${related.join("")}
${s.copyright_notes ? `<p class="muted">${esc(s.copyright_notes)}</p>` : ""}`;

  const crumbs = [{ name: "Praise Library", path: "/" }];
  if (s.books[0]) crumbs.push({ name: s.books[0].book.title, path: `/books/${s.books[0].book.key}/` });
  crumbs.push({ name: s.name, path: `/song/${s.slug}/` });

  const baseName = s.name.replace(/\s*\([^)]*\)$/, "");
  const bookBit = s.books[0] ? ` — ${s.books[0].book.title} ${s.books[0].book.id === 4 ? "Hymn " : "#"}${s.books[0].number}` : " — Christadelphian song";
  await write(`song/${s.slug}/`, page({ path: `/song/${s.slug}/`, title: `${baseName}${bookBit} | Praise Library`, description, body, jsonld, crumbs }));
}

// Book pages
for (const b of books) {
  const entries = songs.flatMap((s) => s.books.filter((e) => e.book.id === b.id).map((e) => ({ s, e })))
    .sort((x, y) => (x.e.number ?? 1e9) - (y.e.number ?? 1e9) || x.s.name.localeCompare(y.s.name));
  if (!entries.length) continue;
  const description = trim(`All ${entries.length} songs in the ${b.title}${b.publish_date ? ` (${b.publish_date})` : ""}, with song numbers, first lines, Bible references and free links to recordings, backing tracks, sheet music and lyrics.`, 300);
  const body = `
<h1>${esc(b.title)}</h1>
<p>${esc(b.description || `${b.title}${b.publisher ? `, published by ${b.publisher}` : ""}${b.publish_date ? ` in ${b.publish_date}` : ""}.`)}</p>
<p class="muted">${entries.length} songs${b.website ? ` · Publisher site: <a href="${esc(b.website.startsWith("http") ? b.website : "https://" + b.website)}" rel="noopener">${esc(b.website.replace(/^https?:\/\//, ""))}</a>` : ""}</p>
<p><a class="btn" href="${APP}/?view=book&amp;coll=${esc(b.key)}">Open this book in Praise Library</a></p>
<ul class="plain">${entries.map(({ s, e }) => `<li><span class="num">${esc(e.number ?? "")}</span><a href="/song/${esc(s.slug)}/">${esc(s.name)}</a>${s.first_line && s.first_line.replace(/[,;:.]+$/, "") !== s.name ? ` <span class="muted">— ${esc(trim(s.first_line, 60))}</span>` : ""}</li>`).join("")}</ul>`;
  const jsonld = [{ "@context": "https://schema.org", "@type": "Book", name: b.title, url: `${SITE}/books/${b.key}/`, ...(b.publisher ? { publisher: { "@type": "Organization", name: b.publisher } } : {}), ...(b.publish_date ? { datePublished: String(b.publish_date) } : {}) }];
  await write(`books/${b.key}/`, page({ path: `/books/${b.key}/`, title: `${b.title} — song list and resources | Praise Library`, description, body, jsonld, crumbs: [{ name: "Praise Library", path: "/" }, { name: b.title, path: `/books/${b.key}/` }] }));
}

// Bible chapter pages
const chapters = [...byChapter.keys()].sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
for (const ref of chapters) {
  const ss = byChapter.get(ref).sort((a, b) => a.name.localeCompare(b.name));
  await write(`bible/${refSlug(ref)}/`, page({
    path: `/bible/${refSlug(ref)}/`,
    title: `Songs based on ${ref} — Christadelphian hymns and songs | Praise Library`,
    description: trim(`${ss.length} Christadelphian hymn${ss.length > 1 ? "s and songs" : " or song"} based on ${ref}: ${ss.slice(0, 6).map((s) => s.name).join(", ")}${ss.length > 6 ? " and more" : ""}.`, 300),
    body: `<h1>Songs based on ${esc(ref)}</h1><p>${ss.length} song${ss.length > 1 ? "s" : ""} in the library draw on ${esc(ref)}.</p><ul class="plain">${ss.map((s) => `<li>${songLine(s)}</li>`).join("")}</ul><p><a href="/bible/">All Bible chapters</a></p>`,
    crumbs: [{ name: "Praise Library", path: "/" }, { name: "By Bible chapter", path: "/bible/" }, { name: ref, path: `/bible/${refSlug(ref)}/` }],
  }));
}
await write("bible/", page({
  path: "/bible/", title: "Christadelphian songs by Bible chapter | Praise Library",
  description: `Find Christadelphian hymns and songs by the Bible chapter they are based on — ${chapters.length} chapters covered.`,
  body: `<h1>Songs by Bible chapter</h1><ul class="plain">${chapters.map((r) => `<li><a href="/bible/${refSlug(r)}/">${esc(r)}</a> <span class="muted">· ${byChapter.get(r).length}</span></li>`).join("")}</ul>`,
  crumbs: [{ name: "Praise Library", path: "/" }, { name: "By Bible chapter", path: "/bible/" }],
}));

// A–Z
const az = [...songs].sort((a, b) => a.name.localeCompare(b.name));
await write("songs/", page({
  path: "/songs/", title: "All Christadelphian songs A–Z | Praise Library",
  description: `An A–Z list of all ${songs.length} songs and hymns in Praise Library, from the Green Hymn Book and the Purple, Orange and Blue Worship Books.`,
  body: `<h1>All songs A–Z</h1><p>${songs.length} songs.</p><ul class="plain">${az.map((s) => `<li>${songLine(s)}</li>`).join("")}</ul>`,
  crumbs: [{ name: "Praise Library", path: "/" }, { name: "All songs", path: "/songs/" }],
}));

// Home
const shown = books.filter((b) => songs.some((s) => s.books.some((e) => e.book.id === b.id)));
const resCount = songs.reduce((n, s) => n + s.resources.length, 0);
const faq = [
  ["What is Praise Library?", `Praise Library (praiselibrary.com) is a free online library of Christadelphian song resources. It lists ${songs.length} songs from the Green Hymn Book and the Purple, Orange and Blue Worship Books, with ${resCount.toLocaleString("en")} links to recordings, videos, backing tracks, piano-only tracks, sheet music and lyrics.`],
  ["Where can I find backing tracks for the Christadelphian Hymn Book?", "Each hymn page on Praise Library lists the backing tracks, piano accompaniments and recordings available for that hymn, with links to where they are hosted. Search or browse by hymn number at praiselibrary.com."],
  ["Is Praise Library free?", "Yes. Anyone can use it without an account. The site links to resources hosted by their owners on YouTube, Vimeo, Spotify, Bandcamp, Google Drive and other sites; it does not host audio itself."],
  ["Can I find songs by Bible passage?", "Yes. Every song lists the Bible chapters it draws on, and you can browse songs by Bible chapter — useful for choosing songs to match a reading or exhortation."],
  ["Who runs Praise Library?", "It is a community project for Christadelphian ecclesias, youth groups and families. Contact contact@praiselibrary.com to suggest a resource or report a problem."],
];
await write("index.html", page({
  path: "/", title: "Praise Library — Christadelphian hymns, worship songs and resources",
  description: `Free library of ${songs.length} Christadelphian hymns and worship songs — Green Hymn Book, Purple, Orange and Blue Worship Books — with recordings, backing tracks, sheet music, lyrics and Bible references.`,
  jsonld: [
    { "@context": "https://schema.org", "@type": "WebSite", name: "Praise Library", alternateName: "Christadelphian Song Resources", url: APP + "/", description: "A free library of Christadelphian song resources." },
    { "@context": "https://schema.org", "@type": "Organization", name: "Praise Library", url: APP + "/", email: "contact@praiselibrary.com" },
    { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: faq.map(([q, a]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })) },
  ],
  body: `
<h1>Christadelphian hymns, worship songs and resources</h1>
<p>Praise Library is a free library of Christadelphian song resources: ${songs.length} songs from the songbooks used in Christadelphian ecclesias, with ${resCount.toLocaleString("en")} links to recordings, videos, backing tracks, piano-only tracks, sheet music and lyrics. Every song lists its book number, page, composer and the Bible passages it draws on.</p>
<p><a class="btn" href="${APP}/">Open Praise Library</a></p>
<h2>Song books</h2>
<ul class="plain">${shown.map((b) => `<li><a href="/books/${esc(b.key)}/">${esc(b.title)}</a> <span class="muted">· ${songs.filter((s) => s.books.some((e) => e.book.id === b.id)).length} songs${b.publish_date ? ` · ${esc(b.publish_date)}` : ""}</span></li>`).join("")}</ul>
<h2>Browse</h2>
<ul class="plain"><li><a href="/songs/">All songs A–Z</a></li><li><a href="/bible/">Songs by Bible chapter</a></li></ul>
<h2>Questions</h2>
${faq.map(([q, a]) => `<h3>${esc(q)}</h3><p>${esc(a)}</p>`).join("")}`,
}));

// 404, robots, sitemap, llms.txt, CNAME
await write("404.html", page({ path: "/404.html", title: "Not found | Praise Library", description: "Page not found.", body: `<h1>Page not found</h1><p><a href="/">Back to Praise Library</a></p>` }));
await write("robots.txt", `User-agent: *\nAllow: /\n\nSitemap: ${SITE}/sitemap.xml\n`);
const urls = ["/", "/songs/", "/bible/", ...shown.map((b) => `/books/${b.key}/`), ...chapters.map((r) => `/bible/${refSlug(r)}/`), ...songs.map((s) => `/song/${s.slug}/`)];
await write("sitemap.xml", `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `<url><loc>${SITE}${u}</loc><lastmod>${TODAY}</lastmod></url>`).join("\n")}\n</urlset>\n`);
await write("llms.txt", `# Praise Library

> Praise Library (${APP}) is a free online library of Christadelphian song resources: ${songs.length} hymns and worship songs from the Green Hymn Book and the Purple, Orange and Blue Worship Books, with links to recordings, videos, backing tracks, piano-only tracks, sheet music and lyrics, and the Bible passages each song draws on. It links to resources hosted by their owners and does not host audio.

## Browse
- [All songs A–Z](${SITE}/songs/)
- [Songs by Bible chapter](${SITE}/bible/)
${shown.map((b) => `- [${b.title}](${SITE}/books/${b.key}/)`).join("\n")}

## The app
- [Praise Library app](${APP}/): search, filter by book, theme, Bible reference and resource type, and play recordings in a built-in player.
- Contact: contact@praiselibrary.com
`);
await write("CNAME", "songs.praiselibrary.com\n");

console.log(`Built ${songs.length} songs, ${shown.length} books, ${chapters.length} Bible chapters, ${urls.length} URLs in sitemap.`);
