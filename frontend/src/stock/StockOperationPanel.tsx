import { useRef, useState, type FormEvent } from "react";
import {
  recordStockOperation,
  StockOperationApiError,
  type StockOperationRequest,
  type StockOperationType,
} from "../api/stockApi";
import type { PublicComponent } from "../api/inventoryApi";

const MAX_STOCK_QUANTITY = 2_147_483_647;
const quantityFormatter = new Intl.NumberFormat("en-US");
const operationTypes: readonly StockOperationType[] = [
  "STOCK_IN",
  "STOCK_OUT",
  "ADJUSTMENT",
];

type RefreshResult = {
  component: PublicComponent | null;
  dashboardRefreshed: boolean;
};

const operationLabels: Record<StockOperationType, string> = {
  STOCK_IN: "Stock In",
  STOCK_OUT: "Stock Out",
  ADJUSTMENT: "Stock Adjustment",
};

function formatQuantity(quantity: number): string {
  return quantityFormatter.format(quantity);
}

function getQuantityError(
  operationType: StockOperationType,
  quantityText: string,
  currentQuantity: number,
): { value: number | null; proposed: number | null; error: string | null } {
  const normalized = quantityText.trim();
  if (!/^\d+$/.test(normalized)) {
    return {
      value: null,
      proposed: null,
      error: "Enter a whole number.",
    };
  }

  const value = Number(normalized);
  if (!Number.isSafeInteger(value) || value > MAX_STOCK_QUANTITY) {
    return {
      value: null,
      proposed: null,
      error: "Enter a quantity within the supported range.",
    };
  }
  if (operationType !== "ADJUSTMENT" && value === 0) {
    return {
      value: null,
      proposed: null,
      error: "Enter a quantity greater than zero.",
    };
  }
  if (operationType === "STOCK_OUT" && value > currentQuantity) {
    return {
      value,
      proposed: null,
      error: `Only ${formatQuantity(currentQuantity)} units are available.`,
    };
  }
  if (
    operationType === "STOCK_IN" &&
    currentQuantity + value > MAX_STOCK_QUANTITY
  ) {
    return {
      value,
      proposed: null,
      error: "The resulting quantity exceeds the supported range.",
    };
  }

  const proposed =
    operationType === "STOCK_IN"
      ? currentQuantity + value
      : operationType === "STOCK_OUT"
        ? currentQuantity - value
        : value;

  return { value, proposed, error: null };
}

function getOperationRequest(
  operationType: StockOperationType,
  value: number,
  comment: string,
): StockOperationRequest {
  const normalizedComment = comment.trim();
  const commentField = normalizedComment ? { comment: normalizedComment } : {};

  if (operationType === "ADJUSTMENT") {
    return {
      type: "ADJUSTMENT",
      newQuantity: value,
      ...commentField,
    };
  }

  return {
    type: operationType,
    quantity: value,
    ...commentField,
  };
}

function getOperationError(error: unknown): string {
  if (error instanceof StockOperationApiError) {
    return error.message;
  }
  return "The stock operation could not be completed. Please try again.";
}

export default function StockOperationPanel({
  component,
  csrfToken,
  onRefresh,
  onSessionExpired,
  onCsrfFailure,
}: {
  component: PublicComponent;
  csrfToken: string;
  onRefresh: (componentId: string) => Promise<RefreshResult>;
  onSessionExpired: () => void;
  onCsrfFailure: () => Promise<boolean>;
}) {
  const [operationType, setOperationType] =
    useState<StockOperationType>("STOCK_IN");
  const [quantityText, setQuantityText] = useState("");
  const [comment, setComment] = useState("");
  const [showValidation, setShowValidation] = useState(false);
  const [confirmationOpen, setConfirmationOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [refreshWarning, setRefreshWarning] = useState<string | null>(null);
  const submissionLock = useRef(false);
  const quantityId = `stock-quantity-${component.id}`;
  const commentId = `stock-comment-${component.id}`;
  const validationId = `${quantityId}-error`;
  const quantityResult = getQuantityError(
    operationType,
    quantityText,
    component.currentQuantity,
  );
  const operationLabel = operationLabels[operationType];

  function resetMessages() {
    setErrorMessage(null);
    setSuccessMessage(null);
    setRefreshWarning(null);
  }

  function chooseOperation(nextOperation: StockOperationType) {
    setOperationType(nextOperation);
    setConfirmationOpen(false);
    setShowValidation(false);
    resetMessages();
  }

  function handleReview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    resetMessages();
    setShowValidation(true);
    if (quantityResult.error || quantityResult.value === null) {
      setConfirmationOpen(false);
      return;
    }
    setConfirmationOpen(true);
  }

  async function handleConfirm() {
    if (submissionLock.current || quantityResult.value === null) {
      return;
    }

    submissionLock.current = true;
    setSubmitting(true);
    setErrorMessage(null);
    setSuccessMessage(null);
    setRefreshWarning(null);

    try {
      const receipt = await recordStockOperation(
        component.id,
        getOperationRequest(operationType, quantityResult.value, comment),
        csrfToken,
      );
      setConfirmationOpen(false);
      setQuantityText("");
      setComment("");
      setShowValidation(false);
      setSuccessMessage(
        `${operationLabel} recorded. The server confirmed a new quantity of ${formatQuantity(receipt.newQuantity)}.`,
      );

      try {
        const refreshed = await onRefresh(component.id);
        if (refreshed.component) {
          setSuccessMessage(
            `${operationLabel} recorded. Current quantity is ${formatQuantity(refreshed.component.currentQuantity)}.`,
          );
        } else {
          setRefreshWarning(
            "The operation was recorded, but the latest component quantity could not be loaded.",
          );
        }
        if (!refreshed.dashboardRefreshed) {
          setRefreshWarning(
            "The operation was recorded, but dashboard statistics could not be refreshed. Try refreshing inventory.",
          );
        }
      } catch {
        setRefreshWarning(
          "The operation was recorded, but inventory could not be refreshed. Try refreshing inventory.",
        );
      }
    } catch (error) {
      if (error instanceof StockOperationApiError && error.status === 401) {
        onSessionExpired();
        return;
      }
      if (
        error instanceof StockOperationApiError &&
        error.status === 403 &&
        error.code === "CSRF_TOKEN_INVALID"
      ) {
        const tokenRefreshed = await onCsrfFailure();
        setConfirmationOpen(false);
        setErrorMessage(
          tokenRefreshed
            ? "Your security token expired and was refreshed. Review the operation and confirm it again."
            : "Your security token could not be refreshed. Sign in again before trying this operation.",
        );
        return;
      }
      setConfirmationOpen(false);
      setErrorMessage(getOperationError(error));
    } finally {
      submissionLock.current = false;
      setSubmitting(false);
    }
  }

  async function handleRefresh() {
    setRefreshWarning(null);
    try {
      const refreshed = await onRefresh(component.id);
      if (!refreshed.component || !refreshed.dashboardRefreshed) {
        setRefreshWarning(
          "Inventory refresh was incomplete. Please try again.",
        );
      }
    } catch {
      setRefreshWarning("Inventory refresh failed. Please try again.");
    }
  }

  return (
    <section
      className="stock-operation-panel"
      aria-labelledby={`stock-operations-title-${component.id}`}
    >
      <div className="stock-operation-panel__heading">
        <div>
          <p className="eyebrow">Staff action</p>
          <h2 id={`stock-operations-title-${component.id}`}>
            Stock operations
          </h2>
        </div>
        <p>Changes are recorded in the protected transaction history.</p>
      </div>

      <div
        className="stock-operation-types"
        role="group"
        aria-label="Stock operation type"
      >
        {operationTypes.map((type) => (
          <button
            key={type}
            className={
              type === operationType
                ? "stock-operation-type stock-operation-type--selected"
                : "stock-operation-type"
            }
            type="button"
            aria-pressed={type === operationType}
            disabled={submitting}
            onClick={() => chooseOperation(type)}
          >
            {operationLabels[type]}
          </button>
        ))}
      </div>

      <form
        className="stock-operation-form"
        onSubmit={(event) => handleReview(event)}
        noValidate
      >
        <div className="stock-operation-form__fields">
          <div className="stock-operation-field">
            <label htmlFor={quantityId}>
              {operationType === "STOCK_IN"
                ? "Quantity to add"
                : operationType === "STOCK_OUT"
                  ? "Quantity to remove"
                  : "Corrected absolute quantity"}
            </label>
            <input
              id={quantityId}
              type="text"
              inputMode="numeric"
              autoComplete="off"
              value={quantityText}
              disabled={submitting}
              aria-invalid={showValidation && Boolean(quantityResult.error)}
              aria-describedby={
                showValidation && quantityResult.error
                  ? `${quantityId}-hint ${validationId}`
                  : `${quantityId}-hint`
              }
              onChange={(event) => {
                setQuantityText(event.target.value);
                setConfirmationOpen(false);
                if (showValidation) setShowValidation(true);
                resetMessages();
              }}
            />
            <span
              className="stock-operation-field__hint"
              id={`${quantityId}-hint`}
            >
              {operationType === "ADJUSTMENT"
                ? "Enter the new total stock quantity."
                : "Enter a positive whole number of units."}
            </span>
            {showValidation && quantityResult.error && (
              <span
                className="stock-operation-error"
                id={validationId}
                role="alert"
              >
                {quantityResult.error}
              </span>
            )}
          </div>

          <div className="stock-operation-field">
            <label htmlFor={commentId}>
              {operationType === "ADJUSTMENT"
                ? "Explanation (optional)"
                : "Comment (optional)"}
            </label>
            <textarea
              id={commentId}
              rows={3}
              maxLength={500}
              value={comment}
              disabled={submitting}
              aria-describedby={`${commentId}-hint`}
              onChange={(event) => {
                setComment(event.target.value);
                resetMessages();
              }}
            />
            <span
              className="stock-operation-field__hint"
              id={`${commentId}-hint`}
            >
              Up to 500 characters.
            </span>
          </div>
        </div>

        <div
          className="stock-operation-preview"
          aria-live="polite"
          aria-label="Stock quantity preview"
        >
          <p>
            <span>Current quantity</span>
            <strong>{formatQuantity(component.currentQuantity)}</strong>
          </p>
          <p>
            <span>Expected new quantity</span>
            <strong>
              {quantityResult.proposed === null
                ? "—"
                : formatQuantity(quantityResult.proposed)}
            </strong>
          </p>
        </div>

        {errorMessage && (
          <p className="stock-operation-error" role="alert">
            {errorMessage}
          </p>
        )}
        {successMessage && (
          <p className="stock-operation-success" role="status">
            {successMessage}
          </p>
        )}
        {refreshWarning && (
          <div className="stock-operation-refresh-warning" role="alert">
            <p>{refreshWarning}</p>
            <button
              className="button button--secondary"
              type="button"
              disabled={submitting}
              onClick={() => void handleRefresh()}
            >
              Refresh inventory
            </button>
          </div>
        )}

        {!confirmationOpen ? (
          <button
            className="button button--primary"
            type="submit"
            disabled={submitting}
          >
            Review {operationLabel.toLowerCase()}
          </button>
        ) : (
          <div
            className="stock-operation-confirmation"
            role="group"
            aria-label="Confirm stock operation"
          >
            <p>
              Confirm {operationLabel.toLowerCase()} for{" "}
              <strong>{component.displayName}</strong>:{" "}
              {formatQuantity(component.currentQuantity)} to{" "}
              <strong>
                {formatQuantity(
                  quantityResult.proposed ?? component.currentQuantity,
                )}
              </strong>
              ?
            </p>
            {comment.trim() && <p>Comment: {comment.trim()}</p>}
            <div className="stock-operation-confirmation__actions">
              <button
                className="button button--primary"
                type="button"
                disabled={submitting}
                onClick={() => void handleConfirm()}
              >
                {submitting
                  ? "Saving operation…"
                  : `Confirm ${operationLabel.toLowerCase()}`}
              </button>
              <button
                className="button button--secondary"
                type="button"
                disabled={submitting}
                onClick={() => setConfirmationOpen(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </form>
    </section>
  );
}
