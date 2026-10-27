import { debugLog } from "./debug";

export const REMOTE_CALL_TIMEOUT_MS = 10_000;

// DEBUG-gated (like debugLog) trace of every server call to a remote
// service -- Google Vision, R2, ArcGIS, Resend, Firebase Admin link
// generation, etc. Logs both the outgoing call and its outcome (with
// duration). Also enforces a timeout: past `timeoutMs` the caller gets a
// rejection instead of hanging on a slow upstream. This only stops *waiting*;
// callers that can truly cancel (fetch) should also pass
// AbortSignal.timeout(REMOTE_CALL_TIMEOUT_MS) so the request is torn down.
// Actual error handling/reporting stays with each call site's own catch block.
export async function logRemoteCall<T>(
  service: string,
  operation: string,
  fn: () => Promise<T>,
  timeoutMs: number = REMOTE_CALL_TIMEOUT_MS,
): Promise<T> {
  debugLog(`[remote] ${service} ${operation} ->`);
  const start = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`Remote call ${service} ${operation} timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
  });
  try {
    const result = await Promise.race([fn(), timeout]);
    debugLog(`[remote] ${service} ${operation} ok ${Date.now() - start}ms`);
    return result;
  } catch (error) {
    debugLog(`[remote] ${service} ${operation} failed ${Date.now() - start}ms:`, error);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
