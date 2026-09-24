const CHAVE_GOOGLE = process.env.GOOGLE_API_KEY ?? '';
const PLANILHA = '1Z20NUscF9Id2Sss-osT-Xq06gz9ooikt6Kjtianeg0I';
const ABAS = [
    { tier: 's', aba: 'S Tier' },
    { tier: 'a', aba: 'A Tier' },
    { tier: 'b', aba: 'B Tier' },
    { tier: 'c', aba: 'C Tier' },
    { tier: 'pure', aba: 'Pure Tier' },
    { tier: 'odd', aba: 'Oddities' },
    { tier: 'un', aba: 'Untiered' },
];
const TIER_NOME = {
    s: 'S', a: 'A', b: 'B', c: 'C', pure: 'PURE', odd: 'ODD', un: '—',
};
const ORDEM_TIER = ['s', 'a', 'b', 'c', 'pure', 'odd', 'un'];

function corDaCelula(c) {
    const f = (c?.effectiveFormat || {}).backgroundColor;
    if (!f)
        return '';
    const r = f.red ?? 0, g = f.green ?? 0, b = f.blue ?? 0;
    if (r === 1 && g === 1 && b === 1)
        return '';
    const hex = (n) => Math.round(n * 255).toString(16).padStart(2, '0');
    return `#${hex(r)}${hex(g)}${hex(b)}`;
}
async function lerAba(aba) {
    const faixa = encodeURIComponent(`'${aba}'!A1:J400`);
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${PLANILHA}`
        + `?ranges=${faixa}&includeGridData=true`
        + `&fields=sheets(properties(title),data(rowData(values(formattedValue,`
        + `effectiveFormat(backgroundColor)))))&key=${CHAVE_GOOGLE}`;
    const r = await fetch(url);
    if (!r.ok)
        throw new Error(`aba ${aba}: HTTP ${r.status}`);
    const dados = await r.json();
    const folha = dados.sheets?.[0];
    if (!folha)
        return [];

    const veio = folha.properties?.title ?? '';
    if (veio.trim().toLowerCase() !== aba.trim().toLowerCase()) {
        console.error(`aba: pedi "${aba}" e veio "${veio}"`);
        return [];
    }
    return (folha.data?.[0]?.rowData ?? []).map((l) => (l.values ?? []).map((c) => ({
        cor: corDaCelula(c),
        texto: (c?.formattedValue ?? '').trim(),
    })));
}

async function lerLegenda() {
    const legenda = {};
    let dentro = false;
    for (const linha of await lerAba('Tutorial')) {
        const textos = linha.map(c => c.texto);
        if (textos.some(t => /^units tags:?$/i.test(t))) {
            dentro = true;
            continue;
        }
        if (dentro && textos.some(t => /^what is liquidity/i.test(t)))
            break;
        if (!dentro)
            continue;
        for (const c of linha) {

            if (c.cor && c.texto && c.texto.length <= 20 && !legenda[c.cor]) {
                legenda[c.cor] = c.texto;
            }
        }
    }
    return legenda;
}

function unidadesDaAba(tier, linhas, legenda) {
    const fora = [];
    let cValor = null;
    let cRar = null;
    let cLiq = null;
    let cNotas = null;
    let secao = '';
    let achouCabecalho = false;
    for (const linha of linhas) {
        const textos = linha.map(c => c.texto);
        const iNotices = textos.findIndex(t => t.toLowerCase() === 'notices');
        if (iNotices >= 0) {
            cNotas = iNotices;
            cValor = iNotices > 2 ? 2 : null;
            cRar = iNotices > 3 ? 3 : null;
            cLiq = iNotices > 4 ? 4 : null;
            const rotulo = (textos[1] ?? '').trim();
            secao = /^(names?|units?)$/i.test(rotulo) ? '' : rotulo;
            achouCabecalho = true;
            continue;
        }
        if (!achouCabecalho)
            continue;
        const nome = (textos[1] ?? '').trim();
        if (!nome)
            continue;
        const bruto = cValor !== null ? (textos[cValor] ?? '').trim() : '';
        const rar = cRar !== null ? (textos[cRar] ?? '').trim() : '';

        if (cValor !== null && !bruto && !rar)
            continue;
        const numero = (s) => {
            const n = Number(s.replace(/[,\s]/g, ''));
            return s && Number.isFinite(n) ? n : null;
        };
        const valor = numero(bruto);
        fora.push({
            chave: `${tier}|${nome}`,
            tier, nome, secao,
            valor,
            valorTexto: valor === null ? bruto : '',
            raridade: numero(rar),
            liquidez: cLiq !== null ? (textos[cLiq] ?? '').trim() : '',
            notas: cNotas !== null ? (textos[cNotas] ?? '').trim() : '',
            tag: cValor !== null ? (legenda[linha[cValor]?.cor ?? ''] ?? '') : '',
            tag2: cLiq !== null ? (legenda[linha[cLiq]?.cor ?? ''] ?? '') : '',
        });
    }
    return fora;
}
let cache = null;
const CACHE_MS = 15 * 60 * 1000;
async function valores() {
    if (cache && Date.now() - cache.em < CACHE_MS)
        return cache.dados;
    const legenda = await lerLegenda();
    const mapa = new Map();
    await Promise.all(ABAS.map(async ({ tier, aba }) => {
        for (const u of unidadesDaAba(tier, await lerAba(aba), legenda))
            mapa.set(u.chave, u);
    }));
    if (mapa.size)
        cache = { em: Date.now(), dados: mapa };
    return mapa;
}
const normalizar = (s) => s.toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
const semPlural = (p) => (p.length > 3 && p.endsWith('s') ? p.slice(0, -1) : p);

const APELIDOS = {
    cren: 'challenger rengoku',
    dbz: 'legendary borul alternative dbz broly',
    udbz: 'ultra legendary borul alternative ultra dbz broly',
    hashi: 'hashirama',
    yama: 'yamamoto',
    drb: 'dark rock blaster',
    lrb: 'light rock blaster',
    dace: 'dark ace',

    ulq: 'dark wing ulquiorra',
    'g ulq': 'gold dark wing gold ulquiorra',
    mura: 'flame servant senji muramasa',
    gmura: 'gold flame servant gold senji muramasa',
    sdio: 'shadow zio shadow dio',
    hdio: 'heaven zio heaven dio',
    flaw: 'nurse heart female law',
    femjo: 'mysterious x girl fem gojo',

    a21: 'bot 12 lab android 21 lab coat',
    'bot 12': 'bot 12 lab android 21 lab coat',
    'android 12': 'bot 12 lab android 21 lab coat',
    'android 21': 'bot 12 lab android 21 lab coat',
    cumber: 'jinjou cumber',
    'g mura': 'gold flame servant gold senji muramasa',
    'g senji': 'gold flame servant gold senji muramasa',
    tobi: 'tomi tobi',
    gtobi: 'gold tomi gold tobi',
    gtomi: 'gold tomi gold tobi',
    femlaw: 'nurse heart female law',
    'female gojo': 'mysterious x girl fem gojo',
    femgojo: 'mysterious x girl fem gojo',
    stella: 'dark rock blaster stella',
    'gogeta evo': 'ultra kovegu ssj3 gogeta',
    k: 'leaf koishi komeji',
    pyama: 'pure yamamoto',
    pkaido: 'pure kaido',
    phashi: 'pure hashirama',
    pcren: 'pure challenger rengoku',
    pryuk: 'pure ryuk',
    pdouma: 'pure douma',
    paizen: 'pure hogyoku aizen',
    phog: 'pure hogyoku aizen',
    ppadoru: 'pure nero padoru',
    pdbz: 'pure dbz broly',
    psinbad: 'pure sinbad',
    paqua: 'pure aqua',
    pgrr: 'pure zaruto grr iii',
};

const TIER_ESCRITO = {
    pure: 'pure', pures: 'pure',
    oddity: 'odd', oddities: 'odd', odd: 'odd',
    untiered: 'un',
};
const LETRA_TIER = ['s', 'a', 'b', 'c'];
function separarTier(termo) {
    const partes = normalizar(termo).split(' ').filter(Boolean);
    if (partes.length > 1 && LETRA_TIER.includes(partes[0])) {
        return { tier: partes[0], resto: partes.slice(1).join(' ') };
    }
    for (let i = 0; i < partes.length; i++) {
        const direto = TIER_ESCRITO[partes[i]];
        if (direto) {
            const resto = [...partes.slice(0, i), ...partes.slice(i + 1)].join(' ');
            if (resto)
                return { tier: direto, resto };
        }

        if (partes[i + 1] === 'tier' && [...LETRA_TIER, 'pure'].includes(partes[i])) {
            const resto = [...partes.slice(0, i), ...partes.slice(i + 2)].join(' ');
            if (resto)
                return { tier: partes[i], resto };
        }
    }
    return { tier: '', resto: '' };
}
const CERTEZA = 60;

function pontuar(u, q) {
    const nome = normalizar(u.nome);
    if (nome === q)
        return 1000;
    if (nome.startsWith(q))
        return 500;

    const metades = nome.split(' ').join(' ');
    let n = 0;
    if (metades.includes(q))
        n += 200;
    const pedacos = q.split(' ').filter(Boolean).map(semPlural);
    const doNome = nome.split(' ').filter(Boolean).map(semPlural);
    let bateram = 0;
    for (const p of pedacos) {
        if (doNome.some(d => d === p)) {
            bateram++;
            n += 60;
        }
        else if (doNome.some(d => d.startsWith(p) && p.length >= 3)) {
            bateram++;
            n += 30;
        }
    }

    if (pedacos.length && bateram < pedacos.length)
        n = Math.floor(n / 3);
    return n;
}
function procurarCru(termo, precos) {
    const q = normalizar(termo);
    if (!q)
        return { tipo: 'nada' };
    const notas = [];
    for (const u of precos.values()) {
        const n = pontuar(u, q);
        if (n > 0)
            notas.push({ u, n });
    }
    if (!notas.length)
        return { tipo: 'nada' };
    notas.sort((a, b) => b.n - a.n || ORDEM_TIER.indexOf(a.u.tier) - ORDEM_TIER.indexOf(b.u.tier));
    const melhor = notas[0];
    const segundo = notas[1];

    if (melhor.n >= CERTEZA && (!segundo || melhor.n >= segundo.n * 1.5)) {
        return { tipo: 'achou', u: melhor.u };
    }
    const proximos = notas.filter(x => x.n >= melhor.n * 0.6).slice(0, 25);
    if (proximos.length === 1)
        return { tipo: 'achou', u: proximos[0].u };

    const nomes = new Set(proximos.map(x => x.u.nome));
    if (nomes.size === 1)
        return { tipo: 'achou', u: proximos[0].u };
    return { tipo: 'duvida', opcoes: proximos.map(x => x.u) };
}

function comApelidos(termo, precos) {
    const q = normalizar(termo);

    if (APELIDOS[q]) {
        const pelaGiria = procurarCru(APELIDOS[q], precos);
        if (pelaGiria.tipo !== 'nada')
            return pelaGiria;
    }

    const direto = procurarCru(termo, precos);
    if (direto.tipo === 'achou')
        return direto;
    const aberto = q.split(' ').map(p => APELIDOS[p] ?? p).join(' ');
    if (aberto !== q) {
        const x = procurarCru(aberto, precos);
        if (x.tipo !== 'nada')
            return x;
    }
    return direto;
}

function fatiar(q, palavras) {
    let melhor = 0;
    let visitas = 0;
    const tentar = (i, w, pedacos, pulos, inteiras) => {
        if (++visitas > 4000)
            return;
        if (i >= q.length) {
            const n = 100 - pedacos * 9 - pulos * 4 + inteiras * 12;
            if (n > melhor)
                melhor = n;
            return;
        }
        if (w >= palavras.length)
            return;
        tentar(i, w + 1, pedacos, pulos + 1, inteiras);
        const p = palavras[w];
        for (let k = Math.min(p.length, q.length - i); k >= 1; k--) {
            if (q.startsWith(p.slice(0, k), i)) {
                tentar(i + k, w + 1, pedacos + 1, pulos, inteiras + (k === p.length ? 1 : 0));
            }
        }
    };
    tentar(0, 0, 0, 0, 0);
    return melhor;
}
function porFatias(termo, precos) {
    const q = normalizar(termo).replace(/ /g, '');

    if (q.length < 3)
        return { tipo: 'nada' };
    const notas = [];
    for (const u of precos.values()) {
        const n = fatiar(q, normalizar(u.nome).split(' ').filter(Boolean));
        if (n > 0)
            notas.push({ u, n });
    }
    if (!notas.length)
        return { tipo: 'nada' };
    notas.sort((a, b) => b.n - a.n || ORDEM_TIER.indexOf(a.u.tier) - ORDEM_TIER.indexOf(b.u.tier));
    const melhor = notas[0];
    const empatados = notas.filter(x => x.n === melhor.n);
    if (empatados.length === 1)
        return { tipo: 'achou', u: melhor.u };

    if (new Set(empatados.map(x => x.u.nome)).size === 1) {
        return { tipo: 'achou', u: empatados[0].u };
    }
    return { tipo: 'duvida', opcoes: empatados.slice(0, 25).map(x => x.u) };
}
function procurar(termo, precos) {

    const expandido = APELIDOS[normalizar(termo)] ?? termo;
    const { tier, resto } = separarTier(expandido);
    if (tier && resto) {
        const soDoTier = new Map([...precos].filter(([, u]) => u.tier === tier));
        if (soDoTier.size) {
            const r = comApelidos(resto, soDoTier);
            if (r.tipo !== 'nada')
                return r;
        }
    }
    const normal = comApelidos(termo, precos);
    if (normal.tipo !== 'nada')
        return normal;

    return porFatias(termo, precos);
}
export { valores, procurar, normalizar, pontuar, TIER_NOME, ORDEM_TIER, APELIDOS };
