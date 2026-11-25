import { LiquityAgentKitError } from "./errors.js";
import { BRANCH_IDS, type BranchId } from "./types.js";

/**
 * Validates an untrusted branch identifier. Uses an own-property allow-list so that
 * inputs such as "constructor" or "toString" cannot resolve to prototype members.
 */
export function parseBranchId(value: unknown): BranchId {
  if (typeof value === "string" && (BRANCH_IDS as readonly string[]).includes(value)) return value as BranchId;
  throw new LiquityAgentKitError("UNKNOWN_BRANCH", `Unsupported branch: ${String(value)}. Expected one of ${BRANCH_IDS.join(", ")}.`);
}

/** Parses a non-negative decimal-integer string (or bigint) into a bigint. Rejects numbers to avoid precision loss. */
export function parseUint(value: unknown, label: string): bigint {
  if (typeof value === "bigint") {
    if (value < 0n) throw new LiquityAgentKitError("INVALID_INPUT", `${label} must be non-negative.`);
    return value;
  }
  if (typeof value === "string" && /^[0-9]+$/.test(value)) return BigInt(value);
  throw new LiquityAgentKitError("INVALID_INPUT", `${label} must be a non-negative decimal integer string.`);
}
