// Bot entrypoint: creates the Discord client, wires commands to the game and logs in.
import { ActivityType, Client, Events, GatewayIntentBits } from 'discord.js';
import { handleButton } from './commands/buttons.ts';
import { commands } from './commands/index.ts';
import { config } from './config.ts';
import { generate } from './llm/client.ts';
import { createGame } from './orchestrator/game.ts';
import { JsonCampaignStore } from './state/store.ts';

const game = createGame({ store: new JsonCampaignStore('data'), generate });
const commandsByName = new Map(commands.map((command) => [command.data.name, command]));

// Client: the bot's connection to Discord. Intents pick which events it receives:
// Guilds for slash commands, GuildVoiceStates to know who is in each voice channel.
// No MessageContent: the bot never reads regular chat.
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates] });

client.once(Events.ClientReady, (ready) => {
  // setPresence: the status line under the bot's name in the member list ("Jogando /ajuda").
  ready.user.setPresence({ activities: [{ name: '/ajuda', type: ActivityType.Playing }] });
  console.log(`Tavola online como ${ready.user.tag} (modelo: ${config.llmModel}).`);
});

// InteractionCreate fires whenever someone uses a slash command (or a button, menu, etc.).
client.on(Events.InteractionCreate, async (interaction) => {
  if (interaction.isButton()) {
    await handleButton(interaction, game).catch((error) => console.error('Failed to handle button:', error));
    return;
  }
  if (!interaction.isChatInputCommand()) return;
  const command = commandsByName.get(interaction.commandName);
  if (!command) {
    console.warn(`Unknown command: /${interaction.commandName}. Did you run npm run deploy?`);
    return;
  }
  try {
    await command.execute(interaction, game);
  } catch (error) {
    // runCommand already handles game errors; this only catches failures talking to Discord itself.
    console.error(`Failed to handle /${interaction.commandName}:`, error);
  }
});

process.on('unhandledRejection', (error) => {
  console.error('Unhandled rejection:', error);
});

await client.login(config.discordToken);
