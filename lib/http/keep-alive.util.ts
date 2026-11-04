/** An SSE comment line: clients skip it, and proxies see the connection is alive. */
const KEEP_ALIVE = new TextEncoder().encode(': keep-alive\n\n');

/**
 * `body` with a keep-alive comment written whenever it has been quiet for `intervalMs`: while a tool runs, or the
 * model thinks, so that proxies and load balancers do not close the connection as idle. Comments go between the
 * body's chunks, each a whole server-sent event.
 */
export function withKeepAlive(body: ReadableStream<Uint8Array>, intervalMs: number): ReadableStream<Uint8Array> {
  const reader = body.getReader();
  let pending: ReturnType<typeof reader.read> | undefined;
  return new ReadableStream<Uint8Array>({
    pull: async (controller) => {
      pending ??= reader.read();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const quiet = new Promise<'quiet'>((resolve) => {
        timer = setTimeout(() => resolve('quiet'), intervalMs);
      });
      try {
        const next = await Promise.race([pending, quiet]);
        if (next === 'quiet') {
          controller.enqueue(KEEP_ALIVE);
          return;
        }
        pending = undefined;
        if (next.done) {
          controller.close();
        } else {
          controller.enqueue(next.value);
        }
      } finally {
        clearTimeout(timer);
      }
    },
    cancel: (reason) => reader.cancel(reason),
  });
}
