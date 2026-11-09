import { model, Schema, type Types } from "mongoose";

export const STOCK_ACTIONS = ["stock-in", "stock-out", "adjustment"] as const;
export type StockAction = (typeof STOCK_ACTIONS)[number];

export interface StockTransactionRecord {
  _id: Types.ObjectId;
  componentId: Types.ObjectId;
  userId: Types.ObjectId;
  timestamp: Date;
  previousQuantity: number;
  newQuantity: number;
  changeAmount: number;
  actionType: StockAction;
  comment?: string;
}

const stockTransactionSchema = new Schema<StockTransactionRecord>(
  {
    componentId: {
      type: Schema.Types.ObjectId,
      ref: "Component",
      required: true,
      index: true,
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    timestamp: { type: Date, required: true, default: Date.now, index: true },
    previousQuantity: { type: Number, required: true, min: 0 },
    newQuantity: { type: Number, required: true, min: 0 },
    changeAmount: { type: Number, required: true },
    actionType: { type: String, enum: STOCK_ACTIONS, required: true },
    comment: { type: String, required: false, trim: true },
  },
  { versionKey: false, strict: "throw" },
);

export const StockTransactionModel = model<StockTransactionRecord>(
  "StockTransaction",
  stockTransactionSchema,
  "stockTransactions",
);
