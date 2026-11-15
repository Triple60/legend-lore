# Legend Lore

A shared, live-updating graph for keeping track of a tabletop RPG campaign:
places, people, objects, lore, and how they all connect.

Built with SvelteKit and Cytoscape.js, hosted on GitHub Pages, with Supabase
for data, login and live updates. See [DESIGN.md](DESIGN.md) for the
decisions behind it.

## One-time setup

### 1. Supabase project

1. Create a free project at [supabase.com](https://supabase.com).
2. In **SQL Editor**, paste and run
   `supabase/migrations/20261114000000_init.sql`.
3. Click **Connect** at the top of the dashboard (or open **Project Settings →
   Data API** and **API Keys**) and note:
   - the **Project URL**, `https://<project-ref>.supabase.co`;
   - the **Publishable key**, `sb_publishable_…`. The legacy anon key also
     works.
4. In **Authentication → URL Configuration**:
   - Site URL: `https://<your-github-user>.github.io/legend-lore/`
   - Redirect URLs: add `https://<your-github-user>.github.io/legend-lore/**`
     and `http://localhost:5173/**`

### 2. Discord login

1. At the [Discord developer portal](https://discord.com/developers/applications),
   create an application. Under **OAuth2**, add the redirect
   `https://<project-ref>.supabase.co/auth/v1/callback`.
2. In Supabase, **Authentication → Providers → Discord**: enable it and paste
   the Discord client ID and secret.

### 3. Email codes (optional)

Email login is hidden unless the `PUBLIC_EMAIL_LOGIN` variable is `true`. To
turn it on:

1. **Authentication → Emails → Templates → Magic Link**: include
   `{{ .Token }}` in the body so the email contains a code, e.g.
   `Your Legend Lore code is {{ .Token }}`.
2. **Authentication → Emails → SMTP Settings**: configure a free SMTP provider
   (e.g. Resend or Brevo). Supabase's built-in sender is for testing only.
3. Add a GitHub repository variable `PUBLIC_EMAIL_LOGIN` = `true`.

### 4. GitHub

1. **Settings → Pages → Build and deployment → Source**: *GitHub Actions*.
   Ignore the suggested Jekyll / Static HTML starter workflows: this repo
   already has its own in `.github/workflows/deploy.yml`.
2. **Settings → Secrets and variables → Actions → Variables → Repository
   variables**, add:
   - `PUBLIC_SUPABASE_URL`: the Project URL
   - `PUBLIC_SUPABASE_ANON_KEY`: the publishable key

   These are public values, so they go under *Variables*, not *Secrets*. Use
   repository variables, not environment variables: the build job doesn't run
   in an environment, so it can't see environment variables.
3. Push to `main`. The **Deploy to GitHub Pages** workflow builds and
   publishes the site. **Keep Supabase awake** runs every three days.

### Branch previews

Every branch also gets a demo build at
`https://<user>.github.io/<repo>/preview/<branch>/` (slashes in the branch
name become dashes), and `/preview/` lists them all. Previews don't use
Supabase: they load a sample campaign into memory, so anything you change
lasts until you reload the page. Nothing to set up; the deploy workflow
rebuilds the previews after the **Test** workflow finishes on any branch, and
drops a branch's preview once the branch is deleted. Branches from before demo
mode existed are skipped.

Previews share the real app's web address (`<user>.github.io`), so their code
could read what the real app keeps in the browser, including the login
session. Only people who can push branches to this repository can publish a
preview, so treat pushing a branch with the same care as merging to `main`.

## Using the map

- **Add a node:** right-click empty space on the map (long-press on a touch
  screen). **New node here** is the first item in the menu, right under the
  pointer, so a right-click then a left-click opens the quick-add pop-up. The
  node is placed where you clicked. **+ New node** or `N` opens the pop-up in
  the middle of the map instead.
- The pop-up asks for a name, type and tags. **Open in side panel** moves what
  you've typed into the full form, with aliases, session and notes.
- **Connect nodes:** select a node, then Shift+click another to draw a
  connection from the first to the second. Type its annotation in the box that
  appears on the new connection, or click any unlabelled connection to label it.
- **Panels** float on the left. A node's panel opens on top of the Campaign
  panel. The Campaign panel collapses with **«** (it starts collapsed on
  phones); the choice is remembered per browser.

## Keyboard shortcuts

On the campaign page, when you aren't typing in a field:

| Key | Does |
|---|---|
| `/` | Focus the search box |
| `N` | Open the quick-add pop-up, with the cursor in Name |
| `Esc` | Close the menu, pop-up or panel, or clear the search |

They can be turned off under **Keyboard shortcuts** in the Campaign panel
(remembered per browser), as recommended for single-key shortcuts by WCAG
2.1.4.

## Local development

```bash
npm install
```

```bash
cp .env.example .env   # then fill in the two values
```

```bash
npm run dev
```

`npm run check` type-checks; `npm run build` produces the static site in
`build/`.

To try the UI without Supabase, run it in demo mode, with the same sample
campaign as the branch previews. Set `PUBLIC_DEMO=true` in `.env` (no other
values needed), then `npm run dev`. Or as a one-off on macOS and Linux:

```bash
PUBLIC_DEMO=true npm run dev
```

## Tests

```bash
npm test
```

`npm run test:watch` re-runs them as you edit. No Supabase project or network
access is needed. There are two groups:

- **app** (`src/**/*.test.ts`): search, Markdown and wiki links, the graph
  filters, the campaign store (against a fake Supabase client), and the node
  form and node panel rendered in a simulated browser.
- **db** (`supabase/tests/`): runs the real migrations in an in-memory Postgres
  ([PGlite](https://pglite.dev)) and checks the rules that live in SQL:
  row-level security, invites, cleanup of tags and aliases, version stamps and
  history.

GitHub Actions runs the type check and tests on every push. On `main`, a
failing test stops the deploy.
