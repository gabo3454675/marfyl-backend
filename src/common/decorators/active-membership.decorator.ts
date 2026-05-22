import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export const ActiveMembership = createParamDecorator(
  (data: unknown, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    return request.activeMembership;
  },
);
