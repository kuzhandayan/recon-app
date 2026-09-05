// Split file + require() shape keeps Node-only code out of the Edge compile, see LEARNING.md
export function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- require() shape is required for Next's per-runtime build exclusion, see LEARNING.md
    return require("./instrumentation-node").default();
  }
}
