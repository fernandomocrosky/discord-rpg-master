// Shape of a slash command module. `game` is injected by index.ts, so commands create nothing themselves.
import type { ChatInputCommandInteraction, SharedNameAndDescription, SharedSlashCommand } from 'discord.js';
import type { Game } from '../orchestrator/game.ts';

export interface Command {
  // SlashCommandBuilder: defines the name, description and options Discord shows in the command picker.
  data: SharedSlashCommand & SharedNameAndDescription;
  execute(interaction: ChatInputCommandInteraction, game: Game): Promise<void>;
}
