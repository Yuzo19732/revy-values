# -*- coding: utf-8 -*-
"""
Atualiza as imagens das unidades do site.

O que ele faz, na ordem:
  1. Le a planilha de valores (as mesmas abas que o site usa)
  2. Lista todas as paginas do wiki do ASTD e pega a imagem de cada uma
  3. Casa os nomes da planilha com os titulos do wiki
  4. Reescreve o bloco ASTD_IMAGES dentro do index.html

Rode assim, nesta pasta:      python atualizar_imagens.py

Use quando sairem unidades novas no jogo. Nao precisa mexer no
index.html na mao — o script faz isso sozinho.
"""

import json, csv, io, re, sys, time, urllib.request, urllib.parse, difflib

SHEET_ID = '1Z20NUscF9Id2Sss-osT-Xq06gz9ooikt6Kjtianeg0I'
WIKI_API = 'https://allstartd.fandom.com/api.php'
HTML     = 'index.html'
UA       = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36'

# Mesmas abas listadas no index.html
GIDS = {
    'New Units':'598345464', 'S Tier':'1154918591', 'A Tier':'2023119820',
    'B Tier':'1418037381',   'C Tier':'2096364692', 'Pure Tier':'253483720',
    'Oddities':'459291543',  'Untiered':'1974142836',
}

PREFIX = 'https://static.wikia.nocookie.net/allstartd/images/'


def get(url, tries=3):
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': UA})
            return urllib.request.urlopen(req, timeout=45).read()
        except Exception as e:
            if i == tries - 1: raise
            time.sleep(2)


def api(**p):
    p.setdefault('format', 'json'); p.setdefault('action', 'query')
    return json.loads(get(WIKI_API + '?' + urllib.parse.urlencode(p)))


# ---------------------------------------------------------------- planilha
def ler_planilha():
    """Mesma logica do site: acha a linha com 'Notices' e deduz as colunas."""
    nomes = []
    for aba, gid in GIDS.items():
        url = (f'https://docs.google.com/spreadsheets/d/{SHEET_ID}/gviz/tq'
               f'?tqx=out:csv&gid={gid}&headers=0')
        rows = list(csv.reader(io.StringIO(get(url).decode('utf-8'))))
        cols = None
        for r in rows:
            low = [c.strip().lower() for c in r]
            if 'notices' in low:
                n = low.index('notices')
                cols = dict(value=2 if n > 2 else None, rarity=3 if n > 3 else None)
                continue
            if not cols or len(r) < 2: continue
            nome = r[1].strip()
            if not nome: continue
            val = r[cols['value']].strip()  if cols['value']  is not None and len(r) > cols['value']  else ''
            rar = r[cols['rarity']].strip() if cols['rarity'] is not None and len(r) > cols['rarity'] else ''
            if cols['value'] is not None and not val and not rar: continue   # recado solto, nao item
            nomes.append(nome)
        print(f'  {aba:12} ok')
    return nomes


# ---------------------------------------------------------------- wiki
def ler_wiki():
    def listar(filtro):
        out, cont = [], {}
        while True:
            d = api(list='allpages', aplimit='500', apnamespace='0',
                    apfilterredir=filtro, **cont)
            out += [p['title'] for p in d['query']['allpages']]
            if 'continue' in d: cont = d['continue']
            else: break
        return out

    titulos = listar('nonredirects')
    # Redirecionamentos servem pro link (o Fandom leva pra pagina certa
    # sozinho) — e varias unidades so existem sob esse nome, tipo
    # "Rukia (Captain)" e "Afro Samurai".
    redirects = listar('redirects')
    print(f'  {len(titulos)} paginas + {len(redirects)} redirecionamentos')

    imgs = {}
    for i in range(0, len(titulos), 50):
        d = api(prop='pageimages', piprop='thumbnail|original', pithumbsize='200',
                pilimit='50', titles='|'.join(titulos[i:i+50]))
        for p in d['query']['pages'].values():
            src = ((p.get('thumbnail') or {}).get('source')
                   or (p.get('original') or {}).get('source'))
            if not src or not src.startswith(PREFIX): continue
            imgs[p['title']] = src[len(PREFIX):].split('/revision/')[0].split('?')[0]
        sys.stdout.write(f'\r  imagens: {len(imgs)}'); sys.stdout.flush()
        time.sleep(.12)
    print()
    # Devolve tambem TODOS os titulos: varias paginas existem sem ter
    # imagem (Afro Samurai, Rukia (Captain)...), e elas servem pro link
    # mesmo sem servir pra foto.
    return imgs, titulos + redirects


# ---------------------------------------------------------------- casamento
def norm(s):
    s = s.lower().replace('&', ' and ')
    return re.sub(r'\s+', ' ', re.sub(r'[^a-z0-9 ]', ' ', s)).strip()

def sem_paren(s):
    return re.sub(r'\([^)]*\)', ' ', s)

# A planilha e o wiki discordam na numeracao: "Snowman 1..5" numa,
# "Snowman II..V" na outra — e no "Gun Girl" e o contrario.
R2A = {'i':'1','ii':'2','iii':'3','iv':'4','v':'5','vi':'6','vii':'7','viii':'8','ix':'9','x':'10'}
A2R = {v: k for k, v in R2A.items()}

def num_var(s):
    out, w = [], s.split()
    if not w: return out
    last = w[-1].lower().strip('.')
    if last in R2A: out.append(' '.join(w[:-1] + [R2A[last]]))
    if last in A2R: out.append(' '.join(w[:-1] + [A2R[last].upper()]))
    if last in R2A or last in A2R: out.append(' '.join(w[:-1]))
    else: out += [s + ' 1', s + ' I']
    return out

def sem_colchete(s):
    return re.sub(r'\[[^\]]*\]', ' ', s)

# Regras marcadas como 'chute' precisam de conferencia humana: elas
# acertam na maioria das vezes, mas sao as unicas capazes de apontar
# pra OUTRA unidade (foi assim que "Platinum God" virou "God").
SEGURO, CHUTE = 'seguro', 'chute'

def variantes(nome):
    """Todas as formas de escrever esse nome que valem tentar, da MAIS
       confiavel pra MENOS — a primeira que casar vence, entao a ordem
       aqui e o que separa a imagem certa da imagem de outra unidade.
       Devolve pares (texto, confianca)."""
    out = []
    lados = [x.strip() for x in nome.split(' / ')] if ' / ' in nome else [nome]

    # A) O nome inteiro e cada lado da barra, exatamente como estao.
    #    Tem que vir primeiro: "Blossom [EXT]" normaliza pra "blossom ext"
    #    e casa certinho com a pagina "Blossom (EXT)". Se a gente tirasse
    #    os colchetes antes, ele casaria com a "Blossom" pura, que e outra.
    out.append((nome, SEGURO))
    out += [(p, SEGURO) for p in lados]

    # D) Numeracao romana <-> arabica — continua seguro, so troca a
    #    forma de escrever o mesmo numero.
    for p in lados:
        out += [(v, SEGURO) for v in num_var(p)]

    # Daqui pra baixo tudo APAGA pedaco do nome. Como e justamente o
    # pedaco que separa uma variante da outra ("Dungeon Queen (Flare)"
    # vira "Dungeon Queen"), tudo entra como chute.

    # B) Sem os parenteses
    out += [(sem_paren(p), CHUTE) for p in lados]

    # C) Sem os colchetes — pega paginas que juntam os dois lados, tipo
    #    "Slim Shady [Killer Bee] / Ye [Raikage] (Forever)", que no wiki
    #    vira "Slim Shady/Ye (Forever)".
    out += [(sem_colchete(nome), CHUTE), (sem_paren(sem_colchete(nome)), CHUTE)]
    for p in lados:
        q = sem_colchete(p).strip()
        if q and q != p: out += [(q, CHUTE), (sem_paren(q), CHUTE)]
        out += [(v, CHUTE) for v in num_var(sem_paren(p).strip())]

    # E) Sufixos de variacao — daqui pra baixo e chute, porque a gente
    #    esta APAGANDO informacao que distingue uma unidade da outra.
    for p in lados:
        out.append((re.sub(r'\b(shiny|alternative|alt|revived|awakened)\b', '', p, flags=re.I), CHUTE))

    # F) ULTIMO recurso: tirar a primeira palavra ("Ultra Kovegu" -> "Kovegu").
    #    So se o que sobrar for especifico o bastante. Sem esse freio,
    #    "Platinum God" virava "God" e pegava a arte de outra unidade que
    #    se chama exatamente "God" — e "Kid Koku" pegava a do Goku normal.
    for p in lados:
        w = sem_colchete(p).split()
        if len(w) > 1:
            resto = ' '.join(w[1:])
            if len(w) > 2 or len(resto) >= 7: out.append((resto, CHUTE))

    vistos, limpo = set(), []
    for texto, conf in out:
        if texto.strip() and texto not in vistos:
            vistos.add(texto); limpo.append((texto, conf))
    return limpo

def casar(nomes, paginas, aceitar_chute=True, aceitar_parecido=True):
    """Casa nomes da planilha com titulos do wiki.

       `aceitar_chute` liga as regras que APAGAM palavras ("Gold Martial
       Artist" -> "Martial Artist"). Elas mudam de unidade, entao ficam
       desligadas pro LINK: mandar o cara pra pagina errada e pior do
       que nao ter link. Pra IMAGEM valem, porque no maximo mostram a
       arte do personagem base, que ainda ajuda a reconhecer.

       `aceitar_parecido` liga a comparacao por semelhanca, que serve
       pra erro de digitacao ("Platinum" x "Platinium", "Eyezen" x
       "Eyzen"). Essa fica LIGADA nos dois casos: com corte em 0.92 ela
       so perdoa letra trocada, nao palavra inteira a menos."""
    index = {}
    def add(k, t):
        k = norm(k)
        if k and k not in index: index[k] = t
    for t in paginas:
        add(t, t); add(sem_paren(t), t); add(t.replace('-', ' '), t)
        for v in num_var(t): add(v, t)
        for v in num_var(sem_paren(t).strip()): add(v, t)

    chaves = list(index)
    achados = {}
    for nome in nomes:
        alvo = conf = None
        for texto, c in variantes(nome):
            if c == CHUTE and not aceitar_chute: continue
            if norm(texto) in index:
                alvo, conf = index[norm(texto)], c; break
        if not alvo and aceitar_parecido:  # ultima tentativa: nome parecido
            for texto, c in variantes(nome):
                if c == CHUTE and not aceitar_chute: continue
                k = norm(texto)
                if len(k) < 4: continue
                m = difflib.get_close_matches(k, chaves, n=1, cutoff=0.92)
                if m: alvo, conf = index[m[0]], CHUTE; break
        if alvo: achados[nome] = {'pagina': alvo, 'conf': conf}
    return achados


# ---------------------------------------------------------------- escrita
INICIO = 'IMAGENS DAS UNIDADES — INÍCIO'
FIM    = 'IMAGENS DAS UNIDADES — FIM'

def gravar(achados):
    html = open(HTML, encoding='utf-8').read()
    i, f = html.find(INICIO), html.find(FIM)
    if i < 0 or f < 0:
        print('ERRO: nao achei os marcadores no index.html'); sys.exit(1)
    ini_tag = html.rfind('<script>', i, f)
    fim_tag = html.find('</script>', ini_tag)

    def esc(s):
        return s.replace('\\', '\\\\').replace('"', '\\"')

    imagens, links = achados

    linhas = ['<script>window.ASTD_IMAGES = {']
    for k in sorted(imagens):
        linhas.append(f'  "{esc(k)}": "{imagens[k]}",')
    linhas.append('};')

    # Titulo da pagina no wiki, pra montar o link de cada unidade.
    linhas.append('window.ASTD_WIKI = {')
    for k in sorted(links):
        linhas.append(f'  "{esc(k)}": "{esc(links[k])}",')
    linhas.append('};')

    novo = html[:ini_tag] + '\n'.join(linhas) + html[fim_tag:]
    open(HTML, 'w', encoding='utf-8').write(novo)


if __name__ == '__main__':
    print('1/4  lendo a planilha...')
    nomes = ler_planilha()
    print(f'     {len(nomes)} itens')

    print('2/4  lendo o wiki (demora ~1 min)...')
    imgs, todas_paginas = ler_wiki()

    print('3/4  casando os nomes...')
    # IMAGEM: so paginas que tem foto, e chute vale
    m_img = casar(nomes, list(imgs), aceitar_chute=True)
    imagens = {k: imgs[v['pagina']] for k, v in m_img.items()}

    # LINK: TODAS as paginas (varias existem sem foto), e chute NAO vale
    m_link = casar(nomes, todas_paginas, aceitar_chute=False)
    links = {k: v['pagina'] for k, v in m_link.items()}

    print(f'     {len(imagens)} com imagem, {len(links)} com link do wiki')

    print('4/4  gravando no index.html...')
    gravar((imagens, links))
    print('     pronto!')

    sem_img  = [n for n in nomes if n not in imagens]
    sem_link = [n for n in nomes if n not in links]

    # Casou a imagem por aproximacao: a foto pode ser a do personagem
    # base em vez da variante. Vale uma conferida no site.
    chutes = sorted(k for k, v in m_img.items() if v['conf'] == CHUTE)
    if chutes:
        print(f'\n=== IMAGEM POR APROXIMACAO ({len(chutes)}) — confira no site ===')
        for k in chutes:
            print(f'  {k[:46]:48} -> {m_img[k]["pagina"]}')

    print(f'\nSem link ({len(sem_link)}) — o wiki nao tem pagina propria pra eles:')
    for n in sem_link[:30]: print('  -', n)
    if len(sem_link) > 30: print(f'  ... e mais {len(sem_link)-30}')

    print(f'\nSem imagem ({len(sem_img)}) — normal para caixas, gamepasses e ovos.')
