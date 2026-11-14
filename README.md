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
3. In **Project Settings → API**, note the **Project URL** and the
   **anon / publishable** key.
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

### 3. Email codes

1. **Authentication → Emails → Templates → Magic Link**: include
   `{{ .Token }}` in the body so the email contains a code, e.g.
   `Your Legend Lore code is {{ .Token }}`.
2. **Authentication → Emails → SMTP Settings**: configure a free SMTP provider
   (e.g. Resend or Brevo). Supabase's built-in sender is for testing only.

### 4. GitHub

1. **Settings → Pages → Build and deployment → Source**: *GitHub Actions*.
2. **Settings → Secrets and variables → Actions → Variables**, add:
   - `PUBLIC_SUPABASE_URL`
   - `PUBLIC_SUPABASE_ANON_KEY`

   These are public values, so they go under *Variables*, not *Secrets*.
3. Push to `main`. The **Deploy to GitHub Pages** workflow builds and
   publishes the site. **Keep Supabase awake** runs every three days.

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
