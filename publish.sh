#!/usr/bin/env bash
set -euo pipefail

# contrastcap publish script
# Usage:
#   ./publish.sh              — bump patch version and publish (default)
#   ./publish.sh patch        — bump patch version and publish
#   ./publish.sh minor        — bump minor version and publish
#   ./publish.sh major        — bump major version and publish
#   ./publish.sh patch 123456 — bump + publish, passing a 2FA OTP (skips the
#                               y/N confirm; needed for npm 2FA / non-interactive)
#   ./publish.sh --dry-run    — dry run only, no publish
#
# First-time publish (package not yet on npm) is auto-detected and the
# current package.json version is used as-is (no bump).

PACKAGE_NAME="@icjia/contrastcap"
BUMP="${1:-patch}"
OTP="${2:-}"
DRY_RUN=false

if [[ "$BUMP" == "--dry-run" ]]; then
  DRY_RUN=true
  BUMP="patch"
fi

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

info()  { echo -e "${GREEN}[contrastcap]${NC} $1"; }
warn()  { echo -e "${YELLOW}[contrastcap]${NC} $1"; }
error() { echo -e "${RED}[contrastcap]${NC} $1" >&2; }

# The OTP must be a 6-8 digit code. Anything else (e.g. a misplaced
# --dry-run: `./publish.sh minor --dry-run`) would otherwise be sent to npm as
# the "code" during a REAL publish, so stop here before bumping anything.
if [[ -n "$OTP" && ! "$OTP" =~ ^[0-9]{6,8}$ ]]; then
  error "OTP '$OTP' is not a 6-8 digit code — nothing was changed or published."
  error "Usage: ./publish.sh [patch|minor|major] [otp]   or   ./publish.sh --dry-run"
  exit 1
fi

# Helper to read package.json fields (ESM-safe — project uses "type": "module")
pkg_field() {
  node --input-type=commonjs -e "console.log(require('./package.json').$1)"
}

# ─── Preflight checks ───────────────────────────────────────────────

# Must be in project root
if [[ ! -f "package.json" ]]; then
  error "No package.json found. Run this from the contrastcap project root."
  exit 1
fi

# Verify correct package
ACTUAL_NAME=$(pkg_field name)
if [[ "$ACTUAL_NAME" != "$PACKAGE_NAME" ]]; then
  error "package.json name is '$ACTUAL_NAME', expected '$PACKAGE_NAME'"
  exit 1
fi

# Check npm login
if ! npm whoami &>/dev/null; then
  warn "Not logged in to npm. Logging in now..."
  npm login
fi

NPM_USER=$(npm whoami)
info "Logged in as: $NPM_USER"

# Check for uncommitted changes (only if this is a git repo)
if git rev-parse --git-dir &>/dev/null; then
  if [[ -n "$(git status --porcelain)" ]]; then
    error "Uncommitted changes detected. Commit or stash before publishing."
    git status --short
    exit 1
  fi
else
  warn "Not a git repository — skipping git checks. Tag + push will also be skipped."
fi

# Validate bump type
if [[ "$BUMP" != "patch" && "$BUMP" != "minor" && "$BUMP" != "major" ]]; then
  error "Invalid bump type: '$BUMP'. Use patch, minor, or major."
  exit 1
fi

# ─── First-time detection ───────────────────────────────────────────

FIRST_TIME=false
if ! npm view "$PACKAGE_NAME" version &>/dev/null 2>&1; then
  FIRST_TIME=true
  warn "Package '$PACKAGE_NAME' not found on npm — this is a first-time publish."
fi

# ─── Version bump ───────────────────────────────────────────────────

CURRENT_VERSION=$(pkg_field version)

if [[ "$FIRST_TIME" == true ]]; then
  info "Current version: $CURRENT_VERSION (will publish as-is for first release)"
  NEW_VERSION="$CURRENT_VERSION"
else
  info "Current version: $CURRENT_VERSION"
  info "Bumping: $BUMP"
  NEW_VERSION=$(npm version "$BUMP" --no-git-tag-version)
  NEW_VERSION="${NEW_VERSION#v}" # strip leading 'v'
  info "New version: $NEW_VERSION"
fi

# ─── CHANGELOG check ────────────────────────────────────────────────

# Require a CHANGELOG entry for the new version before publishing.
if ! grep -qE "\[$NEW_VERSION\]|## $NEW_VERSION( |$)" CHANGELOG.md; then
  error "CHANGELOG.md has no entry for [$NEW_VERSION]. Add one before publishing."
  if [[ "$FIRST_TIME" == false ]] && git rev-parse --git-dir &>/dev/null; then
    git checkout package.json
  fi
  exit 1
fi
info "CHANGELOG.md entry for $NEW_VERSION found."

# ─── Dry run ────────────────────────────────────────────────────────

info "Running dry run..."
echo ""

if [[ "$FIRST_TIME" == true ]]; then
  npm publish --access public --dry-run
else
  npm publish --dry-run
fi

echo ""

if [[ "$DRY_RUN" == true ]]; then
  # Revert the version bump since we're not publishing
  if [[ "$FIRST_TIME" == false ]]; then
    if git rev-parse --git-dir &>/dev/null; then
      git checkout package.json
    fi
  fi
  info "Dry run complete. No changes made."
  exit 0
fi

# ─── Confirm ────────────────────────────────────────────────────────

# An OTP is an explicit, time-sensitive signal of intent — skip the prompt so
# the code doesn't expire while waiting (and so non-interactive runs work).
if [[ -n "$OTP" ]]; then
  info "OTP provided — skipping confirmation and publishing now."
else
  echo ""
  if [[ "$FIRST_TIME" == true ]]; then
    warn "About to publish $PACKAGE_NAME@$NEW_VERSION for the FIRST TIME."
  else
    warn "About to publish $PACKAGE_NAME@$NEW_VERSION"
  fi
  read -p "Proceed? (y/N) " -n 1 -r
  echo ""

  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    # Revert the version bump
    if [[ "$FIRST_TIME" == false ]]; then
      if git rev-parse --git-dir &>/dev/null; then
        git checkout package.json
      fi
    fi
    info "Aborted. No changes made."
    exit 0
  fi
fi

# ─── Publish ────────────────────────────────────────────────────────

# ${OTP:+--otp "$OTP"} expands to nothing when no OTP was given, or to the
# --otp flag and code when one was. If omitted and 2FA is on, npm prompts.
if [[ "$FIRST_TIME" == true ]]; then
  npm publish --access public ${OTP:+--otp "$OTP"}
else
  npm publish ${OTP:+--otp "$OTP"}
fi

# ─── Git commit + tag ───────────────────────────────────────────────

if git rev-parse --git-dir &>/dev/null; then
  if [[ "$FIRST_TIME" == true ]]; then
    # First-time: no version bump to commit, but tag the initial release
    git tag "v$NEW_VERSION"
  else
    git add package.json
    git commit -m "release: v$NEW_VERSION"
    git tag "v$NEW_VERSION"
  fi

  if git remote get-url origin &>/dev/null; then
    git push && git push --tags
  else
    warn "No git remote 'origin' — skipping push. Run 'git push && git push --tags' manually."
  fi
fi

# ─── Done ───────────────────────────────────────────────────────────

echo ""
info "Published $PACKAGE_NAME@$NEW_VERSION"
info "npm: https://www.npmjs.com/package/$PACKAGE_NAME"
info ""
info "Users will get this version on next Claude Code restart via:"
info "  npx -y $PACKAGE_NAME"
