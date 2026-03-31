#!/usr/bin/env bash
# =============================================================================
# CryptoVault-Exchange — Multi-Agent Workflow Orchestrator
# =============================================================================
# Usage:
#   ./scripts/workflow.sh feature "Add CSV export for wallet balances"
#   ./scripts/workflow.sh bugfix  "Wallet index 0 shows wrong address"
#   ./scripts/workflow.sh audit   "Full security review of crypto.ts"
#   ./scripts/workflow.sh review  "Review the latest changes before commit"
#   ./scripts/workflow.sh docs    "Update README after Trezor integration changes"
# =============================================================================

set -euo pipefail

WORKFLOW="${1:-help}"
TASK="${2:-}"
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

log()  { echo -e "${CYAN}[workflow]${NC} $*"; }
step() { echo -e "\n${BLUE}━━━ STEP: $* ━━━${NC}"; }
ok()   { echo -e "${GREEN}✓${NC} $*"; }
warn() { echo -e "${YELLOW}⚠${NC}  $*"; }
err()  { echo -e "${RED}✗${NC}  $*"; exit 1; }

# Check claude CLI is available
if ! command -v claude &>/dev/null; then
  err "Claude Code CLI not found. Install it first: https://claude.ai/code"
fi

# =============================================================================
# WORKFLOWS
# =============================================================================

workflow_feature() {
  local task="$1"
  [[ -z "$task" ]] && err "Provide a feature description: ./scripts/workflow.sh feature \"Add CSV export\""

  log "Starting FEATURE workflow: $task"

  # Step 1: Product Manager breaks down the feature
  step "1/5 — Product Manager: define requirements"
  claude \
    --agent product-manager \
    --print "Break down this feature request into tasks with acceptance criteria:\n\n$task\n\nOutput the task list using the standard template from your instructions." \
    --output-format text \
    > "$PROJECT_ROOT/scripts/.last-pm-output.md"
  ok "PM output saved to scripts/.last-pm-output.md"
  cat "$PROJECT_ROOT/scripts/.last-pm-output.md"

  echo ""
  read -rp "$(echo -e "${YELLOW}Continue to implementation? [y/N]${NC} ")" confirm
  [[ "$confirm" != "y" && "$confirm" != "Y" ]] && { warn "Aborted."; exit 0; }

  # Step 2: Parallel implementation (user picks interactively)
  step "2/5 — Implementation"
  echo "Choose implementation mode:"
  echo "  1) frontend-blockchain (UI / React components)"
  echo "  2) backend-blockchain  (API / data layer)"
  echo "  3) both (run sequentially)"
  read -rp "$(echo -e "${YELLOW}Choice [1/2/3]:${NC} ")" impl_choice

  case "$impl_choice" in
    1)
      claude --agent frontend-blockchain \
        "Implement this feature:\n\n$task\n\nContext from PM:\n$(cat "$PROJECT_ROOT/scripts/.last-pm-output.md")"
      ;;
    2)
      claude --agent backend-blockchain \
        "Implement this feature:\n\n$task\n\nContext from PM:\n$(cat "$PROJECT_ROOT/scripts/.last-pm-output.md")"
      ;;
    3)
      claude --agent frontend-blockchain \
        "Implement the frontend parts of this feature:\n\n$task\n\nContext from PM:\n$(cat "$PROJECT_ROOT/scripts/.last-pm-output.md")"
      claude --agent backend-blockchain \
        "Implement the backend/data parts of this feature:\n\n$task\n\nContext from PM:\n$(cat "$PROJECT_ROOT/scripts/.last-pm-output.md")"
      ;;
    *)
      warn "Invalid choice, skipping implementation step."
      ;;
  esac

  # Step 3: Blockchain expert review (if crypto-related)
  step "3/5 — Blockchain Expert: review crypto logic"
  read -rp "$(echo -e "${YELLOW}Does this feature touch crypto.ts / derivation / token balances? [y/N]${NC} ")" crypto_change
  if [[ "$crypto_change" == "y" || "$crypto_change" == "Y" ]]; then
    claude --agent blockchain-expert \
      "Review all recent changes to crypto.ts and any derivation-related code for this feature: $task. Check correctness of paths, key handling, token decimals, and API usage."
  else
    ok "Skipping blockchain review (no crypto changes)."
  fi

  # Step 4: Trezor expert review (if HW wallet related)
  read -rp "$(echo -e "${YELLOW}Does this feature touch Trezor Connect / xpub import / AdminPanel? [y/N]${NC} ")" trezor_change
  if [[ "$trezor_change" == "y" || "$trezor_change" == "Y" ]]; then
    claude --agent trezor-expert \
      "Review the Trezor integration changes for this feature: $task. Verify paths, manifest, error handling, and that addresses will match Trezor Suite."
  fi

  # Step 5: QA test plan
  step "4/5 — QA: test plan"
  claude --agent qa \
    "Create a test plan for this feature:\n\n$task\n\nInclude: happy path, error cases, edge cases (indices 0 and 400+), and a regression checklist." \
    --print \
    --output-format text \
    > "$PROJECT_ROOT/scripts/.last-qa-output.md"
  ok "QA test plan saved to scripts/.last-qa-output.md"
  cat "$PROJECT_ROOT/scripts/.last-qa-output.md"

  # Step 6: Documentation
  step "5/5 — Documentation update"
  read -rp "$(echo -e "${YELLOW}Update documentation now? [y/N]${NC} ")" do_docs
  if [[ "$do_docs" == "y" || "$do_docs" == "Y" ]]; then
    claude --agent documentation \
      "Update README.md, .env.example, and any inline comments for this completed feature: $task"
  fi

  ok "Feature workflow complete."
}

workflow_bugfix() {
  local task="$1"
  [[ -z "$task" ]] && err "Provide a bug description: ./scripts/workflow.sh bugfix \"Wrong address at index 0\""

  log "Starting BUG FIX workflow: $task"

  # Step 1: QA reproduces and documents
  step "1/3 — QA: reproduce + define expected behavior"
  claude --agent qa \
    "Analyze this bug report, identify what the expected vs actual behavior is, and list the files most likely responsible:\n\n$task"

  # Step 2: Appropriate specialist fixes it
  step "2/3 — Fix"
  echo "Which specialist should fix this?"
  echo "  1) blockchain-expert  (wrong addresses, derivation, token amounts)"
  echo "  2) trezor-expert      (Trezor connect, xpub import)"
  echo "  3) frontend-blockchain (UI, display, React)"
  echo "  4) backend-blockchain  (API calls, rate limiting, localStorage)"
  read -rp "$(echo -e "${YELLOW}Choice [1-4]:${NC} ")" fix_choice

  case "$fix_choice" in
    1) claude --agent blockchain-expert "Fix this bug: $task" ;;
    2) claude --agent trezor-expert "Fix this bug: $task" ;;
    3) claude --agent frontend-blockchain "Fix this bug: $task" ;;
    4) claude --agent backend-blockchain "Fix this bug: $task" ;;
    *) warn "Invalid choice." ;;
  esac

  # Step 3: QA verifies
  step "3/3 — QA: verify fix"
  claude --agent qa \
    "Verify the fix for this bug: $task. Check the changed files and confirm the bug is resolved. Run through the relevant test scenarios from the QA test matrix."

  ok "Bug fix workflow complete."
}

workflow_audit() {
  local scope="${1:-full codebase}"
  log "Starting SECURITY AUDIT for: $scope"

  step "1/2 — Blockchain Expert: cryptographic review"
  claude --agent blockchain-expert \
    "Perform a security audit of the following scope: $scope. Focus on: key handling, derivation correctness, API key exposure, BigInt safety, rate limit compliance, and any potential for wrong address generation."

  step "2/2 — Trezor Expert: hardware wallet flow review"
  claude --agent trezor-expert \
    "Audit the Trezor integration for: $scope. Focus on: correct paths, no private key exposure, init lifecycle, error handling, and address match against Trezor Suite."

  ok "Security audit complete."
}

workflow_review() {
  local target="${1:-recent changes}"
  log "Starting CODE REVIEW for: $target"

  # Get recent git diff for context
  local diff
  diff=$(git -C "$PROJECT_ROOT" diff HEAD~1 HEAD --stat 2>/dev/null || echo "No git diff available")

  step "Frontend review"
  claude --agent frontend-blockchain \
    "Review the following changes for frontend code quality, blockchain UX standards, and component correctness:\n\n$target\n\nRecent changes:\n$diff"

  step "Backend/integration review"
  claude --agent backend-blockchain \
    "Review the following changes for API integration quality, rate limiting, and data layer correctness:\n\n$target\n\nRecent changes:\n$diff"

  ok "Code review complete."
}

workflow_docs() {
  local target="${1:-all recent changes}"
  log "Starting DOCUMENTATION update for: $target"

  claude --agent documentation \
    "Update all documentation for: $target. Check README.md, .env.example, inline JSDoc comments in crypto.ts and models.ts, and user-facing text in components."

  ok "Documentation update complete."
}

# =============================================================================
# HELP
# =============================================================================

show_help() {
  echo -e "${CYAN}CryptoVault Multi-Agent Workflow Orchestrator${NC}"
  echo ""
  echo "Usage: ./scripts/workflow.sh <command> [task description]"
  echo ""
  echo "Commands:"
  echo -e "  ${GREEN}feature${NC}  <desc>   Full feature development pipeline"
  echo -e "           PM → Frontend/Backend → Blockchain Expert → Trezor Expert → QA → Docs"
  echo ""
  echo -e "  ${GREEN}bugfix${NC}   <desc>   Bug fix pipeline"
  echo -e "           QA identifies → Specialist fixes → QA verifies"
  echo ""
  echo -e "  ${GREEN}audit${NC}    [scope]  Security audit"
  echo -e "           Blockchain Expert + Trezor Expert review"
  echo ""
  echo -e "  ${GREEN}review${NC}   [desc]   Code review before commit"
  echo -e "           Frontend + Backend review of recent changes"
  echo ""
  echo -e "  ${GREEN}docs${NC}     [desc]   Update documentation"
  echo -e "           Documentation agent updates README, .env.example, comments"
  echo ""
  echo "Examples:"
  echo "  ./scripts/workflow.sh feature \"Add CSV export for wallet balances\""
  echo "  ./scripts/workflow.sh bugfix  \"Address at index 0 doesn't match Trezor Suite\""
  echo "  ./scripts/workflow.sh audit   \"crypto.ts and AdminPanel.tsx\""
  echo "  ./scripts/workflow.sh review"
  echo "  ./scripts/workflow.sh docs    \"Trezor integration changes\""
  echo ""
  echo -e "${YELLOW}Agents available:${NC}"
  echo "  blockchain-expert  — HD wallets, BIP standards, token decimals"
  echo "  trezor-expert      — @trezor/connect-web, xpub export, path verification"
  echo "  product-manager    — Features, acceptance criteria, roadmap"
  echo "  frontend-blockchain — React/TypeScript/Tailwind, wallet UX"
  echo "  backend-blockchain  — Etherscan API, rate limits, localStorage"
  echo "  qa                 — Test plans, regression, address correctness"
  echo "  documentation      — README, .env.example, code comments"
}

# =============================================================================
# DISPATCH
# =============================================================================

case "$WORKFLOW" in
  feature) workflow_feature "$TASK" ;;
  bugfix)  workflow_bugfix  "$TASK" ;;
  audit)   workflow_audit   "$TASK" ;;
  review)  workflow_review  "$TASK" ;;
  docs)    workflow_docs    "$TASK" ;;
  help|--help|-h|"") show_help ;;
  *) err "Unknown workflow: $WORKFLOW. Run ./scripts/workflow.sh help" ;;
esac
