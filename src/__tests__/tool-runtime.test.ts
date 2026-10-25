import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, writeFileSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  executeLocalToolCall,
  getOpenAICompatibleToolDefinitions,
} from "../agent/tool-runtime.js";

const TEST_DIR = join(tmpdir(), `voltz-tool-runtime-${Date.now()}`);
const OUTSIDE_FILE = join(
  tmpdir(),
  `voltz-tool-runtime-secret-${Date.now()}.txt`,
);

describe("tool runtime", () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
    mkdirSync(join(TEST_DIR, "docs"), { recursive: true });
    writeFileSync(
      join(TEST_DIR, "docs", "notes.txt"),
      "hello from workspace\n",
    );
    writeFileSync(OUTSIDE_FILE, "outside workspace\n");
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
    rmSync(OUTSIDE_FILE, { force: true });
  });

  it("filters tool definitions to the allowed subset", () => {
    const tools = getOpenAICompatibleToolDefinitions(false, [
      "Read",
      "WebSearch",
    ]);
    expect(tools.map((tool) => tool.function.name)).toEqual([
      "read_file",
      "web_search",
    ]);
  });

  it("only exposes bash when both allowed and enabled", () => {
    expect(
      getOpenAICompatibleToolDefinitions(false, ["Bash"]).map(
        (tool) => tool.function.name,
      ),
    ).toEqual([]);

    expect(
      getOpenAICompatibleToolDefinitions(true, ["Bash"]).map(
        (tool) => tool.function.name,
      ),
    ).toEqual(["bash"]);
  });

  it("blocks tool calls outside the allowed subset", async () => {
    const result = await executeLocalToolCall(
      "read_file",
      { path: "docs/notes.txt" },
      {
        cwd: TEST_DIR,
        dangerousTools: false,
        allowedTools: ["WebSearch"],
      },
    );

    expect(result).toBe("Tool is not allowed: read_file");
  });

  it("keeps file reads inside the workspace", async () => {
    const result = await executeLocalToolCall(
      "read_file",
      { path: OUTSIDE_FILE },
      {
        cwd: TEST_DIR,
        dangerousTools: false,
        allowedTools: ["Read"],
      },
    );

    expect(result).toBe("Path must stay within the current workspace.");
  });

  it("blocks file symlinks outside the workspace", async () => {
    symlinkSync(OUTSIDE_FILE, join(TEST_DIR, "outside.txt"));
    const result = await executeLocalToolCall(
      "read_file",
      { path: "outside.txt" },
      {
        cwd: TEST_DIR,
        dangerousTools: false,
      },
    );
    expect(result).toBe("Path must stay within the current workspace.");
  });

  it("blocks grep roots that link outside the workspace", async () => {
    symlinkSync(tmpdir(), join(TEST_DIR, "outside"), "dir");
    const result = await executeLocalToolCall(
      "grep_files",
      {
        path: "outside",
        pattern: "outside workspace",
      },
      { cwd: TEST_DIR, dangerousTools: false },
    );
    expect(result).toBe("Path must stay within the current workspace.");
  });

  it("allows internal symlinks and a symlinked workspace", async () => {
    symlinkSync(join(TEST_DIR, "docs"), join(TEST_DIR, "linked-docs"), "dir");
    symlinkSync(TEST_DIR, join(TEST_DIR, "workspace-link"), "dir");
    const result = await executeLocalToolCall(
      "read_file",
      { path: "linked-docs/notes.txt" },
      {
        cwd: join(TEST_DIR, "workspace-link"),
        dangerousTools: false,
      },
    );
    expect(result).toContain("hello from workspace");
  });

  it("allows names beginning with two dots inside the workspace", async () => {
    writeFileSync(join(TEST_DIR, "..notes"), "ordinary workspace file");
    const result = await executeLocalToolCall(
      "read_file",
      { path: "..notes" },
      {
        cwd: TEST_DIR,
        dangerousTools: false,
      },
    );
    expect(result).toContain("ordinary workspace file");
  });

  it("rejects lexical traversal and handles missing files", async () => {
    const context = { cwd: TEST_DIR, dangerousTools: false };
    expect(
      await executeLocalToolCall(
        "read_file",
        { path: "../outside.txt" },
        context,
      ),
    ).toBe("Path must stay within the current workspace.");
    expect(
      await executeLocalToolCall("read_file", { path: "missing.txt" }, context),
    ).toBe("Path must stay within the current workspace.");
  });

  it("reads files inside the workspace", async () => {
    const result = await executeLocalToolCall(
      "read_file",
      { path: "docs/notes.txt" },
      {
        cwd: TEST_DIR,
        dangerousTools: false,
        allowedTools: ["Read"],
      },
    );

    expect(result).toContain("hello from workspace");
  });
});
