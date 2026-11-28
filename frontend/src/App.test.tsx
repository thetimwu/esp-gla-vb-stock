import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import type { AuthUser } from "./api/authApi";
import type { PublicComponent, PublicStatistics } from "./api/inventoryApi";

const components: PublicComponent[] = [
  {
    id: "hinge-1",
    displayName: "Hinge clamp",
    description: "Heavy-duty gate hinge.",
    partNumber: "PX-100",
    currentQuantity: 12,
    minimumStockLevel: 5,
    photoUrl: null,
  },
  {
    id: "latch-2",
    displayName: "Latch bolt",
    description: "Replacement latch bolt.",
    partNumber: "PX-200",
    currentQuantity: 2,
    minimumStockLevel: 6,
    photoUrl: null,
  },
  {
    id: "roller-3",
    displayName: "Roller guide",
    description: "Bottom roller guide.",
    partNumber: "PX-300",
    currentQuantity: 0,
    minimumStockLevel: 1,
    photoUrl: null,
  },
];

const statistics: PublicStatistics = {
  activeComponentCount: 3,
  totalStockQuantity: 14,
  lowStockComponentCount: 2,
};

const fetchMock = vi.fn<typeof fetch>();

const engineerUser: AuthUser = {
  id: "engineer-1",
  username: "test-engineer",
  role: "ENGINEER",
};

const adminUser: AuthUser = {
  id: "admin-1",
  username: "test-admin",
  role: "ADMIN",
};

interface AuthMockOptions {
  initialUser?: AuthUser | null;
  loginUser?: AuthUser;
  loginStatus?: number;
  loginMessage?: string;
  stockStatus?: number | null;
  stockMessage?: string;
  stockDelayMs?: number;
}

interface AuthMockState {
  sessionUser: AuthUser | null;
  stockStatus: number | null;
  csrfToken: string;
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

function emptyResponse(status = 204): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => null,
  } as Response;
}

function respondWithDashboard(
  inventory: PublicComponent[] = components,
  totals: PublicStatistics = statistics,
  authOptions: AuthMockOptions = {},
): AuthMockState {
  const authState: AuthMockState = {
    sessionUser: authOptions.initialUser ?? null,
    stockStatus: authOptions.stockStatus ?? null,
    csrfToken: "csrf-token-before-login",
  };
  let inventoryState = inventory.map((component) => ({ ...component }));
  let statisticsState = { ...totals };
  const loginUser = authOptions.loginUser ?? engineerUser;
  const loginStatus = authOptions.loginStatus ?? 200;
  const loginMessage =
    authOptions.loginMessage ?? "Invalid username or password";

  fetchMock.mockImplementation(async (input, options) => {
    const url = String(input);
    if (url.endsWith("/components")) {
      return jsonResponse({ components: inventoryState });
    }
    if (url.endsWith("/statistics")) {
      return jsonResponse({ statistics: statisticsState });
    }
    if (url.endsWith("/auth/session")) {
      return jsonResponse({ user: authState.sessionUser });
    }
    if (url.endsWith("/auth/csrf-token")) {
      return jsonResponse({ csrfToken: authState.csrfToken });
    }
    if (url.endsWith("/auth/login")) {
      if (loginStatus < 200 || loginStatus >= 300) {
        return jsonResponse(
          {
            error: {
              code:
                loginStatus === 403
                  ? "CSRF_TOKEN_INVALID"
                  : "INVALID_CREDENTIALS",
              message: loginMessage,
            },
          },
          loginStatus,
        );
      }
      authState.sessionUser = loginUser;
      authState.csrfToken = "csrf-token-after-login";
      return jsonResponse({
        user: loginUser,
        csrfToken: authState.csrfToken,
      });
    }
    if (url.endsWith("/auth/logout")) {
      if (!authState.sessionUser) {
        return jsonResponse(
          {
            error: {
              code: "AUTHENTICATION_REQUIRED",
              message: "Login required",
            },
          },
          401,
        );
      }
      authState.sessionUser = null;
      return emptyResponse();
    }
    if (url.endsWith("/stock-transactions")) {
      if (authOptions.stockDelayMs) {
        await new Promise((resolve) =>
          setTimeout(resolve, authOptions.stockDelayMs),
        );
      }
      if (authState.stockStatus !== null) {
        if (authState.stockStatus === 401) {
          authState.sessionUser = null;
        }
        if (authState.stockStatus === 403) {
          authState.csrfToken = "csrf-token-refreshed";
        }
        return jsonResponse(
          {
            error: {
              code:
                authState.stockStatus === 401
                  ? "AUTHENTICATION_REQUIRED"
                  : authState.stockStatus === 403
                    ? "CSRF_TOKEN_INVALID"
                    : authState.stockStatus === 409
                      ? "INSUFFICIENT_STOCK"
                      : "INTERNAL_SERVER_ERROR",
              message:
                authOptions.stockMessage ??
                "The stock operation could not be completed.",
            },
          },
          authState.stockStatus,
        );
      }

      const componentId = url.split("/").at(-2);
      const component = inventoryState.find(
        (component) => component.id === componentId,
      );
      if (!component || !componentId) {
        return jsonResponse(
          {
            error: {
              code: "COMPONENT_NOT_FOUND",
              message: "Component not found",
            },
          },
          404,
        );
      }
      const body = JSON.parse(String(options?.body)) as {
        type: "STOCK_IN" | "STOCK_OUT" | "ADJUSTMENT";
        quantity?: number;
        newQuantity?: number;
        comment?: string;
      };
      const previousQuantity = component.currentQuantity;
      if (
        body.type === "STOCK_OUT" &&
        (body.quantity ?? 0) > previousQuantity
      ) {
        return jsonResponse(
          {
            error: {
              code: "INSUFFICIENT_STOCK",
              message: "The requested stock-out exceeds available stock.",
            },
          },
          409,
        );
      }
      const newQuantity =
        body.type === "STOCK_IN"
          ? previousQuantity + (body.quantity ?? 0)
          : body.type === "STOCK_OUT"
            ? previousQuantity - (body.quantity ?? 0)
            : (body.newQuantity ?? previousQuantity);
      inventoryState = inventoryState.map((item) =>
        item.id === componentId
          ? { ...item, currentQuantity: newQuantity }
          : item,
      );
      statisticsState = {
        activeComponentCount: inventoryState.length,
        totalStockQuantity: inventoryState.reduce(
          (total, item) => total + item.currentQuantity,
          0,
        ),
        lowStockComponentCount: inventoryState.filter(
          (item) => item.currentQuantity < item.minimumStockLevel,
        ).length,
      };
      return jsonResponse(
        {
          transaction: {
            id: "stock-transaction-1",
            componentId,
            componentName: component.displayName,
            userId: authState.sessionUser?.id ?? engineerUser.id,
            username: authState.sessionUser?.username ?? engineerUser.username,
            actionType: body.type,
            previousQuantity,
            newQuantity,
            quantityChange: newQuantity - previousQuantity,
            comment: body.comment ?? null,
            createdAt: new Date().toISOString(),
          },
        },
        201,
      );
    }
    const id = url.split("/").at(-1);
    const component = inventoryState.find((item) => item.id === id);
    return component
      ? jsonResponse({ component })
      : jsonResponse(
          {
            error: {
              code: "COMPONENT_NOT_FOUND",
              message: "Component not found",
            },
          },
          404,
        );
  });
  return authState;
}

async function openLoginPage() {
  await userEvent.click(screen.getByRole("link", { name: "Log in" }));
  expect(
    await screen.findByRole("heading", { name: "Sign in" }),
  ).toBeInTheDocument();
  await screen.findByRole("button", { name: "Sign in" });
}

async function submitLogin(username = "test-user", password = "correct horse") {
  await userEvent.type(screen.getByLabelText("Username"), username);
  await userEvent.type(screen.getByLabelText("Password"), password);
  const submitButton = screen.getByRole("button", { name: "Sign in" });
  await vi.waitFor(() => expect(submitButton).toBeEnabled());
  await userEvent.click(submitButton);
}

beforeEach(() => {
  window.history.replaceState(null, "", window.location.pathname);
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("public stock dashboard", () => {
  it("loads public statistics and inventory without login or session credentials", async () => {
    respondWithDashboard();
    render(<App />);

    expect(await screen.findByText("Hinge clamp")).toBeInTheDocument();
    const loginLink = await screen.findByRole("link", { name: "Log in" });
    expect(screen.queryByRole("heading", { name: "Sign in" })).toBeNull();
    expect(screen.queryByText("Administration")).toBeNull();

    const componentMetric = screen
      .getByRole("heading", { name: "Component types" })
      .closest("article");
    const quantityMetric = screen
      .getByRole("heading", { name: "Total quantity" })
      .closest("article");
    const lowMetric = screen
      .getByRole("heading", { name: "Below minimum" })
      .closest("article");
    const zeroMetric = screen
      .getByRole("heading", { name: "Out of stock" })
      .closest("article");

    expect(componentMetric).toHaveTextContent("3");
    expect(quantityMetric).toHaveTextContent("14");
    expect(lowMetric).toHaveTextContent("2");
    expect(zeroMetric).toHaveTextContent("1");
    expect(
      screen.getByText("In Stock", { selector: ".status-badge" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Low Stock", { selector: ".status-badge" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Out of Stock", { selector: ".status-badge" }),
    ).toBeInTheDocument();
    const inventoryCalls = fetchMock.mock.calls.filter(([url]) => {
      const requestUrl = String(url);
      return (
        requestUrl.endsWith("/components") || requestUrl.endsWith("/statistics")
      );
    });
    expect(inventoryCalls).toHaveLength(2);
    expect(
      inventoryCalls.every(([, options]) => options?.credentials === "omit"),
    ).toBe(true);
    expect(
      fetchMock.mock.calls.filter(([url]) =>
        String(url).endsWith("/auth/session"),
      ),
    ).toHaveLength(1);
    expect(
      fetchMock.mock.calls.find(([url]) =>
        String(url).endsWith("/auth/session"),
      )?.[1]?.credentials,
    ).toBe("include");
    expect(
      fetchMock.mock.calls.some(([url]) =>
        String(url).endsWith("/auth/csrf-token"),
      ),
    ).toBe(false);

    await userEvent.click(loginLink);
    expect(
      await screen.findByRole("heading", { name: "Sign in" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Stock overview" }),
    ).toBeNull();
    expect(
      fetchMock.mock.calls.some(([url]) =>
        String(url).endsWith("/auth/csrf-token"),
      ),
    ).toBe(true);

    await userEvent.click(
      screen.getByRole("link", { name: "Return to public dashboard" }),
    );
    expect(
      await screen.findByRole("heading", { name: "Stock overview" }),
    ).toBeInTheDocument();
  });

  it("searches by part number and filters by stock status", async () => {
    respondWithDashboard();
    render(<App />);
    const user = userEvent.setup();

    const search = await screen.findByRole("searchbox", {
      name: "Search by name or part number",
    });
    await user.type(search, "PX-200");

    expect(screen.getByText("Latch bolt")).toBeInTheDocument();
    expect(screen.queryByText("Hinge clamp")).not.toBeInTheDocument();

    await user.clear(search);
    await user.selectOptions(
      screen.getByLabelText("Stock status"),
      "low-stock",
    );

    expect(screen.getByText("Latch bolt")).toBeInTheDocument();
    expect(screen.queryByText("Roller guide")).not.toBeInTheDocument();
    expect(
      fetchMock.mock.calls.filter(([url]) => {
        const requestUrl = String(url);
        return (
          requestUrl.endsWith("/components") ||
          requestUrl.endsWith("/statistics")
        );
      }),
    ).toHaveLength(2);
  });

  it("sorts components by stock quantity", async () => {
    respondWithDashboard();
    render(<App />);
    const user = userEvent.setup();

    await screen.findByText("Hinge clamp");
    await user.selectOptions(
      screen.getByLabelText("Sort by"),
      "quantity-descending",
    );

    const cardNames = screen
      .getAllByRole("button", { name: /^View details for / })
      .map((button) => button.getAttribute("aria-label"));
    expect(cardNames).toEqual([
      "View details for Hinge clamp",
      "View details for Latch bolt",
      "View details for Roller guide",
    ]);

    await user.selectOptions(
      screen.getByLabelText("Sort by"),
      "quantity-ascending",
    );
    expect(
      screen
        .getAllByRole("button", { name: /^View details for / })
        .map((button) => button.getAttribute("aria-label")),
    ).toEqual([
      "View details for Roller guide",
      "View details for Latch bolt",
      "View details for Hinge clamp",
    ]);
  });

  it("loads public component details and reuses them when reopened", async () => {
    respondWithDashboard();
    render(<App />);
    const user = userEvent.setup();

    await user.click(
      await screen.findByRole("button", {
        name: "View details for Hinge clamp",
      }),
    );
    expect(
      await screen.findByText("Heavy-duty gate hinge."),
    ).toBeInTheDocument();
    expect(screen.getByText("PX-100")).toBeInTheDocument();
    expect(
      fetchMock.mock.calls.filter(([url]) =>
        String(url).endsWith("/components/hinge-1"),
      ),
    ).toHaveLength(1);

    await user.click(screen.getByRole("button", { name: /Back to inventory/ }));
    await user.click(
      screen.getByRole("button", { name: "View details for Hinge clamp" }),
    );
    expect(
      await screen.findByText("Heavy-duty gate hinge."),
    ).toBeInTheDocument();
    expect(
      fetchMock.mock.calls.filter(([url]) =>
        String(url).endsWith("/components/hinge-1"),
      ),
    ).toHaveLength(1);
  });

  it("shows component-detail errors and retries the public detail request", async () => {
    let detailShouldFail = true;
    fetchMock.mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/components")) {
        return jsonResponse({ components });
      }
      if (url.endsWith("/statistics")) {
        return jsonResponse({ statistics });
      }
      if (detailShouldFail) {
        return jsonResponse(
          {
            error: {
              code: "SERVICE_UNAVAILABLE",
              message: "Component details temporarily unavailable.",
            },
          },
          503,
        );
      }
      return jsonResponse({ component: components[0] });
    });
    render(<App />);
    const user = userEvent.setup();

    await user.click(
      await screen.findByRole("button", {
        name: "View details for Hinge clamp",
      }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Component details temporarily unavailable.",
    );

    detailShouldFail = false;
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(
      await screen.findByText("Heavy-duty gate hinge."),
    ).toBeInTheDocument();
  });

  it("shows loading and empty-inventory states", async () => {
    fetchMock.mockImplementation(() => new Promise<Response>(() => {}));
    const { unmount } = render(<App />);
    expect(screen.getByText("Loading public inventory…")).toBeInTheDocument();
    unmount();

    fetchMock.mockReset();
    respondWithDashboard([], {
      activeComponentCount: 0,
      totalStockQuantity: 0,
      lowStockComponentCount: 0,
    });
    render(<App />);
    expect(
      await screen.findByRole("heading", {
        name: "No components in inventory yet",
      }),
    ).toBeInTheDocument();
  });

  it("shows API errors and retries the public requests", async () => {
    let shouldFail = true;
    fetchMock.mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/components") && shouldFail) {
        return jsonResponse(
          {
            error: {
              code: "SERVICE_UNAVAILABLE",
              message: "Inventory temporarily unavailable.",
            },
          },
          503,
        );
      }
      if (url.endsWith("/components")) {
        return jsonResponse({ components });
      }
      if (url.endsWith("/statistics")) {
        return jsonResponse({ statistics });
      }
      return jsonResponse({ component: components[0] });
    });
    render(<App />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Inventory temporarily unavailable.",
    );
    shouldFail = false;
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByText("Hinge clamp")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it("logs an Engineer in with CSRF protection and shows Engineer account navigation", async () => {
    respondWithDashboard(components, statistics, { loginUser: engineerUser });
    render(<App />);

    await screen.findByText("Hinge clamp");
    await openLoginPage();
    await submitLogin(engineerUser.username);

    expect(await screen.findByText(engineerUser.username)).toBeInTheDocument();
    expect(screen.getByText("Engineer")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Log out" })).toBeInTheDocument();
    expect(screen.queryByText("Administration")).toBeNull();
    expect(screen.queryByRole("heading", { name: "Sign in" })).toBeNull();
    expect(window.localStorage.length).toBe(0);

    const csrfCall = fetchMock.mock.calls.find(([url]) =>
      String(url).endsWith("/auth/csrf-token"),
    );
    expect(csrfCall?.[1]?.credentials).toBe("include");

    const loginCall = fetchMock.mock.calls.find(([url]) =>
      String(url).endsWith("/auth/login"),
    );
    expect(loginCall?.[1]?.credentials).toBe("include");
    expect(loginCall?.[1]?.headers).toMatchObject({
      "x-csrf-token": "csrf-token-before-login",
    });
    expect(JSON.parse(String(loginCall?.[1]?.body))).toEqual({
      username: engineerUser.username,
      password: "correct horse",
    });
  });

  describe("stock operations interface", () => {
    it("offers a sign-in prompt to public visitors without showing stock controls", async () => {
      respondWithDashboard();
      render(<App />);
      const user = userEvent.setup();

      await user.click(
        await screen.findByRole("button", {
          name: "View details for Hinge clamp",
        }),
      );

      expect(
        await screen.findByText("Protected staff action"),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Sign in to continue" }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole("group", { name: "Stock operation type" }),
      ).toBeNull();
      expect(
        fetchMock.mock.calls.some(([url]) =>
          String(url).endsWith("/stock-transactions"),
        ),
      ).toBe(false);

      await user.click(
        screen.getByRole("button", { name: "Sign in to continue" }),
      );
      await submitLogin(engineerUser.username);
      expect(
        await screen.findByRole("heading", { name: "Stock operations" }),
      ).toBeInTheDocument();
      expect(screen.getByText("Hinge clamp")).toBeInTheDocument();
    });

    it.each([
      ["Engineer", engineerUser],
      ["Admin", adminUser],
    ] as const)(
      "shows stock controls to an authenticated %s",
      async (_role, account) => {
        respondWithDashboard(components, statistics, { initialUser: account });
        render(<App />);
        const user = userEvent.setup();

        await user.click(
          await screen.findByRole("button", {
            name: "View details for Hinge clamp",
          }),
        );

        expect(
          await screen.findByRole("heading", { name: "Stock operations" }),
        ).toBeInTheDocument();
        expect(
          screen.getByRole("button", { name: "Stock In" }),
        ).toBeInTheDocument();
        expect(
          screen.getByRole("button", { name: "Stock Out" }),
        ).toBeInTheDocument();
        expect(
          screen.getByRole("button", { name: "Stock Adjustment" }),
        ).toBeInTheDocument();
      },
    );

    it.each([
      {
        label: "Stock In",
        quantityLabel: "Quantity to add",
        quantity: "5",
        expectedBody: { type: "STOCK_IN", quantity: 5, comment: "Delivery" },
        expectedQuantity: "17",
        expectedTotal: "19",
      },
      {
        label: "Stock Out",
        quantityLabel: "Quantity to remove",
        quantity: "3",
        expectedBody: { type: "STOCK_OUT", quantity: 3, comment: "Repair" },
        expectedQuantity: "9",
        expectedTotal: "11",
      },
      {
        label: "Stock Adjustment",
        quantityLabel: "Corrected absolute quantity",
        quantity: "8",
        expectedBody: {
          type: "ADJUSTMENT",
          newQuantity: 8,
          comment: "Physical count",
        },
        expectedQuantity: "8",
        expectedTotal: "10",
      },
    ])(
      "submits $label and refreshes the component and statistics",
      async ({
        label,
        quantityLabel,
        quantity,
        expectedBody,
        expectedQuantity,
        expectedTotal,
      }) => {
        respondWithDashboard(components, statistics, {
          initialUser: engineerUser,
        });
        render(<App />);
        const user = userEvent.setup();

        await user.click(
          await screen.findByRole("button", {
            name: "View details for Hinge clamp",
          }),
        );
        await screen.findByRole("heading", { name: "Stock operations" });
        if (label !== "Stock In") {
          await user.click(screen.getByRole("button", { name: label }));
        }

        await user.type(screen.getByLabelText(quantityLabel), quantity);
        await user.type(
          screen.getByLabelText(
            label === "Stock Adjustment"
              ? "Explanation (optional)"
              : "Comment (optional)",
          ),
          label === "Stock Adjustment"
            ? "Physical count"
            : label === "Stock In"
              ? "Delivery"
              : "Repair",
        );
        await user.click(
          screen.getByRole("button", {
            name: `Review ${label.toLowerCase()}`,
          }),
        );
        await user.click(
          screen.getByRole("button", {
            name: `Confirm ${label.toLowerCase()}`,
          }),
        );

        expect(
          await screen.findByText(
            new RegExp(
              `${label} recorded\\. Current quantity is ${expectedQuantity}\\.`,
            ),
          ),
        ).toBeInTheDocument();
        expect(
          screen.getByText(expectedQuantity, { selector: ".detail-facts dd" }),
        ).toBeInTheDocument();
        const totalMetric = screen
          .getByRole("heading", { name: "Total quantity" })
          .closest("article");
        expect(totalMetric).toHaveTextContent(expectedTotal);

        const stockCall = fetchMock.mock.calls.find(([url]) =>
          String(url).endsWith("/stock-transactions"),
        );
        expect(stockCall?.[1]?.method).toBe("POST");
        expect(stockCall?.[1]?.credentials).toBe("include");
        expect(stockCall?.[1]?.headers).toMatchObject({
          "x-csrf-token": "csrf-token-before-login",
        });
        expect(JSON.parse(String(stockCall?.[1]?.body))).toEqual(expectedBody);
      },
    );

    it("rejects decimals and stock-outs above the available quantity before posting", async () => {
      respondWithDashboard(components, statistics, {
        initialUser: engineerUser,
      });
      render(<App />);
      const user = userEvent.setup();

      await user.click(
        await screen.findByRole("button", {
          name: "View details for Hinge clamp",
        }),
      );
      await screen.findByRole("heading", { name: "Stock operations" });
      await user.type(screen.getByLabelText("Quantity to add"), "1.5");
      await user.click(screen.getByRole("button", { name: "Review stock in" }));
      expect(await screen.findByRole("alert")).toHaveTextContent(
        "Enter a whole number.",
      );
      expect(
        screen.queryByRole("button", { name: "Confirm stock in" }),
      ).toBeNull();

      await user.click(screen.getByRole("button", { name: "Stock Out" }));
      const quantityInput = screen.getByLabelText("Quantity to remove");
      await user.clear(quantityInput);
      await user.type(quantityInput, "13");
      await user.click(
        screen.getByRole("button", { name: "Review stock out" }),
      );
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Only 12 units are available.",
      );
      expect(
        fetchMock.mock.calls.some(([url]) =>
          String(url).endsWith("/stock-transactions"),
        ),
      ).toBe(false);
    });

    it("prevents duplicate submissions while the stock request is pending", async () => {
      respondWithDashboard(components, statistics, {
        initialUser: engineerUser,
        stockDelayMs: 100,
      });
      render(<App />);
      const user = userEvent.setup();

      await user.click(
        await screen.findByRole("button", {
          name: "View details for Hinge clamp",
        }),
      );
      await screen.findByRole("heading", { name: "Stock operations" });
      await user.type(screen.getByLabelText("Quantity to add"), "2");
      await user.click(screen.getByRole("button", { name: "Review stock in" }));
      const confirmButton = screen.getByRole("button", {
        name: "Confirm stock in",
      });
      await user.click(confirmButton);

      expect(
        screen.getByRole("button", { name: "Saving operation…" }),
      ).toBeDisabled();
      await user.click(
        screen.getByRole("button", { name: "Saving operation…" }),
      );
      await screen.findByText(/Stock In recorded/);
      expect(
        fetchMock.mock.calls.filter(([url]) =>
          String(url).endsWith("/stock-transactions"),
        ),
      ).toHaveLength(1);
    });

    it("shows API failures and prompts again when the session has expired", async () => {
      const authState = respondWithDashboard(components, statistics, {
        initialUser: engineerUser,
        stockStatus: 409,
        stockMessage: "Insufficient stock for this operation.",
      });
      render(<App />);
      const user = userEvent.setup();

      await user.click(
        await screen.findByRole("button", {
          name: "View details for Hinge clamp",
        }),
      );
      await screen.findByRole("heading", { name: "Stock operations" });
      await user.type(screen.getByLabelText("Quantity to add"), "2");
      await user.click(screen.getByRole("button", { name: "Review stock in" }));
      await user.click(
        screen.getByRole("button", { name: "Confirm stock in" }),
      );
      expect(await screen.findByRole("alert")).toHaveTextContent(
        "Insufficient stock for this operation.",
      );

      authState.stockStatus = 401;
      await user.click(screen.getByRole("button", { name: "Review stock in" }));
      await user.click(
        screen.getByRole("button", { name: "Confirm stock in" }),
      );
      expect(
        await screen.findByRole("heading", { name: "Sign in" }),
      ).toBeInTheDocument();
      expect(authState.sessionUser).toBeNull();
      expect(screen.getByText("Hinge clamp")).toBeInTheDocument();
    });

    it("refreshes the CSRF token after a CSRF failure without replaying the operation", async () => {
      const authState = respondWithDashboard(components, statistics, {
        initialUser: engineerUser,
        stockStatus: 403,
        stockMessage: "CSRF token invalid",
      });
      render(<App />);
      const user = userEvent.setup();

      await user.click(
        await screen.findByRole("button", {
          name: "View details for Hinge clamp",
        }),
      );
      await screen.findByRole("heading", { name: "Stock operations" });
      await user.type(screen.getByLabelText("Quantity to add"), "2");
      await user.click(screen.getByRole("button", { name: "Review stock in" }));
      await user.click(
        screen.getByRole("button", { name: "Confirm stock in" }),
      );

      expect(await screen.findByRole("alert")).toHaveTextContent(
        "Your security token expired and was refreshed.",
      );
      expect(
        fetchMock.mock.calls.filter(([url]) =>
          String(url).endsWith("/stock-transactions"),
        ),
      ).toHaveLength(1);
      expect(
        fetchMock.mock.calls.filter(([url]) =>
          String(url).endsWith("/auth/csrf-token"),
        ),
      ).toHaveLength(2);

      authState.stockStatus = null;
      await user.click(screen.getByRole("button", { name: "Review stock in" }));
      await user.click(
        screen.getByRole("button", { name: "Confirm stock in" }),
      );
      await screen.findByText(/Stock In recorded/);
      const stockCalls = fetchMock.mock.calls.filter(([url]) =>
        String(url).endsWith("/stock-transactions"),
      );
      expect(stockCalls).toHaveLength(2);
      expect(stockCalls[1]?.[1]?.headers).toMatchObject({
        "x-csrf-token": "csrf-token-refreshed",
      });
    });
  });

  it("logs an Admin in and shows administration navigation only for Admins", async () => {
    respondWithDashboard(components, statistics, { loginUser: adminUser });
    render(<App />);

    await screen.findByText("Hinge clamp");
    await openLoginPage();
    await submitLogin(adminUser.username);

    expect(await screen.findByText(adminUser.username)).toBeInTheDocument();
    expect(screen.getByText("Admin")).toBeInTheDocument();
    expect(screen.getByText("Administration")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Log out" })).toBeInTheDocument();
  });

  it("shows a clear error for incorrect credentials without leaving the login page", async () => {
    respondWithDashboard(components, statistics, {
      loginStatus: 401,
      loginMessage: "Invalid username or password",
    });
    render(<App />);

    await screen.findByText("Hinge clamp");
    await openLoginPage();
    await submitLogin("unknown-user", "wrong-password");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Incorrect username or password.",
    );
    expect(
      screen.getByRole("heading", { name: "Sign in" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Return to public dashboard" }),
    ).toBeInTheDocument();
  });

  it("restores the authenticated session after the application is remounted", async () => {
    const authState = respondWithDashboard(components, statistics, {
      initialUser: engineerUser,
    });
    const firstRender = render(<App />);

    expect(await screen.findByText(engineerUser.username)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Log out" })).toBeInTheDocument();
    firstRender.unmount();

    authState.sessionUser = engineerUser;
    render(<App />);

    expect(await screen.findByText(engineerUser.username)).toBeInTheDocument();
    expect(
      fetchMock.mock.calls.filter(([url]) =>
        String(url).endsWith("/auth/session"),
      ),
    ).toHaveLength(2);
    expect(
      fetchMock.mock.calls.filter(([url]) =>
        String(url).endsWith("/auth/csrf-token"),
      ),
    ).toHaveLength(2);
  });

  it("logs out and clears authenticated navigation", async () => {
    const authState = respondWithDashboard(components, statistics);
    render(<App />);

    await screen.findByText("Hinge clamp");
    await openLoginPage();
    await submitLogin();
    await screen.findByRole("button", { name: "Log out" });

    await userEvent.click(screen.getByRole("button", { name: "Log out" }));
    expect(
      await screen.findByRole("link", { name: "Log in" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Administration")).toBeNull();
    expect(authState.sessionUser).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent(
      "You have been signed out.",
    );

    const logoutCall = fetchMock.mock.calls.find(([url]) =>
      String(url).endsWith("/auth/logout"),
    );
    expect(logoutCall?.[1]?.credentials).toBe("include");
    expect(logoutCall?.[1]?.headers).toMatchObject({
      "x-csrf-token": "csrf-token-after-login",
    });
  });

  it("treats an expired session as signed out without redirecting the public dashboard", async () => {
    const authState = respondWithDashboard(components, statistics, {
      initialUser: engineerUser,
    });
    const signedInRender = render(<App />);

    expect(await screen.findByText(engineerUser.username)).toBeInTheDocument();
    signedInRender.unmount();
    authState.sessionUser = null;
    render(<App />);

    expect(
      await screen.findByRole("link", { name: "Log in" }),
    ).toBeInTheDocument();
    expect(await screen.findByText("Hinge clamp")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Sign in" })).toBeNull();
  });

  it("clears local sign-in state when the session expires during logout", async () => {
    const authState = respondWithDashboard(components, statistics);
    render(<App />);

    await screen.findByText("Hinge clamp");
    await openLoginPage();
    await submitLogin();
    await screen.findByRole("button", { name: "Log out" });

    authState.sessionUser = null;
    await userEvent.click(screen.getByRole("button", { name: "Log out" }));

    expect(
      await screen.findByRole("link", { name: "Log in" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Your session expired. You have been signed out.",
    );
    expect(screen.getByText("Hinge clamp")).toBeInTheDocument();
  });

  it("reports a CSRF failure and stays on the sign-in form", async () => {
    respondWithDashboard(components, statistics, {
      loginStatus: 403,
      loginMessage: "Missing or invalid CSRF token",
    });
    render(<App />);

    await screen.findByText("Hinge clamp");
    await openLoginPage();
    await submitLogin();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Your sign-in request could not be verified. Please try again.",
    );
    expect(
      screen.getByRole("heading", { name: "Sign in" }),
    ).toBeInTheDocument();
  });
});
