// Helpers shared by every command and button: acknowledging, splitting long text and turning errors into messages.
import {
  MessageFlags,
  type ActionRowBuilder,
  type ButtonBuilder,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { GameError } from '../orchestrator/game.ts';

export const DISCORD_MESSAGE_LIMIT = 2000;

/** A reply: plain text, or text with button rows attached to its last message. */
export type ReplyContent = string | { text: string; components: ActionRowBuilder<ButtonBuilder>[] };

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
 * Acknowledges the interaction, runs `produce` and sends its reply (split if needed).
 * - Slash command: deferReply ("thinking..."), then the first part replaces it.
 * - Button: the clicked button is removed from its message, then the reply is sent as new messages.
 * GameError messages are shown to the player; anything else is logged and replaced by a generic message.
 */
export async function runCommand(
  interaction: ChatInputCommandInteraction | ButtonInteraction,
  produce: () => Promise<ReplyContent>,
  { ephemeral = false } = {},
): Promise<void> {
  const flags = ephemeral ? MessageFlags.Ephemeral : undefined;
  if (interaction.isButton()) {
    // update: edits the message the button belongs to; this also acknowledges the click within 3s.
    await interaction.update({ components: [] });
  } else {
    // deferReply: tells Discord "working on it" (shows "thinking..."), extending the 3s deadline to 15 min.
    await interaction.deferReply(flags ? { flags } : {});
  }

  // editReply replaces the "thinking..." placeholder; followUp sends a new message.
  const send = (index: number, content: string, components: ActionRowBuilder<ButtonBuilder>[] = []) =>
    index === 0 && !interaction.isButton()
      ? interaction.editReply({ content, components })
      : interaction.followUp({ content, components, ...(flags ? { flags } : {}) });

  try {
    const reply = await produce();
    const { text, components } = typeof reply === 'string' ? { text: reply, components: [] } : reply;
    const parts = splitMessage(text);
    if (parts.length === 0) parts.push('…');
    for (const [i, part] of parts.entries()) {
      await send(i, part, i === parts.length - 1 ? components : []);
    }
  } catch (error) {
    if (error instanceof GameError) {
      await send(0, `⚠️ ${error.message}`);
    } else {
      console.error(`Error in ${interaction.isButton() ? `button ${interaction.customId}` : `/${interaction.commandName}`}:`, error);
      await send(0, '⚠️ O mestre se distraiu por um instante. Tente de novo.');
    }
  }
}
