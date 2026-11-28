import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
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

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

function respondWithDashboard(
  inventory: PublicComponent[] = components,
  totals: PublicStatistics = statistics,
) {
  fetchMock.mockImplementation(async (input) => {
    const url = String(input);
    if (url.endsWith("/components")) {
      return jsonResponse({ components: inventory });
    }
    if (url.endsWith("/statistics")) {
      return jsonResponse({ statistics: totals });
    }
    const id = url.split("/").at(-1);
    const component = inventory.find((item) => item.id === id);
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
}

beforeEach(() => {
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
    expect(screen.getByRole("button", { name: "Log in" })).toBeInTheDocument();

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
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(
      fetchMock.mock.calls.map(([url]) => String(url)).join(" "),
    ).not.toContain("/auth/");
    expect(
      fetchMock.mock.calls.every(
        ([, options]) => options?.credentials === "omit",
      ),
    ).toBe(true);

    await userEvent.click(screen.getByRole("button", { name: "Log in" }));
    expect(
      screen.getByRole("status", {
        name: "",
      }),
    ).toHaveTextContent("Sign-in is not available in this milestone");
    expect(fetchMock).toHaveBeenCalledTimes(2);
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
    expect(fetchMock).toHaveBeenCalledTimes(2);
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
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
});
