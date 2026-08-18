# Portuguese originals — reference only, do not deploy

The project is written in Portuguese by its author. For this review, the
**comments** of the bot and the SQL were translated into English. The
files here are the untranslated originals, kept so that claim can be
checked rather than taken on trust.

| Here | Corresponds to |
|---|---|
| `index.ts` | `../discord/bot/index.ts` |
| `01-banco.sql` | `../discord/01-database.sql` |
| `03-corrigir-remocao.sql` | `../discord/03-fix-removal.sql` |

To verify that only comments differ:

```
python tools/verify-translation.py
```

It strips comments from both versions and compares what is left. Anything
other than "identical" means a code line was changed, not just a comment.

**Deploy the English ones** (`discord/`). These are here for reading only;
keeping two live copies would be a way to drift apart.
