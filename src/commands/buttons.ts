// Closing "call to action" under each narration (whose turn / which check) and the check button.
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, type ButtonInteraction } from 'discord.js';
import type { CallToAction } from '../orchestrator/call-to-action.ts';
import type { Game, Narration } from '../orchestrator/game.ts';
import {
  ATTRIBUTE_LABELS,
  ATTRIBUTES,
  GRADE_INFO,
  describeMargin,
  formatModifier,
  type Attribute,
  type CheckResult,
} from '../rules/checks.ts';
import { runCommand, type ReplyContent } from './reply.ts';

// customId: invisible id carried by the button. Encoding who rolls, the attribute and the
// difficulty keeps the button working after a restart, e.g. "check:123456:agilidade:15".
const CHECK_PREFIX = 'check';
const DIVIDER = '──────────';

/** Narration text plus a highlighted footer that mentions (and notifies) whoever must act. */
export function narrationReply(header: string, narration: Narration): ReplyContent {
  const text = header ? `${header}\n\n${narration.text}` : narration.text;
  const action = narration.callToAction;
  if (!action) return text;

  // <@id> mentions the user, which also sends them a notification.
  const who = `**${action.characterName}** (<@${action.userId}>)`;
  if (action.kind === 'turn') {
    return `${text}\n\n${DIVIDER}\n👉 Vez de ${who}\n${capitalize(action.prompt)}`;
  }

  const label = ATTRIBUTE_LABELS[action.attribute];
  const details = [action.goal && capitalize(action.goal), label, `dificuldade ${action.difficulty}`].filter(Boolean);
  return {
    text: `${text}\n\n${DIVIDER}\n🎲 Teste de ${who}\n${details.join(' · ')}${action.stakes ? `\n${action.stakes}` : ''}`,
    components: [new ActionRowBuilder<ButtonBuilder>().addComponents(checkButton(action))],
  };
}

function checkButton(action: Extract<CallToAction, { kind: 'check' }>): ButtonBuilder {
  return new ButtonBuilder()
    .setCustomId(`${CHECK_PREFIX}:${action.userId}:${action.attribute}:${action.difficulty}`)
    .setLabel(`Rolar 1d20 ${formatModifier(action.modifier)} (${ATTRIBUTE_LABELS[action.attribute]})`)
    .setEmoji('🎲')
    .setStyle(ButtonStyle.Primary);
}

/** e.g. "🎲 Teste de Agilidade — Lia / 1d20 (14) + Agilidade (+2) = 16 vs dificuldade 15 / ✅ Sucesso (passou por 1)" */
export function checkCard(check: CheckResult, characterName: string): string {
  const label = ATTRIBUTE_LABELS[check.attribute];
  const grade = GRADE_INFO[check.grade];
  const detail = check.die === 20 || check.die === 1 ? `${check.die} natural!` : describeMargin(check.margin);
  return [
    `🎲 **Teste de ${label} — ${characterName}**`,
    `1d20 (${check.die}) + ${label} (${formatModifier(check.modifier)}) = **${check.total}**  vs  dificuldade ${check.difficulty}`,
    `${grade.emoji} **${grade.label}** (${detail})`,
  ].join('\n');
}

/** Handles clicks on check buttons. Other buttons (e.g. confirmations) are handled by their own collectors. */
export async function handleButton(interaction: ButtonInteraction, game: Game): Promise<void> {
  const [prefix, userId, attribute, difficultyText] = interaction.customId.split(':');
  const difficulty = Number(difficultyText);
  if (prefix !== CHECK_PREFIX || !userId || !isAttribute(attribute) || !Number.isInteger(difficulty)) return;

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
    const { check, narration } = await game.playerCheck(interaction.channelId, userId, attribute, difficulty);
    const character = await game.getCharacter(interaction.channelId, userId);
    return narrationReply(checkCard(check, character?.name ?? interaction.user.displayName), narration);
  });
}

function isAttribute(value: string | undefined): value is Attribute {
  return ATTRIBUTES.includes(value as Attribute);
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
