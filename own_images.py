# -*- coding: utf-8 -*-
"""
Coloca SUAS proprias imagens no site (elas ganham do wiki).

Como usar:
  1. Salve a imagem na pasta `imagens/` com o nome da unidade.
     Pode ser o nome do jogo ou o do anime — os dois funcionam:
        imagens/fire king.png       -> Fire King / Sabo
        imagens/aqua.png            -> Water Goddess / Aqua
     Formatos: png, jpg, webp, gif.
  2. Rode:   python imagens_proprias.py
  3. Recarregue o site.

O script encolhe cada imagem pra 160px, converte pra webp (fica
uns 10x menor) e embute dentro do index.html. Embutir e de proposito:
assim voce pode mandar o index.html pra alguem que as imagens vao junto.

Ele NAO mexe no bloco do wiki — os dois convivem, e o seu ganha.
"""

import os, re, csv, io, sys, glob, base64, urllib.request, urllib.parse, difflib

PASTA   = 'imagens'
HTML    = 'index.html'
LARGURA = 160                      # do tamanho que o site mostra (60px em telas 2x)
SHEET_ID = '1Z20NUscF9Id2Sss-osT-Xq06gz9ooikt6Kjtianeg0I'
GIDS = {'New Units':'598345464','S Tier':'1154918591','A Tier':'2023119820',
        'B Tier':'1418037381','C Tier':'2096364692','Pure Tier':'253483720',
        'Oddities':'459291543','Untiered':'1974142836'}

INICIO = 'MINHAS IMAGENS — INÍCIO'
FIM    = 'MINHAS IMAGENS — FIM'

try:
    from PIL import Image
except ImportError:
    print('Falta a biblioteca Pillow. Rode:  pip install Pillow'); sys.exit(1)


def norm(s):
    s = s.lower().replace('&', ' and ')
    return re.sub(r'\s+', ' ', re.sub(r'[^a-z0-9 ]', ' ', s)).strip()

# O wiki numera com romano ("Snowman II") e a planilha com arabico
# ("Snowman 2") — as duas formas tem que casar.
R2A = {'i':'1','ii':'2','iii':'3','iv':'4','v':'5',
       'vi':'6','vii':'7','viii':'8','ix':'9','x':'10'}
A2R = {v: k for k, v in R2A.items()}

def num_var(s):
    """Devolve o mesmo nome com a numeracao do outro jeito."""
    out, w = [], s.split()
    if not w: return out
    last = w[-1]
    if last in R2A: out.append(' '.join(w[:-1] + [R2A[last]]))
    if last in A2R: out.append(' '.join(w[:-1] + [A2R[last]]))
    return out


def nomes_da_planilha():
    nomes = []
    for gid in GIDS.values():
        url = (f'https://docs.google.com/spreadsheets/d/{SHEET_ID}/gviz/tq'
               f'?tqx=out:csv&gid={gid}&headers=0')
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        rows = list(csv.reader(io.StringIO(urllib.request.urlopen(req, timeout=45)
                                           .read().decode('utf-8'))))
        cols = None
        for r in rows:
            low = [c.strip().lower() for c in r]
            if 'notices' in low:
                n = low.index('notices')
                cols = dict(v=2 if n > 2 else None, r=3 if n > 3 else None); continue
            if not cols or len(r) < 2: continue
            nm = r[1].strip()
            if not nm: continue
            vv = r[cols['v']].strip() if cols['v'] is not None and len(r) > cols['v'] else ''
            rr = r[cols['r']].strip() if cols['r'] is not None and len(r) > cols['r'] else ''
            if cols['v'] is not None and not vv and not rr: continue
            if nm not in nomes: nomes.append(nm)
    return nomes


def achar_unidade(arquivo, nomes):
    """Descobre a qual unidade esse arquivo pertence.
       Devolve (nome, motivo) ou (None, motivo do fracasso)."""
    cru = os.path.splitext(os.path.basename(arquivo))[0]
    # Arquivo baixado do wiki costuma vir com codigo de URL no nome:
    # "40%25_Egg" e na verdade "40% Egg" (%25 = %). Sem desfazer isso,
    # o "25" vira parte do nome e nada casa.
    try: cru = urllib.parse.unquote(cru)
    except Exception: pass
    base = norm(cru)

    def lado(n, i):
        p = n.split(' / ')
        return norm(p[i]) if len(p) > i else ''

    # Antes de qualquer coisa: esse nome de arquivo serve pra mais de
    # uma unidade? Acontece de verdade — "Slim Shady [Killer Bee]" bate
    # exatamente com a unidade "Slim Shady / Killer Bee" E tambem e o
    # comeco de "Slim Shady [Killer Bee] / Ye [Raikage] (Forever)".
    # Nesse caso e melhor reclamar do que escolher no chute e o cara
    # so descobrir a troca olhando o site depois.
    # o proprio nome e as versoes com a numeracao trocada
    bases = [base] + num_var(base)

    exatos  = [n for n in nomes if any(norm(n) == b or lado(n, 0) == b for b in bases)]
    comecos = [n for n in nomes if any(norm(n).startswith(b + ' ') for b in bases)]
    outros  = [c for c in comecos if c not in exatos]

    # Se bate EXATO com uma unidade so, ela ganha — mesmo que existam
    # variantes que comecam igual. "Spade.webp" e a Spade base, nao a
    # "Spade (Dark)". So avisamos que as outras existem, caso voce
    # quisesse uma delas.
    if len(exatos) == 1:
        aviso = ''
        if outros:
            aviso = ' [ATENCAO: existe tambem ' + ', '.join(f'"{o}"' for o in outros[:3]) + \
                    ' — se era essa, renomeie o arquivo pro nome completo]'
        return exatos[0], ('nome exato' + aviso)

    # Nenhum exato (ou mais de um): ai sim e ambiguidade de verdade.
    candidatos = list(dict.fromkeys(exatos + comecos))
    if len(candidatos) > 1:
        return None, ('esse nome serve pra mais de uma unidade — renomeie o '
                      'arquivo pro nome completo de qual voce quer:\n' +
                      ''.join(f'        · {c}\n' for c in candidatos).rstrip())

    # 1) igual ao nome inteiro
    ex = [n for n in nomes if any(norm(n) == b for b in bases)]
    if len(ex) == 1: return ex[0], 'nome completo'

    # 2) igual ao nome do jogo (antes da barra)
    ex = [n for n in nomes if any(lado(n, 0) == b for b in bases)]
    if len(ex) == 1: return ex[0], 'nome do jogo'

    # 3) o arquivo e o comeco do nome
    if len(comecos) == 1: return comecos[0], 'comeco do nome'

    # 4) igual ao nome do anime (depois da barra)
    ex = [n for n in nomes if lado(n, 1) == base]
    if len(ex) == 1: return ex[0], 'nome do anime'
    if len(ex) > 1: return None, f'ambiguo, bate com {len(ex)}: {ex[:3]}'

    # 5) parecido
    todos = {norm(n): n for n in nomes}
    todos.update({lado(n, 0): n for n in nomes if lado(n, 0)})
    m = difflib.get_close_matches(base, [k for k in todos if k], n=1, cutoff=0.86)
    if m: return todos[m[0]], f'parecido com "{m[0]}"'

    return None, 'nao achei nenhuma unidade com esse nome'


def encolher(caminho):
    im = Image.open(caminho)
    if im.mode not in ('RGBA', 'RGB'): im = im.convert('RGBA')
    if im.width > LARGURA:
        alt = round(im.height * LARGURA / im.width)
        im = im.resize((LARGURA, alt), Image.LANCZOS)
    buf = io.BytesIO()
    im.save(buf, 'WEBP', quality=88, method=6)
    return buf.getvalue()


def gravar(mapa):
    html = open(HTML, encoding='utf-8').read()
    i, f = html.find(INICIO), html.find(FIM)
    if i < 0 or f < 0:
        print('ERRO: nao achei os marcadores no index.html'); sys.exit(1)
    ini = html.rfind('<script>', i, f)
    fim = html.find('</script>', ini)

    linhas = ['<script>window.ASTD_IMAGES_CUSTOM = {']
    for k in sorted(mapa):
        kk = k.replace('\\', '\\\\').replace('"', '\\"')
        linhas.append(f'  "{kk}":\n    "{mapa[k]}",')
    linhas.append('};')
    open(HTML, 'w', encoding='utf-8').write(html[:ini] + '\n'.join(linhas) + html[fim:])


if __name__ == '__main__':
    arquivos = [f for f in glob.glob(os.path.join(PASTA, '*'))
                if f.lower().endswith(('.png', '.jpg', '.jpeg', '.webp', '.gif'))]
    if not arquivos:
        print(f'Nenhuma imagem em `{PASTA}/`. Coloque os arquivos la e rode de novo.')
        sys.exit(0)

    print(f'{len(arquivos)} imagem(ns) em `{PASTA}/`')
    print('lendo a planilha pra saber os nomes exatos...')
    nomes = nomes_da_planilha()
    print(f'{len(nomes)} unidades na planilha\n')

    mapa, falhas = {}, []
    for a in sorted(arquivos):
        unidade, motivo = achar_unidade(a, nomes)
        arq = os.path.basename(a)
        if not unidade:
            falhas.append((arq, motivo))
            print(f'  X  {arq[:34]:36} {motivo}')
            continue
        dados = encolher(a)
        mapa[unidade] = 'data:image/webp;base64,' + base64.b64encode(dados).decode()
        antes = os.path.getsize(a) // 1024
        print(f'  ok {arq[:34]:36} -> {unidade[:40]:42} ({antes}KB -> {len(dados)//1024}KB, {motivo})')

    if mapa:
        print(f'\ngravando {len(mapa)} no index.html...')
        gravar(mapa)
        total = sum(len(v) for v in mapa.values()) // 1024
        print(f'pronto! (+{total}KB no index.html)')

    if falhas:
        print('\nEstes nao entraram — confira o nome do arquivo:')
        for arq, motivo in falhas: print(f'  - {arq}: {motivo}')
