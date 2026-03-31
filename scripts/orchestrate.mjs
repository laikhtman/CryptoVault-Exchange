#!/usr/bin/env node
/**
 * CryptoVault-Exchange — Programmatic Multi-Agent Orchestrator
 *
 * Chains multiple Claude Code agents in sequence using the claude CLI.
 * Each agent's output is passed as context to the next.
 *
 * Usage:
 *   node scripts/orchestrate.mjs feature "Add CSV export"
 *   node scripts/orchestrate.mjs audit
 *   node scripts/orchestrate.mjs qa-check "WalletsView sync changes"
 *   node scripts/orchestrate.mjs full-review
 *
 * Requires claude CLI: https://claude.ai/code
 */

import { execSync, spawnSync } from "child_process";
import { writeFileSync, readFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { createInterface } from "readline";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const TMP = join(__dirname, ".tmp");

if (!existsSync(TMP)) mkdirSync(TMP, { recursive: true });

// ──────────────────────────────────────────────────────────────────────────────
// Utilities
// ──────────────────────────────────────────────────────────────────────────────

const colors = {
  reset: "\x1b[0m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  red: "\x1b[31m",
  bold: "\x1b[1m",
};

const log = (msg) => console.log(`${colors.cyan}[orchestrate]${colors.reset} ${msg}`);
const step = (n, total, msg) => console.log(`\n${colors.blue}${colors.bold}─── Step ${n}/${total}: ${msg} ───${colors.reset}`);
const ok = (msg) => console.log(`${colors.green}✓${colors.reset} ${msg}`);
const warn = (msg) => console.log(`${colors.yellow}⚠${colors.reset}  ${msg}`);
const err = (msg) => { console.error(`${colors.red}✗${colors.reset}  ${msg}`); process.exit(1); };

function prompt(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(`${colors.yellow}${question}${colors.reset} `, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

/**
 * Run a claude CLI command with a specific agent and prompt.
 * Returns the agent's text output.
 */
function runAgent(agentName, prompt, { printOutput = true } = {}) {
  log(`Running agent: ${colors.bold}${agentName}${colors.reset}`);

  const result = spawnSync(
    "claude",
    [
      "--agent", agentName,
      "--print",
      "--output-format", "text",
      prompt,
    ],
    {
      cwd: ROOT,
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024, // 10MB
      timeout: 300_000, // 5 min per agent
    }
  );

  if (result.error) {
    warn(`Agent ${agentName} failed: ${result.error.message}`);
    return "";
  }

  const output = result.stdout || "";
  if (printOutput && output) {
    console.log(output);
  }

  // Save output to tmp file for chaining
  const tmpFile = join(TMP, `${agentName}-output.md`);
  writeFileSync(tmpFile, output, "utf8");

  return output;
}

function loadAgentOutput(agentName) {
  const tmpFile = join(TMP, `${agentName}-output.md`);
  if (existsSync(tmpFile)) return readFileSync(tmpFile, "utf8");
  return "";
}

function getGitDiff() {
  try {
    return execSync("git diff HEAD~1 HEAD --stat", { cwd: ROOT, encoding: "utf8" });
  } catch {
    return "No git history available.";
  }
}

function getChangedFiles() {
  try {
    return execSync("git diff HEAD~1 HEAD --name-only", { cwd: ROOT, encoding: "utf8" })
      .split("\n")
      .filter(Boolean);
  } catch {
    return [];
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Workflows
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Full feature development pipeline:
 * PM → Frontend/Backend → Blockchain Expert → Trezor Expert → QA → Docs
 */
async function workflowFeature(task) {
  if (!task) err("Provide a feature description.");

  log(`Starting FEATURE pipeline: "${task}"`);
  const TOTAL = 6;

  // 1. Product Manager
  step(1, TOTAL, "Product Manager — define requirements");
  const pmOutput = runAgent(
    "product-manager",
    `Break down this feature into tasks with acceptance criteria using your standard template:\n\n${task}`
  );

  const proceed = await prompt("Continue to implementation? [y/N]");
  if (proceed.toLowerCase() !== "y") { warn("Aborted."); return; }

  // 2. Implementation (ask which agent)
  step(2, TOTAL, "Implementation");
  const implChoice = await prompt(
    "Which implementation?\n  1) frontend-blockchain\n  2) backend-blockchain\n  3) both\nChoice [1/2/3]:"
  );

  const implContext = `Feature: ${task}\n\nPM Requirements:\n${pmOutput}`;

  if (implChoice === "1" || implChoice === "3") {
    runAgent(
      "frontend-blockchain",
      `Implement the frontend parts of this feature.\n\n${implContext}`
    );
  }
  if (implChoice === "2" || implChoice === "3") {
    runAgent(
      "backend-blockchain",
      `Implement the backend/data layer parts of this feature.\n\n${implContext}`
    );
  }

  // 3. Blockchain expert review (conditional)
  step(3, TOTAL, "Blockchain Expert — review crypto logic");
  const hasCrypto = await prompt("Does this touch crypto.ts / derivation / token balances? [y/N]");
  if (hasCrypto.toLowerCase() === "y") {
    runAgent(
      "blockchain-expert",
      `Review all changes made for this feature: "${task}". Verify derivation paths, key handling, token decimals, and Etherscan API usage. Flag any CRITICAL, HIGH, MEDIUM, LOW issues.`
    );
  } else {
    ok("Skipping blockchain review.");
  }

  // 4. Trezor expert review (conditional)
  step(4, TOTAL, "Trezor Expert — review hardware wallet integration");
  const hasTrezor = await prompt("Does this touch Trezor Connect / xpub / AdminPanel? [y/N]");
  if (hasTrezor.toLowerCase() === "y") {
    runAgent(
      "trezor-expert",
      `Review the Trezor integration changes for: "${task}". Verify paths, manifest config, error handling, and that derived addresses will match Trezor Suite.`
    );
  } else {
    ok("Skipping Trezor review.");
  }

  // 5. QA test plan
  step(5, TOTAL, "QA — test plan");
  runAgent(
    "qa",
    `Create a complete test plan for this feature:\n\n${task}\n\nPM Requirements:\n${pmOutput}\n\nInclude: happy path, error cases, edge cases (index 0, index 400+, invalid xpub), and a regression checklist.`
  );
  ok(`QA test plan saved to scripts/.tmp/qa-output.md`);

  // 6. Documentation
  step(6, TOTAL, "Documentation — update README and comments");
  const doDocs = await prompt("Update documentation now? [y/N]");
  if (doDocs.toLowerCase() === "y") {
    runAgent(
      "documentation",
      `Update README.md, .env.example, inline comments, and user-facing text for this completed feature: "${task}".`
    );
  } else {
    ok("Skipping documentation (run manually: node scripts/orchestrate.mjs docs).");
  }

  ok(`\nFeature pipeline complete! Summary saved in scripts/.tmp/`);
}

/**
 * Bug fix pipeline: QA → Specialist → QA verify
 */
async function workflowBugfix(task) {
  if (!task) err("Provide a bug description.");

  log(`Starting BUG FIX pipeline: "${task}"`);

  // 1. QA analysis
  step(1, 3, "QA — analyze and reproduce");
  const qaOutput = runAgent(
    "qa",
    `Analyze this bug report. State the expected vs actual behavior, the files most likely involved, and the test cases that would catch this:\n\n${task}`
  );

  // 2. Specialist fix
  step(2, 3, "Specialist — fix");
  const specialistChoice = await prompt(
    "Which specialist should fix this?\n  1) blockchain-expert\n  2) trezor-expert\n  3) frontend-blockchain\n  4) backend-blockchain\nChoice [1-4]:"
  );

  const agentMap = {
    "1": "blockchain-expert",
    "2": "trezor-expert",
    "3": "frontend-blockchain",
    "4": "backend-blockchain",
  };
  const fixAgent = agentMap[specialistChoice];
  if (!fixAgent) err("Invalid choice.");

  runAgent(
    fixAgent,
    `Fix this bug:\n\n${task}\n\nQA Analysis:\n${qaOutput}`
  );

  // 3. QA verification
  step(3, 3, "QA — verify fix");
  const fixOutput = loadAgentOutput(fixAgent);
  runAgent(
    "qa",
    `Verify the fix for this bug:\n\n${task}\n\nThe fix applied was:\n${fixOutput}\n\nConfirm the bug is resolved and check for regressions.`
  );

  ok("Bug fix pipeline complete.");
}

/**
 * Security audit: Blockchain Expert + Trezor Expert
 */
async function workflowAudit(scope = "full codebase") {
  log(`Starting SECURITY AUDIT: "${scope}"`);

  step(1, 2, "Blockchain Expert — cryptographic review");
  runAgent(
    "blockchain-expert",
    `Perform a security audit of: ${scope}\n\nFocus on:\n- Key handling and storage\n- Derivation path correctness vs BIP standards\n- API key exposure\n- BigInt conversion safety\n- Rate limit compliance\n- Any scenario where wrong addresses could be generated`
  );

  step(2, 2, "Trezor Expert — hardware wallet flow review");
  const blockchainOutput = loadAgentOutput("blockchain-expert");
  runAgent(
    "trezor-expert",
    `Audit the Trezor integration in: ${scope}\n\nBlockchain expert already noted:\n${blockchainOutput}\n\nFocus on: correct paths, no private key exposure, init lifecycle, error handling, address match against Trezor Suite.`
  );

  ok("Security audit complete.");
}

/**
 * Pre-commit full review: Frontend + Backend + QA
 */
async function workflowFullReview() {
  const changedFiles = getChangedFiles();
  const diff = getGitDiff();

  log("Starting FULL REVIEW pipeline");
  log(`Changed files: ${changedFiles.join(", ") || "none"}`);

  const context = `Changed files:\n${changedFiles.join("\n")}\n\nDiff summary:\n${diff}`;

  step(1, 3, "Frontend review");
  runAgent(
    "frontend-blockchain",
    `Review the following changes for frontend quality, blockchain UX standards, and correctness:\n\n${context}`
  );

  step(2, 3, "Backend/integration review");
  runAgent(
    "backend-blockchain",
    `Review the following changes for API integration quality, rate limiting, and data layer correctness:\n\n${context}`
  );

  // If crypto files changed, add blockchain review
  const cryptoChanged = changedFiles.some(
    (f) => f.includes("crypto") || f.includes("Admin") || f.includes("Wallet")
  );
  if (cryptoChanged) {
    step(3, 3, "Blockchain/Trezor expert review (crypto files changed)");
    runAgent(
      "blockchain-expert",
      `Review crypto-related changes:\n\n${context}\n\nFocus on derivation paths, key handling, token decimals.`
    );
  } else {
    ok("No crypto files changed — skipping blockchain review.");
  }

  ok("Full review complete.");
}

/**
 * Standalone QA check for a specific change
 */
async function workflowQaCheck(scope) {
  log(`Starting QA CHECK: "${scope || "recent changes"}"`);

  const changedFiles = getChangedFiles();
  const context = scope || `Recent changes to: ${changedFiles.join(", ")}`;

  runAgent(
    "qa",
    `Run QA analysis for: ${context}\n\nProvide:\n1. Test scenarios that must pass\n2. Edge cases specific to HD wallet derivation\n3. Any regression risks\n4. Manual verification steps for wallet address correctness`
  );

  ok("QA check complete.");
}

/**
 * Documentation update
 */
async function workflowDocs(scope) {
  log(`Starting DOCUMENTATION update: "${scope || "all recent changes"}"`);

  runAgent(
    "documentation",
    `Update all documentation for: ${scope || "recent changes"}. Check README.md, .env.example, inline JSDoc in crypto.ts and models.ts, and user-facing error/help text in components.`
  );

  ok("Documentation update complete.");
}

// ──────────────────────────────────────────────────────────────────────────────
// Help
// ──────────────────────────────────────────────────────────────────────────────

function showHelp() {
  console.log(`
${colors.cyan}${colors.bold}CryptoVault Multi-Agent Orchestrator${colors.reset}

Usage:
  node scripts/orchestrate.mjs <command> [description]

Commands:
  ${colors.green}feature${colors.reset}  <desc>    Full feature pipeline
                        PM → Implementation → Expert review → QA → Docs

  ${colors.green}bugfix${colors.reset}   <desc>    Bug fix pipeline
                        QA analysis → Specialist fix → QA verify

  ${colors.green}audit${colors.reset}    [scope]   Security audit
                        Blockchain Expert + Trezor Expert

  ${colors.green}full-review${colors.reset}         Pre-commit review
                        Frontend + Backend + Blockchain (if needed)

  ${colors.green}qa-check${colors.reset} [scope]   QA analysis of changes
  ${colors.green}docs${colors.reset}     [scope]   Update documentation

Examples:
  node scripts/orchestrate.mjs feature "Add CSV export for wallet balances"
  node scripts/orchestrate.mjs bugfix "Index 0 address doesn't match Trezor Suite"
  node scripts/orchestrate.mjs audit "crypto.ts and AdminPanel.tsx"
  node scripts/orchestrate.mjs full-review
  node scripts/orchestrate.mjs qa-check "WalletsView sync changes"

Agents used:
  blockchain-expert   — HD wallet crypto, BIP standards, Etherscan API
  trezor-expert       — @trezor/connect-web, xpub paths, device flow
  product-manager     — Feature breakdown, acceptance criteria
  frontend-blockchain — React/TypeScript/Tailwind, wallet UX
  backend-blockchain  — API integration, rate limiting, localStorage
  qa                  — Test plans, regression, address correctness
  documentation       — README, .env.example, code comments
`);
}

// ──────────────────────────────────────────────────────────────────────────────
// Dispatch
// ──────────────────────────────────────────────────────────────────────────────

const [,, command, ...rest] = process.argv;
const taskArg = rest.join(" ");

switch (command) {
  case "feature":     await workflowFeature(taskArg); break;
  case "bugfix":      await workflowBugfix(taskArg); break;
  case "audit":       await workflowAudit(taskArg); break;
  case "full-review": await workflowFullReview(); break;
  case "qa-check":    await workflowQaCheck(taskArg); break;
  case "docs":        await workflowDocs(taskArg); break;
  case "help":
  case "--help":
  case undefined:     showHelp(); break;
  default: err(`Unknown command: ${command}. Run node scripts/orchestrate.mjs help`);
}
