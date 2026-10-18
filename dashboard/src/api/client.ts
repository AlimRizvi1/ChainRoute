import { ApiError, readApiError } from "./errors";
import { clearSession, readSession } from "../auth/session";
import { mockRequest } from "../mocks/mockApi";

export const API_MODE = import.meta.env.VITE_API_MODE === "mock" ? "mock" : "real";
export const API_ROOT = import.meta.env.VITE_API_ROOT || "/api";

export type ApiRequestOptions = Omit<RequestInit, "body"> & {
  body?: unknown;
  auth?: boolean;
};

export async function apiRequest<T>(
  path: string,
  options: ApiRequestOptions = {},
): Promise<T> {
  const { auth = true, body, headers: inputHeaders, ...requestOptions } = options;
  const headers = new Headers(inputHeaders);
  if (body !== undefined) headers.set("content-type", "application/json");
  const session = auth ? readSession() : null;
  if (session) headers.set("authorization", `Bearer ${session.token}`);

  let response: Response;
  try {
    response =
      API_MODE === "mock"
        ? await mockRequest(path, {
            method: requestOptions.method ?? "GET",
            body,
            token: session?.token,
          })
        : await fetch(`${API_ROOT}${path.startsWith("/") ? path : `/${path}`}`, {
            ...requestOptions,
            headers,
            ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
            signal: requestOptions.signal ?? AbortSignal.timeout(12_000),
          });
  } catch (cause) {
    const message =
      cause instanceof DOMException && cause.name === "TimeoutError"
        ? "The service took too long to respond. Please try again."
        : "Cannot reach the ChainRoute service. Check your connection and try again.";
    throw new ApiError(0, { code: "NETWORK_UNAVAILABLE", message });
  }

  if (!response.ok) {
    const error = await readApiError(response);
    if (error.status === 401 && auth) {
      clearSession();
      window.dispatchEvent(new Event("chainroute:session-expired"));
    }
    throw error;
  }
  if (response.status === 204) return undefined as T;
  try {
    return (await response.json()) as T;
  } catch {
    throw new ApiError(502, {
      code: "INVALID_RESPONSE",
      message: "The service returned a response the dashboard could not read.",
    });
  }
}

export function isServiceUnavailable(error: unknown): error is ApiError {
  return error instanceof ApiError && error.status === 503;
}
