/**
 * Extracts a human-readable message from an API error response body.
 *
 * Most providers (OpenAI, Gemini, Groq) return structured JSON:
 *   { "error": { "message": "Please reduce the length..." } }
 *
 * Falls back to raw body (truncated) for non-JSON or unexpected formats.
 */
export function parseApiError(body: string): string {
  try {
    const parsed = JSON.parse(body);
    // OpenAI/Groq format: { error: { message: "..." } }
    if (parsed.error?.message) return parsed.error.message;
    // Alternate format: { message: "..." }
    if (parsed.message) return parsed.message;
  } catch {
    // Not JSON — return as-is
  }
  return body.slice(0, 200);
}
