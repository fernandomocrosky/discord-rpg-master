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
    .addSubcommand((sub) =>
      sub.setName('encerrar').setDescription('Encerra (arquiva) a campanha deste canal para começar outra'),
    ),
  execute(interaction, game) {
    return interaction.options.getSubcommand() === 'nova' ? create(interaction, game) : end(interaction, game);
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
      '3. Durante o jogo, use `/acao` para dizer o que faz. Quando o mestre pedir um teste (🎲), **o personagem citado** usa `/rolar`.',
    ].join('\n');
  });
}

async function end(interaction: ChatInputCommandInteraction, game: Game): Promise<void> {
  const campaign = await game.getCampaign(interaction.channelId);
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
