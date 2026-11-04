import { SlashCommandBuilder } from 'discord.js';
import { attributeLine } from './format.ts';
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
        const outdated = character.attributes
          ? ''
          : '\n-# Personagem criado antes dos atributos: use `/personagem criar` de novo para escolher seu perfil.';
        return `**${character.name}**\nConceito: ${character.concept}\n${attributeLine(character)}${outdated}`;
      },
      { ephemeral: true },
    );
  },
};
