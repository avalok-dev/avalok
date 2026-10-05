export class RequestBodyError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 413,
  ) {
    super(message);
  }
}

/** Reads a JSON request body, refusing to buffer more than `maximum` bytes. */
export async function readJsonBody(request: Request, maximum: number): Promise<unknown> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maximum)
    throw new RequestBodyError(`Request body exceeds ${maximum} bytes.`, 413);
  const chunks: Uint8Array[] = [];
  let total = 0;
  if (request.body) {
    const reader = request.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximum) {
        await reader.cancel();
        throw new RequestBodyError(`Request body exceeds ${maximum} bytes.`, 413);
      }
      chunks.push(value);
    }
  }
  const text = new TextDecoder().decode(Buffer.concat(chunks));
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new RequestBodyError("Malformed JSON request body.", 400);
  }
}
