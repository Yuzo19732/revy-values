const CHAVE_PUBLICA = Deno.env.get('DISCORD_PUBLIC_KEY') ?? ''
const CHAVE_GOOGLE  = Deno.env.get('GOOGLE_API_KEY') ?? ''
const SUPABASE_URL  = Deno.env.get('SUPABASE_URL') ?? ''
const SITE          = Deno.env.get('SITE_URL') ?? 'https://astdvalues.netlify.app'

const LISTA_COMPLETA = Deno.env.get('LISTA_URL') ?? 'https://astdvl-testing.vercel.app'

const PLANILHA = '1Z20NUscF9Id2Sss-osT-Xq06gz9ooikt6Kjtianeg0I'
const BALDE    = 'unidades'

const nf = new Intl.NumberFormat('en-US')

const hexParaBytes = (hex: string) =>
  new Uint8Array(hex.match(/.{1,2}/g)!.map(b => parseInt(b, 16)))

async function assinaturaConfere(req: Request, corpo: string): Promise<boolean> {
  const assinatura = req.headers.get('x-signature-ed25519')
  const momento    = req.headers.get('x-signature-timestamp')
  if (!assinatura || !momento || !CHAVE_PUBLICA) return false

  try {
    const chave = await crypto.subtle.importKey(
      'raw', hexParaBytes(CHAVE_PUBLICA), { name: 'Ed25519' }, false, ['verify'])
    return await crypto.subtle.verify(
      { name: 'Ed25519' }, chave,
      hexParaBytes(assinatura),
      new TextEncoder().encode(momento + corpo))
  } catch (e) {
    console.error('assinatura:', e)
    return false
  }
}

type Unidade = {
  chave: string
  tier: string
  nome: string
  secao: string
  valor: number | null
  valorTexto: string
  raridade: number | null
  liquidez: string
  notas: string
  tag: string

  tag2: string
}

const ABAS = [
  { tier: 's',    aba: 'S Tier'    },
  { tier: 'a',    aba: 'A Tier'    },
  { tier: 'b',    aba: 'B Tier'    },
  { tier: 'c',    aba: 'C Tier'    },
  { tier: 'pure', aba: 'Pure Tier' },
  { tier: 'odd',  aba: 'Oddities'  },
  { tier: 'un',   aba: 'Untiered'  },
]

const TIER_NOME: Record<string, string> = {
  s: 'S', a: 'A', b: 'B', c: 'C', pure: 'PURE', odd: 'ODD', un: '—',
}
const ORDEM_TIER = ['s', 'a', 'b', 'c', 'pure', 'odd', 'un']

type Celula = { cor: string; texto: string }

function corDaCelula(c: any): string {
  const f = (c?.effectiveFormat || {}).backgroundColor
  if (!f) return ''
  const r = f.red ?? 0, g = f.green ?? 0, b = f.blue ?? 0
  if (r === 1 && g === 1 && b === 1) return ''
  const hex = (n: number) => Math.round(n * 255).toString(16).padStart(2, '0')
  return `#${hex(r)}${hex(g)}${hex(b)}`
}

async function lerAba(aba: string): Promise<Celula[][]> {
  const faixa = encodeURIComponent(`'${aba}'!A1:J400`)
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${PLANILHA}`
            + `?ranges=${faixa}&includeGridData=true`
            + `&fields=sheets(properties(title),data(rowData(values(formattedValue,`
            + `effectiveFormat(backgroundColor)))))&key=${CHAVE_GOOGLE}`

  const r = await fetch(url)
  if (!r.ok) throw new Error(`aba ${aba}: HTTP ${r.status}`)
  const dados = await r.json()

  const folha = dados.sheets?.[0]
  if (!folha) return []

  const veio = folha.properties?.title ?? ''
  if (veio.trim().toLowerCase() !== aba.trim().toLowerCase()) {
    console.error(`aba: pedi "${aba}" e veio "${veio}"`)
    return []
  }

  return (folha.data?.[0]?.rowData ?? []).map((l: any) =>
    (l.values ?? []).map((c: any) => ({
      cor: corDaCelula(c),
      texto: (c?.formattedValue ?? '').trim(),
    })))
}

async function lerLegenda(): Promise<Record<string, string>> {
  const legenda: Record<string, string> = {}
  let dentro = false

  for (const linha of await lerAba('Tutorial')) {
    const textos = linha.map(c => c.texto)
    if (textos.some(t => /^units tags:?$/i.test(t))) { dentro = true; continue }
    if (dentro && textos.some(t => /^what is liquidity/i.test(t))) break
    if (!dentro) continue
    for (const c of linha) {

      if (c.cor && c.texto && c.texto.length <= 20 && !legenda[c.cor]) {
        legenda[c.cor] = c.texto
      }
    }
  }
  return legenda
}

function unidadesDaAba(tier: string, linhas: Celula[][], legenda: Record<string, string>): Unidade[] {
  const fora: Unidade[] = []
  let cValor: number | null = null
  let cRar: number | null = null
  let cLiq: number | null = null
  let cNotas: number | null = null
  let secao = ''
  let achouCabecalho = false

  for (const linha of linhas) {
    const textos = linha.map(c => c.texto)
    const iNotices = textos.findIndex(t => t.toLowerCase() === 'notices')

    if (iNotices >= 0) {
      cNotas = iNotices
      cValor = iNotices > 2 ? 2 : null
      cRar   = iNotices > 3 ? 3 : null
      cLiq   = iNotices > 4 ? 4 : null
      const rotulo = (textos[1] ?? '').trim()
      secao = /^(names?|units?)$/i.test(rotulo) ? '' : rotulo
      achouCabecalho = true
      continue
    }
    if (!achouCabecalho) continue

    const nome = (textos[1] ?? '').trim()
    if (!nome) continue

    const bruto = cValor !== null ? (textos[cValor] ?? '').trim() : ''
    const rar   = cRar   !== null ? (textos[cRar]   ?? '').trim() : ''

    if (cValor !== null && !bruto && !rar) continue

    const numero = (s: string) => {
      const n = Number(s.replace(/[,\s]/g, ''))
      return s && Number.isFinite(n) ? n : null
    }
    const valor = numero(bruto)

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
    })
  }
  return fora
}

let cache: { em: number; dados: Map<string, Unidade> } | null = null
const CACHE_MS = 15 * 60 * 1000

async function valores(): Promise<Map<string, Unidade>> {
  if (cache && Date.now() - cache.em < CACHE_MS) return cache.dados

  const legenda = await lerLegenda()
  const mapa = new Map<string, Unidade>()

  await Promise.all(ABAS.map(async ({ tier, aba }) => {
    for (const u of unidadesDaAba(tier, await lerAba(aba), legenda)) mapa.set(u.chave, u)
  }))

  if (mapa.size) cache = { em: Date.now(), dados: mapa }
  return mapa
}

const normalizar = (s: string) =>
  s.toLowerCase()
   .normalize('NFD').replace(/[̀-ͯ]/g, '')
   .replace(/[^a-z0-9 ]+/g, ' ')
   .replace(/\s+/g, ' ')
   .trim()

const semPlural = (p: string) => (p.length > 3 && p.endsWith('s') ? p.slice(0, -1) : p)

const APELIDOS: Record<string, string> = {
  cren:  'challenger rengoku',
  dbz:   'legendary borul alternative dbz broly',
  udbz:  'ultra legendary borul alternative ultra dbz broly',
  hashi: 'hashirama',
  yama:  'yamamoto',
  drb:   'dark rock blaster',
  lrb:   'light rock blaster',
  dace:  'dark ace',

  ulq:     'dark wing ulquiorra',
  'g ulq': 'gold dark wing gold ulquiorra',
  mura:    'flame servant senji muramasa',
  gmura:   'gold flame servant gold senji muramasa',

  sdio:  'shadow zio shadow dio',
  hdio:  'heaven zio heaven dio',
  flaw:  'nurse heart female law',
  femjo: 'mysterious x girl fem gojo',

  a21:           'bot 12 lab android 21 lab coat',
  'bot 12':      'bot 12 lab android 21 lab coat',
  'android 12':  'bot 12 lab android 21 lab coat',
  'android 21':  'bot 12 lab android 21 lab coat',
  cumber:        'jinjou cumber',
  'g mura':      'gold flame servant gold senji muramasa',
  'g senji':     'gold flame servant gold senji muramasa',
  tobi:          'tomi tobi',
  gtobi:         'gold tomi gold tobi',
  gtomi:         'gold tomi gold tobi',
  femlaw:        'nurse heart female law',
  'female gojo': 'mysterious x girl fem gojo',
  femgojo:       'mysterious x girl fem gojo',
  stella:        'dark rock blaster stella',
  'gogeta evo':  'ultra kovegu ssj3 gogeta',
  k:             'leaf koishi komeji',

  pyama:   'pure yamamoto',
  pkaido:  'pure kaido',
  phashi:  'pure hashirama',
  pcren:   'pure challenger rengoku',
  pryuk:   'pure ryuk',
  pdouma:  'pure douma',
  paizen:  'pure hogyoku aizen',
  phog:    'pure hogyoku aizen',
  ppadoru: 'pure nero padoru',
  pdbz:    'pure dbz broly',
  psinbad: 'pure sinbad',
  paqua:   'pure aqua',
  pgrr:    'pure zaruto grr iii',
}

const TIER_ESCRITO: Record<string, string> = {
  pure: 'pure', pures: 'pure',
  oddity: 'odd', oddities: 'odd', odd: 'odd',
  untiered: 'un',
}
const LETRA_TIER = ['s', 'a', 'b', 'c']

function separarTier(termo: string): { tier: string; resto: string } {
  const partes = normalizar(termo).split(' ').filter(Boolean)

  if (partes.length > 1 && LETRA_TIER.includes(partes[0])) {
    return { tier: partes[0], resto: partes.slice(1).join(' ') }
  }
  for (let i = 0; i < partes.length; i++) {
    const direto = TIER_ESCRITO[partes[i]]
    if (direto) {
      const resto = [...partes.slice(0, i), ...partes.slice(i + 1)].join(' ')
      if (resto) return { tier: direto, resto }
    }

    if (partes[i + 1] === 'tier' && [...LETRA_TIER, 'pure'].includes(partes[i])) {
      const resto = [...partes.slice(0, i), ...partes.slice(i + 2)].join(' ')
      if (resto) return { tier: partes[i], resto }
    }
  }
  return { tier: '', resto: '' }
}

type Busca =
  | { tipo: 'achou'; u: Unidade }
  | { tipo: 'duvida'; opcoes: Unidade[] }
  | { tipo: 'nada' }

const CERTEZA = 60

function pontuar(u: Unidade, q: string): number {
  const nome = normalizar(u.nome)
  if (nome === q) return 1000
  if (nome.startsWith(q)) return 500

  const metades = nome.split(' ').join(' ')
  let n = 0
  if (metades.includes(q)) n += 200

  const pedacos = q.split(' ').filter(Boolean).map(semPlural)
  const doNome  = nome.split(' ').filter(Boolean).map(semPlural)
  let bateram = 0
  for (const p of pedacos) {
    if (doNome.some(d => d === p)) { bateram++; n += 60 }
    else if (doNome.some(d => d.startsWith(p) && p.length >= 3)) { bateram++; n += 30 }
  }

  if (pedacos.length && bateram < pedacos.length) n = Math.floor(n / 3)
  return n
}

function procurarCru(termo: string, precos: Map<string, Unidade>): Busca {
  const q = normalizar(termo)
  if (!q) return { tipo: 'nada' }

  const notas: { u: Unidade; n: number }[] = []
  for (const u of precos.values()) {
    const n = pontuar(u, q)
    if (n > 0) notas.push({ u, n })
  }
  if (!notas.length) return { tipo: 'nada' }

  notas.sort((a, b) =>
    b.n - a.n || ORDEM_TIER.indexOf(a.u.tier) - ORDEM_TIER.indexOf(b.u.tier))

  const melhor = notas[0]
  const segundo = notas[1]

  if (melhor.n >= CERTEZA && (!segundo || melhor.n >= segundo.n * 1.5)) {
    return { tipo: 'achou', u: melhor.u }
  }
  const proximos = notas.filter(x => x.n >= melhor.n * 0.6).slice(0, 25)
  if (proximos.length === 1) return { tipo: 'achou', u: proximos[0].u }

  const nomes = new Set(proximos.map(x => x.u.nome))
  if (nomes.size === 1) return { tipo: 'achou', u: proximos[0].u }

  return { tipo: 'duvida', opcoes: proximos.map(x => x.u) }
}

function comApelidos(termo: string, precos: Map<string, Unidade>): Busca {
  const q = normalizar(termo)

  if (APELIDOS[q]) {
    const pelaGiria = procurarCru(APELIDOS[q], precos)
    if (pelaGiria.tipo !== 'nada') return pelaGiria
  }

  const direto = procurarCru(termo, precos)
  if (direto.tipo === 'achou') return direto

  const aberto = q.split(' ').map(p => APELIDOS[p] ?? p).join(' ')
  if (aberto !== q) {
    const x = procurarCru(aberto, precos)
    if (x.tipo !== 'nada') return x
  }
  return direto
}

function fatiar(q: string, palavras: string[]): number {
  let melhor = 0
  let visitas = 0

  const tentar = (i: number, w: number, pedacos: number, pulos: number, inteiras: number) => {
    if (++visitas > 4000) return
    if (i >= q.length) {
      const n = 100 - pedacos * 9 - pulos * 4 + inteiras * 12
      if (n > melhor) melhor = n
      return
    }
    if (w >= palavras.length) return

    tentar(i, w + 1, pedacos, pulos + 1, inteiras)

    const p = palavras[w]
    for (let k = Math.min(p.length, q.length - i); k >= 1; k--) {
      if (q.startsWith(p.slice(0, k), i)) {
        tentar(i + k, w + 1, pedacos + 1, pulos, inteiras + (k === p.length ? 1 : 0))
      }
    }
  }

  tentar(0, 0, 0, 0, 0)
  return melhor
}

function porFatias(termo: string, precos: Map<string, Unidade>): Busca {
  const q = normalizar(termo).replace(/ /g, '')

  if (q.length < 3) return { tipo: 'nada' }

  const notas: { u: Unidade; n: number }[] = []
  for (const u of precos.values()) {
    const n = fatiar(q, normalizar(u.nome).split(' ').filter(Boolean))
    if (n > 0) notas.push({ u, n })
  }
  if (!notas.length) return { tipo: 'nada' }

  notas.sort((a, b) =>
    b.n - a.n || ORDEM_TIER.indexOf(a.u.tier) - ORDEM_TIER.indexOf(b.u.tier))

  const melhor = notas[0]
  const empatados = notas.filter(x => x.n === melhor.n)
  if (empatados.length === 1) return { tipo: 'achou', u: melhor.u }

  if (new Set(empatados.map(x => x.u.nome)).size === 1) {
    return { tipo: 'achou', u: empatados[0].u }
  }
  return { tipo: 'duvida', opcoes: empatados.slice(0, 25).map(x => x.u) }
}

function procurar(termo: string, precos: Map<string, Unidade>): Busca {

  const expandido = APELIDOS[normalizar(termo)] ?? termo

  const { tier, resto } = separarTier(expandido)
  if (tier && resto) {
    const soDoTier = new Map([...precos].filter(([, u]) => u.tier === tier))
    if (soDoTier.size) {
      const r = comApelidos(resto, soDoTier)
      if (r.tipo !== 'nada') return r
    }
  }

  const normal = comApelidos(termo, precos)
  if (normal.tipo !== 'nada') return normal

  return porFatias(termo, precos)
}

const arquivoDe = (nome: string) =>
  normalizar(nome).replace(/ /g, '-') + '.webp'

async function baixarArte(nome: string): Promise<{ nome: string; dados: Uint8Array } | null> {
  if (!SUPABASE_URL) return null
  const url = `${SUPABASE_URL}/storage/v1/object/public/${BALDE}/${arquivoDe(nome)}`
  try {
    const r = await fetch(url)
    if (!r.ok) return null
    const dados = new Uint8Array(await r.arrayBuffer())
    if (!dados.length) return null
    return { nome: arquivoDe(nome), dados }
  } catch (e) {
    console.error('arte:', e)
    return null
  }
}

async function editarResposta(
  appId: string, token: string, corpo: unknown,
  arquivo?: { nome: string; dados: Uint8Array },
) {
  const url = `https://discord.com/api/v10/webhooks/${appId}/${token}/messages/@original`

  if (!arquivo) {
    const r = await fetch(url, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(corpo),
    })
    if (!r.ok) console.error('editar:', r.status, await r.text())
    return
  }

  const forma = new FormData()
  forma.append('payload_json', JSON.stringify({
    ...(corpo as object),
    attachments: [{ id: 0, filename: arquivo.nome }],
  }))
  forma.append('files[0]', new Blob([arquivo.dados]), arquivo.nome)

  const r = await fetch(url, { method: 'PATCH', body: forma })
  if (!r.ok) console.error('editar com anexo:', r.status, await r.text())
}

const aviso = (txt: string) => ({ embeds: [{ color: 0xff7a7a, description: txt }] })

const TAG_EXPLICA: Record<string, string> = {
  'Stable':         'Offers stay fair and consistent.',
  'Unstable':       'Can rise or drop at any moment.',
  'Rising':         'Owners are asking more and more.',
  'Dropping':       'Owners are taking less and less.',
  'Inflated':       'Costs way more than it should.',
  'Deflated':       'Goes for way less than it should.',
  'Varies':         'Can get fair offers, can also get lowballed.',
  'Lowballed':      'Usually gets offers below what it is worth.',
  'Highballed':     'Usually gets offers above what it is worth.',
  'Hyped':          'New or something big changed — value is moving fast.',
  'Gatekept':       'Owners refuse to trade it.',
  'Black Marketed': 'Traded outside the game for real money.',
}

async function montarUnitInfo(u: Unidade) {
  const [jogo, anime] = u.nome.split(' / ')

  const valorStr = u.valorTexto ? u.valorTexto
                 : u.valor !== null ? nf.format(u.valor)
                 : 'no set value'

  const campos: any[] = [
    { name: 'Value', value: `**${valorStr}**`, inline: true },
    {
      name: 'Tier',
      value: `\`${TIER_NOME[u.tier] ?? u.tier}\`${u.secao ? ` · ${u.secao}` : ''}`,
      inline: true,
    },
  ]

  const stats: string[] = []
  if (u.raridade !== null) stats.push(`**Rarity** ${u.raridade}`)
  if (u.liquidez)          stats.push(`**Liquidity** ${u.liquidez}`)
  if (stats.length) campos.push({ name: 'Stats', value: stats.join(' · '), inline: false })

  if (u.notas) campos.push({ name: 'Notes', value: u.notas.slice(0, 1000), inline: false })

  const tags = [u.tag, u.tag2].filter((x, i, a) => x && a.indexOf(x) === i)

  const anexo = await baixarArte(u.nome) ?? undefined

  const corpo = {
    embeds: [{
      color: 0x8b6dff,
      title: jogo,
      description: [anime ? `*${anime}*` : '', ...tags.map(t => `\`${t}\``)]
                    .filter(Boolean).join('  ·  ') || undefined,
      thumbnail: anexo ? { url: `attachment://${anexo.nome}` } : undefined,
      fields: campos,
      footer: {

        text: tags.filter(t => TAG_EXPLICA[t])
                  .map(t => `${t} — ${TAG_EXPLICA[t]}`)
                  .join(String.fromCharCode(10)) || SITE.replace(/^https?:\/\//, ''),
      },
    }],
  }
  return { corpo, anexo }
}

function menuDeEscolha(opcoes: Unidade[]) {
  return {
    embeds: [{ color: 0xffcb63, title: 'Which one did you mean?' }],
    components: [{
      type: 1,
      components: [{
        type: 3,
        custom_id: 'escolha:unitinfo',
        placeholder: 'Pick the unit',
        options: opcoes.slice(0, 25).map(o => ({
          label: o.nome.slice(0, 100),
          description: `${TIER_NOME[o.tier] ?? o.tier}${o.secao ? ' · ' + o.secao : ''}`.slice(0, 100),
          value: o.chave.slice(0, 100),
        })),
      }],
    }],
  }
}

async function processar(dados: any) {
  const appId = dados.application_id
  const token = dados.token
  const opts  = dados.data?.options ?? []

  try {
    if (dados.data?.name !== 'unitinfo') {
      return editarResposta(appId, token, aviso('Unknown command.'))
    }

    const termo  = String(opts.find((o: any) => o.name === 'unit')?.value ?? '')
    const precos = await valores()

    let u = precos.get(termo) ?? null
    if (!u) {
      const r = procurar(termo, precos)
      if (r.tipo === 'achou') u = r.u
      else if (r.tipo === 'duvida') {
        return editarResposta(appId, token, menuDeEscolha(r.opcoes))
      }
    }
    if (!u) {
      return editarResposta(appId, token, aviso(
        `I couldn't find **${termo}**.\nBrowse the full list at ${LISTA_COMPLETA}`))
    }

    const { corpo, anexo } = await montarUnitInfo(u)
    return editarResposta(appId, token, corpo, anexo)

  } catch (e) {

    console.error('falhou:', e)
    const detalhe = String((e as any)?.message ?? e).slice(0, 300)
    await editarResposta(appId, token, aviso(
      `Something went wrong.\n\`\`\`${detalhe}\`\`\``))
  }
}

async function processarEscolha(dados: any) {
  const appId = dados.application_id
  const token = dados.token
  const chave = String(dados.data?.values?.[0] ?? '')

  const semMenu = (corpo: any) => ({ ...corpo, components: [] })

  try {
    const precos = await valores()
    const u = precos.get(chave)
    if (!u) {
      return editarResposta(appId, token, semMenu(aviso(
        'That unit is no longer in the sheet. Try the command again.')))
    }
    const { corpo, anexo } = await montarUnitInfo(u)
    return editarResposta(appId, token, semMenu(corpo), anexo)
  } catch (e) {
    console.error('falhou na escolha:', e)
    await editarResposta(appId, token, semMenu(aviso('Something went wrong.')))
  }
}

Deno.serve(async (req) => {
  const corpo = await req.text()

  if (!(await assinaturaConfere(req, corpo))) {
    return new Response('assinatura invalida', { status: 401 })
  }

  const dados = JSON.parse(corpo)

  if (dados.type === 1) return Response.json({ type: 1 })

  if (dados.type === 4) {
    let precos = cache?.dados
    if (!precos) {
      const desistir = new Promise<null>(r => setTimeout(() => r(null), 2200))
      precos = await Promise.race([valores().catch(() => null), desistir]) ?? undefined
    }
    if (!precos) return Response.json({ type: 8, data: { choices: [] } })

    const opcao = (dados.data?.options ?? []).find((o: any) => o.focused)
    const digitado = normalizar(String(opcao?.value ?? ''))

    const expandido = APELIDOS[digitado]
      ? normalizar(APELIDOS[digitado])
      : digitado.split(' ').map(p => APELIDOS[p] ?? p).join(' ')

    const soTier = TIER_ESCRITO[expandido.trim()] ?? ''
    const separado = separarTier(expandido)
    const tier = soTier || separado.tier
    const q = soTier ? '' : (separado.tier && separado.resto ? separado.resto : expandido)

    const doTier = tier ? [...precos.values()].filter(u => u.tier === tier) : null
    const olhar = (doTier && doTier.length ? doTier : [...precos.values()])

    const notas: { u: Unidade; n: number }[] = []
    for (const u of olhar) {
      const n = q ? pontuar(u, q) : (u.valor ?? 0) / 1e9
      if (n > 0) notas.push({ u, n })
    }
    notas.sort((a, b) =>
      b.n - a.n || ORDEM_TIER.indexOf(a.u.tier) - ORDEM_TIER.indexOf(b.u.tier))

    return Response.json({
      type: 8,
      data: {
        choices: notas.slice(0, 25).map(({ u }) => ({
          name: `[${TIER_NOME[u.tier] ?? u.tier}] ${u.nome}`.slice(0, 100),
          value: u.chave.slice(0, 100),
        })),
      },
    })
  }

  if (dados.type === 3) {
    // @ts-ignore  — o Supabase deixa a funcao viva depois de responder
    EdgeRuntime.waitUntil(processarEscolha(dados))
    return Response.json({ type: 6 })
  }

  if (dados.type === 2) {
    // @ts-ignore
    EdgeRuntime.waitUntil(processar(dados))
    return Response.json({ type: 5 })
  }

  return Response.json({ type: 4, data: { content: 'unsupported' } })
})
