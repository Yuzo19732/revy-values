# -*- coding: utf-8 -*-
"""
Le da planilha as TAGS (pela cor da celula) e os VALORES EM TEXTO,
e grava os dois dentro do index.html.

    python atualizar_tags.py

POR QUE ISTO EXISTE
-------------------
O site le a planilha ao vivo pela API gviz do Google. So que ela tem
duas cegueiras:

  1. Nao devolve COR de celula. E a cor e justamente o que marca a tag
     da unidade (laranja = Maximum, roxo = Varies, etc).

  2. Descarta VALOR EM TEXTO. A coluna de valor e do tipo numero, entao
     celulas como "Owner's Choice", "400,000 - ???" ou "3,000-?" voltam
     VAZIAS — e a unidade aparecia no site como "sem valor".

A pagina de edicao da planilha (/edit) devolve a grade inteira em HTML,
com uma classe de estilo por celula. Dali sai tudo: o texto de verdade e
a cor. Como isso e pesado pra fazer no navegador a cada visita, este
script roda de vez em quando e deixa o resultado pronto no index.html.

Rode de novo quando as tags mudarem na planilha.
"""

import re, html, json, sys, os, time, urllib.request

PLANILHA = '1Z20NUscF9Id2Sss-osT-Xq06gz9ooikt6Kjtianeg0I'
HTML_SITE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'index.html')
UA = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120 Safari/537.36'}

ABAS = [
    ('new', '598345464'), ('s', '1154918591'), ('a', '2023119820'),
    ('b', '1418037381'),  ('c', '2096364692'), ('pure', '253483720'),
    ('odd', '459291543'), ('un', '1974142836'),
]
GID_TUTORIAL = '1754835262'

INICIO = 'TAGS E VALORES EM TEXTO — INÍCIO'
FIM    = 'TAGS E VALORES EM TEXTO — FIM'


def baixar(gid):
    url = f'https://docs.google.com/spreadsheets/d/{PLANILHA}/edit?gid={gid}'
    req = urllib.request.Request(url, headers=UA)
    return urllib.request.urlopen(req, timeout=60).read().decode('utf-8', 'replace')


def estilos(pagina):
    """{'s15': '#ff6d01'} — a cor de fundo de cada classe de celula."""
    out = {}
    for classe, regra in re.findall(r'\.(s\d+)\s*\{([^}]*)\}', pagina):
        m = re.search(r'background-color:\s*(#[0-9a-fA-F]{6})', regra)
        if m: out[classe] = m.group(1).lower()
    return out


def celulas(linha):
    """[(classe, texto)] de uma <tr>."""
    fora = []
    for classe, bruto in re.findall(r'<td class="(s\d+)"[^>]*>(.*?)</td>', linha, re.S):
        fora.append((classe, html.unescape(re.sub(r'<[^>]+>', '', bruto)).strip()))
    return fora


def ler_legenda():
    """Monta {cor: nome da tag} lendo a propria aba Tutorial."""
    pagina = baixar(GID_TUTORIAL)
    cores = estilos(pagina)
    nomes = ['Stable', 'Unstable', 'Rising', 'Dropping', 'Inflated', 'Deflated',
             'Varies', 'Maximum', 'Hyped', 'Gatekept', 'Black Marketed']
    legenda = {}
    for linha in re.findall(r'<tr[^>]*>(.*?)</tr>', pagina, re.S):
        for classe, texto in celulas(linha):
            if texto in nomes and classe in cores:
                legenda.setdefault(cores[classe], texto)
    return legenda


def ler_aba(tier, gid, legenda):
    """Devolve (tags, textos) desta aba."""
    pagina = baixar(gid)
    cores = estilos(pagina)
    tags, textos = {}, {}

    col_valor = None
    achou_cabecalho = False

    for linha in re.findall(r'<tr[^>]*>(.*?)</tr>', pagina, re.S):
        cs = celulas(linha)
        if len(cs) < 3: continue
        txt = [t for _, t in cs]

        # mesma logica do site: a linha de cabecalho e a que tem "Notices"
        baixos = [t.lower() for t in txt]
        if 'notices' in baixos:
            n = baixos.index('notices')
            col_valor = 2 if n > 2 else None
            achou_cabecalho = True
            continue
        if not achou_cabecalho or col_valor is None: continue

        nome = txt[1]
        if not nome or len(cs) <= col_valor: continue

        chave = f'{tier}|{nome}'
        valor = txt[col_valor]

        # a tag vem da cor da celula de VALOR
        cor = cores.get(cs[col_valor][0])
        if cor in legenda:
            tags[chave] = legenda[cor]

        # valor que o gviz descartaria (qualquer coisa que nao seja numero puro)
        if valor and not valor.replace(',', '').replace('.', '').isdigit():
            textos[chave] = valor

    return tags, textos


def js(dicionario):
    linhas = []
    for k in sorted(dicionario):
        kk = k.replace('\\', '\\\\').replace('"', '\\"')
        vv = str(dicionario[k]).replace('\\', '\\\\').replace('"', '\\"')
        linhas.append(f'  "{kk}": "{vv}",')
    return '\n'.join(linhas)


def gravar(tags, textos):
    doc = open(HTML_SITE, encoding='utf-8').read()
    i, f = doc.find(INICIO), doc.find(FIM)
    if i < 0 or f < 0:
        print('ERRO: nao achei os marcadores no index.html'); sys.exit(1)
    ini = doc.rfind('<script>', i, f)
    fim = doc.find('</script>', ini)

    bloco = ('<script>\n'
             'window.ASTD_TAGS = {\n' + js(tags) + '\n};\n'
             'window.ASTD_VALOR_TEXTO = {\n' + js(textos) + '\n};')
    open(HTML_SITE, 'w', encoding='utf-8').write(doc[:ini] + bloco + doc[fim:])


if __name__ == '__main__':
    print('1/3  lendo a legenda das tags (aba Tutorial)...')
    legenda = ler_legenda()
    if not legenda:
        print('     nao achei a legenda. A planilha mudou de formato?'); sys.exit(1)
    for cor, nome in sorted(legenda.items(), key=lambda x: x[1]):
        print(f'     {cor}  {nome}')

    print('\n2/3  lendo as abas...')
    tags, textos = {}, {}
    for tier, gid in ABAS:
        t, v = ler_aba(tier, gid, legenda)
        tags.update(t); textos.update(v)
        print(f'     {tier:5} {len(t):4} com tag, {len(v):3} com valor em texto')
        time.sleep(.3)

    print(f'\n3/3  gravando no index.html...')
    gravar(tags, textos)
    print(f'     {len(tags)} tags, {len(textos)} valores em texto')

    from collections import Counter
    print('\nDistribuicao das tags:')
    for nome, n in Counter(tags.values()).most_common():
        print(f'   {nome:16} {n}')
