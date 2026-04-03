export function log(level: "info" | "warn" | "error", message: string, data?: Record<string, any>): void {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...data,
  };
  console.error(JSON.stringify(entry));
}

export function toolLog(tool: string, args: Record<string, any>, durationMs: number, success: boolean, error?: string): void {
  log(success ? "info" : "error", `tool:${tool}`, {
    tool,
    args: sanitizeArgs(args),
    durationMs,
    success,
    ...(error ? { error } : {}),
  });
}

function sanitizeArgs(args: Record<string, any>): Record<string, any> {
  const sanitized = { ...args };
  // Truncate long content fields
  for (const key of Object.keys(sanitized)) {
    if (typeof sanitized[key] === "string" && sanitized[key].length > 200) {
      sanitized[key] = sanitized[key].slice(0, 200) + "...";
    }
  }
  return sanitized;
}
