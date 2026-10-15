import type { ArchitectureEvidence, ConfidenceLabel } from "./types";

export function confidenceFromEvidence(evidence: readonly ArchitectureEvidence[], penalty = 0) {
  let remaining = 1;
  for (const item of evidence) remaining *= 1 - Math.min(0.95, Math.max(0, item.weight));
  return Math.max(0, Math.min(1, 1 - remaining - penalty));
}

export function confidenceLabel(confidence: number): ConfidenceLabel {
  if (confidence >= 0.95) return "confirmed";
  if (confidence >= 0.8) return "high";
  if (confidence >= 0.55) return "medium";
  return "low";
}
