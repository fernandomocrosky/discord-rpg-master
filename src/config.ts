// Lê e valida as variáveis do .env. Falha cedo, com mensagem clara, se faltar alguma.
// Node 20.12+: carrega o .env sem precisar do pacote dotenv.
try {
  process.loadEnvFile();
} catch {
  // Sem arquivo .env: usa só as variáveis que já estão no ambiente.
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Variável de ambiente ${name} não definida. Veja o .env.example.`);
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
