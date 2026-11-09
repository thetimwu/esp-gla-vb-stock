import type { RequestHandler } from "express";
import type { ComponentReader } from "../services/componentService.js";
import type { ComponentIdParams } from "../validators/componentValidators.js";

export function createListComponentsController(
  componentReader: ComponentReader,
): RequestHandler {
  return async (_request, response) => {
    const components = await componentReader.listPublic();
    response.status(200).json({ components });
  };
}

export function createGetComponentController(
  componentReader: ComponentReader,
): RequestHandler<ComponentIdParams> {
  return async (request, response) => {
    const component = await componentReader.findPublicById(
      request.params.componentId,
    );
    if (!component) {
      response.status(404).json({
        error: {
          code: "COMPONENT_NOT_FOUND",
          message: "Component not found",
        },
      });
      return;
    }

    response.status(200).json({ component });
  };
}
