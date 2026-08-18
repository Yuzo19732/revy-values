# Discord sign-in + bot — step by step

All the code is ready. What is missing are the accounts and keys, which
only the project owner can create. Six steps, about 30–40 minutes.

Do them in order — each depends on the previous one.

---

## 1. Create the Supabase project

1. Go to **supabase.com** and create an account
2. **New project**
   - Name: `astd-values`
   - Pick a database password and **keep it somewhere safe**
   - Region: pick the one closest to your players

Then note down (⚙️ *Project Settings* → *API*):

| What | Where it is | Goes to |
|---|---|---|
| **Project URL** | `https://xxxxx.supabase.co` | the site |
| **anon public** key | long string | the site |
| **service_role** key | long string, marked secret | the bot only |

> ⚠️ The `service_role` key bypasses every security rule. It must **never**
> go into `index.html` or onto Netlify. Supabase dashboard only.

---

## 2. Create the tables

1. In Supabase, **SQL Editor** → **New query**
2. Open `01-database.sql`, copy **everything**, paste it there
3. **Run**

You should see *Success*. Check under **Table Editor**: the tables
`perfis` and `inventarios` must exist.

---

## 3. Create the Discord app

1. Go to **discord.com/developers/applications** → **New Application**
2. Name it (this is what shows up in the server)

Under **General Information**, note:
- **Application ID**
- **Public Key**

Under **Bot**:
- **Reset Token** and save the **Bot Token** (shown only once)
- Leave every *Privileged Intent* **off** — slash commands need none

Under **OAuth2**, in *Redirects*, **Add Redirect**:

```
https://YOUR-PROJECT.supabase.co/auth/v1/callback
```

**Save Changes**. Still under OAuth2, note the **Client ID** and
**Client Secret**.

---

## 4. Connect Discord to Supabase

1. Supabase: **Authentication** → **Sign In / Providers**
2. Enable **Discord** and fill in the **Client ID** and **Client Secret**
3. **Save**

Then under **Authentication** → **URL Configuration**:
- **Site URL**: the site's address
- Add the same address under **Redirect URLs**

---

## 5. Publish the bot

The bot is an Edge Function. It can be created straight from the browser:

1. **Edge Functions** → **Deploy a new function** → *Via Editor*
2. Name it **`bot`** — exactly that, lowercase (the name becomes the URL)
3. **Turn OFF `Verify JWT`**

> This matters: the caller is Discord, which has no Supabase session. With
> verification on, the call is rejected before reaching the bot. Security
> here comes from the Ed25519 signature the bot checks on every request.

4. Paste the contents of `bot/index.ts` and **Deploy**

Then add the secret (**Edge Functions** → **Secrets**):

| Name | Value |
|---|---|
| `DISCORD_PUBLIC_KEY` | the Public Key from step 3 |

> `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically
> — do not create those. That is why the `service_role` key never has to
> be handled manually.

Finally, back in the Discord Developer Portal → **General Information**,
set **Interactions Endpoint URL** to:

```
https://YOUR-PROJECT.supabase.co/functions/v1/bot
```

> Discord tests the endpoint the moment you save. Saving without an error
> means the bot answered the signature challenge correctly.

---

## 6. Invite the bot and register the commands

**Invite first** — in this order. Guild commands can only be created where
the bot already is; the other way round gives a 403 "Missing Access".

```
https://discord.com/api/oauth2/authorize?client_id=YOUR_APP_ID&scope=bot+applications.commands&permissions=0
```

`permissions=0` is deliberate: the bot needs no permissions at all. It
will not read messages, cannot moderate, cannot touch channels.

**Then** register the commands:

```bash
python 02-register-commands.py
```

The first run creates a `credentials.txt`. Fill it in (Application ID,
Bot Token, optionally a server ID) and run it again. **Delete that file
afterwards** — it holds the Bot Token in plain text.

---

## 7. Finally: enable sign-in on the site

Open `index.html`, find `const CONTA` near the top of the script and fill
in the two values:

```js
const CONTA = {
  url:  'https://xxxxx.supabase.co',
  chave:'the anon public key',
};
```

Save and deploy.

---

## Verifying it works

1. Open the site → **Sign in with Discord** should appear
2. Sign in → the button becomes your name and picture
3. Add a unit to your inventory
4. On Discord, type `/myinventory` → it should list what you added

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| No sign-in button | `CONTA` left empty in index.html |
| Sign-in loops back signed out | wrong Redirect URL (steps 3 and 4) |
| Discord rejects the bot endpoint | wrong `DISCORD_PUBLIC_KEY` |
| `/myinventory` says you have not linked | signed into the site with a different Discord account |
| Commands do not show when typing `/` | step 6 not run, or bot not in the server |

To see what the bot did internally: Supabase → **Edge Functions** → `bot`
→ **Logs**.
