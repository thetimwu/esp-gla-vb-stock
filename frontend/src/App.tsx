import { useEffect, useMemo, useRef, useState } from "react";
import {
  fetchComponent,
  fetchDashboard,
  type DashboardData,
  type PublicComponent,
} from "./api/inventoryApi";
import {
  AuthenticationApiError,
  fetchCsrfToken,
  fetchCurrentSession,
  logout,
  type AuthUser,
} from "./api/authApi";
import LoginPage from "./auth/LoginPage";
import StockOperationPanel from "./stock/StockOperationPanel";
import TransactionHistoryPage from "./history/TransactionHistoryPage";
import "./App.css";

type DashboardState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: DashboardData };

type DetailState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; component: PublicComponent };

type DashboardResult = {
  requestId: number;
  state: Exclude<DashboardState, { status: "loading" }>;
};

type DetailResult = {
  componentId: string;
  requestId: number;
  state: Exclude<DetailState, { status: "loading" }>;
};

type AuthenticationState =
  | { status: "checking" }
  | { status: "anonymous" }
  | { status: "error"; message: string }
  | { status: "authenticated"; user: AuthUser; csrfToken: string };

type InventoryStatus = "in-stock" | "low-stock" | "out-of-stock";
type StatusFilter = "all" | InventoryStatus;
type SortOrder = "name" | "quantity-ascending" | "quantity-descending";

const EMPTY_COMPONENTS: PublicComponent[] = [];

const statusLabels: Record<InventoryStatus, string> = {
  "in-stock": "In Stock",
  "low-stock": "Low Stock",
  "out-of-stock": "Out of Stock",
};

const quantityFormatter = new Intl.NumberFormat("en-US");

function getInventoryStatus(component: PublicComponent): InventoryStatus {
  if (component.currentQuantity === 0) {
    return "out-of-stock";
  }
  if (component.currentQuantity < component.minimumStockLevel) {
    return "low-stock";
  }
  return "in-stock";
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "Unable to load inventory data. Please try again.";
}

function getAuthenticationErrorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "Unable to complete the authentication request. Please try again.";
}

function formatQuantity(quantity: number): string {
  return quantityFormatter.format(quantity);
}

function getSafeImageUrl(photoUrl: string | null): string | null {
  if (!photoUrl?.trim()) {
    return null;
  }

  try {
    const resolved = new URL(photoUrl, window.location.origin);
    if (resolved.protocol === "http:" || resolved.protocol === "https:") {
      return photoUrl;
    }
  } catch {
    return null;
  }
  return null;
}

function ComponentPhoto({
  component,
  size = "card",
}: {
  component: PublicComponent;
  size?: "card" | "detail";
}) {
  const [failed, setFailed] = useState(false);
  const photoUrl = failed ? null : getSafeImageUrl(component.photoUrl);

  if (!photoUrl) {
    return (
      <div
        className={`component-photo component-photo--${size} component-photo--empty`}
        role="img"
        aria-label={`No photo available for ${component.displayName}`}
      >
        <span aria-hidden="true">Photo unavailable</span>
      </div>
    );
  }

  return (
    <div className={`component-photo component-photo--${size}`}>
      <img
        src={photoUrl}
        alt={component.displayName}
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
      />
    </div>
  );
}

function StatusBadge({ status }: { status: InventoryStatus }) {
  return (
    <span className={`status-badge status-badge--${status}`}>
      <span className="status-badge__dot" aria-hidden="true" />
      {statusLabels[status]}
    </span>
  );
}

function MetricCard({
  label,
  value,
  detail,
  tone,
}: {
  label: string;
  value: number;
  detail: string;
  tone: "neutral" | "warning" | "critical";
}) {
  return (
    <article
      className={`metric-card metric-card--${tone}`}
      aria-labelledby={`metric-${label.replaceAll(" ", "-").toLowerCase()}`}
    >
      <h3 id={`metric-${label.replaceAll(" ", "-").toLowerCase()}`}>{label}</h3>
      <p className="metric-card__value">{formatQuantity(value)}</p>
      <p className="metric-card__detail">{detail}</p>
    </article>
  );
}

function ComponentCard({
  component,
  onOpen,
}: {
  component: PublicComponent;
  onOpen: (id: string) => void;
}) {
  const status = getInventoryStatus(component);

  return (
    <article
      className={`component-card component-card--${status}`}
      aria-labelledby={`component-name-${component.id}`}
    >
      <button
        type="button"
        className="component-card__open"
        aria-label={`View details for ${component.displayName}`}
        onClick={() => onOpen(component.id)}
      >
        <ComponentPhoto component={component} />
        <span className="component-card__content">
          <span className="component-card__topline">
            <StatusBadge status={status} />
            <span className="component-card__arrow" aria-hidden="true">
              →
            </span>
          </span>
          <span
            className="component-card__name"
            id={`component-name-${component.id}`}
          >
            {component.displayName}
          </span>
          <span className="component-card__part-number">
            {component.partNumber
              ? `Part no. ${component.partNumber}`
              : "Part number not listed"}
          </span>
          <span className="component-card__quantities">
            <span>
              <span className="quantity-label">Available</span>
              <strong>{formatQuantity(component.currentQuantity)}</strong>
            </span>
            <span>
              <span className="quantity-label">Minimum</span>
              <strong>{formatQuantity(component.minimumStockLevel)}</strong>
            </span>
          </span>
        </span>
      </button>
    </article>
  );
}

function ComponentDetails({
  componentId,
  onBack,
  cache,
  authentication,
  onRefresh,
  onRequestLogin,
  onSessionExpired,
  onCsrfFailure,
}: {
  componentId: string;
  onBack: () => void;
  cache: { current: Map<string, PublicComponent> };
  authentication: AuthenticationState;
  onRefresh: (componentId: string) => Promise<{
    component: PublicComponent | null;
    dashboardRefreshed: boolean;
  }>;
  onRequestLogin: () => void;
  onSessionExpired: () => void;
  onCsrfFailure: () => Promise<boolean>;
}) {
  const [retryCount, setRetryCount] = useState(0);
  const [result, setResult] = useState<DetailResult | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    if (cache.current.has(componentId)) {
      return;
    }

    void fetchComponent(componentId, controller.signal)
      .then((component) => {
        cache.current.set(componentId, component);
        setResult({
          componentId,
          requestId: retryCount,
          state: { status: "ready", component },
        });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setResult({
            componentId,
            requestId: retryCount,
            state: { status: "error", message: getErrorMessage(error) },
          });
        }
      });

    return () => controller.abort();
  }, [cache, componentId, retryCount]);

  const cachedComponent = cache.current.get(componentId);
  const state: DetailState = cachedComponent
    ? { status: "ready", component: cachedComponent }
    : result?.componentId === componentId && result.requestId === retryCount
      ? result.state
      : { status: "loading" };

  return (
    <section className="detail-view" aria-labelledby="detail-heading">
      <button className="back-button" type="button" onClick={onBack}>
        <span aria-hidden="true">←</span> Back to inventory
      </button>

      {state.status === "loading" && (
        <p className="loading-message" role="status" aria-live="polite">
          Loading component details…
        </p>
      )}

      {state.status === "error" && (
        <div className="error-panel" role="alert">
          <h2 id="detail-heading">Component details unavailable</h2>
          <p>{state.message}</p>
          <button
            className="button button--primary"
            type="button"
            onClick={() => setRetryCount((count) => count + 1)}
          >
            Try again
          </button>
        </div>
      )}

      {state.status === "ready" && (
        <>
          <article className="detail-card">
            <ComponentPhoto component={state.component} size="detail" />
            <div className="detail-card__body">
              <div className="detail-card__heading">
                <div>
                  <p className="eyebrow">Component details</p>
                  <h1 id="detail-heading">{state.component.displayName}</h1>
                </div>
                <StatusBadge status={getInventoryStatus(state.component)} />
              </div>
              <p className="detail-card__description">
                {state.component.description || "No description provided."}
              </p>
              <dl className="detail-facts">
                <div>
                  <dt>Part number</dt>
                  <dd>{state.component.partNumber || "Not listed"}</dd>
                </div>
                <div>
                  <dt>Current stock</dt>
                  <dd>{formatQuantity(state.component.currentQuantity)}</dd>
                </div>
                <div>
                  <dt>Minimum stock</dt>
                  <dd>{formatQuantity(state.component.minimumStockLevel)}</dd>
                </div>
              </dl>
            </div>
          </article>

          {authentication.status === "authenticated" && (
            <StockOperationPanel
              component={state.component}
              csrfToken={authentication.csrfToken}
              onRefresh={onRefresh}
              onSessionExpired={onSessionExpired}
              onCsrfFailure={onCsrfFailure}
            />
          )}
          {authentication.status === "anonymous" && (
            <aside className="stock-login-prompt">
              <div>
                <p className="eyebrow">Protected staff action</p>
                <p>Sign in to record an inventory stock operation.</p>
              </div>
              <button
                className="button button--primary"
                type="button"
                onClick={onRequestLogin}
              >
                Sign in to continue
              </button>
            </aside>
          )}
        </>
      )}
    </section>
  );
}

function App() {
  const [dashboardResult, setDashboardResult] =
    useState<DashboardResult | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [sortOrder, setSortOrder] = useState<SortOrder>("name");
  const [selectedComponentId, setSelectedComponentId] = useState<string | null>(
    null,
  );
  const detailsCache = useRef(new Map<string, PublicComponent>());
  const [authentication, setAuthentication] = useState<AuthenticationState>({
    status: "checking",
  });
  const [isLoginRoute, setIsLoginRoute] = useState(
    () => window.location.hash === "#login",
  );
  const [isHistoryRoute, setIsHistoryRoute] = useState(
    () => window.location.hash === "#transactions",
  );
  const [authenticationNotice, setAuthenticationNotice] = useState<
    string | null
  >(null);
  const [loggingOut, setLoggingOut] = useState(false);
  const hasAuthenticatedInThisMount = useRef(false);
  const returnToHistoryAfterLogin = useRef(false);

  useEffect(() => {
    const controller = new AbortController();

    async function restoreSession() {
      try {
        const user = await fetchCurrentSession(controller.signal);
        if (controller.signal.aborted || hasAuthenticatedInThisMount.current) {
          return;
        }
        if (!user) {
          setAuthentication({ status: "anonymous" });
          return;
        }

        const csrfToken = await fetchCsrfToken(controller.signal);
        if (
          !controller.signal.aborted &&
          !hasAuthenticatedInThisMount.current
        ) {
          setAuthentication({ status: "authenticated", user, csrfToken });
        }
      } catch (error) {
        if (
          !controller.signal.aborted &&
          !hasAuthenticatedInThisMount.current
        ) {
          setAuthentication({
            status: "error",
            message: getAuthenticationErrorMessage(error),
          });
        }
      }
    }

    void restoreSession();
    return () => controller.abort();
  }, []);

  useEffect(() => {
    function updateRouteFromHash() {
      const currentHash = window.location.hash;
      setIsLoginRoute(currentHash === "#login");
      setIsHistoryRoute(currentHash === "#transactions");
    }

    window.addEventListener("hashchange", updateRouteFromHash);
    return () => window.removeEventListener("hashchange", updateRouteFromHash);
  }, []);

  useEffect(() => {
    if (authentication.status === "authenticated" && isLoginRoute) {
      window.history.replaceState(
        null,
        "",
        `${window.location.pathname}${window.location.search}#top`,
      );
    }
  }, [authentication, isLoginRoute]);

  useEffect(() => {
    if (
      isHistoryRoute &&
      (authentication.status === "anonymous" ||
        authentication.status === "error")
    ) {
      requestHistorySignIn();
    }
  }, [authentication.status, isHistoryRoute]);

  useEffect(() => {
    const controller = new AbortController();
    void fetchDashboard(controller.signal)
      .then((data) =>
        setDashboardResult({
          requestId: retryCount,
          state: { status: "ready", data },
        }),
      )
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setDashboardResult({
            requestId: retryCount,
            state: { status: "error", message: getErrorMessage(error) },
          });
        }
      });

    return () => controller.abort();
  }, [retryCount]);

  function handleAuthenticated(user: AuthUser, csrfToken: string) {
    hasAuthenticatedInThisMount.current = true;
    setAuthentication({ status: "authenticated", user, csrfToken });
    setAuthenticationNotice(null);
    const returnToHistory = returnToHistoryAfterLogin.current;
    returnToHistoryAfterLogin.current = false;
    window.location.hash = returnToHistory ? "#transactions" : "#top";
    setIsHistoryRoute(returnToHistory);
    setIsLoginRoute(false);
  }

  function requestHistorySignIn() {
    returnToHistoryAfterLogin.current = true;
    setAuthenticationNotice(
      "Sign in to view transaction history. You will return here after login.",
    );
    window.location.hash = "#login";
    setIsLoginRoute(true);
    setIsHistoryRoute(false);
  }

  function handleHistorySessionExpired() {
    returnToHistoryAfterLogin.current = true;
    setAuthentication({ status: "anonymous" });
    setAuthenticationNotice(
      "Your session expired. Sign in again to view transaction history.",
    );
    window.location.hash = "#login";
    setIsLoginRoute(true);
    setIsHistoryRoute(false);
  }

  function requestStockSignIn() {
    setAuthenticationNotice(
      "Sign in to record this stock operation. You will return to the selected component.",
    );
    window.location.hash = "#login";
    setIsLoginRoute(true);
  }

  function handleStockSessionExpired() {
    setAuthentication({ status: "anonymous" });
    setAuthenticationNotice(
      "Your session expired. Sign in again to continue; you will return to the selected component.",
    );
    window.location.hash = "#login";
    setIsLoginRoute(true);
  }

  async function refreshCsrfTokenAfterFailure(): Promise<boolean> {
    try {
      const csrfToken = await fetchCsrfToken();
      setAuthentication((current) =>
        current.status === "authenticated"
          ? { ...current, csrfToken }
          : current,
      );
      return true;
    } catch (error) {
      if (error instanceof AuthenticationApiError && error.status === 401) {
        handleStockSessionExpired();
      }
      return false;
    }
  }

  async function refreshInventoryAfterStockOperation(componentId: string) {
    const [dashboardRefresh, componentRefresh] = await Promise.allSettled([
      fetchDashboard(),
      fetchComponent(componentId),
    ]);

    let refreshedComponent: PublicComponent | null = null;
    if (dashboardRefresh.status === "fulfilled") {
      const data = dashboardRefresh.value;
      for (const component of data.components) {
        detailsCache.current.set(component.id, component);
      }
      refreshedComponent =
        data.components.find((component) => component.id === componentId) ??
        null;
      setDashboardResult({
        requestId: retryCount,
        state: { status: "ready", data },
      });
    }
    if (componentRefresh.status === "fulfilled") {
      refreshedComponent = componentRefresh.value;
      detailsCache.current.set(componentId, componentRefresh.value);
    } else if (refreshedComponent) {
      detailsCache.current.set(componentId, refreshedComponent);
    }

    return {
      component: refreshedComponent,
      dashboardRefreshed: dashboardRefresh.status === "fulfilled",
    };
  }

  async function handleLogout() {
    if (authentication.status !== "authenticated" || loggingOut) {
      return;
    }

    setLoggingOut(true);
    setAuthenticationNotice(null);
    try {
      await logout(authentication.csrfToken);
      setAuthentication({ status: "anonymous" });
      setAuthenticationNotice("You have been signed out.");
      window.location.hash = "#top";
      setIsLoginRoute(false);
      setIsHistoryRoute(false);
    } catch (error) {
      if (
        error instanceof AuthenticationApiError &&
        (error.status === 401 || error.status === 403)
      ) {
        try {
          const currentUser = await fetchCurrentSession();
          if (!currentUser) {
            setAuthentication({ status: "anonymous" });
            setAuthenticationNotice(
              "Your session expired. You have been signed out.",
            );
            window.location.hash = "#top";
            setIsLoginRoute(false);
            setIsHistoryRoute(false);
            return;
          }

          const csrfToken = await fetchCsrfToken();
          setAuthentication({
            status: "authenticated",
            user: currentUser,
            csrfToken,
          });
          setAuthenticationNotice(
            "Your security token expired. Please log out again.",
          );
        } catch {
          setAuthenticationNotice(
            "Your session could not be verified. Please try again.",
          );
        }
      } else {
        setAuthenticationNotice(getAuthenticationErrorMessage(error));
      }
    } finally {
      setLoggingOut(false);
    }
  }

  const dashboard: DashboardState =
    dashboardResult?.requestId === retryCount
      ? dashboardResult.state
      : { status: "loading" };
  const components =
    dashboard.status === "ready" ? dashboard.data.components : EMPTY_COMPONENTS;
  const visibleComponents = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    const filtered = components.filter((component) => {
      const matchesSearch =
        normalizedSearch.length === 0 ||
        component.displayName.toLowerCase().includes(normalizedSearch) ||
        (component.partNumber ?? "").toLowerCase().includes(normalizedSearch);
      const matchesStatus =
        statusFilter === "all" ||
        getInventoryStatus(component) === statusFilter;
      return matchesSearch && matchesStatus;
    });

    return filtered.sort((left, right) => {
      if (sortOrder === "quantity-ascending") {
        return (
          left.currentQuantity - right.currentQuantity ||
          left.displayName.localeCompare(right.displayName)
        );
      }
      if (sortOrder === "quantity-descending") {
        return (
          right.currentQuantity - left.currentQuantity ||
          left.displayName.localeCompare(right.displayName)
        );
      }
      return left.displayName.localeCompare(right.displayName);
    });
  }, [components, search, sortOrder, statusFilter]);

  const zeroStockCount = components.filter(
    (component) => component.currentQuantity === 0,
  ).length;
  const loginView = isLoginRoute && authentication.status !== "authenticated";
  const historyView =
    isHistoryRoute && authentication.status === "authenticated";

  return (
    <div className="app-shell">
      <header className="site-header">
        <a
          className="brand"
          href="#top"
          aria-label="Gate Components Inventory home"
        >
          <span className="brand__mark" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
          <span className="brand__name">
            Gate Components
            <span>Inventory</span>
          </span>
        </a>
        <nav className="site-nav" aria-label="Main navigation">
          <a
            className={`site-nav__link${isHistoryRoute ? "" : " site-nav__link--active"}`}
            href="#top"
          >
            Dashboard
          </a>
          {authentication.status === "authenticated" && (
            <a
              className={`site-nav__link${isHistoryRoute ? " site-nav__link--active" : ""}`}
              href="#transactions"
              aria-current={isHistoryRoute ? "page" : undefined}
            >
              Transaction history
            </a>
          )}
          {!isHistoryRoute && (
            <span className="read-only-label">
              <span className="read-only-label__dot" aria-hidden="true" />
              Read-only dashboard
            </span>
          )}
          {authentication.status === "checking" ? (
            <span className="auth-checking" role="status">
              Checking sign-in…
            </span>
          ) : authentication.status === "authenticated" ? (
            <>
              {authentication.user.role === "ADMIN" && (
                <span
                  className="site-nav__link site-nav__link--disabled"
                  title="Administration screens are not available yet."
                >
                  Administration
                </span>
              )}
              <span
                className="account-summary"
                aria-label={`Signed in as ${authentication.user.username}, ${
                  authentication.user.role === "ADMIN"
                    ? "Administrator"
                    : "Engineer"
                }`}
              >
                <span className="account-summary__username">
                  {authentication.user.username}
                </span>
                <span className="account-summary__role">
                  {authentication.user.role === "ADMIN" ? "Admin" : "Engineer"}
                </span>
              </span>
              <button
                className="button button--login"
                type="button"
                disabled={loggingOut}
                onClick={() => void handleLogout()}
              >
                {loggingOut ? "Signing out…" : "Log out"}
              </button>
            </>
          ) : (
            <>
              {authentication.status === "error" && (
                <span
                  className="auth-checking"
                  title={authentication.message}
                  role="status"
                >
                  Sign-in unavailable
                </span>
              )}
              <a className="button button--login" href="#login">
                Log in
              </a>
            </>
          )}
        </nav>
      </header>

      {authenticationNotice && (
        <p className="auth-notice" role="status">
          {authenticationNotice}
        </p>
      )}

      {loginView && <LoginPage onAuthenticated={handleAuthenticated} />}
      <main
        id="top"
        className="dashboard-main"
        hidden={loginView || historyView}
      >
        <section className="welcome-panel" aria-labelledby="page-title">
          <div className="welcome-panel__copy">
            <p className="eyebrow">Company inventory</p>
            <h1 id="page-title">Gate Components Inventory</h1>
            <p className="welcome-panel__description">
              A clear view of component availability across your inventory.
            </p>
          </div>
          <div className="welcome-panel__note">
            <span className="welcome-panel__note-icon" aria-hidden="true">
              i
            </span>
            <span>Public dashboard · No sign-in required</span>
          </div>
        </section>

        <section className="metrics-section" aria-labelledby="metrics-title">
          <div className="section-heading">
            <div>
              <p className="eyebrow">At a glance</p>
              <h2 id="metrics-title">Stock overview</h2>
            </div>
            {dashboard.status === "ready" && (
              <p className="updated-note">Live inventory data</p>
            )}
          </div>

          {dashboard.status === "ready" && (
            <div className="metrics-grid" aria-label="Stock statistics">
              <MetricCard
                label="Component types"
                value={dashboard.data.statistics.activeComponentCount}
                detail="Active inventory items"
                tone="neutral"
              />
              <MetricCard
                label="Total quantity"
                value={dashboard.data.statistics.totalStockQuantity}
                detail="Units currently in stock"
                tone="neutral"
              />
              <MetricCard
                label="Below minimum"
                value={dashboard.data.statistics.lowStockComponentCount}
                detail="Items below their minimum level"
                tone="warning"
              />
              <MetricCard
                label="Out of stock"
                value={zeroStockCount}
                detail="Items with zero quantity"
                tone="critical"
              />
            </div>
          )}
        </section>

        <section
          id="inventory"
          className="inventory-section"
          aria-labelledby="inventory-title"
        >
          <div className="section-heading inventory-heading">
            <div>
              <p className="eyebrow">Browse components</p>
              <h2 id="inventory-title">Inventory</h2>
            </div>
            {dashboard.status === "ready" && (
              <p className="inventory-count">
                {formatQuantity(visibleComponents.length)} of{" "}
                {formatQuantity(components.length)} components
              </p>
            )}
          </div>

          {dashboard.status === "loading" && (
            <div className="loading-panel" role="status" aria-live="polite">
              <span className="loading-indicator" aria-hidden="true" />
              <span>Loading public inventory…</span>
            </div>
          )}

          {dashboard.status === "error" && (
            <div className="error-panel" role="alert">
              <div className="error-panel__icon" aria-hidden="true">
                !
              </div>
              <div>
                <h3>Inventory could not be loaded</h3>
                <p>{dashboard.message}</p>
              </div>
              <button
                className="button button--primary"
                type="button"
                onClick={() => setRetryCount((count) => count + 1)}
              >
                Try again
              </button>
            </div>
          )}

          {dashboard.status === "ready" && (
            <>
              {selectedComponentId ? (
                <ComponentDetails
                  componentId={selectedComponentId}
                  onBack={() => setSelectedComponentId(null)}
                  cache={detailsCache}
                  authentication={authentication}
                  onRefresh={refreshInventoryAfterStockOperation}
                  onRequestLogin={requestStockSignIn}
                  onSessionExpired={handleStockSessionExpired}
                  onCsrfFailure={refreshCsrfTokenAfterFailure}
                />
              ) : (
                <>
                  <div className="filter-toolbar">
                    <label className="search-field">
                      <span className="search-field__icon" aria-hidden="true">
                        ⌕
                      </span>
                      <span className="visually-hidden">
                        Search by name or part number
                      </span>
                      <input
                        type="search"
                        aria-label="Search by name or part number"
                        placeholder="Search name or part number"
                        value={search}
                        onChange={(event) => setSearch(event.target.value)}
                      />
                      {search && (
                        <button
                          className="search-field__clear"
                          type="button"
                          aria-label="Clear search"
                          onClick={() => setSearch("")}
                        >
                          ×
                        </button>
                      )}
                    </label>

                    <div className="filter-control">
                      <label htmlFor="status-filter">Stock status</label>
                      <select
                        id="status-filter"
                        value={statusFilter}
                        onChange={(event) =>
                          setStatusFilter(event.target.value as StatusFilter)
                        }
                      >
                        <option value="all">All statuses</option>
                        <option value="in-stock">In Stock</option>
                        <option value="low-stock">Low Stock</option>
                        <option value="out-of-stock">Out of Stock</option>
                      </select>
                    </div>

                    <div className="filter-control">
                      <label htmlFor="sort-order">Sort by</label>
                      <select
                        id="sort-order"
                        value={sortOrder}
                        onChange={(event) =>
                          setSortOrder(event.target.value as SortOrder)
                        }
                      >
                        <option value="name">Name, A to Z</option>
                        <option value="quantity-ascending">
                          Quantity, low to high
                        </option>
                        <option value="quantity-descending">
                          Quantity, high to low
                        </option>
                      </select>
                    </div>
                  </div>

                  {components.length === 0 ? (
                    <div className="empty-state">
                      <span className="empty-state__mark" aria-hidden="true">
                        —
                      </span>
                      <h3>No components in inventory yet</h3>
                      <p>
                        Component details will appear here when the inventory is
                        populated.
                      </p>
                    </div>
                  ) : visibleComponents.length === 0 ? (
                    <div className="empty-state empty-state--compact">
                      <h3>No matching components</h3>
                      <p>Try changing your search or stock-status filter.</p>
                      <button
                        className="button button--secondary"
                        type="button"
                        onClick={() => {
                          setSearch("");
                          setStatusFilter("all");
                        }}
                      >
                        Clear filters
                      </button>
                    </div>
                  ) : (
                    <div className="component-grid">
                      {visibleComponents.map((component) => (
                        <ComponentCard
                          key={component.id}
                          component={component}
                          onOpen={setSelectedComponentId}
                        />
                      ))}
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </section>
      </main>
      {historyView && (
        <TransactionHistoryPage
          components={components}
          onSessionExpired={handleHistorySessionExpired}
        />
      )}

      <footer className="site-footer">
        <span>Gate Components Inventory</span>
        <span>Public stock dashboard · Read-only</span>
      </footer>
    </div>
  );
}

export default App;
