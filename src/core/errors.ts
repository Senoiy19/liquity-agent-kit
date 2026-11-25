export type LiquityAgentKitErrorCode =
  | "INVALID_RPC_URL" | "UNSUPPORTED_CHAIN" | "UNKNOWN_BRANCH" | "RPC_READ_FAILED"
  | "TROVE_NOT_FOUND" | "INVALID_INPUT" | "UNSUPPORTED_CAPABILITY" | "UNKNOWN_TOOL" | "INTERNAL_ERROR";

export class LiquityAgentKitError extends Error {
  readonly code: LiquityAgentKitErrorCode;
  readonly causeValue?: unknown;
  constructor(code: LiquityAgentKitErrorCode, message: string, causeValue?: unknown) {
    super(message); this.name = "LiquityAgentKitError"; this.code = code; this.causeValue = causeValue;
  }
}
