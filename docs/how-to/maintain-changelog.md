# CHANGELOG Management Guide

This guide explains how `CHANGELOG.md` is structured and maintained in the Aura framework.

---

## 1. Overview

Aura uses:
- **CHANGELOG.md**: Located at the root, following the [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format.
- **Semantic Versioning (SemVer)**: For version numbers (`MAJOR.MINOR.PATCH`).
- **Conventional Commits**: For categorizing commits in the git history.

---

## 2. CHANGELOG.md Structure

```markdown
# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- New features currently in development.

### Fixed
- Bug fixes.

## [0.1.0] - 2026-05-25

### Added
- Initial TypeScript framework release.
```

### Allowed Categories

Entries in the changelog must be grouped under the following headers:
- `Added`: for new features.
- `Changed`: for changes in existing functionality.
- `Deprecated`: for soon-to-be-removed features.
- `Removed`: for now-removed features.
- `Fixed`: for any bug fixes.
- `Security`: in case of vulnerabilities.
- `Performance`: for performance optimizations.
- `Documentation`: for documentation updates.

---

## 3. Workflow & Best Practices

### A. For Contributors

1. **Manual Entry under [Unreleased]**: When you add a feature, fix a bug, or change functionality, add a bullet point under the appropriate category in the `## [Unreleased]` section of `CHANGELOG.md`.
2. **Be Concise and Clear**: Write entries that explain *what* changed and *why* from a user/developer perspective.
3. **Use Conventional Commits**: Ensure your commit messages use standard prefixes (e.g. `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`).

### B. For Maintainers (Preparing a Release)

When cutting a new release (e.g. updating version from `0.1.0` to `0.2.0`):

1. **Move Unreleased Content**: Move all contents under `## [Unreleased]` to a new version header (e.g. `## [0.2.0] - YYYY-MM-DD`).
2. **Update Package Version**: Update the `version` field in `package.json` to match the new version.
3. **Commit & Tag**:
   ```bash
   git add CHANGELOG.md package.json
   git commit -m "chore: bump version to 0.2.0"
   git tag -a v0.2.0 -m "Release v0.2.0"
   git push origin main --tags
   ```
4. **CI Validation**: GitHub Actions will automatically run the Node.js test suites on Node 20 and Node 22 to verify build correctness.

---

## 4. Conventional Commits Reference

| Commit Type | CHANGELOG Section | Example |
| :--- | :--- | :--- |
| `feat` | `Added` | `feat: add session export` |
| `fix` | `Fixed` | `fix: handle null payload` |
| `docs` | `Documentation` / `Changed` | `docs: update changelog guide` |
| `refactor` | `Changed` | `refactor: extract command class` |
| `perf` | `Performance` | `perf: optimize context assembly` |
| `security` | `Security` | `security: prevent command injection` |
| `test`, `style`, `chore` | `Changed` | `test: add coverage for memory` |
