# -*- coding: utf-8 -*-
"""
Cadastra os comandos de barra no Discord.

Roda UMA vez (e de novo sempre que mudar nome/descricao de comando).

    python 02-registrar-comandos.py

Ele pede o Application ID e o Bot Token — os dois estao no
Discord Developer Portal, na sua aplicacao.

Comandos globais demoram ate 1 hora pra aparecer em todos os servidores.
Se quiser testar na hora, informe tambem o ID do seu servidor quando ele
perguntar: comando de servidor aparece na mesma hora.
"""

import json, os, sys, urllib.request

COMANDOS = [
    {
        "name": "myinventory",
        "description": "Show your own ASTD inventory and its total value",
        "type": 1,
    },
    {
        "name": "inventory",
        "description": "Show another player's ASTD inventory",
        "type": 1,
        "options": [{
            "name": "user",
            "description": "Who do you want to look up?",
            "type": 6,          # 6 = usuario do Discord
            "required": True,
        }],
    },
    {
        "name": "unitinfo",
        "description": "Everything about a unit: value, rarity, supply, demand, notes and art",
        "type": 1,
        "options": [{
            "name": "unit",
            "description": "Start typing the unit name",
            "type": 3,              # 3 = texto
            "required": True,
            "autocomplete": True,   # o bot sugere enquanto voce digita
        }],
    },
    {
        "name": "wfl",
        "description": "Win / Fair / Loss — compare a trade",
        "type": 1,
        "options": [{
            "name": "trade",
            "description": 'What you give "for" what you get. Ex: death and demise for aqua',
            "type": 3,          # 3 = texto
            "required": True,
        }],
    },
]


def chamar(url, token, dados):
    req = urllib.request.Request(
        url, method='PUT',
        data=json.dumps(dados).encode(),
        headers={
            'Authorization': f'Bot {token}',
            'Content-Type': 'application/json',
            'User-Agent': 'ASTDValues (https://astdvalues.netlify.app, 1.0)',
        },
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.status, json.loads(r.read())


# Caminho baseado na pasta DESTE arquivo, nao na pasta onde o terminal
# esta. Sem isso, rodar de outro lugar cria o credenciais.txt no lugar
# errado e a pessoa nao acha.
PASTA   = os.path.dirname(os.path.abspath(__file__))
ARQUIVO = os.path.join(PASTA, 'credenciais.txt')
MODELO = """# Preencha os valores depois do "=" e salve.
# Apague este arquivo depois que os comandos forem cadastrados.

APPLICATION_ID=
BOT_TOKEN=
# opcional: ID do servidor pra testar na hora (deixe vazio pra global)
GUILD_ID=
"""


def ler_arquivo():
    """Le as credenciais de credenciais.txt, se existir."""
    if not os.path.exists(ARQUIVO):
        return None
    dados = {}
    for linha in open(ARQUIVO, encoding='utf-8'):
        linha = linha.strip()
        if not linha or linha.startswith('#') or '=' not in linha:
            continue
        k, v = linha.split('=', 1)
        dados[k.strip().upper()] = v.strip()
    return dados


if __name__ == '__main__':
    dados = ler_arquivo()

    if dados is None:
        # primeira vez: cria o modelo e explica
        with open(ARQUIVO, 'w', encoding='utf-8') as f:
            f.write(MODELO)
        print('Criei este arquivo:\n')
        print(f'    {ARQUIVO}\n')
        print('1. Abra ele no Bloco de Notas')
        print('2. Cole o Application ID e o Bot Token depois do "="')
        print('3. Salve e rode este script de novo\n')
        print('Assim voce cola com Ctrl+V normal, sem brigar com o terminal.')
        sys.exit(0)

    app_id = dados.get('APPLICATION_ID', '')
    token  = dados.get('BOT_TOKEN', '')
    guild  = dados.get('GUILD_ID', '')

    if not app_id or not token:
        print(f'Faltou preencher em:\n    {ARQUIVO}\n')
        if not app_id: print('   - APPLICATION_ID')
        if not token:  print('   - BOT_TOKEN')
        sys.exit(1)

    alvo = (f'https://discord.com/api/v10/applications/{app_id}/guilds/{guild}/commands'
            if guild else
            f'https://discord.com/api/v10/applications/{app_id}/commands')

    print(f'\nCadastrando {len(COMANDOS)} comandos', '(neste servidor)' if guild else '(globais)', '...')
    try:
        status, resp = chamar(alvo, token, COMANDOS)
    except urllib.error.HTTPError as e:
        print(f'\nERRO {e.code}: {e.read().decode()[:400]}')
        if e.code == 401:
            print('\n-> Token errado. Use o Bot Token (aba "Bot"),')
            print('   nao o Client Secret (aba "OAuth2"). Sao coisas diferentes.')
        elif e.code == 403:
            print('\n-> O bot ainda nao esta nesse servidor.')
            print('   Comando de servidor so pode ser criado onde o bot ja foi convidado.')
            print('\n   Abra esta URL no navegador e autorize:')
            print(f'   https://discord.com/api/oauth2/authorize'
                  f'?client_id={app_id}&scope=applications.commands')
            print('\n   Depois rode este script de novo.')
            print('   (Ou apague o GUILD_ID pra cadastrar global, que nao exige convite.)')
        sys.exit(1)

    print(f'OK ({status}). Comandos no ar:')
    for c in resp:
        print('   /' + c['name'])

    if guild:
        print('\nJa aparecem nesse servidor. Se nao vier, digite / e espere a lista carregar.')
    else:
        print('\nComandos globais podem levar ate 1 hora pra aparecer em todo lugar.')

    print(f'\nPronto. Agora pode APAGAR o arquivo "{ARQUIVO}" — ele tem o seu Bot Token.')
