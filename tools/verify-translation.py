#!/usr/bin/env python3
"""
Proves that translating the comments did not change any code.

The project is written in Portuguese. For this review the comments of the
bot and the SQL were translated into English; the untranslated originals
are kept in pt-original/. This script strips every comment from both
versions and compares what is left.

"identical" means the executable code is the same in both. Anything else
means a code line changed, not just a comment — which is exactly what a
reviewer should want to rule out.

    python tools/verify-translation.py
"""

import io
import os
import re
import sys

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(AQUI)

PARES = [
    ("pt-original/index.ts", "discord/bot/index.ts", "ts"),
    ("pt-original/01-banco.sql", "discord/01-database.sql", "sql"),
    ("pt-original/03-corrigir-remocao.sql", "discord/03-fix-removal.sql", "sql"),
]


def so_codigo(caminho, linguagem):
    """Return the file's code lines, with comments and blank lines removed."""
    texto = io.open(os.path.join(RAIZ, caminho), encoding="utf-8").read()
    if linguagem == "ts":
        texto = re.sub(r"/\*.*?\*/", "", texto, flags=re.S)      # /* block */
        texto = re.sub(r"(^|\s)//.*$", "", texto, flags=re.M)    # // line
    else:
        texto = re.sub(r"--.*$", "", texto, flags=re.M)          # -- line
    return [l.strip() for l in texto.split("\n") if l.strip()]


def main():
    falhou = False
    for original, traduzido, linguagem in PARES:
        a = so_codigo(original, linguagem)
        b = so_codigo(traduzido, linguagem)
        nome = os.path.basename(traduzido)
        if a == b:
            print("%-22s %4d code lines   identical" % (nome, len(a)))
            continue

        falhou = True
        print("%-22s %4d vs %d code lines   DIFFERENT" % (nome, len(a), len(b)))
        import difflib
        for linha in difflib.unified_diff(a, b, original, traduzido,
                                          lineterm="", n=0):
            print("    " + linha[:110])

    print()
    if falhou:
        print("At least one file differs in code, not just comments.")
        return 1
    print("Only comments differ. Every executable line is the same.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
