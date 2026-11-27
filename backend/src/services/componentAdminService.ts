import { AppDataSource } from "../config/dataSource.js";
import { ApiError } from "../errors/ApiError.js";
import { AuditLog } from "../entities/AuditLog.js";
import { Component } from "../entities/Component.js";

export interface ComponentChanges {
  name?: string;
  description?: string;
  partNumber?: string | null;
  minimumStockLevel?: number;
  photoPath?: string | null;
  attributes?: Record<string, unknown>;
  isActive?: boolean;
}

export interface NewComponent extends ComponentChanges {
  name: string;
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "driverError" in error &&
    typeof error.driverError === "object" &&
    error.driverError !== null &&
    "code" in error.driverError &&
    error.driverError.code === "23505"
  );
}

export interface ComponentAdminService {
  list(): Promise<Component[]>;
  findById(id: string): Promise<Component | null>;
  create(changes: NewComponent, actorId: string): Promise<Component>;
  update(
    id: string,
    changes: ComponentChanges,
    actorId: string,
  ): Promise<Component>;
}

export const componentAdminService: ComponentAdminService = {
  async list() {
    return AppDataSource.getRepository(Component).find({
      order: { name: "ASC" },
    });
  },

  async findById(id) {
    return AppDataSource.getRepository(Component).findOne({ where: { id } });
  },

  async create(changes, actorId) {
    try {
      return await AppDataSource.transaction(async (manager) => {
        const component = await manager.getRepository(Component).save(
          manager.getRepository(Component).create({
            name: changes.name,
            description: changes.description ?? "",
            partNumber: changes.partNumber ?? null,
            minimumStockLevel: changes.minimumStockLevel ?? 0,
            photoPath: changes.photoPath ?? null,
            attributes: changes.attributes ?? {},
          }),
        );
        await manager.getRepository(AuditLog).save({
          userId: actorId,
          action: "COMPONENT_CREATED",
          entityType: "component",
          entityId: component.id,
          details: { name: component.name },
        });
        return component;
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ApiError(
          409,
          "COMPONENT_CONFLICT",
          "Component conflicts with an existing record",
        );
      }
      throw error;
    }
  },

  async update(id, changes, actorId) {
    return AppDataSource.transaction(async (manager) => {
      const repository = manager.getRepository(Component);
      const component = await repository.findOne({ where: { id } });
      if (!component) {
        throw new ApiError(404, "COMPONENT_NOT_FOUND", "Component not found");
      }
      Object.assign(component, changes);
      const saved = await repository.save(component);
      await manager.getRepository(AuditLog).save({
        userId: actorId,
        action:
          changes.isActive === false
            ? "COMPONENT_ARCHIVED"
            : "COMPONENT_UPDATED",
        entityType: "component",
        entityId: saved.id,
        details: { changedFields: Object.keys(changes) },
      });
      return saved;
    });
  },
};
