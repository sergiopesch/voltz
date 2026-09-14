import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

test("CLI starts and prints help without requiring credentials", () => {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const output = execFileSync(process.execPath, ["--import", "tsx", "src/index.ts", "--help"], {
    cwd: root,
    encoding: "utf8",
    timeout: 10000,
    env: { ...process.env, CI: "1" },
  });
  expect(output).toContain("Usage: voltz");
  expect(output).toContain("doctor");
});
