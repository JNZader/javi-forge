import { describe, expect, it, vi } from "vitest";
vi.mock("ink", () => ({ render: vi.fn() }));
import { render } from "ink";
import { handleInitDefault } from "./simple-renderers.js";
describe("handleInitDefault", () => {
 it("refuses Darwin without rendering Ink", () => {
  const original = process.platform; Object.defineProperty(process, "platform", { value: "darwin", configurable: true });
  const oldExitCode = process.exitCode; const error = vi.spyOn(console, "error").mockImplementation(() => {});
  try { handleInitDefault({ flags: {}, input: [] } as never, { isCI: false } as never); expect(render).not.toHaveBeenCalled(); expect(process.exitCode).toBe(1); expect(error).toHaveBeenCalled(); } finally { Object.defineProperty(process, "platform", { value: original, configurable: true }); process.exitCode=oldExitCode; error.mockRestore(); }
 });
});
