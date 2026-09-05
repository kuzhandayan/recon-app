// Split file + require() shape keeps Node-only code out of the Edge compile
export function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- required for Next's per-runtime build exclusion
    return require("./instrumentation-node").default();
  }
}
