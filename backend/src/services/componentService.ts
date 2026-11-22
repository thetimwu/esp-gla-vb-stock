import { AppDataSource } from "../config/dataSource.js";
import { Component } from "../entities/Component.js";

export interface PublicComponent {
  id: string;
  displayName: string;
  currentQuantity: number;
  minimumStockLevel: number;
  photoUrl: string | null;
}

export interface ComponentReader {
  listPublic(): Promise<PublicComponent[]>;
  findPublicById(id: string): Promise<PublicComponent | null>;
}

type PublicComponentRecord = Pick<
  Component,
  "id" | "name" | "currentQuantity" | "minimumStockLevel" | "photoPath"
>;

function toPublicComponent(component: PublicComponentRecord): PublicComponent {
  return {
    id: component.id,
    displayName: component.name,
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
        currentQuantity: true,
        minimumStockLevel: true,
        photoPath: true,
      },
      where: { id, isActive: true },
    });
    return component ? toPublicComponent(component) : null;
  },
};
