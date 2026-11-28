import { AppDataSource } from "../config/dataSource.js";
import { AuditLog } from "../entities/AuditLog.js";
import { StockTransaction } from "../entities/StockTransaction.js";
import type { StockAction } from "../entities/StockTransaction.js";
import {
  Between,
  LessThanOrEqual,
  MoreThanOrEqual,
  type FindOptionsWhere,
} from "typeorm";

export interface HistoryPage<T> {
  records: T[];
  total: number;
}

export interface TransactionFilters {
  componentId?: string;
  actionType?: StockAction;
  from?: Date;
  to?: Date;
}

export interface HistoryReader {
  listTransactions(
    limit: number,
    offset: number,
    filters?: TransactionFilters,
  ): Promise<HistoryPage<StockTransaction>>;
  listAuditLogs(limit: number, offset: number): Promise<HistoryPage<AuditLog>>;
}

function transactionWhere(
  filters: TransactionFilters,
): FindOptionsWhere<StockTransaction> {
  const where: FindOptionsWhere<StockTransaction> = {};
  if (filters.componentId) where.componentId = filters.componentId;
  if (filters.actionType) where.actionType = filters.actionType;
  if (filters.from && filters.to) {
    where.createdAt = Between(filters.from, filters.to);
  } else if (filters.from) {
    where.createdAt = MoreThanOrEqual(filters.from);
  } else if (filters.to) {
    where.createdAt = LessThanOrEqual(filters.to);
  }
  return where;
}

export const historyReader: HistoryReader = {
  async listTransactions(limit, offset, filters = {}) {
    const [records, total] = await AppDataSource.getRepository(
      StockTransaction,
    ).findAndCount({
      select: {
        id: true,
        componentId: true,
        componentName: true,
        userId: true,
        username: true,
        actionType: true,
        previousQuantity: true,
        newQuantity: true,
        quantityChange: true,
        comment: true,
        createdAt: true,
      },
      where: transactionWhere(filters),
      order: { createdAt: "DESC" },
      take: limit,
      skip: offset,
    });
    return { records, total };
  },

  async listAuditLogs(limit, offset) {
    const [records, total] = await AppDataSource.getRepository(
      AuditLog,
    ).findAndCount({
      order: { createdAt: "DESC" },
      take: limit,
      skip: offset,
    });
    return { records, total };
  },
};
