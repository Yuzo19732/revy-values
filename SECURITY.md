# Revy Values — security overview

Document for review. Describes what the system does, what data it stores,
how each part is protected, and **what is worth questioning**.

Last updated: 2026-08-18

---

## 1. The three pieces

| Piece | Runs on | What it is |
|---|---|---|
| **Site** | Netlify (HTTPS) | a single static HTML file, no backend of its own |
| **Login + database** | Supabase | Discord authentication and Postgres |
| **Bot** | Supabase Edge Function | endpoint Discord calls on slash commands |

The bot **is not always on**. It holds no gateway connection to Discord,
does not read server messages, and has no permissions beyond existing and
answering slash commands.

---

## 2. What data is stored

**In the database (Supabase):**

| Table | Contents |
|---|---|
| `perfis` (profiles) | Discord id, display name, avatar URL |
| `inventarios` (inventories) | each person's units and quantities |

Supabase also keeps its own authentication table (`auth.users`) with
whatever Discord returns at login — including **email**, if the Discord
account has one.

**Not stored:** passwords (login is via Discord), messages, server
content, or IP addresses in our own tables.

**In each person's browser:** their local inventory and login session, in
`localStorage`.

### Who can see what

- Through the **site**, each person only reaches their own inventory.
  This is enforced by the database, not by the site's code (see section 5).
- Through the **bot**, anyone can look up another person's inventory with
  `/inventory @someone`. **This is intentional** — it was the point of the
  project. Worth confirming the server is comfortable with that level of
  exposure.

---

## 3. Discord sign-in

Standard OAuth flow, brokered by Supabase:

1. The person clicks *Sign in with Discord* on the site
2. Discord asks for authorization and redirects back to Supabase
3. Supabase exchanges the code for a session and returns it to the site

**The app's Client Secret lives only in Supabase.** It never passes
through the browser — that detour through the server is precisely why the
flow is shaped this way instead of going straight from the site.

The app requests only the default identification scopes. It does not ask
for access to servers, messages or friends.

**Point for review:** the session is kept in `localStorage`, which is the
Supabase default for single-page apps. That means an XSS on the site could
read the token. The mitigation is not having XSS (section 6); a stronger
alternative would be `httpOnly` cookies, which would require running our
own server.

---

## 4. The bot

### How it knows a call really came from Discord

Every request is signed by Discord with Ed25519. The bot **verifies the
signature before anything else** and answers `401` if it does not match:

```ts
if (!(await signatureIsValid(req, body))) {
  return new Response('invalid signature', { status: 401 })
}
```

Without this, anyone who discovered the endpoint could forge commands.
Discord itself refuses to register an endpoint that fails this test.

### Why Supabase JWT verification is turned off

The caller is Discord, which has no Supabase session. With verification
on, the call would be rejected before ever reaching the bot.
Authentication here is the signature above — **it is not an absence of
authentication, it is a different one**.

### The admin key

The bot uses the `service_role` key, which bypasses the database policies.
This is required because it must read other people's inventories to answer
`/inventory @someone`.

That key exists **only** as an Edge Function secret, injected by Supabase
at runtime. It is not in the code, not in the site, and not in any file of
this project.

> During setup this key was exposed once in a chat. The project was
> **discarded and rebuilt from scratch** with new keys, and the old one
> was deleted.

---

## 5. Database

Both tables have **Row Level Security enabled**. Without it, the site's
public key would let any visitor read and delete other people's
inventories.

The policies are all anchored on `auth.uid()`, the identity verified by
Supabase — not a value the browser can forge:

```sql
create policy "read own inventory"
  on public.inventarios for select
  using (auth.uid() = perfil_id);
```

There are four equivalent policies for insert, update and delete, plus
three for `perfis`.

The function that saves an inventory is `security invoker`, meaning it
**runs with the caller's permissions** and remains subject to the policies
above. It refuses calls without a session:

```sql
if uid is null then
  raise exception 'precisa estar logado';   -- "must be signed in"
end if;
```

The only `security definer` function is the trigger that creates a profile
on first login. It is necessary (it writes to a table the user cannot yet
access), has a fixed `search_path`, and only inserts the row for the
user just created.

**Tested:** querying `inventarios` while signed out returns zero rows, and
calling the save function without a session is rejected.

---

## 6. The site

### Third-party content

The data comes from a **public, community-maintained spreadsheet** — text
the project does not control ends up on the page. Left untreated this
would be an XSS path: someone with edit access to the sheet could write
HTML into a cell.

**All spreadsheet text is escaped before becoming HTML.** Verified across
the paths: unit name, character name, notes, tag and text-valued prices.
The search highlighting function also escapes before marking matches.

The only URL accepted from the sheet is an image URL, and it is filtered
by pattern (`https://…` ending in an image extension), which blocks
`javascript:` and similar.

### Public key in the code

`index.html` contains the Supabase `anon` key. **This is by design** — it
is public by nature and only identifies the project. What protects the
data are the policies in section 5.

The `service_role` key is **not** in the site.

### What the site loads from outside

| Origin | Purpose |
|---|---|
| `docs.google.com` | spreadsheet data |
| `fonts.googleapis.com` / `gstatic.com` | fonts |
| `static.wikia.nocookie.net` | unit artwork |
| `cdn.jsdelivr.net` | Supabase client library |

**Point for review:** the spreadsheet is read via JSONP — a `<script>` tag
pointing at Google. That means **executing whatever Google returns**. It is
the standard technique for reading a public sheet from a static site, and
the alternative (`fetch`) is blocked by the browser. The practical risk
comes down to trusting Google; worth recording the decision.

Every origin is HTTPS. There is no `http://` anywhere in the site.

---

## 7. Secrets: what is public and what is not

| Item | Where it lives | Public? |
|---|---|---|
| Supabase `anon` key | in `index.html` | **yes**, by design |
| Discord Application ID | in the invite URL | **yes** |
| Discord Public Key | Edge Function secret | no |
| Discord Client Secret | Supabase dashboard | **no** |
| Bot Token | outside the project | **no** |
| Supabase `service_role` | Edge Function secret | **no** |

No file in the repository contains a secret. The command-registration
script reads the token from a **temporary** `credentials.txt`, and the
script itself tells you to delete it afterwards.

---

## 8. Known limitations

Listed deliberately, so they are not missed:

1. **Anyone's inventory can be looked up through the bot.** That is the
   point of the project, but it is data exposure — worth the server
   confirming.
2. **The session lives in `localStorage`.** Supabase default; an XSS could
   read it.
3. **Trusting Google's JSONP** (section 6).
4. **The spreadsheet is third-party.** If it is edited wrongly or
   maliciously, the site's values change with it. Content is escaped, so
   the risk is *incorrect data*, not code execution.
5. **The Supabase free plan pauses the project** after roughly a week of
   inactivity, taking down login and bot until someone resumes it.
6. **There is no rate limiting of our own.** It relies on Discord's and
   Supabase's limits.
7. **No account deletion in the interface.** Removing someone's data today
   means deleting their row in `auth.users` (the rest cascades). If the
   server requires self-service deletion, it needs to be built.

---

## 9. What to review

| File | What to look at |
|---|---|
| `discord/01-database.sql` | the RLS policies and the two functions |
| `discord/bot/index.ts` | signature verification and `service_role` usage |
| `index-readable.html` | content escaping, external origins, public key |
| `discord/SETUP.md` | how the secrets were configured |

For the site, read `index-readable.html` — it is the same file with the
generated data blocks stripped (91% of the original is base64 artwork).
`index.html` is included untouched for comparison against production.

Useful anchors in the site's code:

| Look for | What it does |
|---|---|
| `const esc =` | the HTML escaping function |
| `function highlight(` | escapes before marking search matches |
| `const CONTA =` | the public Supabase key and project URL |
| `function iniciarConta(` | the whole sign-in flow |
| `function empurrarInventario(` | the only write to the database |

Suggested focus, most critical first:

1. The RLS policies (section 5) — this is what stops one person from
   touching another's inventory
2. The bot's signature verification (section 4)
3. Escaping of spreadsheet content (section 6)
