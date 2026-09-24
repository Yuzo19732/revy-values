import json
import os
import re
import sys
import urllib.error
import urllib.request

AQUI = os.path.dirname(os.path.abspath(__file__))

COMANDOS = [
    {
        'name': 'unitinfo',
        'description': 'Value, rarity, liquidity, notes and art for an ASTD unit',
        'type': 1,
        'options': [{
            'name': 'unit',
            'description': 'Start typing the name, or use a nickname like cren, drb, pyama',
            'type': 3,
            'required': True,
            'autocomplete': True,
        }],
    },
]

def credenciais():
    caminho = os.path.join(AQUI, 'discord.txt')
    if not os.path.exists(caminho):
        modelo = (
            'Cole as duas coisas aqui embaixo e salve (Ctrl+S).\n'
            'Nao precisa apagar este texto — o script acha sozinho.\n\n'
            'Onde tirar: discord.com/developers/applications -> sua aplicacao\n\n'
            '  1) Application ID  (em General Information, so numeros)\n'
            '  2) Bot Token       (em Bot -> Reset Token, aparece uma vez so)\n\n'
            'ATENCAO: o Bot Token controla o bot inteiro. Fica so neste\n'
            'arquivo, que esta no .gitignore. Apague depois de usar.\n\n'
            'APPLICATION ID:\n\n'
            'TOKEN:\n'
        )
        open(caminho, 'w', encoding='utf-8').write(modelo)
        sys.exit('Criei o discord.txt aqui na pasta. Preencha e rode de novo.')

    texto = open(caminho, encoding='utf-8', errors='replace').read()

    ids = [n for n in re.findall(r'\b\d{15,25}\b', texto)]
    token = re.search(r'[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{20,}', texto)

    if not ids or not token:
        sys.exit('Nao achei o Application ID e/ou o Token no discord.txt.')

    return ids[0], token.group(0), (ids[1] if len(ids) > 1 else None)

def chamar(url, token, dados):
    req = urllib.request.Request(
        url, method='PUT', data=json.dumps(dados).encode(),
        headers={
            'Authorization': 'Bot ' + token,
            'Content-Type': 'application/json',
            'User-Agent': 'RevyValues (https://astdvalues.netlify.app, 2.0)',
        })
    with urllib.request.urlopen(req, timeout=40) as r:
        return json.load(r)

def main():
    app_id, token, servidor = credenciais()
    print('aplicacao: %s' % app_id)

    if servidor:
        alvo = 'https://discord.com/api/v10/applications/%s/guilds/%s/commands' % (app_id, servidor)
        onde = 'no servidor %s (aparece na hora)' % servidor
    else:
        alvo = 'https://discord.com/api/v10/applications/%s/commands' % app_id
        onde = 'global (pode demorar ate 1 hora)'

    print('registrando %s...' % onde)
    try:
        resposta = chamar(alvo, token, COMANDOS)
    except urllib.error.HTTPError as e:
        corpo = e.read().decode('utf-8', 'replace')
        print('FALHOU — HTTP %s' % e.code)
        print(corpo[:400])
        if e.code == 401:
            print('\n401 = token errado. Confira o Bot Token no discord.txt.')
        if e.code == 403:
            print('\n403 = o bot nao esta nesse servidor. Convide ele primeiro:')
            print('https://discord.com/api/oauth2/authorize'
                  '?client_id=%s&scope=bot+applications.commands&permissions=0' % app_id)
        return 1

    print()
    print('PRONTO — %d comando(s) registrado(s):' % len(resposta))
    for c in resposta:
        print('   /%s — %s' % (c['name'], c['description']))
    print()
    print('Os comandos antigos foram removidos, como combinado.')
    print('Agora APAGUE o discord.txt: ele tem o token em texto puro.')
    return 0

if __name__ == '__main__':
    sys.exit(main())
