/**
 * Who an agent acts for. Agent functions receive it in their context (`AgentFunctionContext`), and guards read it
 * there, as a route's guards read the request.
 *
 * ```ts
 * caller: { request }                      // in a controller: the request's user, headers, session
 * caller: { user: job.data.user, scopes }  // in a queue job
 * ```
 */
export interface AiCaller<TUser = any, TRequest = any> {
  /** The HTTP platform's request the agent runs in (Express, Fastify, the Node adapter). */
  request?: TRequest;
  /** The user, where there is no request (a queue job, a workflow); in a request, it is `request.user`. */
  user?: TUser;
  /** Scopes the caller holds, checked against an agent function's `scopes`. */
  scopes?: readonly string[];
}

/**
 * What a call's `tools` lists: agent function names, and provider classes (every agent function of the class). The
 * model is offered each as a tool.
 */
export type AiToolSelection = ReadonlyArray<string | (abstract new (...args: any[]) => unknown)>;
