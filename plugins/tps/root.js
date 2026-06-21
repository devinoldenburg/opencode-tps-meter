export * from "./index.js";

export default {
  id: "opencode-tps-meter",
  async tui(...args) {
    const plugin = await import("../tps-meter.tsx");
    return plugin.default.tui(...args);
  },
};
