import { z } from "zod";
import { StockAction } from "../entities/StockTransaction.js";

const MAX_STOCK_QUANTITY = 2_147_483_647;
const commentSchema = z
  .string()
  .trim()
  .max(500, "Comment must be 500 characters or fewer")
  .optional();

export const stockOperationSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal(StockAction.STOCK_IN),
      quantity: z
        .number()
        .int("Quantity must be a whole number")
        .positive("Quantity must be greater than zero")
        .max(MAX_STOCK_QUANTITY, "Quantity exceeds the supported range"),
      comment: commentSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal(StockAction.STOCK_OUT),
      quantity: z
        .number()
        .int("Quantity must be a whole number")
        .positive("Quantity must be greater than zero")
        .max(MAX_STOCK_QUANTITY, "Quantity exceeds the supported range"),
      comment: commentSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal(StockAction.ADJUSTMENT),
      newQuantity: z
        .number()
        .int("New quantity must be a whole number")
        .min(0, "New quantity cannot be negative")
        .max(MAX_STOCK_QUANTITY, "New quantity exceeds the supported range"),
      comment: commentSchema,
    })
    .strict(),
]);

export type StockOperationRequest = z.infer<typeof stockOperationSchema>;
