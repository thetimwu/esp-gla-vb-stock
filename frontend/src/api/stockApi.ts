import { apiBaseUrl } from "./config";

export type StockOperationType = "STOCK_IN" | "STOCK_OUT" | "ADJUSTMENT";

export type StockOperationRequest =
  | {
      type: "STOCK_IN" | "STOCK_OUT";
      quantity: number;
      comment?: string;
    }
  | {
      type: "ADJUSTMENT";
      newQuantity: number;
      comment?: string;
    };

export interface StockOperationReceipt {
  id: string;
  componentId: string;
  actionType: StockOperationType;
  previousQuantity: number;
  newQuantity: number;
  quantityChange: number;
  createdAt: string;
}

export class StockOperationApiError extends Error {
  readonly status: number;
  readonly code: string | null;

  constructor(message: string, status: number, code: string | null = null) {
    super(message);
    this.name = "StockOperationApiError";
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

function parseReceipt(
  value: unknown,
  componentId: string,
): StockOperationReceipt {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    value.componentId !== componentId ||
    (value.actionType !== "STOCK_IN" &&
      value.actionType !== "STOCK_OUT" &&
      value.actionType !== "ADJUSTMENT") ||
    !isNonNegativeInteger(value.previousQuantity) ||
    !isNonNegativeInteger(value.newQuantity) ||
    typeof value.quantityChange !== "number" ||
    !Number.isSafeInteger(value.quantityChange) ||
    value.quantityChange !== value.newQuantity - value.previousQuantity ||
    typeof value.createdAt !== "string" ||
    !Number.isFinite(Date.parse(value.createdAt))
  ) {
    throw new StockOperationApiError(
      "The inventory service returned an unexpected stock-operation response.",
      0,
      "INVALID_RESPONSE",
    );
  }

  return {
    id: value.id,
    componentId: value.componentId,
    actionType: value.actionType,
    previousQuantity: value.previousQuantity,
    newQuantity: value.newQuantity,
    quantityChange: value.quantityChange,
    createdAt: value.createdAt,
  };
}

export async function recordStockOperation(
  componentId: string,
  operation: StockOperationRequest,
  csrfToken: string,
): Promise<StockOperationReceipt> {
  let response: Response;
  try {
    response = await fetch(
      `${apiBaseUrl}/components/${encodeURIComponent(componentId)}/stock-transactions`,
      {
        method: "POST",
        credentials: "include",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "x-csrf-token": csrfToken,
        },
        body: JSON.stringify(operation),
      },
    );
  } catch {
    throw new StockOperationApiError(
      "Unable to reach the inventory service. Check your connection and try again.",
      0,
      "NETWORK_ERROR",
    );
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new StockOperationApiError(
      response.ok
        ? "The inventory service returned an unreadable response."
        : "The stock operation could not be completed. Please try again.",
      response.status,
      "INVALID_RESPONSE",
    );
  }

  if (!response.ok) {
    const error = isRecord(payload) ? payload.error : undefined;
    const message = isRecord(error) ? error.message : undefined;
    const code =
      isRecord(error) && typeof error.code === "string" ? error.code : null;
    throw new StockOperationApiError(
      typeof message === "string"
        ? message
        : "The stock operation could not be completed. Please try again.",
      response.status,
      code,
    );
  }

  if (!isRecord(payload) || !("transaction" in payload)) {
    throw new StockOperationApiError(
      "The inventory service returned an unexpected stock-operation response.",
      response.status,
      "INVALID_RESPONSE",
    );
  }

  return parseReceipt(payload.transaction, componentId);
}
