import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  DiscordjsErrorCodes,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import type { Game } from '../orchestrator/game.ts';
import type { CampaignStatus } from '../orchestrator/status.ts';
import type { Character, TokenUsage } from '../state/campaign.ts';
import { runCommand } from './reply.ts';
import type { Command } from './types.ts';

const CONFIRM_TIMEOUT_MS = 30_000;

export const campanha: Command = {
  data: new SlashCommandBuilder()
    .setName('campanha')
    .setDescription('Gerencia a campanha deste canal')
    .addSubcommand((sub) =>
      sub
        .setName('nova')
        .setDescription('Cria a campanha deste canal (a cena abre no /sessao iniciar)')
        .addStringOption((o) =>
          o.setName('cenario').setDescription('Onde e quando a história se passa').setRequired(true).setMaxLength(300),
        )
        .addStringOption((o) =>
          o.setName('tom').setDescription('Ex.: terror, aventura leve, mistério').setRequired(true).setMaxLength(100),
        )
        .addStringOption((o) =>
          o.setName('gancho').setDescription('O que dá início à história').setRequired(true).setMaxLength(300),
        ),
    )
    .addSubcommand((sub) => sub.setName('status').setDescription('Mostra a campanha deste canal e em que pé ela está'))
    .addSubcommand((sub) => sub.setName('lista').setDescription('Lista as campanhas ativas neste servidor'))
    .addSubcommand((sub) =>
      sub.setName('encerrar').setDescription('Encerra (arquiva) a campanha deste canal para começar outra'),
    ),
  execute(interaction, game) {
    switch (interaction.options.getSubcommand()) {
      case 'nova':
        return create(interaction, game);
      case 'status':
        return status(interaction, game);
      case 'lista':
        return list(interaction, game);
      default:
        return end(interaction, game);
    }
  },
};

function create(interaction: ChatInputCommandInteraction, game: Game): Promise<void> {
  return runCommand(interaction, async () => {
    // options.getString: reads the value the player typed for an option.
    const setting = interaction.options.getString('cenario', true);
    const tone = interaction.options.getString('tom', true);
    await game.newCampaign(interaction.channelId, {
      setting,
      tone,
      hook: interaction.options.getString('gancho', true),
    });
    return [
      `📖 **Campanha criada!** Cenário: ${setting} · Tom: ${tone}`,
      '',
      '1. Cada jogador cria seu personagem com `/personagem criar`.',
      '2. Com todos no canal de voz, alguém usa `/sessao iniciar` e o mestre abre a primeira cena.',
      '3. Durante o jogo, use `/acao` para dizer o que faz. Quando o mestre pedir um teste (🎲), **quem foi marcado** clica no botão.',
      '',
      '-# Dúvidas? Use `/ajuda`.',
    ].join('\n');
  });
}

async function end(interaction: ChatInputCommandInteraction, game: Game): Promise<void> {
  const campaign = await game.getStatus(interaction.channelId);
  if (!campaign) {
    await interaction.reply('⚠️ Este canal não tem campanha para encerrar.');
    return;
  }

  // ButtonBuilder: a clickable button under a message; ActionRowBuilder groups up to 5 of them in a row.
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId('confirm').setLabel('Encerrar').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('cancel').setLabel('Cancelar').setStyle(ButtonStyle.Secondary),
  );
  const prompt = await interaction.reply({
    content:
      `Encerrar a campanha *${campaign.setting}*? Ela será arquivada e este canal ficará livre para uma nova.\n` +
      `-# Só quem usou o comando pode confirmar. Expira em ${CONFIRM_TIMEOUT_MS / 1000} segundos.`,
    components: [row],
  });

  try {
    // awaitMessageComponent: waits for a click on this message's buttons (rejects on timeout).
    const click = await prompt.awaitMessageComponent({
      componentType: ComponentType.Button,
      filter: (i) => i.user.id === interaction.user.id,
      time: CONFIRM_TIMEOUT_MS,
    });
    if (click.customId === 'cancel') {
      await click.update({ content: 'Encerramento cancelado. A campanha continua.', components: [] });
      return;
    }
    await game.endCampaign(interaction.channelId);
    // update: edits the message the button belongs to (here, removing the buttons).
    await click.update({
      content: `📦 Campanha *${campaign.setting}* encerrada e arquivada. Use \`/campanha nova\` para começar outra.`,
      components: [],
    });
  } catch (error) {
    // The collector rejects with this code when nobody clicks before the timeout.
    if ((error as { code?: string }).code === DiscordjsErrorCodes.InteractionCollectorError) {
      await interaction.editReply({ content: 'Tempo esgotado. A campanha continua.', components: [] });
      return;
    }
    console.error('Error in /campanha encerrar:', error);
    await interaction.editReply({ content: '⚠️ Não consegui encerrar a campanha. Tente de novo.', components: [] });
  }
}

function status(interaction: ChatInputCommandInteraction, game: Game): Promise<void> {
  return runCommand(
    interaction,
    async () => {
      const campaign = await game.getStatus(interaction.channelId);
      if (!campaign) return 'Nenhuma campanha neste canal. Use `/campanha nova`.';

      const lines = [
        `📖 **${campaign.setting}** · tom: ${campaign.tone}`,
        `Gancho: ${campaign.hook}`,
        `-# Criada em ${timestamp(campaign.createdAt, 'd')}`,
        '',
        sessionLine(campaign),
      ];
      if (campaign.atTable.length) lines.push(`🎭 Na mesa: ${characterList(campaign.atTable)}`);
      if (campaign.otherCharacters.length) lines.push(`👥 Outros personagens: ${characterList(campaign.otherCharacters)}`);
      if (campaign.lastSummary) lines.push('', `📜 **Onde paramos:** ${campaign.lastSummary}`);

      const { session, total } = campaign.usage;
      lines.push(
        '',
        `-# Tokens: ${session ? `sessão atual ${formatUsage(session)} · ` : ''}campanha toda ${formatUsage(total)}`,
      );
      return lines.join('\n');
    },
    { ephemeral: true },
  );
}

function list(interaction: ChatInputCommandInteraction, game: Game): Promise<void> {
  return runCommand(
    interaction,
    async () => {
      // Campaigns are stored per channel; keep only channels of this server.
      const campaigns = (await game.listCampaigns()).filter((c) => interaction.guild?.channels.cache.has(c.channelId));
      if (campaigns.length === 0) return 'Nenhuma campanha ativa neste servidor. Use `/campanha nova` em um canal.';

      const lines = campaigns.map((c) => {
        const players = c.atTable.length + c.otherCharacters.length;
        // <#id> renders as a clickable channel link.
        return `• <#${c.channelId}> — **${c.setting}** (${c.tone}) · ${shortSessionState(c)} · ${players} ${players === 1 ? 'personagem' : 'personagens'}`;
      });
      return [`📚 **Campanhas ativas neste servidor**`, '', ...lines].join('\n');
    },
    { ephemeral: true },
  );
}

function sessionLine({ session }: CampaignStatus): string {
  if (!session) return '⏳ Aguardando a primeira sessão. Com todos no canal de voz, use `/sessao iniciar`.';
  if (session.ongoing) return `🎬 Sessão ${session.number} em andamento (desde ${timestamp(session.startedAt, 't')})`;
  return `⏸️ Última sessão: ${session.number}, encerrada ${timestamp(session.endedAt!, 'R')}. Use \`/sessao iniciar\` para continuar.`;
}

function shortSessionState({ session }: CampaignStatus): string {
  if (!session) return '⏳ aguardando a 1ª sessão';
  return session.ongoing ? `🟢 sessão ${session.number} em andamento` : `⏸️ pausada após a sessão ${session.number}`;
}

function characterList(characters: Character[]): string {
  return characters.map((c) => `${c.name} (<@${c.userId}>)`).join(', ');
}

function formatUsage(usage: TokenUsage): string {
  return `${usage.inputTokens.toLocaleString('pt-BR')} entrada / ${usage.outputTokens.toLocaleString('pt-BR')} saída`;
}

/** Discord timestamp: <t:unix:style> renders in each viewer's own time zone (d = date, t = time, R = relative). */
function timestamp(iso: string, style: 'd' | 't' | 'R'): string {
  return `<t:${Math.floor(Date.parse(iso) / 1000)}:${style}>`;
}
