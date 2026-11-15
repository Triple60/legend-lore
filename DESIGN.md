# Legend Lore — design

A shared, live-updating graph of everything in a tabletop campaign: places,
people, objects, lore, and how they connect. The party edits it together;
nobody outside the campaign can see it.

## Decisions

| Topic | Decision |
|---|---|
| Hosting | Static SvelteKit (Svelte 5) app on GitHub Pages, built by GitHub Actions. |
| Backend | Supabase free tier: Postgres, Auth, Realtime. No server code of our own. |
| Security | Enforced entirely by Postgres row-level security (RLS). The anon key in the browser is public by design. |
| Login | Discord OAuth, plus a one-time code by email. No passwords stored. (SMS was ruled out: it costs money per message on every provider.) |
| Roles | Everyone in a campaign is an editor. The creator is also *owner* (can rename/delete the campaign and remove members). Viewing requires login + membership. |
| Joining | Any member creates an invite link (`/join?token=…`, valid 7 days). |
| Node types | A per-campaign list, seeded with Place / Person / Object / Lore. Any member can add types. Each node has exactly one type. |
| Tags | Free-form strings on nodes. Tags are how groups are tracked (there is no containment). |
| Edges | Top-level records, directed, with a free-text annotation. |
| Containment | Dropped. Use tags for groups and edges for "located in". |
| Notes | Markdown. `[[Name]]` / `[[Name\|label]]` link to a node by name or alias (links only; they don't create edges). |
| Sessions | Optional session number on nodes ("first seen") and edges. The UI can show the graph "as of session N". |
| History | Every change to a node or edge stores a full snapshot (database trigger). Undo = restore a snapshot as a new version. |
| Deletion | Soft delete (`deleted_at`). Clients have no DELETE permission on nodes/edges. Deleted nodes go to a trash and can be restored; their edges hide and reappear with them. |
| Concurrent edits | One editor per node at a time, via Supabase Presence (locks vanish automatically when a tab closes). Saves also check a `version` number, so a lost race fails loudly instead of overwriting. Live co-editing (Yjs) is a possible later upgrade. |
| Layout | Automatic force-directed layout (Cytoscape.js `cose`). Positions are cached per browser so the map doesn't reshuffle between visits; new nodes appear next to a neighbour. (A Re-layout button was removed: re-running `cose` on a placed map scrambled it.) |
| Search | Client-side over the whole campaign: name > alias > tag > notes; `#tag` filters by tag. Fine up to a few thousand nodes. |
| DB pause | A scheduled GitHub Action pings the database every 3 days. GitHub disables scheduled workflows in public repos after 60 days with no commits; it emails a warning first, and one click re-enables it. |

## Data model

See `supabase/migrations/` for the authoritative schema.

```
campaigns          id, name, created_by, created_at
campaign_members   campaign_id, user_id, role (owner | editor), joined_at
campaign_invites   token, campaign_id, created_by, expires_at
profiles           id (= auth user), display_name
node_types         id, campaign_id, label, color, icon, sort_order
nodes              id, campaign_id, type_id, name, aliases[], tags[], notes,
                   session_number, version, created_by/at, updated_by/at, deleted_at
edges              id, campaign_id, from_id, to_id, annotation, session_number,
                   version, created_by/at, updated_by/at, deleted_at
revisions          id, campaign_id, entity_type, entity_id, version, op, snapshot, changed_by/at
```

Integrity rules enforced in the database:

- Composite foreign keys keep a node's type and both ends of an edge inside
  the same campaign.
- Triggers stamp `created_by`/`updated_by`/timestamps and bump `version`, so
  clients can't forge authorship. Rows can't be moved between campaigns.
- Tags and aliases are trimmed and de-duplicated.

## Free-tier budget

- **Supabase:** 500 MB database (years of text notes), realtime well within
  limits for one party. Reads aren't billed individually.
- **GitHub Actions:** free and unlimited for public repositories (the
  keep-alive uses a few minutes a month even on a private repo).
- **GitHub Pages:** free for public repositories. A private repository needs a
  paid GitHub plan to publish Pages.
- **Email codes:** Supabase's built-in sender is for testing only and heavily
  rate-limited. Use a free SMTP provider (e.g. Resend or Brevo) for real use.

## Later

- Live co-editing of notes (Yjs over Supabase Realtime broadcast).
- Rename/recolour/delete node types in the UI.
- Edge history UI (edges already record revisions).
- JSON export/import for backups.
- Neighbourhood view ("N hops from this node") for very large graphs.
- Code-split Cytoscape so the login page loads faster.
