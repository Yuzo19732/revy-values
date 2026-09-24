import json
import os
import re
import sys
import urllib.error
import urllib.request

AQUI = os.path.dirname(os.path.abspath(__file__))
MANTER = {'unitinfo'}

def credenciais():
    caminho = os.path.join(AQUI, 'discord.txt')
    if not os.path.exists(caminho):
        sys.exit('Falta o discord.txt. Rode o registrar-comando.py primeiro.')
    texto = open(caminho, encoding='utf-8', errors='replace').read()

    token = re.search(r'[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{20,}', texto)
    if not token:
        sys.exit('Nao achei o Token no discord.txt.')

    sem_token = texto.replace(token.group(0), ' ')
    ids = re.findall(r'\b\d{15,25}\b', sem_token)
    if not ids:
        sys.exit('Nao achei o Application ID no discord.txt.')

    return ids[0], token.group(0), (ids[1] if len(ids) > 1 else None)

def chamar(url, token, metodo='GET', dados=None):
    req = urllib.request.Request(
        url, method=metodo,
        data=json.dumps(dados).encode() if dados is not None else None,
        headers={
            'Authorization': 'Bot ' + token,
            'Content-Type': 'application/json',
            'User-Agent': 'RevyValues (https://astdvalues.netlify.app, 2.0)',
        })
    with urllib.request.urlopen(req, timeout=40) as r:
        corpo = r.read()
        return json.loads(corpo) if corpo else []

def main():
    app_id, token, servidor = credenciais()
    limpar = '--limpar' in sys.argv
    so_global = '--so-global' in sys.argv

    if so_global:
        if not servidor:
            sys.exit('Preciso do ID do servidor no discord.txt pra limpar a lista dele.')
        url = ('https://discord.com/api/v10/applications/%s/guilds/%s/commands'
               % (app_id, servidor))
        antes = chamar(url, token)
        chamar(url, token, 'PUT', [])
        print('lista do servidor esvaziada (%d comando(s) removido(s))' % len(antes))
        for c in antes:
            print('   tirado do servidor: /%s' % c['name'])
        print()
        print('Ficou so a global. Se ainda aparecer duplicado, de Ctrl+R no Discord.')
        return 0

    escopos = [('GLOBAL', 'https://discord.com/api/v10/applications/%s/commands' % app_id)]
    if servidor:
        escopos.append(('SERVIDOR %s' % servidor,
                        'https://discord.com/api/v10/applications/%s/guilds/%s/commands'
                        % (app_id, servidor)))
    else:
        print('(sem ID de servidor no discord.txt — vou olhar so os globais)')
        print('Se os comandos velhos forem de um servidor especifico, acrescente')
        print('o ID dele no discord.txt e rode de novo.')
        print()

    sobrando = 0

    for rotulo, url in escopos:
        try:
            lista = chamar(url, token)
        except urllib.error.HTTPError as e:
            print('%s: falhou (HTTP %s)' % (rotulo, e.code))
            continue

        print('%s — %d comando(s)' % (rotulo, len(lista)))
        if not lista:
            print('   (vazio)')
        for c in lista:
            marca = 'manter' if c['name'] in MANTER else 'SOBRANDO'
            print('   /%-14s %s' % (c['name'], marca))
            if c['name'] not in MANTER:
                sobrando += 1
        print()

        if limpar:
            ficam = [c for c in lista if c['name'] in MANTER]
            if len(ficam) != len(lista):
                novo = [{
                    'name': c['name'],
                    'description': c['description'],
                    'type': c.get('type', 1),
                    'options': c.get('options', []),
                } for c in ficam]
                chamar(url, token, 'PUT', novo)
                print('   -> limpo, sobraram %d' % len(ficam))
                print()

    if not limpar:
        if sobrando:
            print('Achei %d comando(s) sobrando.' % sobrando)
            print('Pra remover:  python limpar-comandos.py --limpar')
        else:
            print('Nada sobrando — so o /unitinfo em cada lugar.')
    else:
        print('Pronto.')
        print('Comando de servidor some na hora; global pode levar ate 1 hora.')
        print('Se continuar aparecendo, feche e abra o Discord (Ctrl+R).')

    return 0

if __name__ == '__main__':
    sys.exit(main())
