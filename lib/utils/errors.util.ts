import { HttpException } from '@nestjs/common';
import { AiToolError } from '../errors/ai.errors.js';

/** What the model is told about an error that is not meant for it. */
export const INTERNAL_ERROR_MESSAGE = 'Internal server error';

/**
 * The message of an `HttpException`, as its response body carries it: a string response, the body's `message`
 * (`ValidationPipe`'s list joined), else the exception's own.
 */
export function httpExceptionMessage(exception: HttpException): string {
  const response = exception.getResponse();
  if (typeof response === 'string') {
    return response;
  }
  const message = (response as { message?: unknown } | null)?.message;
  if (Array.isArray(message)) {
    return message.map(String).join('; ');
  }
  return typeof message === 'string' ? message : exception.message;
}

/**
 * An agent function's failure, as the model reads it: an `HttpException`'s message, `Internal server error` for
 * anything else (Nest's exception handler has logged it). A raw error message never reaches the model.
 */
export function toToolError(error: unknown, toolName: string): AiToolError {
  if (error instanceof AiToolError) {
    return error;
  }
  const message = error instanceof HttpException ? httpExceptionMessage(error) : INTERNAL_ERROR_MESSAGE;
  return new AiToolError(message, toolName, { cause: error });
}

/** Whether `error` is an abort: the caller's signal, or a request cancelled with it. */
export function isAbortError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === 'AbortError' || (error as { code?: unknown }).code === 'ABORT_ERR')
  );
}
