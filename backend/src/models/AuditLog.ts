import { model, Schema, type Types } from "mongoose";

export const AUDIT_TARGET_TYPES = ["user", "component"] as const;
export type AuditTargetType = (typeof AUDIT_TARGET_TYPES)[number];

export interface AuditLogRecord {
  _id: Types.ObjectId;
  actorId: Types.ObjectId;
  action: string;
  targetType: AuditTargetType;
  targetId: Types.ObjectId;
  timestamp: Date;
}

const auditLogSchema = new Schema<AuditLogRecord>(
  {
    actorId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    action: { type: String, required: true, trim: true },
    targetType: { type: String, enum: AUDIT_TARGET_TYPES, required: true },
    targetId: { type: Schema.Types.ObjectId, required: true },
    timestamp: { type: Date, required: true, default: Date.now, index: true },
  },
  { versionKey: false, strict: "throw" },
);

export const AuditLogModel = model<AuditLogRecord>(
  "AuditLog",
  auditLogSchema,
  "auditLogs",
);
