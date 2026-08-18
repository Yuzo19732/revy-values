# Revy Values

Trade value site + Discord bot for **All Star Tower Defense**.

Live site: <https://astdvalues.netlify.app>

The site reads a public, community-maintained spreadsheet and shows every
unit's trade value. Signing in with Discord lets you keep an inventory,
which the bot can then read back through slash commands.

**Reviewing this? Start with `SECURITY.md`** — it covers the architecture, what data is
stored, how each part is protected, and what is worth questioning.

---

## What's in this repository

| File | What it is |
|---|---|
| `SECURITY.md` | **read first** — full security overview |
| `discord/01-database.sql` | tables, access policies and database functions |
| `discord/bot/index.ts` | the entire bot (Deno / Supabase Edge Function) |
| `discord/02-register-commands.py` | registers the slash commands with Discord |
| `discord/03-fix-removal.sql` | a later fix, already folded into `01-database.sql` |
| `discord/SETUP.md` | step-by-step install guide |
| `index-readable.html` | **the site's code** — start here |
| `index.html` | the site exactly as deployed (91% generated data) |
| `update_*.py`, `own_images.py` | local scripts that generate the site's data |
| `tools/` | two scripts that let you check the claims made below |
| `pt-original/` | the untranslated Portuguese originals, for comparison |

### About the two copies of the site

The site is a single 1.1 MB file, but **91% of that is generated data** —
base64 artwork, image paths and tags produced by the local scripts. Only
about 100 KB is actual code.

- **`index-readable.html`** has those data blocks replaced by a one-line
  note. Read this one.
- **`index.html`** is byte-identical to what the live site serves. Use it
  to compare against production.

Everything outside the data blocks is identical between the two. You do
not have to take that on trust:

```
python tools/readable-copy.py
```

It normalises both files and compares them line by line — 2,169
comparable lines, zero differences. `--write` rebuilds the readable copy
from `index.html`.

---

## About keys and secrets

**This repository contains no secrets**, on purpose. A security review needs
the code, not live keys — the code shows how they are used, and sending
the keys would be exactly the leak the review is meant to rule out.

The only key present is the Supabase **`anon` key**, inside `index.html`.
It is public by design: the site hands it to every visitor. What protects
the data are the database access policies in `discord/01-database.sql`,
not the secrecy of that key.

**Not included:** Bot Token, Discord Client Secret, Discord Public Key,
and the Supabase `service_role` key.

If the review needs to confirm something that depends on one of those, it
can be shown over a screen share or in the dashboard, without
transmitting the value.

---

## What is deliberately not in this repository

| Not here | Why |
|---|---|
| any secret | see the section above — a review needs the code, not live keys |
| `imagens/` | ~5 MB of unit artwork; the site already embeds all of it as base64 |

Nothing else is held back. Every file the running system uses is here.

---

## Where each secret lives in production

| Secret | Where it lives |
|---|---|
| Discord Client Secret | Supabase dashboard (Authentication) |
| Discord Public Key | Edge Function secret |
| Supabase `service_role` | injected by Supabase at runtime |
| Bot Token | outside the project, used only to register commands |

---

## A note on language

The project is maintained in Portuguese by its author. Exactly what was
translated for this review:

| File | State |
|---|---|
| `README.md`, `SECURITY.md`, `SETUP.md` | written in English |
| `discord/bot/index.ts` | **comments translated, code untouched** |
| `discord/01-database.sql`, `03-fix-removal.sql` | **comments translated, code untouched** |
| `index.html` | **verbatim**, comments still in Portuguese |
| `*.py` scripts | comments still in Portuguese |

**The bot and the SQL had only their comments rewritten.** Every
executable line is identical to production. The untranslated originals are
in `pt-original/` so you can confirm it:

```
python tools/verify-translation.py
```

It strips every comment from both versions and diffs what is left — 549
code lines in the bot, 97 and 22 in the SQL, zero differences. Deploy the
English ones; `pt-original/` is there for reading only.

**`index.html` was left untouched on purpose.** It is byte-identical to
what the live site serves, so it can be compared against production.
Translating its comments would break that match. Everything
security-relevant about it is explained in English in `SECURITY.md`,
section 6.

The `*.py` scripts run only on the maintainer's own machine, handle no
secrets, and are not part of the deployed system. They are included for
completeness.

Table and column names are kept in Portuguese throughout, because that is
what the running code queries — `perfis` = profiles, `inventarios` =
inventories, `chave` = key, `qtd` = quantity.

---

## Checking things without installing anything

- **Live site:** https://astdvalues.netlify.app
- **Database:** the policies are in `discord/01-database.sql`, section 3
- **Bot:** signature verification is in `discord/bot/index.ts`, function
  `signatureIsValid` — it is the first thing that runs on every request

## Discord permissions the bot asks for

None. It is invited with `applications.commands` only, which means it:

- **cannot** read server messages
- **cannot** join channels
- **has no** moderation permissions

It exists only to answer slash commands. That is why it shows as offline
in the member list — it holds no gateway connection to Discord.
