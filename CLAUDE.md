# CLAUDE.md — Mestre de RPG com IA (MVP: bot de Discord)

## O que é este projeto

Um mestre de RPG de mesa feito com IA. Ele narra as cenas, interpreta os NPCs, aplica as regras e lembra da campanha,
para grupos de amigos que não têm quem mestre. O produto final tem foco **presencial**: o celular fica no centro da mesa,
narrando por voz. Este repositório é o **MVP em forma de bot de Discord**. Ele existe para responder a uma pergunta:
*o mestre de IA é bom o bastante para o grupo querer jogar a próxima sessão por vontade própria?*

Qualquer coisa que não ajude a responder essa pergunta fica fora do MVP: interface própria, pagamento, contas de usuário, multi-servidor.

- Idioma do produto, dos textos do bot e dos comentários no código: **português do Brasil**.
- Nomes de variáveis, funções e arquivos: **inglês** (padrão da comunidade). Exceção: os nomes dos comandos de barra, que ficam em português (`/rolar`, `/acao`).
- Quem desenvolve é um dev fullstack (JS/TS, Vue, PHP) que está fazendo o primeiro bot de Discord. Quando usar uma API do Discord pela primeira vez, explique em uma linha o que ela faz.

## Stack

- **Node.js 20+** com **TypeScript** (ESM, `"type": "module"`).
- **discord.js v14** para o bot.
- **LLM:** Messages API da Anthropic, configurável por `LLM_MODEL` (Sonnet para qualidade, Haiku para testes baratos).
- **Estado:** um arquivo JSON por canal na fase 0. SQLite a partir da fase 1. Postgres só se o projeto virar produto.
- **Testes:** `node:test` com `tsx`. Não adicione Jest/Vitest sem necessidade.
- Use poucas dependências. Antes de adicionar um pacote, pergunte se dá para fazer com a biblioteca padrão do Node.

## Regras de arquitetura (não negociáveis)

1. **Os dados são rolados pelo código, nunca pelo LLM.** O motor de regras (`src/rules/`) é código puro, determinístico quando recebe um RNG injetado, e tem testes. O LLM pode *pedir* um teste. Quem rola, soma e compara com a dificuldade é o código.
2. **O histórico do chat não é a memória da campanha.** Fatos importantes (personagens, NPCs, locais, itens, promessas, ferimentos) ficam no estado, de forma estruturada. A cada chamada, o prompt recebe só o que importa para a cena atual, mais uma janela curta de histórico recente.
3. **O mestre não responde a cada mensagem solta.** A partir da fase 1, ações de vários jogadores entram numa *janela de turno* (todos agiram ou passou o tempo limite) e o mestre responde uma vez.
4. **O mestre nunca decide o que os personagens dos jogadores fazem.** Isso vale tanto no system prompt quanto em qualquer lógica que monte a resposta.
5. **Cada camada fica separada:** `commands/` (Discord) → orquestrador → `rules/`, `llm/`, `state/`. As camadas `llm/` e `state/` não importam nada do discord.js. Assim, o futuro app mobile reaproveita tudo menos `commands/`.

## Estrutura de pastas alvo

```
src/
  index.ts             # cria o Client, registra handlers, faz login
  deploy-commands.ts   # registra os comandos de barra no servidor de teste
  config.ts            # lê e valida as variáveis do .env
  commands/            # um arquivo por comando de barra: { data, execute }
  orchestrator/        # janela de turno, montagem de contexto (fase 1)
  rules/               # dados, testes, dano, HP: código puro + *.test.ts
  llm/                 # system prompt e chamadas ao LLM
  state/               # carregar/salvar campanha; trocar JSON → SQLite sem mudar a interface
data/                  # estado local (no .gitignore)
```

## Particularidades do Discord (armadilhas comuns)

- **Toda interação precisa de resposta em até 3 segundos.** Chamadas ao LLM demoram mais que isso, então use `await interaction.deferReply()` primeiro e depois `editReply()` / `followUp()`.
- **Mensagens têm limite de 2000 caracteres.** Quebre a narração em partes antes de enviar.
- **Durante o desenvolvimento, registre os comandos no servidor (guild commands)**, não globalmente. Comandos de servidor atualizam na hora. Os globais podem levar até 1 hora para aparecer.
- Comandos de barra só precisam do intent `Guilds`. Só peça `MessageContent` (intent privilegiado) se o bot precisar ler mensagens comuns.
- Na fase 2 (voz), use `@discordjs/voice`. A voz exige o intent `GuildVoiceStates`, e o celular no centro da mesa entra no canal de voz como se fosse um jogador.
- Uma campanha por **canal**: o `channelId` é a chave do estado.
- Duas ações no mesmo canal ao mesmo tempo não podem sobrescrever o estado uma da outra. Serialize as escritas por canal.

## Comandos do bot (MVP)

| Comando | O que faz |
|---|---|
| `/campanha nova` | Cria a campanha do canal (cenário, tom, gancho) e o mestre abre a cena |
| `/personagem criar` | Ficha simples (nome, conceito) ligada ao jogador |
| `/sessao iniciar` | O mestre retoma a partir do resumo da sessão anterior |
| `/acao <texto>` | O jogador declara o que faz |
| `/rolar <expr>` | Rolagem como `1d20+3`, `2d6`, `d8-1`; o resultado entra no histórico e o mestre narra a consequência |
| `/ficha` | Mostra a ficha do personagem |
| `/sessao encerrar` | Gera o resumo e os fatos novos e salva no estado |

## Fases

- **Fase 0 (texto básico):** campanha, personagem, `/acao`, `/rolar`, narração com a IA. *Pronto quando* uma cena for jogável do início ao fim.
- **Fase 1 (regras e memória):** o LLM pede testes em formato estruturado (JSON) e o código rola os dados. Entram também a janela de turno, o resumo por sessão, os fatos estruturados e a migração para SQLite. *Pronto quando* a segunda sessão retomar a primeira sem erros grosseiros.
- **Fase 2 (voz):** o bot entra no canal de voz, transcreve as falas (STT) e narra em áudio (TTS) em português. *Pronto quando* uma sessão inteira for jogada só por voz, com o celular na mesa.
- **Fase 3 (playtest):** 3 ou mais sessões reais com o grupo, coletando as métricas.

Trabalhe na fase atual. Não adiante funcionalidade de fases futuras sem eu pedir.

## Sistema de regras

Use o **SRD 5.1 de D&D** (licença Creative Commons) ou um sistema próprio simples (atributos + 1d20 contra dificuldade 10/15/20).
**Não** inclua texto nem mecânicas de sistemas proprietários (Tormenta20, Ordem Paranormal etc.) sem licença.

## Custo (métrica de primeira classe)

O modelo de negócio previsto é **cobrar por sessão agendada**, então o custo por sessão define o preço. Desde a fase 0:
- registre os tokens de entrada e saída de cada chamada ao LLM (o campo `usage` da resposta), somados por sessão;
- mantenha o prompt enxuto: janela curta de histórico + fatos relevantes, nunca o histórico inteiro;
- deixe o modelo configurável por variável de ambiente.

## Variáveis de ambiente (`.env`, nunca commitar)

```
DISCORD_TOKEN=        # Developer Portal → Bot → Reset Token
DISCORD_CLIENT_ID=    # Developer Portal → General Information → Application ID
DISCORD_GUILD_ID=     # ID do servidor de teste (Modo desenvolvedor → Copiar ID)
ANTHROPIC_API_KEY=
LLM_MODEL=
```

Mantenha um `.env.example` atualizado sem os valores. `.env` e `data/` ficam no `.gitignore`.

## Scripts esperados

```
npm run dev        # tsx watch src/index.ts
npm run deploy     # registra/atualiza os comandos de barra no servidor de teste
npm test           # testes de rules/ e state/
npm run typecheck  # tsc --noEmit
```

Depois de criar ou alterar um comando de barra, lembre-me de rodar `npm run deploy`.

## Como trabalhar comigo

- Antes de mudanças grandes, proponha o plano em poucos passos e espere meu ok.
- Toda lógica em `rules/` e `state/` vem com teste. Rode `npm test` e `npm run typecheck` antes de dizer que terminou.
- O system prompt do mestre é parte do produto: mudanças nele devem ser pequenas, explicadas e fáceis de reverter.
- Prefira código simples e legível a abstrações antecipadas. É um MVP.
