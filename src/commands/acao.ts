import { SlashCommandBuilder } from 'discord.js';
import { runCommand } from './reply.ts';
import type { Command } from './types.ts';

export const acao: Command = {
  data: new SlashCommandBuilder()
    .setName('acao')
    .setDescription('Diz o que o seu personagem faz')
    .addStringOption((o) => o.setName('texto').setDescription('O que você faz ou fala').setRequired(true).setMaxLength(500)),
  execute(interaction, game) {
    return runCommand(interaction, async () => {
      const text = interaction.options.getString('texto', true);
      const narration = await game.playerAction(interaction.channelId, interaction.user.id, text);
      const character = await game.getCharacter(interaction.channelId, interaction.user.id);
      // Echo the action so the channel reads like a table log.
      return `> **${character?.name ?? interaction.user.displayName}:** ${text}\n\n${narration}`;
    });
  },
};
