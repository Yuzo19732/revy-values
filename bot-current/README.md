# The bot as it runs today

**Read this folder, not `discord/`.** The bot was rewritten. `discord/`
holds the previous version — sign-in, inventories, `/invadd`,
`/inventory @user` — none of which exists any more. The three documents
at the root of the repository (`README.md`, `SECURITY.md`,
`OVERVIEW.md`) still describe that older version and have not been
updated yet.

## What it is now

One Discord application, running in two places:

| File | Where it runs | What it does |
|---|---|---|
| `unitinfo.ts` | Supabase Edge Function (Deno) | the `/unitinfo` slash command |
| `messages.js` | Wispbyte container (Node) | reads chat and answers value questions |
| `logic.generated.js` | with `messages.js` | the shared lookup, generated — see below |

Both read the same public community spreadsheet through the Google
Sheets API. Neither writes to it.

## Two things a reviewer should know up front

**1. It reads messages.** `messages.js` connects to the Discord gateway
with the **MESSAGE CONTENT** privileged intent, so it receives every
message in the channels it can see. It has to, because it answers
questions written as ordinary chat — "how much is aqua" — rather than
only slash commands.

Nothing is stored. Each message is matched against the patterns in
`NAO_E_VALOR` and `PERGUNTAS`, and if it is not a value question it is
dropped and never leaves the process. There is no database write, no
log file, and no message content in the console beyond the author's
display name and the matched text, which exists only in the container's
live console.

`NAO_E_VALOR` is deliberate: in this community "how much is X pulling"
asks what a unit is *currently fetching in trades*, which is not the
spreadsheet's value. Those messages are ignored rather than answered
with a number that would be wrong.

**2. Nothing here is a credential.** All three secrets — the bot token,
the Google API key and the Supabase project URL — are read at startup
from environment variables, falling back to local files that are in
`.gitignore`. See `segredo()` in `messages.js`. The `ehModelo()` check
next to it exists because the credential templates contain example
values, and an earlier version picked the example up instead of the real
one.

## About `logic.generated.js`

It is generated from `unitinfo.ts` by `generate-logic.py`, which lifts
the shared sections out and strips the TypeScript annotations with the
TypeScript compiler. It is included here because it is what actually
executes in the container, and a reviewer should be able to read that
rather than take the generator on trust.

The generator exists so the two bots cannot drift apart. Copying the
lookup by hand had already produced silent divergence three times in
this project: a frozen tag, a stale sheet id, and a field that no longer
existed.

## Comments

The working copies of these files are commented in Portuguese. Those
comments were removed here. The code is otherwise unchanged: every
removed span begins with a comment marker, re-inserting the removed
spans reproduces the original byte for byte, and `tsc` reports the same
diagnostics for both versions. The `@ts-ignore` directives were kept,
because removing them would change what the compiler does.

Identifiers are still in Portuguese — `valores`, `procurar`, `fatiar`,
`apelidos`. Renaming them would have meant editing code, which would
have defeated the point of the check above.
