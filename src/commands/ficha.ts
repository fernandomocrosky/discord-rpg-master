import { SlashCommandBuilder } from 'discord.js';
import { runCommand } from './reply.ts';
import type { Command } from './types.ts';

export const ficha: Command = {
  data: new SlashCommandBuilder().setName('ficha').setDescription('Mostra a ficha do seu personagem (só você vê)'),
  execute(interaction, game) {
    // ephemeral: only the player who used the command sees the reply.
    return runCommand(
      interaction,
      async () => {
        const character = await game.getCharacter(interaction.channelId, interaction.user.id);
        if (!character) return 'Você ainda não tem personagem neste canal. Use /personagem criar.';
        return `**${character.name}**\nConceito: ${character.concept}`;
      },
      { ephemeral: true },
    );
  },
};
