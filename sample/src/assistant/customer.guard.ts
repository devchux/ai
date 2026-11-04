import { Injectable, UnauthorizedException, type CanActivate, type ExecutionContext } from '@nestjs/common';

/**
 * Signs the customer in from the `x-customer` header. A stand-in for the store's real authentication: whatever sets
 * `request.user` works the same.
 */
@Injectable()
export class CustomerGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{ headers: Record<string, string | undefined>; user?: unknown }>();
    const name = request.headers['x-customer'];
    if (!name) {
      throw new UnauthorizedException();
    }
    request.user = { name };
    return true;
  }
}
