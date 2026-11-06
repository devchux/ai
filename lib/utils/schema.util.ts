import { jsonSchema, type Schema } from 'ai';
import { AiConfigurationError } from '../errors/ai.errors.js';
import type { AiSchema, AiSchemaResult } from '../interfaces/ai-schema.interface.js';

/** JSON Schema drafts, in order of preference: what `ai` sends providers, then what MCP uses. */
const TARGETS = ['draft-07', 'draft-2020-12'] as const;

const converted = new WeakMap<object, { schema: Schema<unknown>; rootType: unknown }>();

/** The `ai` schema of a tool without arguments. */
export const EMPTY_OBJECT_SCHEMA = jsonSchema<Record<string, never>>({
  type: 'object',
  properties: {},
  additionalProperties: false,
});

/**
 * The `ai` schema for a Standard Schema with JSON Schema: its JSON Schema (the input side: what the model writes),
 * computed once, and its validation, whose issues become the error the model reads. `object: true` requires an
 * object at the root (tool arguments).
 */
export function toModelSchema<T = unknown>(schema: AiSchema, where: string, { object = false } = {}): Schema<T> {
  const cached = converted.get(schema);
  if (cached) {
    if (object) {
      assertObjectRoot(cached.rootType, where);
    }
    return cached.schema as Schema<T>;
  }

  const standard = (schema as Partial<AiSchema> | undefined)?.['~standard'];
  if (!standard || typeof standard.validate !== 'function') {
    throw new AiConfigurationError(
      `${where}: not a Standard Schema. Pass a Zod 4.2+ schema (z.object({ ... })), an ArkType type, a Valibot schema ` +
        'wrapped with toStandardJsonSchema(), or a JSON Schema wrapped with fromJsonSchema() from @modelcontextprotocol/server.',
    );
  }
  if (typeof standard.jsonSchema?.input !== 'function') {
    throw new AiConfigurationError(
      `${where}: the "${standard.vendor}" schema cannot produce JSON Schema (no ~standard.jsonSchema), which the ` +
        'model needs. Zod needs 4.2 or later (Zod 3 is not supported); Valibot needs toStandardJsonSchema() from ' +
        '@valibot/to-json-schema.',
    );
  }

  let root: Record<string, unknown> | undefined;
  let failure: unknown;
  for (const target of TARGETS) {
    try {
      root = standard.jsonSchema.input({ target });
      break;
    } catch (error) {
      failure = error;
    }
  }
  if (!root) {
    throw new AiConfigurationError(
      `${where}: the schema cannot be converted to JSON Schema: ${(failure as Error)?.message ?? failure}`,
    );
  }
  if (object) {
    assertObjectRoot(root.type, where);
  }

  const result = jsonSchema<T>(root as Parameters<typeof jsonSchema>[0], {
    validate: async (value) => {
      const outcome = (await standard.validate(value)) as AiSchemaResult<T>;
      return outcome.issues
        ? { success: false, error: new TypeError(formatIssues(outcome.issues)) }
        : { success: true, value: outcome.value };
    },
  });
  converted.set(schema, { schema: result as Schema<unknown>, rootType: root.type });
  return result;
}

function assertObjectRoot(type: unknown, where: string): void {
  if (type !== undefined && type !== 'object') {
    throw new AiConfigurationError(
      `${where}: arguments are an object, and this schema describes ${JSON.stringify(type)}. ` +
        'Wrap it in z.object({ ... }).',
    );
  }
}

/** Validation issues as one line each, with their path: what the model reads to correct itself. */
export function formatIssues(issues: NonNullable<Extract<AiSchemaResult<unknown>, { issues: unknown }>['issues']>): string {
  return issues
    .map((issue) => {
      const path = (issue.path ?? [])
        .map((segment) => String(typeof segment === 'object' && segment !== null ? segment.key : segment))
        .join('.');
      return path ? `${path}: ${issue.message}` : issue.message;
    })
    .join('\n');
}
