import type { DuskError } from "./duskError.js";
import type { Result } from "./load.js";

/**
 * Runtime fallible functions return a `Result` (the Phase-1 `{ success }` shape);
 * the MCP boundary (§mcp-read-surface) translates it into the success shape or a
 * typed `DuskError`. `RuntimeResult<T>` defaults the error channel to `DuskError`.
 */
export type RuntimeResult<T> = Result<T, DuskError>;

export const ok = <T>(value: T): { success: true; value: T } => ({ success: true, value });
export const err = <E>(error: E): { success: false; error: E } => ({ success: false, error });

export const isOk = <T, E>(result: Result<T, E>): result is { success: true; value: T } => result.success;
export const isErr = <T, E>(result: Result<T, E>): result is { success: false; error: E } => !result.success;
