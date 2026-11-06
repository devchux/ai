/**
 * The model names `@InjectModel()` asks for, recorded as the decorators run. `AiModule` provides a
 * token for each name asked for by the time it is defined (with `modelNames` and the names it
 * configures), so that a name it does not configure fails with a message of its own, not with
 * Nest's missing-provider error.
 */
const requested = new Set<string>();
const requestedEmbeddings = new Set<string>();

export function recordModelRequest(name: string): void {
  requested.add(name);
}

export function requestedModelNames(): string[] {
  return [...requested];
}

/** Embedding injection requests use a separate namespace, even when the names are identical. */
export function recordEmbeddingModelRequest(name: string): void {
  requestedEmbeddings.add(name);
}

export function requestedEmbeddingModelNames(): string[] {
  return [...requestedEmbeddings];
}
