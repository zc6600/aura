# CHANGELOG and CI/CD Integration Guide

This guide explains how CHANGELOG.md is integrated with the CI/CD pipeline for automated release management.

## Overview

Aura OS uses:
- **CHANGELOG.md**: Following [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format
- **Conventional Commits**: For automated changelog generation
- **GitHub Actions**: For validation and automated releases
- **Rake Tasks**: For local changelog management

## CHANGELOG.md Structure

```markdown
# Changelog

## [Unreleased]
### Added
- Features in development

## [0.1.0] - 2026-05-25
### Added
- Released features

### Fixed
- Bug fixes
```

### Sections

- **[Unreleased]**: Changes not yet released
- **[version]**: Released versions with date
- Categories: Added, Changed, Deprecated, Removed, Fixed, Security, Performance, Documentation

## Local Development

### Manual Updates

Add entries to the `[Unreleased]` section as you develop:

```bash
# Edit CHANGELOG.md
vim CHANGELOG.md

# Add your changes under [Unreleased]
```

### Automated Generation

Generate changelog from git commits:

```bash
# Preview changelog for upcoming release
rake changelog:preview[0.2.0]

# Generate and save to CHANGELOG.md
rake changelog:generate[0.2.0,2026-06-01]

# Validate format
rake changelog:validate
```

### Script Usage

```bash
# Print to stdout
ruby scripts/generate_changelog.rb 0.2.0 --print

# Save to file
ruby scripts/generate_changelog.rb 0.2.0 2026-06-01
```

## Release Process

### Step 1: Prepare Release

```bash
# Ensure all changes are committed
git status

# Generate changelog from commits since last tag
rake changelog:generate[0.2.0,$(date +%Y-%m-%d)]

# Review the generated changelog
cat CHANGELOG.md

# Commit the changelog
git add CHANGELOG.md
git commit -m "docs: update CHANGELOG for v0.2.0"
```

### Step 2: Tag and Push

```bash
# Create annotated tag
git tag -a v0.2.0 -m "Release v0.2.0"

# Push to GitHub
git push origin main --tags
```

### Step 3: CI/CD Automation

The CI/CD pipeline automatically:

1. **Validates CHANGELOG.md** on every push/PR
2. **Extracts release notes** when a tag is pushed
3. **Creates GitHub Release** with:
   - Changelog content as release body
   - Built `.gem` file as attachment
   - Git-generated release notes as supplement

## CI/CD Workflows

### ci.yml (Main Pipeline)

Runs on: `push`, `pull_request`, `release`

**Jobs:**
- `test`: Test matrix (Ruby 3.0-3.3)
- `coverage`: Code coverage report
- `build-gem`: Gem packaging validation
- `lint`: RuboCop style check (non-blocking)
- `validate-changelog`: **NEW** CHANGELOG validation

**CHANGELOG Validation:**
```yaml
validate-changelog:
  - Check CHANGELOG.md exists
  - Validate [Unreleased] section present
  - Warn if [Unreleased] has content on tagged release
  - Extract release notes for tags
  - Upload release notes as artifact
```

### release.yml (Release Pipeline)

Runs on: `push tags: v*`

**Jobs:**
- Extract version from tag
- Generate release notes from CHANGELOG.md
- Build gem with `AURA_RELEASE=1`
- Run tests
- Create GitHub Release with:
  - Tag name and version
  - Changelog content as body
  - Gem file attachment
  - Auto-generated release notes

## Conventional Commits

The changelog generator parses conventional commit format:

```
type(scope): description

type: feat, fix, docs, style, refactor, test, chore, security, perf
```

### Mapping to CHANGELOG Categories

| Commit Type | CHANGELOG Section |
|-------------|-------------------|
| `feat` | Added |
| `fix` | Fixed |
| `docs` | Documentation |
| `refactor` | Changed |
| `perf` | Performance |
| `security` | Security |
| `test`, `style`, `chore` | Changed |

### Examples

```bash
# New feature
git commit -m "feat: add session export functionality"

# Bug fix
git commit -m "fix: handle nil payload in state recorder"

# Documentation
git commit -m "docs: update CHANGELOG workflow"

# Breaking change
git commit -m "feat!: redesign context assembly API"
```

## GitHub Release Flow

```
Developer Actions:                    CI/CD Automation:
┌─────────────────┐                  ┌──────────────────────┐
│ 1. Develop      │                  │                      │
│    features     │                  │                      │
└────────┬────────┘                  │                      │
         │                           │                      │
         ▼                           │                      │
┌─────────────────┐                  │                      │
│ 2. Commit with  │                  │                      │
│    conventional │                  │                      │
│    commits      │                  │                      │
└────────┬────────┘                  │                      │
         │                           │                      │
         ▼                           │                      │
┌─────────────────┐                  │                      │
│ 3. Generate     │                  │                      │
│    changelog    │                  │                      │
│    rake task    │                  │                      │
└────────┬────────┘                  │                      │
         │                           │                      │
         ▼                           │                      │
┌─────────────────┐                  │                      │
│ 4. Tag release  │─────────────────>│ 5. Validate CHANGELOG│
│    git tag v*   │                  │    format            │
└─────────────────┘                  └──────────┬───────────┘
                                                │
                                                ▼
                                       ┌────────────────────┐
                                       │ 6. Extract release │
                                       │    notes from      │
                                       │    CHANGELOG.md    │
                                       └──────────┬─────────┘
                                                  │
                                                  ▼
                                       ┌────────────────────┐
                                       │ 7. Build gem with  │
                                       │    AURA_RELEASE=1  │
                                       └──────────┬─────────┘
                                                  │
                                                  ▼
                                       ┌────────────────────┐
                                       │ 8. Run test suite  │
                                       │    to ensure       │
                                       │    quality         │
                                       └──────────┬─────────┘
                                                  │
                                                  ▼
                                       ┌────────────────────┐
                                       │ 9. Create GitHub   │
                                       │    Release with:   │
                                       │    - Changelog body│
                                       │    - Gem attachment│
                                       │    - Auto notes    │
                                       └────────────────────┘
```

## Best Practices

### For Contributors

1. **Update CHANGELOG.md** for user-facing changes
2. **Use conventional commits** for automated tracking
3. **Be specific** in changelog entries
4. **Group related changes** under appropriate categories

### For Maintainers

1. **Review [Unreleased]** section before tagging
2. **Move [Unreleased]** content to versioned section
3. **Clear [Unreleased]** after release
4. **Tag promptly** after merging release PR

### Entry Quality

**Good:**
```markdown
### Fixed
- Prevent Open3 command injection by using array arguments
- Handle nil payload in StateRecorder gracefully
```

**Bad:**
```markdown
### Fixed
- Fix bugs
- Update code
- Stuff
```

## Troubleshooting

### Missing CHANGELOG.md in CI

```
ERROR: CHANGELOG.md not found
```

**Solution:** Create CHANGELOG.md following the template in this guide.

### Empty Release Notes

```
WARNING: No changelog entry found for 0.2.0
```

**Solution:** Add entry to CHANGELOG.md before tagging, or CI will generate minimal notes from commits.

### [Unreleased] Content on Tagged Release

```
WARNING: [Unreleased] section has content for tagged release
```

**Solution:** Move unreleased content to versioned section before tagging.

### Changelog Generation Fails

```bash
# Check git history
git log --oneline

# Verify tags exist
git tag -l

# Regenerate manually
rake changelog:generate[0.2.0,$(date +%Y-%m-%d)]
```

## Migration from Old Format

If you have `docs/changelog/*.md` files:

1. **Keep as historical reference**: These are development logs
2. **Create CHANGELOG.md**: Use format in this guide
3. **Summarize major releases**: Include key milestones
4. **Update references**: Link to CHANGELOG.md from docs

## Related Files

- `CHANGELOG.md`: The changelog file
- `.github/workflows/ci.yml`: CI pipeline with validation
- `.github/workflows/release.yml`: Automated release workflow
- `scripts/generate_changelog.rb`: Changelog generation script
- `Rakefile`: Rake tasks for changelog management
- `CONTRIBUTING.md`: Contributor guidelines with changelog section

## Commands Reference

```bash
# Validate
rake changelog:validate

# Preview
rake changelog:preview[0.2.0]

# Generate
rake changelog:generate[0.2.0,2026-06-01]

# Manual script usage
ruby scripts/generate_changelog.rb --print
ruby scripts/generate_changelog.rb 0.2.0 2026-06-01

# Git tagging
git tag -a v0.2.0 -m "Release v0.2.0"
git push origin main --tags
```

## Next Steps

1. **Add CI status badges** to README.md
2. **Integrate with RubyGems** for automated gem publishing
3. **Add coveralls.io** for coverage tracking badges
4. **Set up dependabot** for dependency update changelogs
