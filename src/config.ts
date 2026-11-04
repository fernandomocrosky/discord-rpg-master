// Reads and validates .env variables. Fails early, with a clear message, if any is missing.

// Node 20.12+: loads .env without the dotenv package.
try {
  process.loadEnvFile();
} catch {
  // No .env file: rely on variables already set in the environment.
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Environment variable ${name} is not set. See .env.example.`);
  }
  return value;
}

/** Comma-separated Discord IDs, e.g. "123,456". */
function idList(name: string): string[] {
  const ids = required(name)
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
  const invalid = ids.filter((id) => !/^\d+$/.test(id));
  if (ids.length === 0 || invalid.length) {
    throw new Error(`Environment variable ${name} must be a comma-separated list of numeric IDs.`);
  }
  return ids;
}

export const config = {
  discordToken: required('DISCORD_TOKEN'),
  discordClientId: required('DISCORD_CLIENT_ID'),
  discordGuildIds: idList('DISCORD_GUILD_IDS'), // test servers where commands are registered
  anthropicApiKey: required('ANTHROPIC_API_KEY'),
  llmModel: required('LLM_MODEL'),
};
