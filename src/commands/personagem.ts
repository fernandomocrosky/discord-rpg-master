import { SlashCommandBuilder } from 'discord.js';
import { runCommand } from './reply.ts';
import type { Command } from './types.ts';

export const personagem: Command = {
  data: new SlashCommandBuilder()
    .setName('personagem')
    .setDescription('Gerencia o seu personagem')
    .addSubcommand((sub) =>
      sub
        .setName('criar')
        .setDescription('Cria (ou substitui) o seu personagem nesta campanha')
        .addStringOption((o) => o.setName('nome').setDescription('Nome do personagem').setRequired(true).setMaxLength(50))
        .addStringOption((o) =>
          o.setName('conceito').setDescription('Ex.: pescadora curiosa, ex-soldado cansado').setRequired(true).setMaxLength(150),
        ),
    ),
  execute(interaction, game) {
    return runCommand(interaction, async () => {
      const character = await game.createCharacter(interaction.channelId, interaction.user.id, {
        name: interaction.options.getString('nome', true),
        concept: interaction.options.getString('conceito', true),
      });
      return `**${character.name}** (${character.concept}) entrou na história.`;
    });
  },
};
