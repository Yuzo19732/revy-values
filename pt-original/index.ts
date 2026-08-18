// ============================================================
//  BOT DO DISCORD — ASTD Trade Values
//
//  Isto NÃO é um bot que fica ligado 24h. É um endereço que o Discord
//  chama quando alguém usa um comando de barra. Fica parado sem gastar
//  nada e só acorda quando é usado.
//
//  Comandos: /myinventory   /inventory @pessoa   /unitinfo   /wfl
//
//  Roda como Supabase Edge Function (Deno).
//  Segredos necessários (configurados no painel, nunca no código):
//    DISCORD_PUBLIC_KEY          — do Discord Developer Portal
//    SUPABASE_URL                — o Supabase já injeta
//    SUPABASE_SERVICE_ROLE_KEY   — o Supabase já injeta
//    SITE_URL                    — endereço do site (opcional)
// ============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'

const CHAVE_PUBLICA = Deno.env.get('DISCORD_PUBLIC_KEY') ?? ''
const SITE          = Deno.env.get('SITE_URL') ?? 'https://astdvalues.netlify.app'
const PLANILHA      = '1Z20NUscF9Id2Sss-osT-Xq06gz9ooikt6Kjtianeg0I'

const banco = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,   // ignora o RLS: o bot precisa ler o de todos
  { auth: { persistSession: false } },
)

/* ------------------------------------------------------------
   1) CONFERIR QUE A MENSAGEM VEIO MESMO DO DISCORD

   O Discord assina cada chamada. Sem esta conferência, qualquer um
   descobriria o endereço e mandaria comandos falsos — e o Discord nem
   aceita cadastrar um endereço que não responda a este teste.
   ------------------------------------------------------------ */
const hexParaBytes = (hex: string) =>
  new Uint8Array((hex.match(/.{1,2}/g) ?? []).map(b => parseInt(b, 16)))

async function assinaturaConfere(req: Request, corpo: string): Promise<boolean> {
  const assinatura = req.headers.get('x-signature-ed25519')
  const momento    = req.headers.get('x-signature-timestamp')
  if (!assinatura || !momento || !CHAVE_PUBLICA) return false
  try {
    const chave = await crypto.subtle.importKey(
      'raw', hexParaBytes(CHAVE_PUBLICA), { name: 'Ed25519' }, false, ['verify'],
    )
    return await crypto.subtle.verify(
      'Ed25519', chave, hexParaBytes(assinatura),
      new TextEncoder().encode(momento + corpo),
    )
  } catch { return false }
}

/* ------------------------------------------------------------
   2) LER OS VALORES DA PLANILHA

   O bot precisa dos preços pra somar. Guardo só a quantidade no banco,
   nunca o valor — assim o total sai sempre com o preço do dia.

   As abas têm formatos diferentes (o C Tier não tem supply/demand,
   o Untiered só tem nome), então acho a linha de cabeçalho pelo
   "Notices" e deduzo as colunas pela posição dela — mesma lógica do site.
   ------------------------------------------------------------ */
const ABAS: Record<string, string> = {
  new: '598345464', s: '1154918591', a: '2023119820', b: '1418037381',
  c: '2096364692', pure: '253483720', odd: '459291543', un: '1974142836',
}

// Unidades sem preço na planilha, mas que são as mais caras do jogo.
const ESCOLHA_DO_DONO = new Set(['Demise / Rem Shinigami'])
// Valor escrito na mão (a planilha não tem), igual ao site.
const VALOR_MANUAL: Record<string, number> = { 'Galaxy Girl / Sasaki Miyo': 400000 }

type Unidade = {
  nome: string; tier: string
  chave: string               // "s|Death / Ryuk"
  valor: number | null
  raridade: number | null
  supply: number | null       // o C Tier não tem esta coluna
  demanda: number | null      // idem
  notas: string
  secao: string               // "Top S Tier", "Boxes/Crates"...
  escolhaDoDono: boolean
}

let cache: { em: number; dados: Map<string, Unidade> } | null = null
const CACHE_MS = 5 * 60 * 1000   // 5 min: a planilha não muda de minuto em minuto

/** CSV de verdade: campo entre aspas pode ter vírgula e quebra de linha dentro. */
function lerCSV(txt: string): string[][] {
  const linhas: string[][] = []
  let campo = '', linha: string[] = [], aspas = false
  for (let i = 0; i < txt.length; i++) {
    const c = txt[i]
    if (aspas) {
      if (c === '"' && txt[i + 1] === '"') { campo += '"'; i++ }
      else if (c === '"') aspas = false
      else campo += c
    } else if (c === '"') aspas = true
    else if (c === ',') { linha.push(campo); campo = '' }
    else if (c === '\n') { linha.push(campo); linhas.push(linha); linha = []; campo = '' }
    else if (c !== '\r') campo += c
  }
  if (campo || linha.length) { linha.push(campo); linhas.push(linha) }
  return linhas
}

async function valores(): Promise<Map<string, Unidade>> {
  if (cache && Date.now() - cache.em < CACHE_MS) return cache.dados

  const mapa = new Map<string, Unidade>()
  await Promise.all(Object.entries(ABAS).map(async ([tier, gid]) => {
    const url = `https://docs.google.com/spreadsheets/d/${PLANILHA}/gviz/tq?tqx=out:csv&gid=${gid}&headers=0`
    const r = await fetch(url)
    if (!r.ok) return
    const linhas = lerCSV(await r.text())

    let colValor: number | null = null, colRar: number | null = null
    let colSup: number | null = null, colDem: number | null = null
    let colNotas: number | null = null
    let achouCabecalho = false, secao = ''

    for (const l of linhas) {
      const idx = l.findIndex(c => c.trim().toLowerCase() === 'notices')
      if (idx >= 0) {
        // mesma dedução do site: tudo pela posição da coluna "Notices"
        colValor = idx > 2 ? 2 : null
        colRar   = idx > 3 ? 3 : null
        colSup   = idx > 4 ? 4 : null      // o C Tier não chega aqui
        colDem   = idx > 5 ? 5 : null
        colNotas = idx
        const rotulo = (l[1] ?? '').trim()
        secao = /^(names?|units?)$/i.test(rotulo) ? '' : rotulo
        achouCabecalho = true
        continue
      }
      if (!achouCabecalho) continue          // linhas antes do cabeçalho são título/aviso

      const nome = (l[1] ?? '').trim()
      if (!nome) continue
      const bruto = colValor !== null ? (l[colValor] ?? '').trim() : ''
      const rar   = colRar   !== null ? (l[colRar]   ?? '').trim() : ''
      if (colValor !== null && !bruto && !rar) continue   // recado solto, não é item

      const num = (i: number | null) => {
        if (i === null) return null
        const v = Number((l[i] ?? '').trim())
        return Number.isFinite(v) ? v : null
      }
      const n = bruto ? Number(bruto.replace(/[,\s]/g, '')) : NaN

      mapa.set(`${tier}|${nome}`, {
        nome, tier, secao, chave: `${tier}|${nome}`,
        valor: VALOR_MANUAL[nome] ?? (Number.isFinite(n) ? n : null),
        raridade: num(colRar),
        supply: num(colSup),
        demanda: num(colDem),
        notas: colNotas !== null ? (l[colNotas] ?? '').trim() : '',
        escolhaDoDono: ESCOLHA_DO_DONO.has(nome),
      })
    }
  }))

  cache = { em: Date.now(), dados: mapa }
  return mapa
}

/* ------------------------------------------------------------
   3) MONTAR O INVENTÁRIO DE ALGUÉM
   ------------------------------------------------------------ */
const nf = new Intl.NumberFormat('en-US')

type Conta = {
  total: number; pecas: number; diferentes: number
  donos: number; semValor: number
  itens: { nome: string; tier: string; qtd: number; valor: number | null; dono: boolean }[]
}

async function contarDe(perfilId: string): Promise<Conta> {
  const [{ data: inv }, precos] = await Promise.all([
    banco.from('inventarios').select('chave, qtd').eq('perfil_id', perfilId),
    valores(),
  ])

  const c: Conta = { total: 0, pecas: 0, diferentes: 0, donos: 0, semValor: 0, itens: [] }

  for (const { chave, qtd } of inv ?? []) {
    const u = precos.get(chave)
    if (!u) continue                       // saiu da planilha
    c.pecas += qtd; c.diferentes++
    if (u.escolhaDoDono)       c.donos    += qtd
    else if (u.valor === null) c.semValor += qtd
    else                       c.total    += u.valor * qtd
    c.itens.push({ nome: u.nome, tier: u.tier, qtd, valor: u.valor, dono: u.escolhaDoDono })
  }
  c.itens.sort((x, y) => (y.valor ?? 0) * y.qtd - (x.valor ?? 0) * x.qtd)
  return c
}

const TIER_NOME: Record<string, string> = {
  new: 'NEW', s: 'S', a: 'A', b: 'B', c: 'C', pure: 'PURE', odd: 'ODD', un: '—',
}

function embedInventario(nome: string, avatar: string | null, c: Conta) {
  if (!c.pecas) {
    return {
      color: 0x8b6dff,
      title: `${nome}'s inventory`,
      description: `Nothing here yet.\nAdd your units at ${SITE}`,
    }
  }

  // Discord corta mensagem longa, então mostro as mais caras e resumo o resto.
  const MOSTRAR = 20
  const linhas = c.itens.slice(0, MOSTRAR).map(i => {
    const t = `\`${TIER_NOME[i.tier] ?? i.tier}\``
    const v = i.dono ? "Owner's Choice"
            : i.valor === null ? 'no value'
            : nf.format(i.valor * i.qtd)
    return `${t} **${i.nome.split(' / ')[0]}**${i.qtd > 1 ? ` ×${i.qtd}` : ''} — ${v}`
  })
  if (c.itens.length > MOSTRAR) linhas.push(`*…and ${c.itens.length - MOSTRAR} more*`)

  const notas: string[] = []
  if (c.donos)    notas.push(`+ ${c.donos} Owner's Choice (no fixed price)`)
  if (c.semValor) notas.push(`+ ${c.semValor} with no set value`)

  return {
    color: 0x8b6dff,
    author: { name: `${nome}'s inventory`, icon_url: avatar ?? undefined },
    description: linhas.join('\n'),
    fields: [
      { name: 'Total value', value: `**${nf.format(c.total)}**`, inline: true },
      { name: 'Units',       value: `${c.pecas} (${c.diferentes} different)`, inline: true },
    ],
    footer: { text: notas.length ? notas.join(' · ') : `Values from the community sheet` },
  }
}

/* ------------------------------------------------------------
   3.2) O QUE SÓ O SITE SABE

   Tag (que vem da cor da célula), imagem e valores em texto não estão
   na API da planilha — o site guarda tudo isso embutido no index.html,
   gerado pelos scripts. Em vez de duplicar essa lógica aqui, o bot lê
   o próprio site. Assim os dois nunca divergem.
   ------------------------------------------------------------ */
type DadosSite = {
  tags: Record<string, string>
  imgWiki: Record<string, string>
  imgPropria: Record<string, string>
  textos: Record<string, string>
}

let cacheSite: { em: number; dados: DadosSite } | null = null

function extrairObjeto(html: string, nome: string): Record<string, string> {
  const i = html.indexOf(`window.${nome} = {`)
  if (i < 0) return {}
  const ini = html.indexOf('{', i)
  // Procuro o "};" e incluo a chave. Antes eu cortava no "\n" anterior,
  // e como o arquivo usa quebra de linha do Windows (\r\n) o "}" ficava
  // de fora — o JSON chegava aberto e não abria.
  const fim = html.indexOf('};', ini)
  if (fim < 0) return {}
  try {
    const corpo = html.slice(ini, fim + 1)
                      .replace(/,\s*}$/, '}')   // vírgula sobrando no fim
    return JSON.parse(corpo)
  } catch { return {} }
}

async function dadosDoSite(): Promise<DadosSite> {
  if (cacheSite && Date.now() - cacheSite.em < CACHE_MS) return cacheSite.dados

  // Duas tentativas: é 1 MB de download, e uma falha aqui deixaria a
  // resposta sem foto e sem tag. Se as duas falharem, prefiro devolver
  // o cache VELHO a devolver vazio — dado de 10 minutos atrás é melhor
  // que dado nenhum.
  for (let tentativa = 0; tentativa < 2; tentativa++) {
    try {
      const r = await fetch(SITE, { headers: { 'user-agent': 'RevyValues/1.0' } })
      if (!r.ok) continue
      const html = await r.text()
      const dados: DadosSite = {
        tags:       extrairObjeto(html, 'ASTD_TAGS'),
        imgWiki:    extrairObjeto(html, 'ASTD_IMAGES'),
        imgPropria: extrairObjeto(html, 'ASTD_IMAGES_CUSTOM'),
        textos:     extrairObjeto(html, 'ASTD_VALOR_TEXTO'),
      }
      if (!Object.keys(dados.imgWiki).length) continue   // veio quebrado
      cacheSite = { em: Date.now(), dados }
      return dados
    } catch { /* tenta de novo */ }
  }

  return cacheSite?.dados ?? { tags: {}, imgWiki: {}, imgPropria: {}, textos: {} }
}

const WIKI_IMG = 'https://static.wikia.nocookie.net/allstartd/images/'

/* ------------------------------------------------------------
   3.5) ENTENDER A FRASE DA TROCA

   A pessoa escreve como fala:  "2x death and demise for aqua"
   Daqui sai: lado A = [Death ×2, Demise], lado B = [Aqua].
   ------------------------------------------------------------ */

/* Tira acento, pontuação, colchetes e parênteses. Assim
   "Kovegu (Alternative) [F]" vira "kovegu alternative f" e a pessoa
   não precisa acertar a pontuação. */
const normalizar = (s: string) =>
  s.toLowerCase()
   .normalize('NFD').replace(/[̀-ͯ]/g, '')
   .replace(/[^a-z0-9\s]/g, ' ')
   .replace(/\s+/g, ' ').trim()

/** "rippers" -> "ripper". Só corta o s de palavra com 4+ letras, pra
 *  não estragar nomes curtos que terminam em s de verdade. */
const semPlural = (p: string) => (p.length > 3 && p.endsWith('s') ? p.slice(0, -1) : p)

/** Nota de 0 a 100 pra "este texto é esta unidade?".
 *  Acima de 60 = confiança alta. Abaixo = achou só parte, e aí o bot
 *  prefere perguntar a chutar. */
function pontuar(u: Unidade, q: string): number {
  const nomeCru = u.nome.toLowerCase()
  const nome = normalizar(u.nome)
  const partes = nomeCru.split(' / ')
  const jogo = normalizar(partes[0] ?? '')
  const anime = normalizar(partes[1] ?? '')
  const curto = Math.max(0, 24 - jogo.length) / 12   // desempate: nome curto

  // --- casamento da frase inteira: confiança alta ---
  if (jogo === q || anime === q)   return 100 + curto
  if (jogo.startsWith(q))          return 90 + curto
  if (anime.startsWith(q))         return 80 + curto
  if (nome.includes(q))            return 70 + curto

  // --- por palavra: cobre ordem trocada e plural ---
  const palavrasNome = new Set(nome.split(' ').map(semPlural))
  const qp = q.split(' ').map(semPlural).filter(Boolean)
  if (!qp.length) return 0

  const achou = qp.filter(w => palavrasNome.has(w) || nome.includes(w))
  if (!achou.length) return 0

  // Nota abaixo de 60 de propósito: casou em parte, não dá pra cravar.
  return 20 + (achou.length / qp.length) * 35 + curto
}

// Ordem dos tiers pra desempate. 12 unidades aparecem duas vezes na
// planilha (a normal e a Pure) com o MESMO nome — não dá pra escolher
// digitando. Fico com a normal: quem quer a Pure sabe que vale mais, e
// pegar a mais cara por padrão inflaria o resultado do WFL.
const ORDEM_TIER = ['new', 's', 'a', 'b', 'c', 'pure', 'odd', 'un']

const CERTEZA = 60   // abaixo disso o bot pergunta em vez de escolher

type Busca =
  | { tipo: 'achou';   u: Unidade }
  | { tipo: 'duvida';  opcoes: Unidade[] }
  | { tipo: 'nada' }

function procurar(termo: string, precos: Map<string, Unidade>): Busca {
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

  // Casou a frase inteira: pode seguir sem perguntar.
  if (notas[0].n >= CERTEZA) return { tipo: 'achou', u: notas[0].u }

  // Só existe um candidato: não há o que perguntar.
  if (notas.length === 1) return { tipo: 'achou', u: notas[0].u }

  // Um destacou bem à frente do segundo: dá pra seguir com ele.
  if (notas[0].n - notas[1].n >= 15) return { tipo: 'achou', u: notas[0].u }

  /* Casou só em parte ("gogeta fat" acha 3 Gogeta e nenhum tem "fat").
     Escolher um aqui daria uma conta errada com cara de certa — então
     devolvo as opções e deixo a pessoa decidir. */
  return { tipo: 'duvida', opcoes: notas.slice(0, 4).map(x => x.u) }
}

type Pedaco = { u: Unidade; qtd: number }

/** "2x death" -> {qtd:2, nome:'death'}   |   "death" -> {qtd:1} */
function separarQtd(txt: string): { qtd: number; nome: string } {
  const m = txt.trim().match(/^(\d+)\s*[x*]?\s+(.+)$/i) || txt.trim().match(/^(.+?)\s*[x*]\s*(\d+)$/i)
  if (!m) return { qtd: 1, nome: txt.trim() }
  const a = m[1], b = m[2]
  return /^\d+$/.test(a) ? { qtd: +a, nome: b } : { qtd: +b, nome: a }
}

type Duvida = { termo: string; opcoes: Unidade[] }

function lerLado(texto: string, precos: Map<string, Unidade>) {
  const achados: Pedaco[] = [], perdidos: string[] = [], duvidas: Duvida[] = []
  for (const parte of texto.split(/\s+and\s+|,|\+|\//i)) {
    const t = parte.trim()
    if (!t) continue
    const { qtd, nome } = separarQtd(t)
    const r = procurar(nome, precos)
    if (r.tipo === 'achou')      achados.push({ u: r.u, qtd: Math.min(Math.max(qtd, 1), 99) })
    else if (r.tipo === 'duvida') duvidas.push({ termo: t, opcoes: r.opcoes })
    else                          perdidos.push(t)
  }
  return { achados, perdidos, duvidas }
}

function somarLado(pedacos: Pedaco[]) {
  let valor = 0, pecas = 0, semValor = 0, donos = 0, somaDem = 0, pesoDem = 0, semDem = 0
  for (const { u, qtd } of pedacos) {
    pecas += qtd
    if (u.escolhaDoDono)       donos += qtd
    else if (u.valor === null) semValor += qtd
    else                       valor += u.valor * qtd
    if (u.demanda !== null) { somaDem += u.demanda * qtd; pesoDem += qtd }
    else semDem += qtd
  }
  return { valor, pecas, semValor, donos, semDem, demanda: pesoDem ? somaDem / pesoDem : null }
}

/* ------------------------------------------------------------
   4) RESPONDER

   Uso resposta ADIADA: o Discord exige uma resposta em 3 segundos, e
   ler a planilha às vezes passa disso. Então respondo "pensando..."
   na hora e mando o conteúdo de verdade logo depois.
   ------------------------------------------------------------ */
async function editarResposta(
  appId: string, token: string, corpo: unknown, arquivo?: { nome: string; dados: Uint8Array },
) {
  const url = `https://discord.com/api/v10/webhooks/${appId}/${token}/messages/@original`

  // Sem anexo é JSON puro. Com anexo tem que ir como formulário, que é
  // o único jeito de mandar bytes junto — usado nas unidades cuja
  // imagem só existe embutida no site (não tem endereço público).
  if (!arquivo) {
    await fetch(url, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(corpo),
    })
    return
  }

  const form = new FormData()
  form.append('payload_json', JSON.stringify(corpo))
  form.append('files[0]', new Blob([arquivo.dados]), arquivo.nome)
  await fetch(url, { method: 'PATCH', body: form })
}

/** "data:image/webp;base64,AAAA..." -> bytes + nome de arquivo */
function bytesDaImagem(dataUri: string): { nome: string; dados: Uint8Array } | null {
  const m = dataUri.match(/^data:image\/(\w+);base64,(.+)$/)
  if (!m) return null
  try {
    const bin = atob(m[2])
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    return { nome: `unit.${m[1]}`, dados: bytes }
  } catch { return null }
}

/* Baixa a imagem do wiki pra mandar como ANEXO.
 *
 * Por que não mandar o endereço direto: o Discord não busca a imagem na
 * hora — ele passa por um proxy dele, que na primeira vez costuma falhar
 * ou demorar, e só acerta da segunda em diante. Anexo vai direto pro CDN
 * do Discord junto com a mensagem, então aparece sempre de primeira.
 *
 * São uns 10 KB por chamada. O cache evita rebaixar a mesma arte. */
const cacheImg = new Map<string, { nome: string; dados: Uint8Array }>()

async function baixarImagem(url: string): Promise<{ nome: string; dados: Uint8Array } | null> {
  const guardada = cacheImg.get(url)
  if (guardada) return guardada
  try {
    const r = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 RevyValues/1.0' } })
    if (!r.ok) return null
    const tipo = (r.headers.get('content-type') ?? '').split('/')[1]?.split(';')[0] || 'png'
    const dados = new Uint8Array(await r.arrayBuffer())
    if (!dados.length || dados.length > 7_000_000) return null   // limite do Discord
    const arq = { nome: `unit.${tipo}`, dados }
    if (cacheImg.size > 120) cacheImg.clear()                    // não crescer sem fim
    cacheImg.set(url, arq)
    return arq
  } catch { return null }
}

const aviso = (txt: string) => ({ embeds: [{ color: 0xff7a7a, description: txt }] })

async function processar(dados: any) {
  const appId = dados.application_id
  const token = dados.token
  const cmd   = dados.data?.name as string
  const opts  = dados.data?.options ?? []

  try {
    if (cmd === 'unitinfo') {
      const termo = String(opts.find((o: any) => o.name === 'unit')?.value ?? '')
      const precos = await valores()

      // o autocompletar manda a chave exata; digitação livre cai na busca
      let u = precos.get(termo) ?? null
      if (!u) {
        const r = procurar(termo, precos)
        if (r.tipo === 'achou') u = r.u
        else if (r.tipo === 'duvida') {
          return editarResposta(appId, token, {
            embeds: [{
              color: 0xffcb63,
              title: 'Which one did you mean?',
              description: r.opcoes.map(o =>
                `· \`${TIER_NOME[o.tier] ?? o.tier}\` ${o.nome}`).join('\n'),
            }],
          })
        }
      }
      if (!u) {
        return editarResposta(appId, token, aviso(
          `I couldn't find **${termo}**.\nBrowse the full list at ${SITE}`))
      }

      const site = await dadosDoSite()
      const [jogo, anime] = u.nome.split(' / ')

      // valor: número da planilha, ou o texto que a API descarta
      const txt = site.textos[u.chave]
      const valorStr = u.escolhaDoDono ? "Owner's Choice"
                     : txt ? txt
                     : u.valor !== null ? nf.format(u.valor)
                     : 'no set value'

      const linhas: string[] = []
      if (u.raridade !== null) linhas.push(`**Rarity** ${u.raridade}`)
      if (u.supply   !== null) linhas.push(`**Supply** ${u.supply}`)
      if (u.demanda  !== null) linhas.push(`**Demand** ${u.demanda}`)

      const campos: any[] = [
        { name: 'Value', value: `**${valorStr}**`, inline: true },
        { name: 'Tier',  value: `\`${TIER_NOME[u.tier] ?? u.tier}\`${u.secao ? ` · ${u.secao}` : ''}`, inline: true },
      ]
      if (linhas.length) campos.push({ name: 'Stats', value: linhas.join(' · '), inline: false })
      if (u.notas)       campos.push({ name: 'Notes', value: u.notas.slice(0, 1000), inline: false })

      const tag = site.tags[u.chave]

      /* Imagem, na mesma ordem do site.
         Atenção: as imagens são guardadas pelo NOME da unidade, e as
         tags pelo "tier|nome". Chaves diferentes — usar a errada aqui
         faz nunca achar foto nenhuma. */
      const caminhoWiki = site.imgWiki[u.nome]
      const embutida    = site.imgPropria[u.nome]

      /* MESMA ORDEM DO SITE: a sua imagem ganha da do wiki.
         Você trocou a arte de 121 unidades justamente porque a do wiki
         estava velha ou errada — mostrar a do wiki aqui desfaria isso.

         As duas viram ANEXO, nunca endereço: é o que garante a foto já
         na primeira vez (ver o comentário em baixarImagem). */
      let thumb: string | undefined
      let anexo: { nome: string; dados: Uint8Array } | undefined

      if (embutida) {
        anexo = bytesDaImagem(embutida) ?? undefined
      }
      if (!anexo && caminhoWiki) {
        anexo = await baixarImagem(
          WIKI_IMG + caminhoWiki + '/revision/latest/scale-to-width-down/300') ?? undefined
      }
      if (anexo) thumb = `attachment://${anexo.nome}`

      return editarResposta(appId, token, {
        embeds: [{
          color: 0x8b6dff,
          title: jogo,
          description: [anime ? `*${anime}*` : '', tag ? `\`${tag}\`` : '']
                        .filter(Boolean).join('  ·  ') || undefined,
          thumbnail: thumb ? { url: thumb } : undefined,
          fields: campos,
          footer: { text: SITE.replace(/^https?:\/\//, '') },
        }],
      }, anexo)
    }

    if (cmd === 'wfl') {
      const frase = String(opts.find((o: any) => o.name === 'trade')?.value ?? '')
      const corte = frase.split(/\s+for\s+/i)
      if (corte.length < 2) {
        return editarResposta(appId, token, aviso(
          'Write it as **what you give** `for` **what you get**.\n' +
          'Example: `/wfl death and demise for aqua`',
        ))
      }

      const precos = await valores()
      const A = lerLado(corte[0], precos)
      const B = lerLado(corte.slice(1).join(' for '), precos)

      /* Se alguma coisa ficou ambígua, paro aqui e pergunto. Calcular
         escolhendo um dos candidatos daria um resultado errado com
         aparência de certo — e é justamente num WFL que isso engana. */
      const duvidas = [...A.duvidas, ...B.duvidas]
      if (duvidas.length) {
        return editarResposta(appId, token, {
          embeds: [{
            color: 0xffcb63,
            title: 'Which one did you mean?',
            description: duvidas.map(d =>
              `**${d.termo}** — did you mean:\n` +
              d.opcoes.map(u => {
                const v = u.escolhaDoDono ? "Owner's Choice"
                        : u.valor === null ? 'no value' : nf.format(u.valor)
                return `· \`${TIER_NOME[u.tier] ?? u.tier}\` ${u.nome.split(' / ')[0]} — ${v}`
              }).join('\n'),
            ).join('\n\n'),
            footer: { text: 'Type the name closer to the list above and run it again.' },
          }],
        })
      }

      if (!A.achados.length && !B.achados.length) {
        return editarResposta(appId, token, aviso(
          `I couldn't find any of those units.\nCheck the names at ${SITE}`,
        ))
      }

      const sa = somarLado(A.achados), sb = somarLado(B.achados)
      const dif = sb.valor - sa.valor
      const base = Math.max(sa.valor, sb.valor)
      const pct = base ? (dif / base) * 100 : 0

      // Com Owner's Choice na jogada não dá pra cravar: aquilo não tem preço.
      let titulo: string, cor: number
      if (sa.donos || sb.donos)          { titulo = 'N/A';  cor = 0x9aa0c0 }
      else if (Math.abs(pct) < 5)        { titulo = 'FAIR'; cor = 0xffcb63 }
      else if (dif > 0)                  { titulo = 'WIN';  cor = 0x4ecb71 }
      else                               { titulo = 'LOSS'; cor = 0xff5c5c }

      const lista = (r: typeof A) => r.achados.length
        ? r.achados.map(({ u, qtd }) => {
            const v = u.escolhaDoDono ? "Owner's Choice"
                    : u.valor === null ? 'no value'
                    : nf.format(u.valor * qtd)
            return `\`${TIER_NOME[u.tier] ?? u.tier}\` ${u.nome.split(' / ')[0]}${qtd > 1 ? ` ×${qtd}` : ''} — ${v}`
          }).join('\n')
        : '*nothing*'

      const dem = (s: ReturnType<typeof somarLado>) =>
        s.demanda === null ? '—' : s.demanda.toFixed(2).replace(/\.00$/, '')

      const notas: string[] = []
      const perdidos = [...A.perdidos, ...B.perdidos]
      if (perdidos.length) notas.push(`Not found: ${perdidos.map(p => `\`${p}\``).join(', ')}`)
      const sd = sa.semDem + sb.semDem
      if (sd) notas.push(`${sd} left out of the demand average (no demand in the sheet)`)
      const sv = sa.semValor + sb.semValor
      if (sv) notas.push(`${sv} with no set value, not counted`)
      const dn = sa.donos + sb.donos
      if (dn) notas.push(`${dn} Owner's Choice — no fixed price, judge by hand`)

      const sinal = dif > 0 ? '+' : dif < 0 ? '−' : ''
      const seta = (sa.demanda !== null && sb.demanda !== null)
        ? (sb.demanda > sa.demanda ? ' · easier to move'
          : sb.demanda < sa.demanda ? ' · harder to move' : ' · same')
        : ''

      return editarResposta(appId, token, {
        embeds: [{
          color: cor,
          title: titulo,
          description:
            `**Value** ${sinal}${nf.format(Math.abs(dif))}` +
            (base ? ` (${sinal}${Math.abs(pct).toFixed(1)}%)` : '') +
            `\n**Demand** ${dem(sa)} → ${dem(sb)}${seta}`,
          fields: [
            { name: `You give — ${nf.format(sa.valor)}`, value: lista(A), inline: true },
            { name: `You get — ${nf.format(sb.valor)}`,  value: lista(B), inline: true },
          ],
          footer: notas.length ? { text: notas.join(' · ') } : undefined,
        }],
      })
    }

    // /myinventory usa quem chamou; /inventory usa a pessoa marcada
    const alvoId = cmd === 'inventory'
      ? (opts.find((o: any) => o.name === 'user')?.value ?? null)
      : (dados.member?.user?.id ?? dados.user?.id)

    if (!alvoId) return editarResposta(appId, token, aviso('Could not tell who to look up.'))

    const { data: perfil } = await banco
      .from('perfis').select('id, discord_nome, discord_avatar')
      .eq('discord_id', alvoId).maybeSingle()

    if (!perfil) {
      const seuProprio = alvoId === (dados.member?.user?.id ?? dados.user?.id)
      return editarResposta(appId, token, aviso(
        seuProprio
          ? `You haven't linked an inventory yet.\nSign in with Discord at ${SITE} and add your units.`
          : `That player hasn't linked an inventory yet.`,
      ))
    }

    const c = await contarDe(perfil.id)
    return editarResposta(appId, token, {
      embeds: [embedInventario(perfil.discord_nome ?? 'Player', perfil.discord_avatar, c)],
    })

  } catch (e) {
    console.error('falhou:', e)
    await editarResposta(appId, token, aviso('Something broke while reading the data. Try again in a moment.'))
  }
}

/* ------------------------------------------------------------
   5) PORTA DE ENTRADA
   ------------------------------------------------------------ */
Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('ok')       // navegador abrindo a URL

  const corpo = await req.text()
  if (!(await assinaturaConfere(req, corpo))) {
    return new Response('assinatura invalida', { status: 401 })
  }

  const dados = JSON.parse(corpo)

  // 1 = o Discord testando se o endereço está vivo
  if (dados.type === 1) {
    return Response.json({ type: 1 })
  }

  /* 4 = a pessoa está DIGITANDO num campo com autocompletar.
     Isto tem que responder em menos de 3 segundos e não aceita resposta
     adiada — por isso só devolvo se os preços já estiverem em cache.
     Sem cache, devolvo lista vazia e o Discord segue aceitando texto
     livre, que a busca resolve depois. */
  if (dados.type === 4) {
    const opcao = (dados.data?.options ?? []).find((o: any) => o.focused)
    const q = normalizar(String(opcao?.value ?? ''))
    const precos = cache?.dados
    if (!precos) return Response.json({ type: 8, data: { choices: [] } })

    const notas: { u: Unidade; n: number }[] = []
    for (const u of precos.values()) {
      const n = q ? pontuar(u, q) : (u.valor ?? 0) / 1e9   // sem texto: os mais caros
      if (n > 0) notas.push({ u, n })
    }
    notas.sort((a, b) =>
      b.n - a.n || ORDEM_TIER.indexOf(a.u.tier) - ORDEM_TIER.indexOf(b.u.tier))

    return Response.json({
      type: 8,
      data: {
        choices: notas.slice(0, 25).map(({ u }) => ({
          // o rótulo mostra tier e valor; o valor enviado é a chave exata
          name: `[${TIER_NOME[u.tier] ?? u.tier}] ${u.nome}`.slice(0, 100),
          value: u.chave.slice(0, 100),
        })),
      },
    })
  }

  // 2 = alguém usou um comando
  if (dados.type === 2) {
    // @ts-ignore  — o Supabase deixa a função viva depois de responder
    EdgeRuntime.waitUntil(processar(dados))
    return Response.json({ type: 5 })       // "pensando…", edito logo em seguida
  }

  return Response.json({ type: 4, data: { content: 'unsupported' } })
})
