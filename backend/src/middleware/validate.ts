import type { RequestHandler } from "express";
import type { ZodType } from "zod";

export function validateParams<T>(schema: ZodType<T>): RequestHandler {
  return (request, _response, next) => {
    const result = schema.safeParse(request.params);
    if (!result.success) {
      next(result.error);
      return;
    }

    next();
  };
}
