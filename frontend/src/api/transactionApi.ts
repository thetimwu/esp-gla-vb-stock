import { apiBaseUrl } from "./config";

export type TransactionAction = "STOCK_IN" | "STOCK_OUT" | "ADJUSTMENT";

export interface StockTransaction {
  id: string;
  componentId: string;
  componentName: string;
  userId: string;
  username: string;
  actionType: TransactionAction;
  previousQuantity: number;
  newQuantity: number;
  quantityChange: number;
  comment: string | null;
  createdAt: string;
}

export interface TransactionHistoryPage {
  transactions: StockTransaction[];
  total: number;
  limit: number;
  offset: number;
}

export interface TransactionHistoryQuery {
  limit: number;
  offset: number;
  componentId?: string;
  actionType?: TransactionAction;
  from?: string;
  to?: string;
}

export class TransactionHistoryApiError extends Error {
  readonly status: number;
  readonly code: string | null;

  constructor(message: string, status: number, code: string | null = null) {
    super(message);
    this.name = "TransactionHistoryApiError";
    this.status = status;
    this.code = code;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function parseTransaction(value: unknown): StockTransaction {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.componentId !== "string" ||
    typeof value.componentName !== "string" ||
    typeof value.userId !== "string" ||
    typeof value.username !== "string" ||
    (value.actionType !== "STOCK_IN" &&
      value.actionType !== "STOCK_OUT" &&
      value.actionType !== "ADJUSTMENT") ||
    !isNonNegativeInteger(value.previousQuantity) ||
    !isNonNegativeInteger(value.newQuantity) ||
    typeof value.quantityChange !== "number" ||
    !Number.isSafeInteger(value.quantityChange) ||
    value.quantityChange !== value.newQuantity - value.previousQuantity ||
    (value.comment !== null && typeof value.comment !== "string") ||
    typeof value.createdAt !== "string" ||
    !Number.isFinite(Date.parse(value.createdAt))
  ) {
    throw new TransactionHistoryApiError(
      "The inventory service returned an unexpected transaction response.",
      0,
      "INVALID_RESPONSE",
    );
  }

  return {
    id: value.id,
    componentId: value.componentId,
    componentName: value.componentName,
    userId: value.userId,
    username: value.username,
    actionType: value.actionType,
    previousQuantity: value.previousQuantity,
    newQuantity: value.newQuantity,
    quantityChange: value.quantityChange,
    comment: value.comment,
    createdAt: value.createdAt,
  };
}

function parsePage(value: unknown): TransactionHistoryPage {
  if (
    !isRecord(value) ||
    !Array.isArray(value.transactions) ||
    !isNonNegativeInteger(value.total) ||
    !Number.isSafeInteger(value.limit) ||
    typeof value.limit !== "number" ||
    value.limit < 1 ||
    value.limit > 100 ||
    !isNonNegativeInteger(value.offset)
  ) {
    throw new TransactionHistoryApiError(
      "The inventory service returned an unexpected transaction-history response.",
      0,
      "INVALID_RESPONSE",
    );
  }

  return {
    transactions: value.transactions.map(parseTransaction),
    total: value.total,
    limit: value.limit,
    offset: value.offset,
  };
}

export async function fetchTransactionHistory(
  query: TransactionHistoryQuery,
  signal?: AbortSignal,
): Promise<TransactionHistoryPage> {
  const search = new URLSearchParams({
    limit: String(query.limit),
    offset: String(query.offset),
  });
  if (query.componentId) search.set("componentId", query.componentId);
  if (query.actionType) search.set("actionType", query.actionType);
  if (query.from) search.set("from", query.from);
  if (query.to) search.set("to", query.to);

  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl}/transactions?${search}`, {
      method: "GET",
      credentials: "include",
      headers: { Accept: "application/json" },
      ...(signal ? { signal } : {}),
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new TransactionHistoryApiError(
      "Unable to reach transaction history. Check your connection and try again.",
      0,
      "NETWORK_ERROR",
    );
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new TransactionHistoryApiError(
      response.ok
        ? "The inventory service returned an unreadable transaction response."
        : "Transaction history could not be loaded. Please try again.",
      response.status,
      "INVALID_RESPONSE",
    );
  }

  if (!response.ok) {
    const error = isRecord(payload) ? payload.error : undefined;
    const message = isRecord(error) ? error.message : undefined;
    const code =
      isRecord(error) && typeof error.code === "string" ? error.code : null;
    throw new TransactionHistoryApiError(
      typeof message === "string"
        ? message
        : "Transaction history could not be loaded. Please try again.",
      response.status,
      code,
    );
  }

  return parsePage(payload);
}
