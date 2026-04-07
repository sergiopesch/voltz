import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, readdir, stat } from "node:fs/promises";
import { resolve, relative, sep } from "node:path";

const execFileAsync = promisify(execFile);
const DEFAULT_LIMIT = 50;
const DEFAULT_MAX_BYTES = 32_000;
const DEFAULT_MAX_CHARS = 12_000;

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ToolRuntimeContext {
  dangerousTools: boolean;
  cwd: string;
  allowedTools?: string[];
}

const TOOL_CATALOG = [
  {
    name: "read_file",
    aliases: ["Read"],
    dangerous: false,
    description: "Read a UTF-8 text file from the local workspace.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Absolute or relative file path" },
        maxBytes: { type: "integer", minimum: 256, maximum: 200000 },
      },
      required: ["path"],
      additionalProperties: false,
    },
  },
  {
    name: "glob_files",
    aliases: ["Glob"],
    dangerous: false,
    description: "Find files matching a glob-style pattern in the current workspace.",
    parameters: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "Glob pattern like src/**/*.ts" },
        limit: { type: "integer", minimum: 1, maximum: 500 },
      },
      required: ["pattern"],
      additionalProperties: false,
    },
  },
  {
    name: "grep_files",
    aliases: ["Grep"],
    dangerous: false,
    description: "Search text within files in the current workspace.",
    parameters: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "Regex or plain-text pattern" },
        path: { type: "string", description: "Optional file or directory to search from" },
        limit: { type: "integer", minimum: 1, maximum: 200 },
      },
      required: ["pattern"],
      additionalProperties: false,
    },
  },
  {
    name: "fetch_url",
    aliases: ["WebFetch"],
    dangerous: false,
    description: "Fetch a URL and return a text summary of the response body.",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "HTTP or HTTPS URL" },
        maxChars: { type: "integer", minimum: 200, maximum: 30000 },
      },
      required: ["url"],
      additionalProperties: false,
    },
  },
  {
    name: "web_search",
    aliases: ["WebSearch"],
    dangerous: false,
    description: "Run a web search and return the top results with titles and links.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query" },
        limit: { type: "integer", minimum: 1, maximum: 10 },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "bash",
    aliases: ["Bash"],
    dangerous: true,
    description: "Run a shell command in the current workspace.",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string", description: "Shell command to run" },
        timeoutMs: { type: "integer", minimum: 1000, maximum: 120000 },
      },
      required: ["command"],
      additionalProperties: false,
    },
  },
] as const;

function getPermittedToolCatalog(
  dangerousTools: boolean,
  allowedTools?: string[]
): Array<(typeof TOOL_CATALOG)[number]> {
  const allowed = Array.isArray(allowedTools) && allowedTools.length > 0
    ? new Set(allowedTools)
    : null;

  return TOOL_CATALOG.filter((tool) => {
    if (tool.dangerous && !dangerousTools) {
      return false;
    }
    if (!allowed) {
      return true;
    }
    return tool.aliases.some((alias) => allowed.has(alias));
  });
}

export function getOpenAICompatibleToolDefinitions(
  dangerousTools: boolean,
  allowedTools?: string[]
): Array<{ type: "function"; function: ToolDefinition }> {
  return getPermittedToolCatalog(dangerousTools, allowedTools).map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));
}

export async function executeLocalToolCall(
  name: string,
  args: unknown,
  context: ToolRuntimeContext
): Promise<string> {
  if (!isToolAllowed(name, context)) {
    return `Tool is not allowed: ${name}`;
  }

  const parsed = normalizeArgs(args);

  switch (name) {
    case "read_file":
      return runReadFile(parsed, context);
    case "glob_files":
      return runGlobFiles(parsed, context);
    case "grep_files":
      return runGrepFiles(parsed, context);
    case "fetch_url":
      return runFetchUrl(parsed);
    case "web_search":
      return runWebSearch(parsed);
    case "bash":
      if (!context.dangerousTools) {
        return "Bash is disabled. Enable dangerousTools to allow shell execution.";
      }
      return runBash(parsed, context);
    default:
      return `Unknown tool: ${name}`;
  }
}

function normalizeArgs(args: unknown): Record<string, unknown> {
  if (typeof args === "string") {
    try {
      return JSON.parse(args) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  if (typeof args === "object" && args !== null && !Array.isArray(args)) {
    return args as Record<string, unknown>;
  }
  return {};
}

async function runReadFile(
  args: Record<string, unknown>,
  context: ToolRuntimeContext
): Promise<string> {
  const rawPath = typeof args.path === "string" ? args.path : "";
  if (!rawPath) return "Missing required argument: path";

  const targetPath = resolveWorkspacePath(context.cwd, rawPath);
  if (!targetPath) return "Path must stay within the current workspace.";

  const maxBytes = toInt(args.maxBytes, DEFAULT_MAX_BYTES, 256, 200_000);

  try {
    const fileStat = await stat(targetPath);
    if (!fileStat.isFile()) {
      return `Not a file: ${targetPath}`;
    }

    const content = await readFile(targetPath, "utf-8");
    const truncated = content.length > maxBytes;
    const text = truncated ? content.slice(0, maxBytes) : content;
    if (text.includes("\u0000")) {
      return `Binary file not shown: ${targetPath}`;
    }
    return `${targetPath}\n\n${text}${truncated ? "\n\n[truncated]" : ""}`;
  } catch (err) {
    return `Failed to read file: ${err instanceof Error ? err.message : String(err)}`;
  }
}

async function runGlobFiles(
  args: Record<string, unknown>,
  context: ToolRuntimeContext
): Promise<string> {
  const pattern = typeof args.pattern === "string" ? args.pattern : "";
  if (!pattern) return "Missing required argument: pattern";

  const limit = toInt(args.limit, DEFAULT_LIMIT, 1, 500);
  const regex = globToRegex(pattern);
  const matches: string[] = [];

  for await (const filePath of walkFiles(context.cwd)) {
    const relativePath = toPosixPath(relative(context.cwd, filePath));
    if (regex.test(relativePath)) {
      matches.push(relativePath);
      if (matches.length >= limit) break;
    }
  }

  return matches.length > 0
    ? matches.join("\n")
    : `No files matched pattern: ${pattern}`;
}

async function runGrepFiles(
  args: Record<string, unknown>,
  context: ToolRuntimeContext
): Promise<string> {
  const pattern = typeof args.pattern === "string" ? args.pattern : "";
  if (!pattern) return "Missing required argument: pattern";

  const root =
    typeof args.path === "string"
      ? resolveWorkspacePath(context.cwd, args.path)
      : context.cwd;
  if (!root) {
    return "Path must stay within the current workspace.";
  }
  const limit = toInt(args.limit, DEFAULT_LIMIT, 1, 200);
  const matcher = buildMatcher(pattern);
  const matches: string[] = [];

  for await (const filePath of walkFiles(root)) {
    let content: string;
    try {
      content = await readFile(filePath, "utf-8");
    } catch {
      continue;
    }
    if (content.includes("\u0000")) continue;

    const lines = content.split("\n");
    for (let index = 0; index < lines.length; index++) {
      if (matcher(lines[index])) {
        matches.push(`${relative(context.cwd, filePath)}:${index + 1}: ${lines[index]}`);
        if (matches.length >= limit) {
          return matches.join("\n");
        }
      }
    }
  }

  return matches.length > 0
    ? matches.join("\n")
    : `No matches found for pattern: ${pattern}`;
}

async function runFetchUrl(args: Record<string, unknown>): Promise<string> {
  const url = typeof args.url === "string" ? args.url : "";
  if (!url) return "Missing required argument: url";

  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return `Unsupported URL protocol: ${parsed.protocol}`;
    }
  } catch {
    return `Invalid URL: ${url}`;
  }

  const maxChars = toInt(args.maxChars, DEFAULT_MAX_CHARS, 200, 30_000);

  try {
    const response = await fetch(url, {
      headers: { "User-Agent": "voltz-tool-fetch/1.0" },
    });
    const body = await response.text();
    const contentType = response.headers.get("content-type") ?? "";
    const text = contentType.includes("html") ? stripHtml(body) : body;
    const truncated = text.length > maxChars;
    return [
      `URL: ${url}`,
      `Status: ${response.status}`,
      "",
      truncated ? text.slice(0, maxChars) + "\n\n[truncated]" : text,
    ].join("\n");
  } catch (err) {
    return `Failed to fetch URL: ${err instanceof Error ? err.message : String(err)}`;
  }
}

async function runWebSearch(args: Record<string, unknown>): Promise<string> {
  const query = typeof args.query === "string" ? args.query : "";
  if (!query) return "Missing required argument: query";

  const limit = toInt(args.limit, 5, 1, 10);
  const url = `https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`;

  try {
    const response = await fetch(url, {
      headers: { "User-Agent": "voltz-tool-search/1.0" },
    });
    const html = await response.text();
    const results = parseDuckDuckGoResults(html).slice(0, limit);
    if (results.length === 0) {
      return `No search results parsed for query: ${query}`;
    }
    return results
      .map((result, index) => `${index + 1}. ${result.title}\n${result.url}`)
      .join("\n\n");
  } catch (err) {
    return `Failed to run web search: ${err instanceof Error ? err.message : String(err)}`;
  }
}

async function runBash(
  args: Record<string, unknown>,
  context: ToolRuntimeContext
): Promise<string> {
  const command = typeof args.command === "string" ? args.command : "";
  if (!command) return "Missing required argument: command";

  const timeoutMs = toInt(args.timeoutMs, 15_000, 1_000, 120_000);

  try {
    const { stdout, stderr } = await execFileAsync("bash", ["-lc", command], {
      cwd: context.cwd,
      timeout: timeoutMs,
      maxBuffer: 512_000,
    });
    return formatCommandOutput(stdout, stderr);
  } catch (err) {
    if (err && typeof err === "object" && "stdout" in err && "stderr" in err) {
      const output = err as { stdout?: string; stderr?: string; message?: string };
      return `Command failed: ${output.message ?? "unknown error"}\n${formatCommandOutput(output.stdout ?? "", output.stderr ?? "")}`;
    }
    return `Failed to run bash command: ${err instanceof Error ? err.message : String(err)}`;
  }
}

async function* walkFiles(root: string): AsyncGenerator<string> {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (entry.name === ".git" || entry.name === "node_modules") continue;
    const fullPath = resolve(root, entry.name);
    if (entry.isDirectory()) {
      yield* walkFiles(fullPath);
    } else if (entry.isFile()) {
      yield fullPath;
    }
  }
}

function isToolAllowed(name: string, context: ToolRuntimeContext): boolean {
  const tool = TOOL_CATALOG.find((entry) => entry.name === name);
  if (!tool) {
    return false;
  }
  if (tool.dangerous && !context.dangerousTools) {
    return false;
  }
  if (!context.allowedTools?.length) {
    return true;
  }
  const allowed = new Set(context.allowedTools);
  return tool.aliases.some((alias) => allowed.has(alias));
}

function resolveWorkspacePath(cwd: string, inputPath: string): string | null {
  const workspaceRoot = resolve(cwd);
  const targetPath = resolve(workspaceRoot, inputPath);
  const targetRelative = relative(workspaceRoot, targetPath);

  if (
    targetRelative === "" ||
    (!targetRelative.startsWith("..") && targetRelative !== "..")
  ) {
    return targetPath;
  }

  return null;
}

function globToRegex(pattern: string): RegExp {
  let source = "^";
  for (let index = 0; index < pattern.length; index++) {
    const char = pattern[index];
    const next = pattern[index + 1];
    if (char === "*" && next === "*") {
      source += ".*";
      index++;
    } else if (char === "*") {
      source += "[^/]*";
    } else if (char === "?") {
      source += ".";
    } else if ("\\.[]{}()+-^$|".includes(char)) {
      source += `\\${char}`;
    } else if (char === sep || char === "/") {
      source += "/";
    } else {
      source += char;
    }
  }
  source += "$";
  return new RegExp(source);
}

function buildMatcher(pattern: string): (line: string) => boolean {
  try {
    const regex = new RegExp(pattern, "i");
    return (line) => regex.test(line);
  } catch {
    const lower = pattern.toLowerCase();
    return (line) => line.toLowerCase().includes(lower);
  }
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function parseDuckDuckGoResults(html: string): Array<{ title: string; url: string }> {
  const results: Array<{ title: string; url: string }> = [];
  const regex = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;

  for (const match of html.matchAll(regex)) {
    const rawUrl = decodeHtmlEntities(match[1]);
    const title = stripHtml(decodeHtmlEntities(match[2]));
    if (!title) continue;
    results.push({
      title,
      url: extractDuckDuckGoTarget(rawUrl),
    });
  }

  return results;
}

function extractDuckDuckGoTarget(rawUrl: string): string {
  try {
    const url = new URL(rawUrl, "https://duckduckgo.com");
    const target = url.searchParams.get("uddg");
    return target ? decodeURIComponent(target) : url.toString();
  } catch {
    return rawUrl;
  }
}

function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&quot;/g, "\"")
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function formatCommandOutput(stdout: string, stderr: string): string {
  const parts = [];
  if (stdout.trim()) {
    parts.push(`stdout:\n${stdout.trimEnd()}`);
  }
  if (stderr.trim()) {
    parts.push(`stderr:\n${stderr.trimEnd()}`);
  }
  return parts.length > 0 ? parts.join("\n\n") : "Command completed with no output.";
}

function toInt(
  value: unknown,
  fallback: number,
  min: number,
  max: number
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

function toPosixPath(path: string): string {
  return path.split(sep).join("/");
}
