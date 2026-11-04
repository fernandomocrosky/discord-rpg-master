import { SlashCommandBuilder } from 'discord.js';
import { describeRoll } from '../rules/dice.ts';
import { narrationReply } from './buttons.ts';
import { runCommand } from './reply.ts';
import type { Command } from './types.ts';

export const rolar: Command = {
  data: new SlashCommandBuilder()
    .setName('rolar')
    .setDescription('Rolagem livre (ex.: dano): 1d20+3, 2d6, d8-1. Testes pedidos pelo mestre usam o botão')
    .addStringOption((o) => o.setName('expressao').setDescription('Ex.: 1d20+3').setRequired(true).setMaxLength(20)),
  execute(interaction, game) {
    return runCommand(interaction, async () => {
      const { roll, narration } = await game.playerRoll(
        interaction.channelId,
        interaction.user.id,
        interaction.options.getString('expressao', true),
      );
      const character = await game.getCharacter(interaction.channelId, interaction.user.id);
      return narrationReply(`🎲 **${character?.name ?? interaction.user.displayName}** rolou ${describeRoll(roll)}`, narration);
    });
  },
};
