import type { Types } from "mongoose";
import { ComponentModel, type ComponentRecord } from "../models/Component.js";

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

type PublicComponentDocument = Pick<
  ComponentRecord,
  "_id" | "displayName" | "currentQuantity" | "minimumStockLevel" | "photoUrl"
>;

function toPublicComponent(
  component: PublicComponentDocument & { _id: Types.ObjectId },
): PublicComponent {
  return {
    id: component._id.toString(),
    displayName: component.displayName,
    currentQuantity: component.currentQuantity,
    minimumStockLevel: component.minimumStockLevel,
    photoUrl: component.photoUrl ?? null,
  };
}

const publicProjection =
  "_id displayName currentQuantity minimumStockLevel photoUrl";

export const componentReader: ComponentReader = {
  async listPublic() {
    const components = await ComponentModel.find({ isArchived: false })
      .select(publicProjection)
      .sort({ displayName: 1 })
      .lean()
      .exec();
    return components.map((component) => toPublicComponent(component));
  },

  async findPublicById(id) {
    const component = await ComponentModel.findOne({
      _id: id,
      isArchived: false,
    })
      .select(publicProjection)
      .lean()
      .exec();
    return component ? toPublicComponent(component) : null;
  },
};
