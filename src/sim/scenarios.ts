// Fixed campaigns and player profiles for simulated sessions. Original content, in pt-BR like the game.
import type { Attribute } from '../rules/checks.ts';

export interface SimPlayer {
  userId: string;
  name: string;
  concept: string;
  profile: { strong: Attribute; good: Attribute; weak: Attribute };
  style: string; // how the simulated player behaves, sent to the LLM
  silence: number; // chance of not answering in a round or not rolling a check
}

export interface Scenario {
  id: string;
  setting: string;
  tone: string;
  hook: string;
  players: SimPlayer[];
}

const TALKER = 'Você é animado, fala bastante e toma a iniciativa.';
const QUIET = 'Você é tímido e escreve pouco, com frases curtas e ações cautelosas.';
const JOKER = 'Você joga pela piada: faz ações absurdas e engraçadas, mas dentro da cena.';
const OVERREACHER =
  'Você narra o resultado da própria ação como se já tivesse dado certo ("mato ele") e às vezes tira do bolso um item que ninguém citou.';

export const SCENARIOS: Scenario[] = [
  {
    id: 'porto',
    setting: 'Cidade portuária de fantasia, cheia de contrabandistas e guildas rivais',
    tone: 'aventura com humor',
    hook: 'O farol da cidade apagou e os navios começaram a sumir',
    players: [
      {
        userId: '101',
        name: 'Iara',
        concept: 'capitã de navio falida e teimosa',
        profile: { strong: 'presenca', good: 'forca', weak: 'mente' },
        style: TALKER,
        silence: 0,
      },
      {
        userId: '102',
        name: 'Beto',
        concept: 'aprendiz de cartógrafo medroso',
        profile: { strong: 'mente', good: 'agilidade', weak: 'forca' },
        style: QUIET,
        silence: 0.2,
      },
      {
        userId: '103',
        name: 'Zuleica',
        concept: 'cantora de taverna que se acha feiticeira',
        profile: { strong: 'presenca', good: 'agilidade', weak: 'forca' },
        style: JOKER,
        silence: 0,
      },
      {
        userId: '104',
        name: 'Dante',
        concept: 'mercenário convencido',
        profile: { strong: 'forca', good: 'presenca', weak: 'mente' },
        style: OVERREACHER,
        silence: 0,
      },
    ],
  },
];
