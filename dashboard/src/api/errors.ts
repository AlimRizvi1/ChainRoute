export type ApiErrorBody = {
  code: string;
  message: string;
  fields?: Record<string, string>;
};

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields?: Record<string, string>;

  constructor(status: number, body: ApiErrorBody) {
    super(body.message);
    this.name = "ApiError";
    this.status = status;
    this.code = body.code;
    this.fields = body.fields;
  }
}

export async function readApiError(response: Response): Promise<ApiError> {
  let value: unknown;
  try {
    value = await response.json();
  } catch {
    value = null;
  }
  const error =
    typeof value === "object" && value !== null && "error" in value
      ? (value as { error?: unknown }).error
      : undefined;
  const body =
    typeof error === "object" && error !== null
      ? (error as Partial<ApiErrorBody>)
      : undefined;
  return new ApiError(response.status, {
    code: typeof body?.code === "string" ? body.code : "REQUEST_FAILED",
    message:
      typeof body?.message === "string"
        ? body.message
        : response.status === 503
          ? "A required service is unavailable. Your other work is still available."
          : `The request could not be completed (HTTP ${response.status}).`,
    ...(body?.fields && typeof body.fields === "object" ? { fields: body.fields } : {}),
  });
}
