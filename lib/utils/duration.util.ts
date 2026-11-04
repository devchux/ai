import type { Duration } from '@nestjs/resilience';
import { AiConfigurationError } from '../errors/ai.errors.js';

const UNITS: Record<string, number> = { ms: 1, s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 };

/** A duration (`@nestjs/resilience`'s: milliseconds, or `'30s'`, `'2m'`, ...) in milliseconds. */
export function toMilliseconds(value: Duration | string, option: string): number {
  if (typeof value === 'number') {
    if (Number.isFinite(value) && value >= 0) {
      return value;
    }
  } else if (typeof value === 'string') {
    const match = /^(\d+(?:\.\d+)?)(ms|s|m|h|d|w)$/.exec(value.trim());
    if (match) {
      return Number(match[1]) * UNITS[match[2]!]!;
    }
  }
  throw new AiConfigurationError(
    `\`${option}\` must be a number of milliseconds or a duration such as "30s" or "2m". Got ${JSON.stringify(value)}.`,
  );
}
