// Registers (or updates) the slash commands on each test server. Run with `npm run deploy`
// whenever a command's name, description or options change.
import { REST, Routes } from 'discord.js';
import { commands } from './commands/index.ts';
import { config } from './config.ts';

// REST: discord.js HTTP client for the Discord API (no gateway connection needed here).
const rest = new REST().setToken(config.discordToken);
const body = commands.map((command) => command.data.toJSON());

// Guild commands show up instantly; global ones can take up to an hour to propagate.
let failures = 0;
for (const guildId of config.discordGuildIds) {
  try {
    await rest.put(Routes.applicationGuildCommands(config.discordClientId, guildId), { body });
    console.log(`✔ ${commands.length} comandos registrados no servidor ${guildId}.`);
  } catch (error) {
    failures++;
    // Usually "Missing Access": the bot has not been invited to that server yet.
    console.error(`✖ Falha no servidor ${guildId}: ${(error as Error).message}`);
  }
}
if (failures) process.exitCode = 1;
