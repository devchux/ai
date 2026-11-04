/**
 * A schema the package accepts: a Standard Schema that also produces JSON Schema (`~standard.jsonSchema`), as
 * `@nestjs/mcp`'s schemas are, so that one schema serves a method's `@AgentFunction()` and its `@Tool()`. Zod 4.2+
 * and ArkType schemas are, as they are; Valibot through
 * `toStandardJsonSchema()` from `@valibot/to-json-schema`; a JSON Schema document through `fromJsonSchema()` from
 * `@modelcontextprotocol/server`. The model is sent the JSON Schema, and what it answers is validated by the schema.
 *
 * The shape of the [Standard Schema](https://standardschema.dev) interfaces, declared here so that the package has no
 * dependency for them.
 */
export interface AiSchema<Input = any, Output = Input> {
  readonly '~standard': {
    readonly version: 1;
    readonly vendor: string;
    readonly types?: { readonly input: Input; readonly output: Output } | undefined;
    readonly validate: (
      value: unknown,
      options?: { readonly libraryOptions?: Record<string, unknown> | undefined } | undefined,
    ) => AiSchemaResult<Output> | Promise<AiSchemaResult<Output>>;
    readonly jsonSchema: {
      readonly input: (options: AiJsonSchemaOptions) => Record<string, unknown>;
      readonly output: (options: AiJsonSchemaOptions) => Record<string, unknown>;
    };
  };
}

export interface AiJsonSchemaOptions {
  readonly target: 'draft-2020-12' | 'draft-07' | 'openapi-3.0' | ({} & string);
  readonly libraryOptions?: Record<string, unknown> | undefined;
}

export type AiSchemaResult<Output> =
  | { readonly value: Output; readonly issues?: undefined }
  | {
      readonly issues: ReadonlyArray<{
        readonly message: string;
        readonly path?: ReadonlyArray<PropertyKey | { readonly key: PropertyKey }> | undefined;
      }>;
    };

/** The type a schema validates to. */
export type InferSchemaOutput<S extends AiSchema> = NonNullable<S['~standard']['types']>['output'];
