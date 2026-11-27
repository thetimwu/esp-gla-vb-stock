import { z } from "zod";

const componentFields = {
  name: z.string().trim().min(1).max(200),
  description: z.string().max(10000),
  partNumber: z.string().trim().max(100).nullable(),
  minimumStockLevel: z.number().int().min(0).max(2_147_483_647),
  photoPath: z.string().max(2000).nullable(),
  attributes: z.record(z.string(), z.unknown()),
  isActive: z.boolean(),
};

export const createComponentSchema = z
  .object({
    name: componentFields.name,
    description: componentFields.description.optional(),
    partNumber: componentFields.partNumber.optional(),
    minimumStockLevel: componentFields.minimumStockLevel.optional(),
    photoPath: componentFields.photoPath.optional(),
    attributes: componentFields.attributes.optional(),
  })
  .strict();

export const updateComponentSchema = z
  .object({
    name: componentFields.name.optional(),
    description: componentFields.description.optional(),
    partNumber: componentFields.partNumber.optional(),
    minimumStockLevel: componentFields.minimumStockLevel.optional(),
    photoPath: componentFields.photoPath.optional(),
    attributes: componentFields.attributes.optional(),
    isActive: componentFields.isActive.optional(),
  })
  .strict()
  .refine(
    (value) => Object.keys(value).length > 0,
    "Provide at least one field",
  );

export const userIdParamsSchema = z.object({
  userId: z.uuid("Invalid user ID"),
});

export const componentAdminIdParamsSchema = z.object({
  componentId: z.uuid("Invalid component ID"),
});
