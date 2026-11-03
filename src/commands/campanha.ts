import { SlashCommandBuilder } from 'discord.js';
import { runCommand } from './reply.ts';
import type { Command } from './types.ts';

export const campanha: Command = {
  data: new SlashCommandBuilder()
    .setName('campanha')
    .setDescription('Gerencia a campanha deste canal')
    .addSubcommand((sub) =>
      sub
        .setName('nova')
        .setDescription('Cria a campanha deste canal e abre a primeira cena')
        .addStringOption((o) =>
          o.setName('cenario').setDescription('Onde e quando a história se passa').setRequired(true).setMaxLength(300),
        )
        .addStringOption((o) =>
          o.setName('tom').setDescription('Ex.: terror, aventura leve, mistério').setRequired(true).setMaxLength(100),
        )
        .addStringOption((o) =>
          o.setName('gancho').setDescription('O que dá início à história').setRequired(true).setMaxLength(300),
        ),
    ),
  execute(interaction, game) {
    // options.getString: reads the value the player typed for an option.
    return runCommand(interaction, () =>
      game.newCampaign(interaction.channelId, {
        setting: interaction.options.getString('cenario', true),
        tone: interaction.options.getString('tom', true),
        hook: interaction.options.getString('gancho', true),
      }),
    );
  },
};
