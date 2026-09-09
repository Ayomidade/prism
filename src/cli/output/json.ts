import type { WhyResult, ImpactResult } from "./terminal.js";

// --json output mode for `why` and `impact`. Keep this a thin, stable
// serialization layer since scripts/CI may depend on the shape.

export function formatWhyAsJson(result: WhyResult): string {
  return JSON.stringify(result, null, 2);
}

export function formatImpactAsJson(result: ImpactResult): string {
  return JSON.stringify(result, null, 2);
}
