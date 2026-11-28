export interface PublicComponent {
  id: string;
  displayName: string;
  description: string;
  partNumber: string | null;
  currentQuantity: number;
  minimumStockLevel: number;
  photoUrl: string | null;
}

export interface PublicStatistics {
  activeComponentCount: number;
  totalStockQuantity: number;
  lowStockComponentCount: number;
}

export interface DashboardData {
  components: PublicComponent[];
  statistics: PublicStatistics;
}

export class InventoryApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InventoryApiError";
  }
}

const apiBaseUrl = (
  import.meta.env.VITE_API_BASE_URL?.trim() || "/api"
).replace(/\/+$/, "");

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && typeof value === "number" && value >= 0;
}

function parseComponent(value: unknown): PublicComponent {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.displayName !== "string" ||
    typeof value.description !== "string" ||
    (typeof value.partNumber !== "string" && value.partNumber !== null) ||
    !isNonNegativeInteger(value.currentQuantity) ||
    !isNonNegativeInteger(value.minimumStockLevel) ||
    (typeof value.photoUrl !== "string" && value.photoUrl !== null)
  ) {
    throw new InventoryApiError(
      "The inventory service returned an unexpected component response.",
    );
  }

  return {
    id: value.id,
    displayName: value.displayName,
    description: value.description,
    partNumber: value.partNumber,
    currentQuantity: value.currentQuantity,
    minimumStockLevel: value.minimumStockLevel,
    photoUrl: value.photoUrl,
  };
}

function parseStatistics(value: unknown): PublicStatistics {
  if (
    !isRecord(value) ||
    !isNonNegativeInteger(value.activeComponentCount) ||
    !isNonNegativeInteger(value.totalStockQuantity) ||
    !isNonNegativeInteger(value.lowStockComponentCount)
  ) {
    throw new InventoryApiError(
      "The inventory service returned unexpected statistics.",
    );
  }

  return {
    activeComponentCount: value.activeComponentCount,
    totalStockQuantity: value.totalStockQuantity,
    lowStockComponentCount: value.lowStockComponentCount,
  };
}

async function getJson(path: string, signal?: AbortSignal): Promise<unknown> {
  let response: Response;

  try {
    const requestOptions: RequestInit = {
      method: "GET",
      headers: { Accept: "application/json" },
      credentials: "omit",
      ...(signal ? { signal } : {}),
    };
    response = await fetch(`${apiBaseUrl}${path}`, {
      ...requestOptions,
    });
  } catch (error) {
    if (signal?.aborted) {
      throw error;
    }
    throw new InventoryApiError(
      "Unable to reach the inventory service. Check your connection and try again.",
    );
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new InventoryApiError(
      "The inventory service returned an unreadable response.",
    );
  }

  if (!response.ok) {
    const error = isRecord(payload) ? payload.error : undefined;
    const message = isRecord(error) ? error.message : undefined;
    throw new InventoryApiError(
      typeof message === "string"
        ? message
        : "Unable to load inventory data. Please try again.",
    );
  }

  return payload;
}

export async function fetchDashboard(
  signal?: AbortSignal,
): Promise<DashboardData> {
  const [componentPayload, statisticsPayload] = await Promise.all([
    getJson("/components", signal),
    getJson("/statistics", signal),
  ]);
  const components =
    isRecord(componentPayload) && Array.isArray(componentPayload.components)
      ? componentPayload.components.map(parseComponent)
      : null;
  const statistics =
    isRecord(statisticsPayload) && isRecord(statisticsPayload.statistics)
      ? parseStatistics(statisticsPayload.statistics)
      : null;

  if (!components || !statistics) {
    throw new InventoryApiError(
      "The inventory service returned an unexpected dashboard response.",
    );
  }

  return { components, statistics };
}

export async function fetchComponent(
  componentId: string,
  signal?: AbortSignal,
): Promise<PublicComponent> {
  const payload = await getJson(
    `/components/${encodeURIComponent(componentId)}`,
    signal,
  );

  if (!isRecord(payload) || !("component" in payload)) {
    throw new InventoryApiError(
      "The inventory service returned an unexpected component response.",
    );
  }

  return parseComponent(payload.component);
}
