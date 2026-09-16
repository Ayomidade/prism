import type { EnrichedDependent, ImpactSummarizer } from "./impact-types.js";

// Default, no-AI "impact" summary builder. Formats the dependency
// graph and source context into a readable summary without requiring
// an API key. Confidence: "documented".

export function createTemplateImpactSummarizer(): ImpactSummarizer {
  return {
    async summarizeImpact(target, dependents) {
      const text = buildTemplateImpactSummary(target, dependents);
      return { text, confidence: dependents.length > 0 ? "documented" : "none" };
    },

    async summarizeImpactJson(target, dependents) {
      return buildTemplateImpactJson(target, dependents);
    },
  };
}

function buildTemplateImpactSummary(target: string, dependents: EnrichedDependent[]): string {
  if (dependents.length === 0) {
    return `No dependents found for ${target}.\nThis symbol is a leaf — changing it won't break anything in the indexed graph.`;
  }

  const lines: string[] = [];
  lines.push(`Impact of changing ${target}:`);
  lines.push("");

  const direct = dependents.filter((d) => d.depth === 1);
  const transitive = dependents.filter((d) => d.depth > 1);

  if (direct.length > 0) {
    lines.push("Direct dependents:");
    for (const dep of direct) {
      const edgeLabel = dep.edgeType === "calls" ? "calls" : "imports";
      lines.push(`  ${dep.file}:${dep.symbol} (${dep.kind}, ${edgeLabel})`);
      if (dep.history.length > 0) {
        const recent = dep.history[0].message.split("\n")[0];
        lines.push(`    Last changed: ${dep.history[0].date.slice(0, 10)} — ${recent}`);
      }
    }
    lines.push("");
  }

  if (transitive.length > 0) {
    lines.push(`Transitive dependents (${transitive.length}):`);
    for (const dep of transitive) {
      lines.push(`  ${dep.file}:${dep.symbol} (depth ${dep.depth})`);
    }
    lines.push("");
  }

  lines.push(`${dependents.length} dependent${dependents.length === 1 ? "" : "s"} found.`);
  lines.push("");
  lines.push("confidence: documented");

  return lines.join("\n");
}

function buildTemplateImpactJson(target: string, dependents: EnrichedDependent[]) {
  const directCount = dependents.filter((d) => d.depth === 1).length;
  return {
    target,
    confidence: dependents.length > 0 ? "documented" : "none",
    dependentCount: dependents.length,
    directCount,
    transitiveCount: dependents.length - directCount,
  };
}
