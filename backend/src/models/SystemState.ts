import { model, Schema } from "mongoose";

export interface SystemStateRecord {
  _id: string;
  revision: number;
}

const systemStateSchema = new Schema<SystemStateRecord>(
  {
    _id: { type: String, required: true },
    revision: { type: Number, required: true, default: 0 },
  },
  { versionKey: false, strict: "throw" },
);

export const SystemStateModel = model<SystemStateRecord>(
  "SystemState",
  systemStateSchema,
  "systemState",
);
