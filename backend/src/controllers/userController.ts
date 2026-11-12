import type { Request, RequestHandler } from "express";
import { ApiError } from "../errors/ApiError.js";
import type { UserManagementService } from "../services/userManagementService.js";
import {
  createUserBodySchema,
  emptyObjectSchema,
  updateUserBodySchema,
  userIdParamsSchema,
} from "../validators/authValidators.js";

function getActorId(request: Request): string {
  const actorId = request.authenticatedUser?.id;
  if (!actorId) {
    throw new ApiError(
      401,
      "AUTHENTICATION_REQUIRED",
      "Authentication required",
    );
  }
  return actorId;
}

export function createUserController(userService: UserManagementService): {
  list: RequestHandler;
  create: RequestHandler;
  update: RequestHandler;
  deactivate: RequestHandler;
  reactivate: RequestHandler;
} {
  return {
    list: async (request, response) => {
      emptyObjectSchema.parse(request.query);
      const users = await userService.listUsers();
      response.status(200).json({ users });
    },

    create: async (request, response) => {
      emptyObjectSchema.parse(request.query);
      const input = createUserBodySchema.parse(request.body);
      const user = await userService.createUser(getActorId(request), input);
      response.status(201).json({ user });
    },

    update: async (request, response) => {
      const { userId } = userIdParamsSchema.parse(request.params);
      emptyObjectSchema.parse(request.query);
      const input = updateUserBodySchema.parse(request.body);
      const user = await userService.updateUser(
        getActorId(request),
        userId,
        input,
      );
      response.status(200).json({ user });
    },

    deactivate: async (request, response) => {
      const { userId } = userIdParamsSchema.parse(request.params);
      emptyObjectSchema.parse(request.body ?? {});
      emptyObjectSchema.parse(request.query);
      const user = await userService.setUserActive(
        getActorId(request),
        userId,
        false,
      );
      response.status(200).json({ user });
    },

    reactivate: async (request, response) => {
      const { userId } = userIdParamsSchema.parse(request.params);
      emptyObjectSchema.parse(request.body ?? {});
      emptyObjectSchema.parse(request.query);
      const user = await userService.setUserActive(
        getActorId(request),
        userId,
        true,
      );
      response.status(200).json({ user });
    },
  };
}
