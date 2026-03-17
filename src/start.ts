/**
 * Minimal agent loop using Claude via OAuth token.
 *
 * Usage: bun start --prompt "your message here"
 */

import Anthropic from "@anthropic-ai/sdk";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

const CREDENTIALS_FILE = resolve(import.meta.dir, "../.credentials.json");

function getApiKey(): string {
  // Try .credentials.json first (OAuth token)
  if (existsSync(CREDENTIALS_FILE)) {
    const creds = JSON.parse(readFileSync(CREDENTIALS_FILE, "utf-8"));
    if (creds.anthropic?.access) return creds.anthropic.access;
  }

  // Fall back to env
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY;

  throw new Error("No API key found. Run `bun run auth` first.");
}

async function main() {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      prompt: { type: "string", short: "p" },
      model: { type: "string", short: "m", default: "claude-sonnet-4-20250514" },
    },
    strict: false,
  });

  const prompt = values.prompt;
  if (!prompt) {
    console.error("Usage: bun start --prompt \"your message\"");
    process.exit(1);
  }

  const apiKey = getApiKey();
  const isOAuth = apiKey.includes("sk-ant-oat");

  const client = new Anthropic(
    isOAuth
      ? {
          apiKey: undefined as any,
          authToken: apiKey,
          defaultHeaders: {
            "anthropic-beta": "claude-code-20250219,oauth-2025-04-20",
            "user-agent": "zidane/2.0.0",
            "x-app": "cli",
          },
        }
      : { apiKey }
  );

  const model = values.model!;
  console.log(`🤖 Model: ${model}`);
  console.log(`📝 Prompt: ${prompt}\n`);

  const messages: Anthropic.MessageParam[] = [{ role: "user", content: prompt }];

  const response = await client.messages.create({
    model,
    max_tokens: 4096,
    system: isOAuth
      ? "You are Claude Code, Anthropic's official CLI for Claude."
      : "You are a helpful assistant.",
    messages,
  });

  for (const block of response.content) {
    if (block.type === "text") {
      console.log(block.text);
    }
  }

  console.log(`\n---`);
  console.log(
    `Tokens: ${response.usage.input_tokens} in / ${response.usage.output_tokens} out | Stop: ${response.stop_reason}`
  );
}

main().catch((err) => {
  console.error("❌ Error:", err.message);
  process.exit(1);
});
