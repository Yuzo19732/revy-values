import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client, GatewayIntentBits, Events, EmbedBuilder } from 'discord.js'

const AQUI = path.dirname(fileURLToPath(import.meta.url))
const RAIZ = path.dirname(AQUI)

const nf = new Intl.NumberFormat('en-US')

const ehModelo = (s) => /x{4,}|SUA_|SEU_|EXEMPLO|AQUI/i.test(s)

function segredo(nomeVariavel, arquivos, padrao, oQue) {
  const doAmbiente = (process.env[nomeVariavel] ?? '').trim()
  if (doAmbiente && !ehModelo(doAmbiente)) {
    return { valor: doAmbiente, origem: `variavel ${nomeVariavel}` }
  }

  for (const arquivo of [].concat(arquivos)) {

    const caminho = [AQUI, RAIZ]
      .map(base => path.join(base, arquivo))
      .find(c => fs.existsSync(c))
    if (!caminho) continue
    const texto = fs.readFileSync(caminho, 'utf8')
    const g = new RegExp(padrao.source, padrao.flags.includes('g') ? padrao.flags : padrao.flags + 'g')
    const achados = [...texto.matchAll(g)].map(s => s[0]).filter(s => !ehModelo(s))
    if (achados.length) return { valor: achados[0], origem: arquivo }
  }

  console.error(`Nao achei ${oQue}.`)
  console.error(`  Ponha na variavel ${nomeVariavel}, ou no arquivo ${[].concat(arquivos)[0]}.`)
  process.exit(1)
}

const token = segredo('DISCORD_TOKEN', 'discord.txt',
  /[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{20,}/, 'o Bot Token')

const google = segredo('GOOGLE_API_KEY',
  ['chave-google.txt', path.join('..', 'astd-tier-list', 'chave-google.txt')],
  /AIza[0-9A-Za-z_-]{35}/, 'a chave do Google')

const TOKEN = token.valor
process.env.GOOGLE_API_KEY = google.valor

const { valores, procurar, TIER_NOME, normalizar } = await import('./logica.js')

const supa = segredo('SUPABASE_URL', 'supabase.txt',
  /https:\/\/[a-z0-9]+\.supabase\.co/, 'a Project URL do Supabase')
const SUPABASE_URL = supa.valor
const BALDE = 'unidades'

console.log('token do Discord : ' + token.origem)
console.log('chave do Google  : ' + google.origem)
console.log('URL do Supabase  : ' + supa.origem)
console.log('')

const NAO_E_VALOR = [

  /\b(?:pull|pulls|pullin|pulling|gettin|getting)\b/i,

  /\b(?:could|can|would|should|will|might)\b[^?!.]*\bget\b/i,

  /\bhow much\s+(?:u|you|i|we|they|he|she|ppl|people|everyone|someone)\b/i,

  /\b(?:idc|forgot|matter|care|know)\b[^?!.]*\bhow much\b/i,

  /\bhow much\s+(?:hp|dmg|damage|range|spa|dps|exp|xp|yen|gems?)\b/i,
]

const PERGUNTAS = [

  /\bhow much (?:is|are|was|were)\s+(.+?)\s*(?:worth|going for|go for|cost(?:ing)?)?\s*[?!.]*$/i,

  /\bhow much (?:does|do|did)\s+(.+?)\s+(?:cost|costs|go for|sell for)\s*[?!.]*$/i,

  /\bhow much\s+(.+?)\s+(?:worth|cost|costs|go for)\s*[?!.]*$/i,

  /\bhow much for\s+(.+?)\s*[?!.]*$/i,

  /\bwhat(?:'?s|s| is| are)?\s*(?:the\s+)?(?:value|price|worth)\s+(?:of|for)\s+(.+?)\s*[?!.]*$/i,

  /\bwhat(?:'?s|s| is| are)\s+(.+?)(?:'s)?\s+(?:value|price|worth)\s*[?!.]*$/i,
  /\bwhat (?:value|price) (?:is|are)\s+(.+?)\s*[?!.]*$/i,

  /\b(?:value|price|worth)\s+(?:of|for)\s+(.+?)\s*[?!.]*$/i,

  /^(.+?)(?:'s)?\s+(?:value|worth|price)\s*[?!.]*$/i,
]

const RABICHO = /[\s,]*\b(?:rn|atm|now|tho|though|please|pls|plz|tbh|btw|ty|thanks|thx)\b[\s,?!.]*$/i

const SOBRAS = /^(?:a|an|the|that|this|my|your|his|her|their)\s+|\s+(?:please|pls|plz|rn|now|atm|tho|though|tbh)$/gi

const NAO_E_NOME = new Set([
  'it', 'this', 'that', 'one', 'them', 'they', 'these', 'those',
  'u', 'you', 'me', 'i', 'we', 'he', 'she', 'my', 'mine', 'yours',
  'tho', 'though', 'rn', 'atm', 'now', 'ppl', 'people', 'everything',
  'anything', 'something', 'stuff', 'things', 'thing', 'all', 'em',
])

function extrair(texto) {
  const limpo = texto.trim().replace(/<@!?\d+>/g, '').trim()
  if (limpo.length < 4 || limpo.length > 120) return null

  if (NAO_E_VALOR.some(p => p.test(limpo))) return null

  let frase = limpo, antesDisso
  do { antesDisso = frase; frase = frase.replace(RABICHO, '').trim() } while (frase !== antesDisso)

  for (const padrao of PERGUNTAS) {
    const m = frase.match(padrao)
    if (!m) continue
    let alvo = (m[1] || '').trim()
    let antes
    do { antes = alvo; alvo = alvo.replace(SOBRAS, '').trim() } while (alvo !== antes)
    if (NAO_E_NOME.has(alvo.toLowerCase())) return null
    if (alvo.length >= 2 && alvo.length <= 60) return alvo
  }
  return null
}

const PIADAS = [
  {
    quando: /bachelor'?s? degree|college degree|my degree/i,
    titulo: "Bachelor's Degree",
    sub: 'Four Years of Your Life',
    tag: 'Deflated',
    valor: 'NOTHING!!!!!!!!!!!!!',
    tier: '—',
    secao: 'Untiered',
    stats: '**Rarity** 0 · **Liquidity** Low',
  },
]

function piada(texto) {
  const p = PIADAS.find(x => x.quando.test(texto))
  if (!p) return null

  return new EmbedBuilder()
    .setColor(0x8b6dff)
    .setTitle(p.titulo)
    .setDescription(`*${p.sub}*  ·  \`${p.tag}\``)
    .addFields(
      { name: 'Value', value: `**${p.valor}**`, inline: true },
      { name: 'Tier', value: `\`${p.tier}\` · ${p.secao}`, inline: true },
      { name: 'Stats', value: p.stats },
    )
}

const arquivoDe = (nome) => normalizar(nome).replace(/ /g, '-') + '.webp'

async function baixarArte(nome) {
  try {
    const r = await fetch(`${SUPABASE_URL}/storage/v1/object/public/${BALDE}/${arquivoDe(nome)}`)
    if (!r.ok) return null
    const dados = Buffer.from(await r.arrayBuffer())
    return dados.length ? { nome: arquivoDe(nome), dados } : null
  } catch (e) {
    console.error('   arte:', e.message)
    return null
  }
}

function embedDaUnidade(u) {
  const [jogo, anime] = u.nome.split(' / ')

  const valor = u.valorTexto ? u.valorTexto
              : u.valor !== null ? nf.format(u.valor)
              : 'no set value'

  const tags = [u.tag, u.tag2].filter((x, i, a) => x && a.indexOf(x) === i)

  const e = new EmbedBuilder()
    .setColor(0x8b6dff)
    .setTitle(jogo)
    .addFields(
      { name: 'Value', value: `**${valor}**`, inline: true },
      {
        name: 'Tier',
        value: `\`${TIER_NOME[u.tier] ?? u.tier}\`${u.secao ? ` · ${u.secao}` : ''}`,
        inline: true,
      },
    )

  const desc = [anime ? `*${anime}*` : '', ...tags.map(t => `\`${t}\``)].filter(Boolean)
  if (desc.length) e.setDescription(desc.join('  ·  '))

  const stats = []
  if (u.raridade !== null) stats.push(`**Rarity** ${u.raridade}`)
  if (u.liquidez) stats.push(`**Liquidity** ${u.liquidez}`)
  if (stats.length) e.addFields({ name: 'Stats', value: stats.join(' · ') })

  return e
}

function embedDaDuvida(opcoes) {
  return new EmbedBuilder()
    .setColor(0xffcb63)
    .setTitle('Which one did you mean?')
    .setDescription(opcoes.slice(0, 8)
      .map(o => `· \`${TIER_NOME[o.tier] ?? o.tier}\` ${o.nome}`)
      .join('\n'))
}

const cliente = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
})

cliente.once(Events.ClientReady, c => {
  console.log(`ligado como ${c.user.tag}`)
  console.log(`servidores: ${c.guilds.cache.map(g => g.name).join(', ')}`)
  console.log('ouvindo. Ctrl+C para parar.')
  console.log('')

  valores().then(m => console.log(`planilha carregada: ${m.size} unidades`))
          .catch(e => console.error('nao consegui ler a planilha:', e.message))
})

cliente.on(Events.MessageCreate, async (msg) => {
  if (msg.author.bot) return

  const zoeira = piada(msg.content)
  if (zoeira) {
    console.log(`[${msg.author.username}] piada: "${msg.content}"`)
    return void msg.reply({ embeds: [zoeira] }).catch(e => console.error('piada falhou:', e.message))
  }

  const alvo = extrair(msg.content)
  if (!alvo) return

  console.log(`[${msg.author.username}] "${msg.content}"  ->  procurando "${alvo}"`)

  try {
    const precos = await valores()
    const r = procurar(alvo, precos)

    if (r.tipo === 'achou') {
      const arte = await baixarArte(r.u.nome)
      console.log(`   achou: ${r.u.nome}${arte ? '' : '  (sem arte)'}`)

      const e = embedDaUnidade(r.u)
      if (arte) e.setThumbnail(`attachment://${arte.nome}`)

      await msg.reply({
        embeds: [e],
        files: arte ? [{ attachment: arte.dados, name: arte.nome }] : [],
      })
    } else if (r.tipo === 'duvida') {
      console.log(`   duvida entre ${r.opcoes.length}`)
      await msg.reply({ embeds: [embedDaDuvida(r.opcoes)] })
    } else {
      console.log('   nada')

    }
  } catch (e) {
    console.error('falhou:', e)
  }
})

cliente.on(Events.Error, e => console.error('erro do cliente:', e.message))
process.on('unhandledRejection', e => console.error('promessa solta:', e?.message ?? e))
process.on('uncaughtException', e => console.error('erro solto:', e?.message ?? e))

cliente.login(TOKEN)
