// Persistência das campanhas. Fase 0: um arquivo JSON por canal.
// A interface CampaignStore é o que o resto do código usa; na fase 1 entra uma implementação SQLite.
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Campaign } from './campaign.ts';

export interface CampaignStore {
  load(channelId: string): Promise<Campaign | null>;
  /**
   * Lê, aplica `change` e salva, tudo serializado por canal: duas chamadas no mesmo canal
   * nunca se sobrepõem. Se `change` lançar erro, nada é salvo e o erro sobe para quem chamou.
   */
  update(channelId: string, change: (current: Campaign | null) => Campaign | Promise<Campaign>): Promise<Campaign>;
}

export class JsonCampaignStore implements CampaignStore {
  // Fila por canal: cada update espera o anterior do mesmo canal terminar.
  private queues = new Map<string, Promise<unknown>>();

  constructor(private readonly dir: string) {}

  async load(channelId: string): Promise<Campaign | null> {
    try {
      const raw = await readFile(this.filePath(channelId), 'utf8');
      return JSON.parse(raw) as Campaign;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  update(
    channelId: string,
    change: (current: Campaign | null) => Campaign | Promise<Campaign>,
  ): Promise<Campaign> {
    const previous = this.queues.get(channelId) ?? Promise.resolve();
    const next = previous
      .catch(() => {}) // um erro no update anterior não trava a fila
      .then(async () => {
        const updated = await change(await this.load(channelId));
        await this.save(updated);
        return updated;
      });
    this.queues.set(channelId, next);
    // Limpa a fila quando ninguém mais estiver esperando, para o Map não crescer à toa.
    next.finally(() => {
      if (this.queues.get(channelId) === next) this.queues.delete(channelId);
    }).catch(() => {});
    return next;
  }

  private async save(campaign: Campaign): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    const file = this.filePath(campaign.channelId);
    // Grava num arquivo temporário e renomeia: se o processo cair no meio, o arquivo antigo continua íntegro.
    const tmp = `${file}.tmp`;
    await writeFile(tmp, JSON.stringify(campaign, null, 2), 'utf8');
    await rename(tmp, file);
  }

  private filePath(channelId: string): string {
    // IDs do Discord são só dígitos; validar evita nomes de arquivo maliciosos.
    if (!/^\d+$/.test(channelId)) {
      throw new Error(`channelId inválido: ${channelId}`);
    }
    return path.join(this.dir, `${channelId}.json`);
  }
}
