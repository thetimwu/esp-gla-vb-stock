import { z } from "zod";

export const componentIdParamsSchema = z.object({
  componentId: z.uuid("Invalid component ID"),
});

export type ComponentIdParams = z.infer<typeof componentIdParamsSchema>;
