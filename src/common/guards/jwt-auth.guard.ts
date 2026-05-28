import { Injectable, ExecutionContext } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import {
  buildDevPreviewUser,
  DEV_PREVIEW_TOKEN,
  isDevPreviewAuthEnabled,
} from '../dev-preview';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    if (isDevPreviewAuthEnabled()) {
      const request = context.switchToHttp().getRequest();
      const auth = (request.headers?.authorization as string | undefined)?.trim();
      const token = auth?.startsWith('Bearer ') ? auth.slice(7).trim() : auth;
      if (token === DEV_PREVIEW_TOKEN) {
        request.user = buildDevPreviewUser();
        return true;
      }
    }

    return super.canActivate(context);
  }
}
