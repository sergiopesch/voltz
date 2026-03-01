#!/usr/bin/env node

import { Command } from "commander";
import { voiceCommand } from "./commands/voice.js";
import { chatCommand } from "./commands/chat.js";
import { lookCommand } from "./commands/look.js";
import { setupCommand } from "./commands/setup.js";
import { isSilentError } from "./errors.js";
import { logger, setLevel } from "./logger.js";
import { loadConfig } from "./config.js";

// Apply log level from config
const config = loadConfig();
if (config?.logLevel) {
  setLevel(config.logLevel);
}

const program = new Command();

program
  .name("voltz")
  .description("Voice-first AI companion for electronics enthusiasts")
  .version("0.1.0")
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
