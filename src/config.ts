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

export const config = {
  discordToken: required('DISCORD_TOKEN'),
  discordClientId: required('DISCORD_CLIENT_ID'),
  discordGuildId: required('DISCORD_GUILD_ID'),
  anthropicApiKey: required('ANTHROPIC_API_KEY'),
  llmModel: required('LLM_MODEL'),
};
