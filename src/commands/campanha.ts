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
    ),
  execute(interaction, game) {
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
  },
};
