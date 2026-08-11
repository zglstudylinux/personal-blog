# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A reading-first personal blog for an embedded developer. Pure static site: HTML + CSS + vanilla JS, zero dependencies, zero build step, zero bundler. Content is authored in Markdown and rendered client-side by a hand-rolled parser. Deploy target is GitHub Pages or EdgeOne Pages (static, no build command).

## Serving locally (mandatory)

Pages load Markdown via `fetch()`, so they **must** be opened through an HTTP server — opening `index.html` directly via `file://` silently fails (articles/about won't load, CORS blocks fetch on local files).

```powershell
python -m http.server 8000   # then visit http://localhost:8000
# or
npx serve
```

There is no build, lint, or test step. "Verifying a change" means: serve, then click through index → article → about in a browser.

## Architecture

### Three pages, each a distinct script combination

- `index.html` — article list. Scripts: config → posts → markdown → theme → main → **list**
- `post.html` — article detail. Scripts: config → posts → markdown → theme → main → **post**
- `about.html` — about page. Scripts: config → markdown → theme → main → **about** (deliberately omits `posts.js` — the about page doesn't need the registry)

Script load order is a real dependency chain, not cosmetic: `config.js` sets `window.SITE_CONFIG`, `posts.js` sets `window.POSTS`, `markdown.js` sets `window.SimpleMarkdown`; the page-specific script (list/post/about) consumes whichever of those it needs. Reordering or removing a script tag will break the page.

### Content management: the registry, not frontmatter

There is **no frontmatter and no file-walking**. `js/posts.js` is the single source of truth — a hand-maintained `window.POSTS` array. To add an article: drop a `.md` in `posts/`, then add an entry to `POSTS` with `slug` (matches filename), `title`, `date` (YYYY-MM-DD), `excerpt`, `tags`, and optional `file` (defaults to `posts/<slug>.md`). An unregistered `.md` file is invisible to the site.

The one exception is `posts/about.md` — it is fetched directly by `about.js` (fixed path `"posts/about.md"`), never goes through the `POSTS` registry.

### Routing

- Articles: `post.html?p=<slug>` — `post.js` reads `URLSearchParams`, finds the entry in `POSTS` by `slug`, fetches its markdown, renders into `#postBody`. Unknown slug → inline error. `prev/next` nav is computed from registry index.
- About: static `about.html`, fetches fixed `posts/about.md`.

### Markdown rendering (`js/markdown.js`)

`window.SimpleMarkdown.render(md)` — a zero-dependency parser covering headings, paragraphs, bold/italic/strike, inline code, fenced code blocks, blockquotes, ordered/unordered lists, tables, hr, links, images. Input is HTML-escaped (XSS-safe).

**Subtle invariant:** the `inline(s, codes)` helper extracts inline-code spans into a placeholder table (`" «index» "`), processes other formatting, then restores them. The `codes` array is passed **by parameter** through recursive calls (link text can itself contain inline code, e.g. `` `[`js/posts.js`](../js/posts.js) ``). Every recursive `inline()` call inside `inline()` must pass the same `codes` array — if a recursive call creates its own `codes`, outer placeholders are never restored and `render()` throws `Cannot read properties of undefined (reading 'replace')`. This was a real bug that broke the about page. Don't "simplify" `inline()` back to a local `codes`.

### Theming (no FOUC)

Each HTML page has an inline `<head>` script that reads `localStorage.theme` (falling back to `prefers-color-scheme`) and sets `data-theme` on `<html>` **before paint**. `theme.js` only binds the toggle button and persists changes. All colors are CSS custom properties scoped under `[data-theme="dark"]` / `[data-theme="light"]` in `css/style.css`. `prefers-reduced-motion` is respected (disables smooth scroll / transitions).

## Design constraints (locked, do not drift)

These come from the `taste-skill` design directives the site was built under (in `.claude/skills/`, git-ignored). They are part of the site's identity, not arbitrary preferences:

- **Single accent color, locked across the whole site.** Dark `#6cb6ff`, light `#0b6bcb` — a cold blue chosen deliberately *against* the AI-purple default. Don't introduce a second accent (no teal badges, no green status chips). Edit `--accent` in `css/style.css` to change it site-wide.
- **Shape consistency lock:** one corner-radius scale (`--radius` / `--radius-sm`). Don't mix pill buttons with sharp cards.
- **Reading-first editorial tone** — technical feel comes from typography and restraint, not effects. Em-dashes are banned in copy; use them sparingly or not at all. Keep motion minimal.
- Fonts: sans stack (`--font-sans`) for UI/body, mono (`--font-mono`) for code. Serif is available (`--font-serif`) but not used by default — don't reach for it.

## Paths and deployment

All asset paths in HTML are relative to site root (`css/...`, `js/...`, `posts/...`, `assets/...`). Note: `posts/about.md` contains `../`-prefixed links (e.g. `[css/style.css](../css/style.css)`) which resolve relative to `about.html` at root — they work at root deployment. If deploying under a subpath on GitHub Pages, these and the `?p=` links may need adjusting (no `<base>` tag is currently used).

GitHub Pages: Settings → Pages → Source = `Deploy from a branch`, branch `main`, folder `/` (root). No `.nojekyll` needed (no underscore files). EdgeOne Pages: build command empty, output dir `.`.

## Git / remote

- Remote: `git@github.com:zglstudylinux/personal-blog.git` (branch `main`, tracks `origin/main`).
- `.gitignore` excludes `.claude/` (local skill/tool files) and `taste-skill/` (the cloned skill repo with its own `.git` — a nested repo that must not be committed). `node_modules/`, IDE files, OS thumbnails also ignored.
- The repo was initialized onto an existing remote that already had an `Initial commit` (MIT LICENSE, author `zgl_Embedded`). Local history is linear: `0e33d67 Initial commit → <blog commit>`. That LICENSE is preserved — don't overwrite or remove it.
- Line endings: files are LF in the repo; git warns about LF→CRLF on Windows checkout (harmless, `core.autocrlf` default behavior).

## Editing checklist

- Changing site name/description/author/default theme → `js/config.js`.
- Adding/removing/reordering articles → `js/posts.js` (and the `.md` file in `posts/`).
- About page content → `posts/about.md`.
- Colors, spacing, fonts, components → CSS variables at the top of `css/style.css`; one accent, locked.
- After any JS/markdown change: serve via HTTP and click all three pages (list, an article, about) before considering it done — `file://` will hide regressions.
