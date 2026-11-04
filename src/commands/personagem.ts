import { SlashCommandBuilder, type SlashCommandStringOption } from 'discord.js';
import { ATTRIBUTES, ATTRIBUTE_LABELS, type Attribute } from '../rules/checks.ts';
import { attributeLine } from './format.ts';
import { runCommand } from './reply.ts';
import type { Command } from './types.ts';

// addChoices: turns the option into a dropdown with fixed values instead of free text.
const attributeChoices = ATTRIBUTES.map((attribute) => ({ name: ATTRIBUTE_LABELS[attribute], value: attribute }));
const attributeOption = (name: string, description: string) => (option: SlashCommandStringOption) =>
  option
    .setName(name)
    .setDescription(description)
    .setRequired(true)
    .addChoices(...attributeChoices);

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
        )
        .addStringOption(attributeOption('forte', 'Ponto forte (+2)'))
        .addStringOption(attributeOption('bom', 'Ponto bom (+1)'))
        .addStringOption(attributeOption('fraco', 'Ponto fraco (-1)')),
    ),
  execute(interaction, game) {
    return runCommand(interaction, async () => {
      const character = await game.createCharacter(interaction.channelId, interaction.user.id, {
        name: interaction.options.getString('nome', true),
        concept: interaction.options.getString('conceito', true),
        profile: {
          strong: interaction.options.getString('forte', true) as Attribute,
          good: interaction.options.getString('bom', true) as Attribute,
          weak: interaction.options.getString('fraco', true) as Attribute,
        },
      });
      return `**${character.name}** (${character.concept}) entrou na história.\n${attributeLine(character)}`;
    });
  },
};
