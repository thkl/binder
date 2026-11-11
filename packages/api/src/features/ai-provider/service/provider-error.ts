export interface AiProviderErrorDetails {
  message: string;
  type?: string;
  param?: string;
  code?: string;
}

export function parseAiProviderError(body: string, fallback: string): AiProviderErrorDetails {
  let payload: unknown;
  try {
    payload = JSON.parse(body) as unknown;
  } catch {
    return { message: body.trim().slice(0, 1000) || fallback };
  }

  if (!isRecord(payload)) return { message: fallback };
  const error = isRecord(payload.error) ? payload.error : payload;
  const message = readString(error.message);
  const type = readString(error.type);
  const param = readString(error.param);
  const code = readString(error.code);
  return {
    message: message?.slice(0, 1000) || fallback,
    ...(type ? { type: type.slice(0, 100) } : {}),
    ...(param ? { param: param.slice(0, 100) } : {}),
    ...(code ? { code: code.slice(0, 100) } : {}),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
