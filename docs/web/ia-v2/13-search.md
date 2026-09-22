# 13 — Search

Global `/search` + ⌘K palette on both public sites and docs. §14.

## Index
Built on publish: products, solutions, platform, docs, blog, academy, support, use
cases, API reference. Content type / product / category filters.

## Engine
Start with **Postgres full-text search** in the CMS DB (weighted title > headings >
body), exposed via a cached route handler. Add **semantic search (pgvector)** only
if the Postgres instance supports the extension — otherwise log the decision in
`DECISIONS.md` and ship FTS only.

## Analytics
Support search queries logged (anonymous) for the "support searches" metric
(`14-analytics.md`). Never displayed publicly.

## UX
⌘K palette: recent, top results grouped by type, keyboard nav, `Esc` closes.
`/search` full page: query, filters, paginated results, empty state.
