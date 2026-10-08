import { randomBytes } from 'node:crypto';

const ADJECTIVES = [
  'bright',
  'calm',
  'dark',
  'fast',
  'green',
  'happy',
  'keen',
  'light',
  'long',
  'loud',
  'pale',
  'quick',
  'sharp',
  'slow',
  'soft',
  'warm',
  'wild',
  'wise',
];

const NOUNS = [
  'cloud',
  'creek',
  'dawn',
  'dusk',
  'field',
  'flame',
  'frost',
  'grove',
  'hill',
  'lake',
  'leaf',
  'moon',
  'peak',
  'rain',
  'river',
  'rock',
  'snow',
  'star',
  'storm',
  'tide',
  'tree',
  'wave',
  'wind',
];

export function generateSessionId(): string {
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  const hex = randomBytes(2).toString('hex');
  return `${adj}-${noun}-${hex}`;
}
