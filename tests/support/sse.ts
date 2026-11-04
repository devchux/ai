/** The `data:` payloads of a server-sent events body, parsed as JSON; `[DONE]` stays a string. */
export function parseSse(body: string): unknown[] {
  return body
    .split('\n\n')
    .map((event) =>
      event
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trim())
        .join('\n'),
    )
    .filter((data) => data.length > 0)
    .map((data) => (data === '[DONE]' ? data : JSON.parse(data)));
}

/** The chunk types, in order. */
export function typesOf(chunks: unknown[]): string[] {
  return chunks.map((chunk) => (typeof chunk === 'string' ? chunk : (chunk as { type: string }).type));
}
