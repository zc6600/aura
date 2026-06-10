# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- CI/CD pipeline with test matrix (Ruby 3.0-3.3)
- Code coverage tracking with SimpleCov
- RuboCop linting (non-blocking)
- Gem build validation in CI
- CHANGELOG.md with automated release notes generation

### Changed
- Updated RuboCop configuration to use current parameter names
- Improved CI artifact retention policies

### Fixed
- Obsolete RuboCop parameter warnings in `.rubocop.yml`

---

## [0.1.0] - 2026-05-25

### Added
- AI-native operating system for folder-as-workspace agents
- Kernel with AgentLoop execution engine
- Session management with per-session isolated SQLite databases
- CLI with comprehensive command structure (new, agent, session, tools, skills, etc.)
- LLM provider abstraction with multiple adapters (OpenAI, OpenRouter, Anthropic, Gemini, DeepSeek, Local)
- Memory metabolism system with tiered retention strategy
- Context assembly with providers (tools, state, knowledge, LSP, environment)
- Model Context Protocol (MCP) integration
- Language Server Protocol (LSP) support
- Ralph Loop for autonomous multi-turn execution with critic auditing
- Shadow backup system with Git-based versioning
- Event bus for pub/sub communication
- Tool execution engine with validation and sandboxing
- Skill system with installable capabilities
- Workspace initialization and project registry
- Configuration management with global and project-level settings
- Shell completion support (bash, zsh)
- Doctor command for environment diagnostics
- Info command for comprehensive system information
- Update framework for CLI and template synchronization
- Template management with smart merge capabilities
- Branch/profile system for agent customization
- Hints system for code intelligence (@aura-hint tags)

### Changed
- Refactored CLI commands into separate modules (725 → 600 lines for application_command.rb)
- Decoupled Runner from legacy memory adapter
- Unified kernel loop to use AgentLoop
- Simplified Bridge to adapt events from AgentLoop and EventBus
- Implemented stateless Ralph Loop wrapping AgentLoop
- Consolidated config loading mechanism
- Resolved tech debt with undo/redo rollback implementation

### Fixed
- SQLiteStore concurrency issues
- CompatibilityAdapter delegation bugs
- Tool template stdin payload parsing
- Subdirectory path resolution in CLI commands
- Template generators fallback path resolution
- Config.yml resolution path for workspace compatibility
- ResponseParser missing JSON require
- Memory ordering in config loading
- Dynamic version detection for development builds
- Setup.sh compatibility
- Missing .gitignore entries in gemspec
- Template path resolution for installed gems
- AgentLoop robustness to string inputs
- Format error reset on success
- User interrupt handling
- JSON tool protocol enforcement
- Test stability across Ruby versions

### Security
- Prevented Open3 command injection via array argument passing
- Implemented tool execution sandboxing
- Added API key resolution with environment variable support
- Protected config.yml from framework update overwrites
- Implemented workspace-wide file access controls in strict mode

### Performance
- Cached planner and adapter instances
- Enabled WAL mode for SQLite
- Optimized context observation wrapping
- Reduced context explosion with metadata summaries

### Documentation
- Added CONTRIBUTING.md with development guidelines
- Restructured documentation with user/developer separation
- Updated user README and internal kernel architecture docs
- Added developer guide for session architecture, memory management, integrations
- Created comprehensive CI/CD implementation guide

---

## Guidelines

### Version Numbering
- **Major**: Breaking changes requiring migration
- **Minor**: New features, backward compatible
- **Patch**: Bug fixes, backward compatible

### Change Categories
- **Added**: New features
- **Changed**: Changes in existing functionality
- **Deprecated**: Soon-to-be removed features
- **Removed**: Removed features
- **Fixed**: Bug fixes
- **Security**: Security improvements

### Commit Message Convention
Use conventional commits for automatic changelog generation:
```
type: description

type: feat, fix, docs, style, refactor, test, chore, security, perf
```

### Automated Generation
CI/CD pipeline generates release notes from git tags and conventional commits:
```bash
# Generate changelog for a release
git tag -a v0.2.0 -m "Release v0.2.0"
git push origin v0.2.0
# CI will generate changelog entry automatically
```
