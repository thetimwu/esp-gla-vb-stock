import { model, Schema, type Types } from "mongoose";

export interface ComponentRecord {
  _id: Types.ObjectId;
  displayName: string;
  currentQuantity: number;
  minimumStockLevel: number;
  photoUrl?: string;
  attributes?: unknown;
  isArchived: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const componentSchema = new Schema<ComponentRecord>(
  {
    displayName: { type: String, required: true, trim: true },
    currentQuantity: { type: Number, required: true, min: 0 },
    minimumStockLevel: { type: Number, required: true, min: 0 },
    photoUrl: { type: String, required: false, trim: true },
    attributes: { type: Schema.Types.Mixed, required: false },
    isArchived: { type: Boolean, required: true, default: false },
  },
  { timestamps: true, strict: "throw" },
);

export const ComponentModel = model<ComponentRecord>(
  "Component",
  componentSchema,
  "components",
);
