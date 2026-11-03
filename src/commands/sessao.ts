import { SlashCommandBuilder } from 'discord.js';
import { runCommand } from './reply.ts';
import type { Command } from './types.ts';

export const sessao: Command = {
  data: new SlashCommandBuilder()
    .setName('sessao')
    .setDescription('Inicia ou encerra uma sessão de jogo')
    .addSubcommand((sub) => sub.setName('iniciar').setDescription('Começa uma nova sessão, retomando a anterior'))
    .addSubcommand((sub) => sub.setName('encerrar').setDescription('Encerra a sessão e gera o resumo')),
  execute(interaction, game) {
    return runCommand(interaction, async () => {
      if (interaction.options.getSubcommand() === 'iniciar') {
        return game.startSession(interaction.channelId);
      }
      const { summary, usage } = await game.endSession(interaction.channelId);
      // "-#" is Discord's small, gray subtext formatting.
      return (
        `📜 **Resumo da sessão**\n\n${summary}\n\n` +
        `-# Tokens desta sessão: ${usage.inputTokens} de entrada, ${usage.outputTokens} de saída, em ${usage.calls} chamadas.`
      );
    });
  },
};
