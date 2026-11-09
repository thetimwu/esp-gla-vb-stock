import { z } from "zod";

export const componentIdParamsSchema = z.object({
  componentId: z.string().regex(/^[a-f\d]{24}$/i, "Invalid component ID"),
});

export type ComponentIdParams = z.infer<typeof componentIdParamsSchema>;
