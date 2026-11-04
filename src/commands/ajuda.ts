import { EmbedBuilder, MessageFlags, SlashCommandBuilder } from 'discord.js';
import type { Command } from './types.ts';

/** The help card. Kept separate so a future welcome message can reuse it. */
export function helpEmbed(): EmbedBuilder {
  // EmbedBuilder: Discord's formatted "card" (colored side bar, title, fields, footer).
  return new EmbedBuilder()
    .setColor(0x8b5cf6)
    .setTitle('🎲 Tavola — seu mestre de RPG com IA')
    .setDescription(
      'Eu narro a história, interpreto os NPCs e cuido das regras.\nVocês só decidem o que seus personagens fazem.',
    )
    .addFields(
      {
        name: '▸ Como começar',
        value: [
          '1. `/campanha nova` — escolham cenário, tom e gancho',
          '2. `/personagem criar` — cada jogador cria o seu',
          '3. Entrem no canal de voz e usem `/sessao iniciar`',
        ].join('\n'),
      },
      {
        name: '▸ Durante o jogo',
        value: [
          '`/acao` — diga o que seu personagem faz ou fala',
          '🎲 Quando eu pedir um teste, clique no botão (ou use `/rolar`)',
          '`/ficha` — veja seu personagem (só você vê)',
        ].join('\n'),
      },
      {
        name: '▸ Campanha e sessões',
        value: [
          '`/sessao encerrar` — gera o resumo da noite',
          '`/campanha status` · `/campanha lista` · `/campanha encerrar`',
        ].join('\n'),
      },
      {
        name: '▸ Dicas',
        value: [
          'Joguem pelo chat do canal de voz. Eu só envolvo na cena quem está na call.',
          'Seja específico nas ações: "procuro pegadas perto da janela" rende mais que "investigo".',
        ].join('\n'),
      },
    )
    .setFooter({ text: 'Os dados são rolados pelo bot, nunca inventados pela IA.' });
}

export const ajuda: Command = {
  data: new SlashCommandBuilder().setName('ajuda').setDescription('Explica como jogar com o Tavola (só você vê)'),
  async execute(interaction) {
    // No LLM call here, so a direct reply fits in Discord's 3-second window (no deferReply needed).
    await interaction.reply({ embeds: [helpEmbed()], flags: MessageFlags.Ephemeral });
  },
};
