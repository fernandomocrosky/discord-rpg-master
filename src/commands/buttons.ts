// Roll buttons: shown under a narration when the GM asks a character for a roll.
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, type ButtonInteraction } from 'discord.js';
import type { Game, Narration } from '../orchestrator/game.ts';
import { describeRoll } from '../rules/dice.ts';
import { runCommand, type ReplyContent } from './reply.ts';

// customId: invisible id carried by the button. Encoding who rolls and what keeps it working after a restart.
const ROLL_PREFIX = 'roll';

/** Narration text with a roll button (and a mention of who must roll) when the GM asked for one. */
export function narrationReply(header: string, narration: Narration): ReplyContent {
  const text = header ? `${header}\n\n${narration.text}` : narration.text;
  const request = narration.rollRequest;
  if (!request) return text;

  const button = new ButtonBuilder()
    .setCustomId(`${ROLL_PREFIX}:${request.userId}:${request.expression}`)
    .setLabel(`Rolar ${request.expression} · ${request.characterName}`)
    .setEmoji('🎲')
    .setStyle(ButtonStyle.Primary);
  return {
    text: `${text}\n\n<@${request.userId}>, é com você.`, // <@id> mentions (and notifies) the user
    components: [new ActionRowBuilder<ButtonBuilder>().addComponents(button)],
  };
}

/** Handles clicks on roll buttons. Other buttons (e.g. confirmations) are handled by their own collectors. */
export async function handleButton(interaction: ButtonInteraction, game: Game): Promise<void> {
  const [prefix, userId, expression] = interaction.customId.split(':');
  if (prefix !== ROLL_PREFIX || !userId || !expression) return;

  if (interaction.user.id !== userId) {
    const owner = await game.getCharacter(interaction.channelId, userId);
    // ephemeral: only the person who clicked sees this.
    await interaction.reply({
      content: `Este teste é ${owner ? `de **${owner.name}**` : 'de outro jogador'}.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await runCommand(interaction, async () => {
    const { roll, narration } = await game.playerRoll(interaction.channelId, userId, expression);
    const character = await game.getCharacter(interaction.channelId, userId);
    return narrationReply(`🎲 **${character?.name ?? interaction.user.displayName}** rolou ${describeRoll(roll)}`, narration);
  });
}
