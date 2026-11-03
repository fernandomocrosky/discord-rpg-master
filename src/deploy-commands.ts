// Registers (or updates) the slash commands on the test server. Run with `npm run deploy`
// whenever a command's name, description or options change.
import { REST, Routes } from 'discord.js';
import { commands } from './commands/index.ts';
import { config } from './config.ts';

// REST: discord.js HTTP client for the Discord API (no gateway connection needed here).
const rest = new REST().setToken(config.discordToken);

// Guild commands show up instantly; global ones can take up to an hour to propagate.
await rest.put(Routes.applicationGuildCommands(config.discordClientId, config.discordGuildId), {
  body: commands.map((command) => command.data.toJSON()),
});

console.log(`${commands.length} comandos registrados no servidor de teste.`);
