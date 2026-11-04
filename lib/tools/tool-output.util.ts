import { Logger } from '@nestjs/common';
import { AiToolError } from '../errors/ai.errors.js';

const logger = new Logger('AiModule');

/** The shape of an MCP `CallToolResult`, which a method that is an `@nestjs/mcp` `@Tool()` too may return. */
interface CallToolResultLike {
  content: Array<{ type: string; text?: unknown }>;
  structuredContent?: unknown;
  isError?: boolean;
}

function isCallToolResult(value: unknown): value is CallToolResultLike {
  if (typeof value !== 'object' || value === null || !Array.isArray((value as CallToolResultLike).content)) {
    return false;
  }
  const keys = Object.keys(value);
  return (
    keys.every((key) => ['content', 'structuredContent', 'isError', '_meta'].includes(key)) &&
    (value as CallToolResultLike).content.every((block) => typeof block?.type === 'string')
  );
}

/**
 * What the model reads of an agent function's return value: JSON (a `Date` becomes its ISO string; `undefined` is
 * `null`). An MCP `CallToolResult` becomes its `structuredContent`, else its text blocks joined; `isError: true` is a
 * tool error. Blocks other than text (images, audio, resources) are dropped.
 */
export function toToolOutput(value: unknown, toolName: string, where: string): unknown {
  if (isCallToolResult(value)) {
    const text = value.content
      .filter((block) => block.type === 'text' && typeof block.text === 'string')
      .map((block) => block.text as string)
      .join('\n');
    if (value.isError) {
      throw new AiToolError(text || 'The tool failed', toolName);
    }
    if (value.content.some((block) => block.type !== 'text')) {
      logger.warn(`${where} returned content other than text, which agents are not sent; only its text is.`);
    }
    return value.structuredContent !== undefined ? toJson(value.structuredContent) : text;
  }
  return value === undefined ? null : toJson(value);
}

function toJson(value: unknown): unknown {
  if (typeof value !== 'object' || value === null) {
    return value;
  }
  return JSON.parse(JSON.stringify(value));
}
