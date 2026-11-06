import * as z from 'zod';
import { AiConfigurationError } from '../lib/index.js';
import { toModelSchema } from '../lib/utils/schema.util.js';

describe('model schemas', () => {
  it.each([
    ['string', () => z.string()],
    ['array', () => z.array(z.string())],
  ])('refuses a cached %s output schema as tool arguments', (_type, create) => {
    const schema = create();
    const output = toModelSchema(schema, 'generateObject() `schema`');
    expect(toModelSchema(schema, 'another output')).toBe(output);

    expect(() =>
      toModelSchema(schema, 'OrdersTools.find inputSchema', { object: true }),
    ).toThrow(AiConfigurationError);
    expect(() =>
      toModelSchema(schema, 'OrdersTools.find inputSchema', { object: true }),
    ).toThrow('OrdersTools.find inputSchema: arguments are an object');
    // A failed tool registration must not invalidate the schema for output generation.
    expect(toModelSchema(schema, 'another output')).toBe(output);
  });

  it('shares a cached object schema between output generation and tool arguments', async () => {
    const schema = z.object({ id: z.string().transform(Number) });
    const convert = vi.spyOn(schema['~standard'].jsonSchema, 'input');
    const output = toModelSchema<{ id: number }>(
      schema,
      'generateObject() `schema`',
    );
    const input = toModelSchema(schema, 'OrdersTools.find inputSchema', {
      object: true,
    });

    expect(input).toBe(output);
    expect(convert).toHaveBeenCalledTimes(1);
    expect(await input.validate?.({ id: '42' })).toEqual({
      success: true,
      value: { id: 42 },
    });
    expect(await input.validate?.({ id: 42 })).toMatchObject({
      success: false,
    });
  });
});
