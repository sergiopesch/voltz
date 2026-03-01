#!/usr/bin/env node

import { Command } from "commander";
import { createRequire } from "node:module";
import _sun from "simple-update-notifier";
import { voiceCommand } from "./commands/voice.js";
import { chatCommand } from "./commands/chat.js";
import { lookCommand } from "./commands/look.js";
import { setupCommand } from "./commands/setup.js";
import { doctorCommand } from "./commands/doctor.js";
import { completionsCommand } from "./commands/completions.js";
import { isSilentError } from "./errors.js";
import { logger, setLevel } from "./logger.js";
import { loadConfig } from "./config.js";

// CJS default export interop for simple-update-notifier
const simpleUpdateNotifier = (_sun as unknown as { default: (args: { pkg: { name: string; version: string }; distTag?: string }) => Promise<void> }).default;

// Apply log level from config
const config = loadConfig();
if (config?.logLevel) {
  setLevel(config.logLevel);
}

// Check for updates (throttled internally to once per day)
const require = createRequire(import.meta.url);
const pkg = require("../package.json") as { name: string; version: string };
simpleUpdateNotifier({ pkg, distTag: "latest" }).catch(() => {});

const program = new Command();

program
  .name("voltz")
  .description("Voice-first AI companion for electronics enthusiasts")
  .version("0.1.0")
  .option("--verbose", "Enable debug logging")
  .option("--quiet", "Suppress non-error output")
  .hook("preAction", (thisCommand) => {
    const opts = thisCommand.optsWithGlobals();
    if (opts.verbose) {
      setLevel("debug");
    } else if (opts.quiet) {
      setLevel("error");
    }
  })
  .action(async () => {
    await voiceCommand();
  });

program
  .command("chat")
  .description("Text-only chat mode")
  .action(async () => {
    await chatCommand();
  });

program
  .command("look [description]")
  .description("Capture webcam frame and analyze with vision")
  .action(async (description?: string) => {
    await lookCommand(description);
  });

program
  .command("setup")
  .description("Configure API key, test microphone and speaker")
  .action(async () => {
    await setupCommand();
  });

program
  .command("doctor")
  .description("Run diagnostic checks on your Voltz installation")
  .action(async () => {
    await doctorCommand();
  });

program
  .command("completions [shell]")
  .description("Output shell completion script (bash, zsh, fish)")
  .action((shell?: string) => {
    completionsCommand(shell);
  });

// SilentError-aware error handling:
// Commands that already printed a user-friendly message throw SilentError.
// We catch it and exit cleanly without duplicate output.
program.parseAsync().catch((err: unknown) => {
  if (isSilentError(err)) {
    logger.flush();
    process.exit(1);
  }
  // Unexpected error — print it
  console.error(err instanceof Error ? err.message : String(err));
  logger.error("cli", "unexpected-error", {
    error: err instanceof Error ? err.message : String(err),
  });
  logger.flush();
  process.exit(1);
});
