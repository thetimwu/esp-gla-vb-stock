import { useEffect, useState, type FormEvent } from "react";
import {
  fetchTransactionHistory,
  TransactionHistoryApiError,
  type TransactionAction,
  type TransactionHistoryPage as TransactionHistoryData,
  type TransactionHistoryQuery,
} from "../api/transactionApi";
import type { PublicComponent } from "../api/inventoryApi";

const PAGE_SIZE = 20;
const MAX_HISTORY_OFFSET = 100_000;
const quantityFormatter = new Intl.NumberFormat("en-US");
const dateFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

interface HistoryFilters {
  componentId: string;
  actionType: TransactionAction | "";
  startDate: string;
  endDate: string;
}

const EMPTY_FILTERS: HistoryFilters = {
  componentId: "",
  actionType: "",
  startDate: "",
  endDate: "",
};

const actionLabels: Record<TransactionAction, string> = {
  STOCK_IN: "Stock In",
  STOCK_OUT: "Stock Out",
  ADJUSTMENT: "Adjustment",
};

function formatQuantity(quantity: number): string {
  return quantityFormatter.format(quantity);
}

function formatQuantityChange(change: number): string {
  if (change > 0) return `+${formatQuantity(change)}`;
  if (change < 0) return `−${formatQuantity(Math.abs(change))}`;
  return "0";
}

function toLocalDateBoundary(date: string, endOfDay: boolean): string {
  const boundary = new Date(`${date}T00:00:00`);
  if (endOfDay) boundary.setHours(23, 59, 59, 999);
  return boundary.toISOString();
}

function getErrorMessage(error: unknown): string {
  return error instanceof TransactionHistoryApiError
    ? error.message
    : "Transaction history could not be loaded. Please try again.";
}

function matchesFilters(filters: HistoryFilters): boolean {
  return Object.values(filters).some(Boolean);
}

export default function TransactionHistoryPage({
  components,
  onSessionExpired,
}: {
  components: PublicComponent[];
  onSessionExpired: () => void;
}) {
  const [draftFilters, setDraftFilters] =
    useState<HistoryFilters>(EMPTY_FILTERS);
  const [appliedFilters, setAppliedFilters] =
    useState<HistoryFilters>(EMPTY_FILTERS);
  const [offset, setOffset] = useState(0);
  const [retryCount, setRetryCount] = useState(0);
  const [result, setResult] = useState<TransactionHistoryData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [filterError, setFilterError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const query: TransactionHistoryQuery = { limit: PAGE_SIZE, offset };
    if (appliedFilters.componentId) {
      query.componentId = appliedFilters.componentId;
    }
    if (appliedFilters.actionType) {
      query.actionType = appliedFilters.actionType;
    }
    if (appliedFilters.startDate) {
      query.from = toLocalDateBoundary(appliedFilters.startDate, false);
    }
    if (appliedFilters.endDate) {
      query.to = toLocalDateBoundary(appliedFilters.endDate, true);
    }

    void fetchTransactionHistory(query, controller.signal)
      .then((page) => {
        setResult(page);
        setIsLoading(false);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setIsLoading(false);
        if (
          error instanceof TransactionHistoryApiError &&
          error.status === 401
        ) {
          onSessionExpired();
          return;
        }
        setErrorMessage(getErrorMessage(error));
      });

    return () => controller.abort();
  }, [appliedFilters, offset, onSessionExpired, retryCount]);

  function updateDraftFilter<K extends keyof HistoryFilters>(
    key: K,
    value: HistoryFilters[K],
  ) {
    setDraftFilters((current) => ({ ...current, [key]: value }));
  }

  function handleApplyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      draftFilters.startDate &&
      draftFilters.endDate &&
      draftFilters.startDate > draftFilters.endDate
    ) {
      setFilterError("The start date must not be later than the end date.");
      return;
    }
    setFilterError(null);
    setErrorMessage(null);
    setIsLoading(true);
    setOffset(0);
    setAppliedFilters({ ...draftFilters });
  }

  function clearFilters() {
    setDraftFilters(EMPTY_FILTERS);
    setErrorMessage(null);
    setIsLoading(true);
    setAppliedFilters(EMPTY_FILTERS);
    setFilterError(null);
    setOffset(0);
  }

  const hasFilters = matchesFilters(appliedFilters);
  const pageNumber = result ? Math.floor(result.offset / result.limit) + 1 : 1;
  const pageCount =
    result && result.total > 0 ? Math.ceil(result.total / result.limit) : 0;
  const canGoPrevious = Boolean(result && result.offset > 0);
  const canGoNext = Boolean(
    result &&
    result.offset + result.limit < result.total &&
    result.offset + result.limit <= MAX_HISTORY_OFFSET,
  );

  return (
    <main className="history-main" id="transaction-history">
      <section className="history-heading" aria-labelledby="history-title">
        <div>
          <p className="eyebrow">Inventory records</p>
          <h1 id="history-title">Stock transaction history</h1>
          <p>Review recorded stock-in, stock-out, and adjustment activity.</p>
        </div>
        {result && !isLoading && (
          <p className="history-total" aria-live="polite">
            {quantityFormatter.format(result.total)}{" "}
            {result.total === 1 ? "transaction" : "transactions"}
          </p>
        )}
      </section>

      <form className="history-filters" onSubmit={handleApplyFilters}>
        <div className="history-filters__heading">
          <div>
            <p className="eyebrow">Narrow results</p>
            <h2>Filters</h2>
          </div>
          {hasFilters && (
            <button
              className="history-clear-button"
              type="button"
              onClick={clearFilters}
            >
              Clear filters
            </button>
          )}
        </div>

        <div className="history-filter-grid">
          <div className="history-filter-field">
            <label htmlFor="history-component">Component</label>
            <select
              id="history-component"
              value={draftFilters.componentId}
              onChange={(event) =>
                updateDraftFilter("componentId", event.target.value)
              }
            >
              <option value="">All components</option>
              {components
                .slice()
                .sort((left, right) =>
                  left.displayName.localeCompare(right.displayName),
                )
                .map((component) => (
                  <option key={component.id} value={component.id}>
                    {component.displayName}
                  </option>
                ))}
            </select>
          </div>

          <div className="history-filter-field">
            <label htmlFor="history-action">Transaction type</label>
            <select
              id="history-action"
              value={draftFilters.actionType}
              onChange={(event) =>
                updateDraftFilter(
                  "actionType",
                  event.target.value as TransactionAction | "",
                )
              }
            >
              <option value="">All transaction types</option>
              <option value="STOCK_IN">Stock In</option>
              <option value="STOCK_OUT">Stock Out</option>
              <option value="ADJUSTMENT">Adjustment</option>
            </select>
          </div>

          <div className="history-filter-field">
            <label htmlFor="history-start-date">Start date</label>
            <input
              id="history-start-date"
              type="date"
              value={draftFilters.startDate}
              onChange={(event) =>
                updateDraftFilter("startDate", event.target.value)
              }
            />
          </div>

          <div className="history-filter-field">
            <label htmlFor="history-end-date">End date</label>
            <input
              id="history-end-date"
              type="date"
              value={draftFilters.endDate}
              onChange={(event) =>
                updateDraftFilter("endDate", event.target.value)
              }
            />
          </div>
        </div>

        {filterError && (
          <p className="history-error" role="alert">
            {filterError}
          </p>
        )}

        <button className="button button--primary" type="submit">
          Apply filters
        </button>
      </form>

      <section
        className="history-results"
        aria-labelledby="history-results-title"
        aria-busy={isLoading}
      >
        <div className="history-results__heading">
          <div>
            <p className="eyebrow">Recorded activity</p>
            <h2 id="history-results-title">Transactions</h2>
          </div>
          {result && !isLoading && result.total > 0 && (
            <p>
              Page {pageNumber} of {pageCount}
            </p>
          )}
        </div>

        {isLoading && (
          <div className="history-state" role="status" aria-live="polite">
            <span className="loading-indicator" aria-hidden="true" />
            <span>Loading transaction history…</span>
          </div>
        )}

        {!isLoading && errorMessage && (
          <div className="history-error-panel" role="alert">
            <div>
              <h3>Transaction history unavailable</h3>
              <p>{errorMessage}</p>
            </div>
            <button
              className="button button--primary"
              type="button"
              onClick={() => {
                setErrorMessage(null);
                setIsLoading(true);
                setRetryCount((count) => count + 1);
              }}
            >
              Try again
            </button>
          </div>
        )}

        {!isLoading &&
          !errorMessage &&
          result &&
          result.transactions.length === 0 && (
            <div className="history-empty">
              <h3>
                {hasFilters
                  ? "No transactions match these filters"
                  : "No stock transactions yet"}
              </h3>
              <p>
                {hasFilters
                  ? "Try changing or clearing the selected filters."
                  : "Completed stock operations will appear here."}
              </p>
            </div>
          )}

        {!isLoading &&
          !errorMessage &&
          result &&
          result.transactions.length > 0 && (
            <>
              <div
                className="history-table-scroll"
                role="region"
                aria-label="Stock transaction records"
                tabIndex={0}
              >
                <table className="history-table">
                  <caption className="visually-hidden">
                    Stock transaction history
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">Component</th>
                      <th scope="col">Type</th>
                      <th scope="col">Previous</th>
                      <th scope="col">Change</th>
                      <th scope="col">New</th>
                      <th scope="col">Performed by</th>
                      <th scope="col">Date and time</th>
                      <th scope="col">Comment</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.transactions.map((transaction) => (
                      <tr key={transaction.id}>
                        <td data-label="Component">
                          <span className="history-component-name">
                            {transaction.componentName}
                          </span>
                        </td>
                        <td data-label="Type">
                          <span
                            className={`transaction-type transaction-type--${transaction.actionType.toLowerCase()}`}
                          >
                            {actionLabels[transaction.actionType]}
                          </span>
                        </td>
                        <td data-label="Previous">
                          {formatQuantity(transaction.previousQuantity)}
                        </td>
                        <td data-label="Change">
                          <span
                            className={`transaction-change ${
                              transaction.quantityChange > 0
                                ? "transaction-change--positive"
                                : transaction.quantityChange < 0
                                  ? "transaction-change--negative"
                                  : "transaction-change--neutral"
                            }`}
                          >
                            {formatQuantityChange(transaction.quantityChange)}
                          </span>
                        </td>
                        <td data-label="New">
                          {formatQuantity(transaction.newQuantity)}
                        </td>
                        <td data-label="Performed by">
                          {transaction.username}
                        </td>
                        <td data-label="Date and time">
                          <time dateTime={transaction.createdAt}>
                            {dateFormatter.format(
                              new Date(transaction.createdAt),
                            )}
                          </time>
                        </td>
                        <td data-label="Comment">
                          {transaction.comment || "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <nav className="history-pagination" aria-label="History pages">
                <button
                  className="button button--secondary"
                  type="button"
                  disabled={!canGoPrevious}
                  onClick={() => {
                    setErrorMessage(null);
                    setIsLoading(true);
                    setOffset((current) =>
                      Math.max(0, current - (result?.limit ?? PAGE_SIZE)),
                    );
                  }}
                >
                  Previous
                </button>
                <span aria-live="polite">
                  {`Page ${pageNumber} of ${pageCount} · ${quantityFormatter.format(result.total)} ${result.total === 1 ? "record" : "records"}`}
                </span>
                <button
                  className="button button--secondary"
                  type="button"
                  disabled={!canGoNext}
                  onClick={() => {
                    setErrorMessage(null);
                    setIsLoading(true);
                    setOffset(
                      (current) => current + (result?.limit ?? PAGE_SIZE),
                    );
                  }}
                >
                  Next
                </button>
              </nav>
            </>
          )}
      </section>
    </main>
  );
}
