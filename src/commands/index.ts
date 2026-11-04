// All slash commands, used by index.ts (to route interactions) and deploy-commands.ts (to register them).
import { acao } from './acao.ts';
import { ajuda } from './ajuda.ts';
import { campanha } from './campanha.ts';
import { ficha } from './ficha.ts';
import { personagem } from './personagem.ts';
import { rolar } from './rolar.ts';
import { sessao } from './sessao.ts';
import type { Command } from './types.ts';

export const commands: Command[] = [ajuda, campanha, personagem, ficha, acao, rolar, sessao];
