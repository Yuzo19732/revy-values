import os
import re
import shutil
import subprocess
import sys

AQUI = os.path.dirname(os.path.abspath(__file__))
FONTE = os.path.join(os.path.dirname(AQUI), 'bot', 'index.ts')
SAIDA = os.path.join(AQUI, 'logica.js')

TRECHOS = [
    ('type Unidade = {',        'const TIER_NOME'),
    ('const TIER_NOME',         'type Celula'),
    ('type Celula =',           '/* Guardo o resultado na memoria'),
    ('let cache:',              '/* ------------------------------------------------------------\n   3) ACHAR A UNIDADE'),
    ('const normalizar =',      '/* ------------------------------------------------------------\n   4) A ARTE'),
]

EXPORTA = ['valores', 'procurar', 'normalizar', 'pontuar', 'TIER_NOME', 'ORDEM_TIER', 'APELIDOS']

def main():
    if not os.path.exists(FONTE):
        sys.exit('Nao achei o %s' % FONTE)

    fonte = open(FONTE, encoding='utf-8', newline='').read()

    partes = []
    for ini, fim in TRECHOS:
        i = fonte.find(ini.replace('\n', '\r\n')) if '\n' in ini else fonte.find(ini)
        if i < 0:
            i = fonte.find(ini)
        if i < 0:
            sys.exit('Nao achei no index.ts o trecho que comeca com: %s' % ini[:40])
        f = fonte.find(fim.replace('\n', '\r\n'), i)
        if f < 0:
            f = fonte.find(fim, i)
        if f < 0:
            sys.exit('Nao achei o fim do trecho: %s' % fim[:40])
        partes.append(fonte[i:f])

    cabecalho = (
        '// GERADO AUTOMATICAMENTE por gerar-logica.py — nao edite aqui.\n'
        '// A fonte e ../bot/index.ts. Mexeu la, rode o script de novo.\n\n'
        "const CHAVE_GOOGLE = process.env.GOOGLE_API_KEY ?? ''\n"
        "const PLANILHA = '1Z20NUscF9Id2Sss-osT-Xq06gz9ooikt6Kjtianeg0I'\n"
        'declare const process: any\n\n'
    )
    rodape = '\n\nexport { %s }\n' % ', '.join(EXPORTA)

    tmp = os.path.join(AQUI, '_logica.ts')
    open(tmp, 'w', encoding='utf-8').write(cabecalho + '\n\n'.join(partes) + rodape)

    print('compilando...')
    r = subprocess.run(
        ['npx', '--yes', '-p', 'typescript@5.6', 'tsc',
         '--target', 'es2022', '--module', 'es2022', '--skipLibCheck',
         '--lib', 'es2022,dom', tmp],
        capture_output=True, text=True, shell=(os.name == 'nt'))

    gerado = tmp[:-3] + '.js'
    if not os.path.exists(gerado):
        print(r.stdout[-1500:] or r.stderr[-1500:])
        sys.exit('o compilador nao gerou o arquivo')

    js = open(gerado, encoding='utf-8').read()
    open(SAIDA, 'w', encoding='utf-8').write(js)
    os.remove(tmp)
    os.remove(gerado)

    linhas = js.count('\n')
    print('logica.js: %d linhas, %.1f KB' % (linhas, len(js) / 1024))
    if r.returncode != 0:
        print()
        print('(o compilador reclamou de algo, mas gerou assim mesmo:)')
        print(r.stdout[-600:])

if __name__ == '__main__':
    main()
