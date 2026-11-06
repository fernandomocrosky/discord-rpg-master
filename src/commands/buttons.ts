// What the table sees of a round: who declared, who is missing, who must roll. Also the buttons and the round timer.
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  MessageFlags,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Client,
} from 'discord.js';
import type { CallToAction } from '../orchestrator/call-to-action.ts';
import type { Game, Narration, RoundProgress } from '../orchestrator/game.ts';
import {
  ATTRIBUTE_LABELS,
  ATTRIBUTES,
  GRADE_INFO,
  describeMargin,
  formatModifier,
  type Attribute,
  type CheckResult,
} from '../rules/checks.ts';
import { runCommand, splitMessage, type ReplyContent } from './reply.ts';

// customId: invisible id carried by the button. Encoding who rolls, the attribute and the
// difficulty keeps the button working after a restart, e.g. "check:123456:agilidade:15".
const CHECK_PREFIX = 'check';
const RESOLVE_ID = 'round:resolve';
const DIVIDER = '──────────';
const BUTTONS_PER_ROW = 5; // Discord's limit

type CheckCall = Extract<CallToAction, { kind: 'check' }>;

/** Narration text plus a highlighted footer that mentions (and notifies) whoever must act. */
export function narrationReply(header: string, narration: Narration): ReplyContent {
  const text = header ? `${header}\n\n${narration.text}` : narration.text;
  if (narration.calls.length === 0) return text;

  const checks = narration.calls.filter((call): call is CheckCall => call.kind === 'check');
  if (checks.length === 0) return `${text}\n\n${DIVIDER}\n${narration.calls.map(describeCall).join('\n')}`;
  return {
    text: `${text}\n\n${DIVIDER}\n${checks.map(describeCheckCall).join('\n\n')}`,
    components: toRows(checks.map(checkButton)),
  };
}

function describeCall(call: CallToAction): string {
  // <@id> mentions the user, which also sends them a notification.
  switch (call.kind) {
    case 'group':
      return `👉 Vez de ${call.players.map((p) => `<@${p.userId}>`).join(' ')}\n${capitalize(call.prompt)}\nDeclarem com \`/acao\`: eu respondo quando todos tiverem declarado.`;
    case 'turn':
      return `👉 Vez de **${call.characterName}** (<@${call.userId}>)\n${capitalize(call.prompt)}`;
    case 'check':
      return describeCheckCall(call);
  }
}

function describeCheckCall(call: CheckCall): string {
  const details = [call.goal && capitalize(call.goal), ATTRIBUTE_LABELS[call.attribute], `dificuldade ${call.difficulty}`].filter(Boolean);
  const stakes = call.stakes ? `\n${call.stakes}` : '';
  return `🎲 Teste de **${call.characterName}** (<@${call.userId}>)\n${details.join(' · ')}${stakes}`;
}

function toRows(buttons: ButtonBuilder[]): ActionRowBuilder<ButtonBuilder>[] {
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  for (let i = 0; i < buttons.length; i += BUTTONS_PER_ROW) {
    rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(buttons.slice(i, i + BUTTONS_PER_ROW)));
  }
  return rows;
}

function checkButton(call: CheckCall): ButtonBuilder {
  return new ButtonBuilder()
    .setCustomId(`${CHECK_PREFIX}:${call.userId}:${call.attribute}:${call.difficulty}`)
    .setLabel(`${call.characterName}: 1d20 ${formatModifier(call.modifier)} (${ATTRIBUTE_LABELS[call.attribute]})`)
    .setEmoji('🎲')
    .setStyle(ButtonStyle.Primary);
}

/** Reply to anything a player does, and keeps the round timer in step with the game. */
export function roundReply(
  interaction: ChatInputCommandInteraction | ButtonInteraction,
  game: Game,
  header: string,
  progress: RoundProgress,
): ReplyContent {
  if (progress.status === 'narrated') {
    scheduleRound(interaction.client, game, interaction.channelId, progress.narration.deadline);
    return narrationReply(header, progress.narration);
  }
  scheduleRound(interaction.client, game, interaction.channelId, progress.deadline);

  const who = progress.missing.map((player) => `<@${player.userId}>`).join(' ');
  // <t:unix:R>: Discord renders a timestamp in each viewer's clock, here as a countdown ("em 3 minutos").
  const closes = `Fecha <t:${Math.ceil(progress.deadline.getTime() / 1000)}:R>.`;
  const status = progress.rolling
    ? `⏳ Falta rolar: ${who}. ${closes}`
    : `✍️ ${progress.declared}/${progress.total} declararam. Falta: ${who}. ${closes}`;
  const resolve = new ButtonBuilder().setCustomId(RESOLVE_ID).setLabel('Resolver agora').setEmoji('⏩').setStyle(ButtonStyle.Secondary);
  return { text: `${header}\n\n${status}`, components: toRows([resolve]) };
}

// One timer per channel. Timers do not survive a restart: the round then closes on the next player action.
const timers = new Map<string, NodeJS.Timeout>();

function scheduleRound(client: Client, game: Game, channelId: string, deadline: Date | undefined): void {
  clearTimeout(timers.get(channelId));
  timers.delete(channelId);
  if (!deadline) return;
  const timer = setTimeout(() => {
    timers.delete(channelId);
    closeExpiredRound(client, game, channelId).catch((error) => console.error('Failed to close a round:', error));
  }, Math.max(0, deadline.getTime() - Date.now()) + 500);
  timers.set(channelId, timer);
}

/** No interaction to answer here: the deadline passed, so the bot posts straight to the channel. */
async function closeExpiredRound(client: Client, game: Game, channelId: string): Promise<void> {
  const narration = await game.expireRound(channelId);
  if (!narration) return;
  scheduleRound(client, game, channelId, narration.deadline);

  const channel = await client.channels.fetch(channelId);
  if (!channel?.isSendable()) return;
  const reply = narrationReply('⌛ O tempo da rodada acabou.', narration);
  const { text, components } = typeof reply === 'string' ? { text: reply, components: [] } : reply;
  const parts = splitMessage(text);
  for (const [i, part] of parts.entries()) {
    await channel.send({ content: part, components: i === parts.length - 1 ? components : [] });
  }
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

/** Handles clicks on check and round buttons. Other buttons (e.g. confirmations) are handled by their own collectors. */
export async function handleButton(interaction: ButtonInteraction, game: Game): Promise<void> {
  if (interaction.customId === RESOLVE_ID) {
    await runCommand(interaction, async () => {
      const narration = await game.resolveRound(interaction.channelId, interaction.user.id);
      return roundReply(interaction, game, '⏩ Rodada resolvida.', { status: 'narrated', narration });
    });
    return;
  }

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

  await runCommand(
    interaction,
    async () => {
      const { check, progress } = await game.playerCheck(interaction.channelId, userId, attribute, difficulty);
      const character = await game.getCharacter(interaction.channelId, userId);
      return roundReply(interaction, game, checkCard(check, character?.name ?? interaction.user.displayName), progress);
    },
    { remainingButtons: otherButtons(interaction) },
  );
}

/** Several players may share a message of checks: a click removes only the clicked button. */
function otherButtons(interaction: ButtonInteraction): ActionRowBuilder<ButtonBuilder>[] {
  const buttons = interaction.message.components.flatMap((row) =>
    row.type === ComponentType.ActionRow
      ? row.components.flatMap((component) =>
          component.type === ComponentType.Button && component.customId !== interaction.customId ? [ButtonBuilder.from(component)] : [],
        )
      : [],
  );
  return toRows(buttons);
}

function isAttribute(value: string | undefined): value is Attribute {
  return ATTRIBUTES.includes(value as Attribute);
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
