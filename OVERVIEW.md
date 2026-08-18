# What this is, what it can't do, and why it exists

A short answer to three questions: what it does, where it stops, and what
it is for. For the security side, see `SECURITY.md`.

---

## The goal

**To make the tier list easier to use. That is the whole of it.**

The community spreadsheet is good, and this does not try to replace it —
it is the same data, read live from the same sheet. But using it mid-trade
is awkward: eight tabs wide, rough on a phone, and you have to leave the
conversation to check anything.

So this is for the people already using that tier list. A faster way in:
search instead of scrolling, and a bot that answers in the channel where
the trade is happening.

**It is not a marketplace and is not trying to become one.** No trading,
no escrow, no middleman, no currency, no ads. It reads a spreadsheet and
does arithmetic.

---

## What it can do

### The site — <https://astdvalues.netlify.app>

**Values, live.** It reads the community spreadsheet directly. There is no
copy of the data: when the sheet is edited, the site follows. All eight
tabs — New, S, A, B, C, Pure, Oddities and No value.

**Finding a unit.** Search by name, filter to one tier, sort by value,
demand or name.

**Per unit** it shows value, rarity, supply, demand, the notes column, the
status tag (Stable, Maximum, Gatekept and so on — read from the
spreadsheet's own cell colours), the artwork, and a link to its wiki page.

**Inventory.** Sign in with Discord, add the units you own, see what the
whole account is worth. It is stored server-side, so it follows you to
another device and the bot can read it back.

**Trade calculator.** Put units on both sides and it tells you which way
it leans. Value is a straight subtraction. Demand is the average of each
side, compared.

### The bot — four slash commands

| Command | What it does |
|---|---|
| `/myinventory` | your own inventory and its total value |
| `/inventory @user` | someone else's |
| `/unitinfo <unit>` | value, rarity, supply, demand, notes and art for one unit |
| `/wfl <trade>` | Win / Fair / Loss, written as `death and demise for aqua` |

`/unitinfo` and `/wfl` autocomplete unit names as you type, and ask which
one you meant when a name is ambiguous.

---

## Limitations

Listed plainly, including the ones that are not flattering.

**1. The values are not mine.** They come from a community-maintained
spreadsheet that I do not control. If a value is wrong or out of date
there, it is wrong here too. This project makes that data easier to reach;
it does not verify it.

**2. Inventories are self-reported.** Nothing is read from Roblox. There
is no connection to the game at all. Someone can claim to own whatever
they like, and the bot will report it. Treat `/inventory` as "what this
person says they have", not proof.

**3. Anyone can look up anyone.** `/inventory @user` works on any member
who has signed in. That was the point of building it, but it is real
exposure and worth the server deciding on deliberately rather than
discovering later.

**4. `/wfl` is arithmetic, not judgement.** It subtracts values and
averages demand. It does not know that a unit is trending, that a trade is
overpay for a reason, or that demand matters more than value for some
units. It is a starting point for an argument, not the end of one.

**5. Name matching is fuzzy.** Unit naming in the spreadsheet is not
consistent, so matching a typed name to a row involves guessing. It asks
when it is unsure rather than guessing silently, but it can still be
wrong.

**6. It can go to sleep.** The free Supabase plan pauses a project after
roughly a week without traffic. When that happens, sign-in and the bot
stop working until someone resumes it from the dashboard. The site itself
keeps working — only the account features go down.

**7. No rate limiting of my own.** It relies on Discord's and Supabase's.

**8. No account deletion in the interface yet.** Removing someone's data
today means deleting their row by hand. If the server needs self-service
deletion, it has to be built.

**9. The bot shows as offline, always.** It holds no connection to
Discord; it only answers when a slash command calls it. It is invited with
no permissions at all — it cannot read messages, cannot moderate, cannot
touch channels.

---

## What is stored

Discord id, display name, avatar, and the list of units someone added.
That is all. Supabase's own auth table also keeps the email Discord
returns, if the account has one.

Not stored: passwords, messages, server content, IP addresses.

---

## On ownership

If the server wants to run this itself rather than depend on me, that is
fine and the repository is set up for it — `discord/SETUP.md` is the full
install, and the GitHub repository can be transferred outright.
