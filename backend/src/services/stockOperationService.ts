import { AppDataSource } from "../config/dataSource.js";
import { Component } from "../entities/Component.js";
import { StockAction, StockTransaction } from "../entities/StockTransaction.js";
import { User } from "../entities/User.js";
import { ApiError } from "../errors/ApiError.js";
import type { StockOperationRequest } from "../validators/stockValidators.js";

const MAX_STOCK_QUANTITY = 2_147_483_647;

export interface StockOperationService {
  record(
    componentId: string,
    operation: StockOperationRequest,
    userId: string,
  ): Promise<StockTransaction>;
}

function calculateNewQuantity(
  currentQuantity: number,
  operation: StockOperationRequest,
): number {
  switch (operation.type) {
    case StockAction.STOCK_IN: {
      const newQuantity = currentQuantity + operation.quantity;
      if (newQuantity > MAX_STOCK_QUANTITY) {
        throw new ApiError(
          400,
          "STOCK_QUANTITY_LIMIT",
          "The resulting stock quantity exceeds the supported range",
        );
      }
      return newQuantity;
    }
    case StockAction.STOCK_OUT:
      if (operation.quantity > currentQuantity) {
        throw new ApiError(
          409,
          "INSUFFICIENT_STOCK",
          "The requested stock-out exceeds the available quantity",
        );
      }
      return currentQuantity - operation.quantity;
    case StockAction.ADJUSTMENT:
      return operation.newQuantity;
  }
}

export const stockOperationService: StockOperationService = {
  async record(componentId, operation, userId) {
    return AppDataSource.transaction(async (manager) => {
      const componentRepository = manager.getRepository(Component);
      const component = await componentRepository.findOne({
        where: { id: componentId },
        lock: { mode: "pessimistic_write" },
      });

      if (!component) {
        throw new ApiError(404, "COMPONENT_NOT_FOUND", "Component not found");
      }
      if (!component.isActive) {
        throw new ApiError(
          409,
          "COMPONENT_ARCHIVED",
          "Archived components cannot have stock operations",
        );
      }

      const user = await manager.getRepository(User).findOne({
        where: { id: userId, isActive: true },
        lock: { mode: "pessimistic_write" },
      });
      if (!user) {
        throw new ApiError(401, "AUTHENTICATION_REQUIRED", "Login required");
      }

      const previousQuantity = component.currentQuantity;
      const newQuantity = calculateNewQuantity(previousQuantity, operation);
      component.currentQuantity = newQuantity;
      await componentRepository.save(component);

      const transactionRepository = manager.getRepository(StockTransaction);
      const transaction = transactionRepository.create({
        componentId: component.id,
        componentName: component.name,
        userId: user.id,
        username: user.username,
        actionType: operation.type,
        previousQuantity,
        newQuantity,
        quantityChange: newQuantity - previousQuantity,
        comment: operation.comment || null,
      });

      return transactionRepository.save(transaction);
    });
  },
};
