import { AppDataSource } from "../config/dataSource.js";
import { Component } from "../entities/Component.js";

export interface PublicComponent {
  id: string;
  displayName: string;
  description: string;
  currentQuantity: number;
  minimumStockLevel: number;
  photoUrl: string | null;
}

export interface ComponentReader {
  listPublic(): Promise<PublicComponent[]>;
  findPublicById(id: string): Promise<PublicComponent | null>;
  getPublicStatistics(): Promise<PublicStatistics>;
}

export interface PublicStatistics {
  activeComponentCount: number;
  totalStockQuantity: number;
  lowStockComponentCount: number;
}

type PublicComponentRecord = Pick<
  Component,
  | "id"
  | "name"
  | "description"
  | "currentQuantity"
  | "minimumStockLevel"
  | "photoPath"
>;

function toPublicComponent(component: PublicComponentRecord): PublicComponent {
  return {
    id: component.id,
    displayName: component.name,
    description: component.description,
    currentQuantity: component.currentQuantity,
    minimumStockLevel: component.minimumStockLevel,
    photoUrl: component.photoPath,
  };
}

export const componentReader: ComponentReader = {
  async listPublic() {
    const components = await AppDataSource.getRepository(Component).find({
      select: {
        id: true,
        name: true,
        description: true,
        currentQuantity: true,
        minimumStockLevel: true,
        photoPath: true,
      },
      where: { isActive: true },
      order: { name: "ASC" },
    });
    return components.map(toPublicComponent);
  },

  async findPublicById(id) {
    const component = await AppDataSource.getRepository(Component).findOne({
      select: {
        id: true,
        name: true,
        description: true,
        currentQuantity: true,
        minimumStockLevel: true,
        photoPath: true,
      },
      where: { id, isActive: true },
    });
    return component ? toPublicComponent(component) : null;
  },

  async getPublicStatistics() {
    const result = await AppDataSource.getRepository(Component)
      .createQueryBuilder("component")
      .select("COUNT(*)", "activeComponentCount")
      .addSelect(
        "COALESCE(SUM(component.currentQuantity), 0)",
        "totalStockQuantity",
      )
      .addSelect(
        `COUNT(*) FILTER (WHERE component.currentQuantity < component.minimumStockLevel)`,
        "lowStockComponentCount",
      )
      .where("component.isActive = :isActive", { isActive: true })
      .getRawOne<{
        activeComponentCount: string;
        totalStockQuantity: string;
        lowStockComponentCount: string;
      }>();

    return {
      activeComponentCount: Number(result?.activeComponentCount ?? 0),
      totalStockQuantity: Number(result?.totalStockQuantity ?? 0),
      lowStockComponentCount: Number(result?.lowStockComponentCount ?? 0),
    };
  },
};
