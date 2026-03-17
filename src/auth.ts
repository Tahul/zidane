/**
 * Claude Code OAuth token setup.
 *
 * Runs the Anthropic OAuth flow to get a Claude Pro/Max token,
 * then saves it to .env for use with the Anthropic API.
 *
 * Usage: bun run auth
 */

import { loginAnthropic, anthropicOAuthProvider } from "@mariozechner/pi-ai/utils/oauth";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const ENV_FILE = resolve(import.meta.dir, "../.env");
const CREDENTIALS_FILE = resolve(import.meta.dir, "../.credentials.json");

async function main() {
  console.log("🔑 Claude Code OAuth Login\n");

  // Check for existing credentials
  if (existsSync(CREDENTIALS_FILE)) {
    const existing = JSON.parse(readFileSync(CREDENTIALS_FILE, "utf-8"));
    if (existing.anthropic?.access) {
      console.log("Found existing credentials. Refreshing token...");
      try {
        const refreshed = await anthropicOAuthProvider.refreshToken(existing.anthropic);
        saveCredentials(refreshed);
        console.log("\n✅ Token refreshed successfully!");
        return;
      } catch (e) {
        console.log("Refresh failed, starting new login flow...\n");
      }
    }
  }

  // Run OAuth login flow
  const credentials = await loginAnthropic({
    onAuth: (info) => {
      console.log(`\n🌐 Open this URL in your browser:\n\n  ${info.url}\n`);
      if (info.instructions) {
        console.log(`  ${info.instructions}\n`);
      }
    },
    onPrompt: async (prompt) => {
      process.stdout.write(`${prompt.message} `);
      const reader = Bun.stdin.stream().getReader();
      const { value } = await reader.read();
      reader.releaseLock();
      return new TextDecoder().decode(value).trim();
    },
    onProgress: (message) => {
      console.log(`  ${message}`);
    },
  });

  saveCredentials(credentials);
  console.log("\n✅ Authentication successful!");
}

function saveCredentials(credentials: { access: string; refresh: string; expires: number }) {
  // Save full credentials for refresh
  const allCredentials = existsSync(CREDENTIALS_FILE)
    ? JSON.parse(readFileSync(CREDENTIALS_FILE, "utf-8"))
    : {};
  allCredentials.anthropic = credentials;
  writeFileSync(CREDENTIALS_FILE, JSON.stringify(allCredentials, null, 2));

  // Save/update .env with the API key
  const apiKey = credentials.access;
  let envContent = existsSync(ENV_FILE) ? readFileSync(ENV_FILE, "utf-8") : "";

  if (envContent.includes("ANTHROPIC_API_KEY=")) {
    envContent = envContent.replace(/ANTHROPIC_API_KEY=.*/g, `ANTHROPIC_API_KEY=${apiKey}`);
  } else {
    envContent += `${envContent && !envContent.endsWith("\n") ? "\n" : ""}ANTHROPIC_API_KEY=${apiKey}\n`;
  }

  writeFileSync(ENV_FILE, envContent);

  console.log(`  Token saved to .env (ANTHROPIC_API_KEY)`);
  console.log(`  Credentials saved to .credentials.json (for token refresh)`);
  console.log(`  Token expires: ${new Date(credentials.expires).toLocaleString()}`);
}

main().catch((err) => {
  console.error("❌ Error:", err.message);
  process.exit(1);
});
