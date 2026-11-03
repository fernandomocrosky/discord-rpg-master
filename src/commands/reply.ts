// Helpers shared by every command: deferring, splitting long text and turning errors into messages.
import { MessageFlags, type ChatInputCommandInteraction } from 'discord.js';
import { GameError } from '../orchestrator/game.ts';

export const DISCORD_MESSAGE_LIMIT = 2000;

/** Splits text into chunks within Discord's limit, preferring paragraph, then line, then word boundaries. */
export function splitMessage(text: string, limit = DISCORD_MESSAGE_LIMIT): string[] {
  const parts: string[] = [];
  let rest = text.trim();
  while (rest.length > limit) {
    let cut = rest.lastIndexOf('\n\n', limit);
    if (cut <= 0) cut = rest.lastIndexOf('\n', limit);
    if (cut <= 0) cut = rest.lastIndexOf(' ', limit);
    if (cut <= 0) cut = limit;
    parts.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).trimStart();
  }
  if (rest) parts.push(rest);
  return parts;
}

/**
 * Defers the reply, runs `produce` and sends its text (split if needed).
 * GameError messages are shown to the player; anything else is logged and replaced by a generic message.
 */
export async function runCommand(
  interaction: ChatInputCommandInteraction,
  produce: () => Promise<string>,
  { ephemeral = false } = {},
): Promise<void> {
  // deferReply: tells Discord "working on it" (shows "thinking..."), extending the 3s deadline to 15 min.
  await interaction.deferReply(ephemeral ? { flags: MessageFlags.Ephemeral } : {});
  try {
    const [first = '…', ...rest] = splitMessage(await produce());
    // editReply replaces the "thinking..." placeholder; followUp sends extra messages after it.
    await interaction.editReply(first);
    for (const part of rest) {
      await interaction.followUp(ephemeral ? { content: part, flags: MessageFlags.Ephemeral } : part);
    }
  } catch (error) {
    if (error instanceof GameError) {
      await interaction.editReply(`⚠️ ${error.message}`);
    } else {
      console.error(`Error in /${interaction.commandName}:`, error);
      await interaction.editReply('⚠️ O mestre se distraiu por um instante. Tente de novo.');
    }
  }
}
