import type { Context } from "hono";
import type { ZodType } from "zod";
import { ApplicationError } from "../../application/errors";
import type { ApiErrorDetail } from "../../shared/api-types";

export const CRUD_BODY_LIMIT = 64 * 1024;
export const IMPORT_BODY_LIMIT = 5 * 1024 * 1024;

export async function parseJsonBody<T>(
  context: Context,
  schema: ZodType<T>,
  limit = CRUD_BODY_LIMIT,
  inspect?: (source: unknown) => void,
): Promise<T> {
  const contentType = context.req.header("Content-Type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json") {
    throw new ApplicationError("VALIDATION_ERROR", "Content-Type must be application/json.", 422, [
      { path: "", code: "INVALID_CONTENT_TYPE", message: "Use application/json." },
    ]);
  }

  const contentLength = context.req.header("Content-Length");
  if (contentLength !== undefined && Number(contentLength) > limit) throw payloadTooLarge();
  const bytes = await readBounded(context.req.raw.body, limit);
  let source: unknown;
  try {
    source = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new ApplicationError("INVALID_JSON", "The request body is not valid JSON.", 400);
  }
  inspect?.(source);
  const result = schema.safeParse(source);
  if (!result.success) {
    const details: ApiErrorDetail[] = result.error.issues.map((issue) => ({
      path: issue.path.join("."),
      code: issue.code.toUpperCase(),
      message: issue.message,
    }));
    throw new ApplicationError(
      "VALIDATION_ERROR",
      "The request contains invalid fields.",
      422,
      details,
    );
  }
  return result.data;
}

async function readBounded(
  body: ReadableStream<Uint8Array> | null,
  limit: number,
): Promise<Uint8Array> {
  if (body === null) return new Uint8Array();
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) {
        await reader.cancel("payload limit exceeded");
        throw payloadTooLarge();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const combined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return combined;
}

function payloadTooLarge(): ApplicationError {
  return new ApplicationError("PAYLOAD_TOO_LARGE", "The request body is too large.", 413);
}
