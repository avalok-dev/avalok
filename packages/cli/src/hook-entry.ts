// Entry point for the launcher's fast path: `avalok hook ...` loads only this bundle, not the whole
// CLI, because an agent starts a new process for every event. See hook.ts.
export { hookMain as main } from "./hook.ts";
