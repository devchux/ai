import type { ParamsFactory } from '@nestjs/core';
import { RouteParamtypes } from '@nestjs/common/enums/route-paramtypes.enum.js';
import { AI_PARAMS_METADATA } from '../ai.constants.js';

/**
 * The parameters of an agent function. Pipes see the input as a `body` parameter (so `ValidationPipe` validates a DTO
 * class) and the context as a `custom` one (which it skips). The numbers are `@nestjs/mcp`'s, and must stay so: a
 * method that is an MCP tool too has its parameters recorded once, under the key both packages read, and either
 * package's factory reads them.
 */
export enum AiParamtype {
  INPUT = RouteParamtypes.BODY,
  CONTEXT = 1001,
}

export class AiParamsFactory implements ParamsFactory {
  exchangeKeyForValue(type: number, data: unknown, args: unknown[]): unknown {
    switch (type) {
      case AiParamtype.INPUT: {
        const input = args[0] as Record<string, unknown> | undefined;
        return typeof data === 'string' && input ? input[data] : input;
      }
      case AiParamtype.CONTEXT:
        return args[1];
      default:
        return null;
    }
  }
}

/**
 * Records the two parameters of an agent function, `(input, context)`, as parameter metadata, where no parameter
 * decorator took their place. `ExternalContextCreator` runs pipes only on parameters it has metadata for, and calls
 * the method with those alone: custom decorators (`createParamDecorator()`) on other parameters keep theirs.
 */
export function recordHandlerParams(target: Function, methodName: string): void {
  const existing: Record<string, { index: number }> = Reflect.getMetadata(AI_PARAMS_METADATA, target, methodName) ?? {};
  const taken = new Set(Object.values(existing).map((param) => param.index));
  if (taken.has(0) && taken.has(1)) {
    return;
  }
  Reflect.defineMetadata(
    AI_PARAMS_METADATA,
    {
      ...existing,
      ...(!taken.has(0) && { [`${AiParamtype.INPUT}:0`]: { index: 0, data: undefined, pipes: [] } }),
      ...(!taken.has(1) && { [`${AiParamtype.CONTEXT}:1`]: { index: 1, data: undefined, pipes: [] } }),
    },
    target,
    methodName,
  );
}
