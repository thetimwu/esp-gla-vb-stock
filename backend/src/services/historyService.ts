import { AppDataSource } from "../config/dataSource.js";
import { AuditLog } from "../entities/AuditLog.js";
import { StockTransaction } from "../entities/StockTransaction.js";

export interface HistoryPage<T> {
  records: T[];
  total: number;
}

export interface HistoryReader {
  listTransactions(
    limit: number,
    offset: number,
  ): Promise<HistoryPage<StockTransaction>>;
  listAuditLogs(limit: number, offset: number): Promise<HistoryPage<AuditLog>>;
}

export const historyReader: HistoryReader = {
  async listTransactions(limit, offset) {
    const [records, total] = await AppDataSource.getRepository(
      StockTransaction,
    ).findAndCount({
      select: {
        id: true,
        componentId: true,
        userId: true,
        actionType: true,
        previousQuantity: true,
        newQuantity: true,
        quantityChange: true,
        comment: true,
        createdAt: true,
      },
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
