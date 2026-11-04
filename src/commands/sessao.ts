import { SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import { GameError, type Game } from '../orchestrator/game.ts';
import { narrationReply } from './buttons.ts';
import { runCommand, type ReplyContent } from './reply.ts';
import type { Command } from './types.ts';

export const sessao: Command = {
  data: new SlashCommandBuilder()
    .setName('sessao')
    .setDescription('Inicia ou encerra uma sessão de jogo')
    .addSubcommand((sub) =>
      sub.setName('iniciar').setDescription('Começa a sessão com quem está no seu canal de voz'),
    )
    .addSubcommand((sub) => sub.setName('encerrar').setDescription('Encerra a sessão e gera o resumo')),
  execute(interaction, game) {
    return runCommand(interaction, () =>
      interaction.options.getSubcommand() === 'iniciar' ? start(interaction, game) : end(interaction, game),
    );
  },
};

async function start(interaction: ChatInputCommandInteraction, game: Game): Promise<ReplyContent> {
  // inCachedGuild: narrows the type so member/guild data come from the bot's cache (full objects).
  if (!interaction.inCachedGuild()) {
    throw new GameError('Use este comando dentro de um servidor.');
  }
  // member.voice.channel: the voice channel the user is in (needs the GuildVoiceStates intent).
  const voiceChannel = interaction.member.voice.channel;
  if (!voiceChannel) {
    throw new GameError('Entre no canal de voz da mesa antes de usar /sessao iniciar.');
  }
  // voiceStates: who is connected to which voice channel. Other bots are not players.
  const playerIds = interaction.guild.voiceStates.cache
    .filter((state) => state.channelId === voiceChannel.id && !state.member?.user.bot)
    .map((state) => state.id);

  const result = await game.startSession(interaction.channelId, playerIds);
  if (result.status === 'missing-characters') {
    // <@id> is how Discord renders a user mention.
    const mentions = result.userIds.map((id) => `<@${id}>`).join(', ');
    return (
      `⚠️ Antes de começar: ${mentions} ainda não ${result.userIds.length > 1 ? 'têm' : 'tem'} personagem.\n` +
      'Usem `/personagem criar`. Quando estiverem prontos, usem `/sessao iniciar` de novo.'
    );
  }
  const table = result.characters.map((c) => `**${c.name}** (<@${c.userId}>)`).join(', ');
  return narrationReply(`🎭 Na mesa: ${table}`, result.narration);
}

async function end(interaction: ChatInputCommandInteraction, game: Game): Promise<string> {
  const { summary, usage } = await game.endSession(interaction.channelId);
  // "-#" is Discord's small, gray subtext formatting.
  return (
    `📜 **Resumo da sessão**\n\n${summary}\n\n` +
    `-# Tokens desta sessão: ${usage.inputTokens} de entrada, ${usage.outputTokens} de saída, em ${usage.calls} chamadas.`
  );
}
