# Common Workflows

This guide covers version control workflows and update procedures for Aura OS.

---

## Git-Powered Version Control

Aura packages a full local version control workflow inside `.aura-workspace/` using Git under the hood.

### Basic Workflow

```bash
# 1. Check what's modified or untracked
aura status

# 2. Stage a newly created custom tool
aura add tools/my_custom_tool

# 3. Commit the changes
aura commit -m "Added standard enterprise search tool"

# 4. Sync (push) to global templates
aura sync

# 5. Pull updates from global repository
aura pull
```

### Inspect Status

```bash
aura status
```

Shows modified and untracked files in your `.aura-workspace/` workspace.

### Stage Changes

```bash
# Stage specific file
aura add tools/my_tool

# Stage all changes
aura add .
```

### Commit Changes

```bash
aura commit -m "Updated read_file tool to support larger files"
```

### Sync to Global Repository

Push your local changes to the global template repository (`~/.aura-framework/repo`):

```bash
aura sync
```

### Pull from Global Repository

Pull template updates from the global repository into your workspace:

```bash
aura pull
```

---

## Update Workflows

Aura uses a **dual-track update mechanism**:

```
Framework Update → Template Sync → Sub-Project Update
```

### Scenario 1: Update Framework and Sync to All Projects

```bash
# Step 1: Update Framework itself
cd /path/to/aura/aura
git pull
aura update framework

# Step 2: Sync templates to global repository
aura template sync

# Step 3: Check which sub-projects need updates
aura list

# Step 4: Batch update all sub-projects
aura update all

# Or use smart merge (handles conflicts)
aura update all --merge
```

### Scenario 2: Update Single Sub-Project

```bash
cd my-project

# Check update status
aura update status

# Simple pull (no conflicts)
aura pull

# Smart merge (when conflicts exist)
aura update merge

# Force merge (use remote version)
aura update merge --force

# Stash local changes, then merge
aura update merge --stash
```

### Scenario 3: Check Template Sync Status

```bash
# Check differences between framework templates and global repo
aura template diff

# View template sync status
aura template status

# Execute sync if needed
aura template sync
```

---

## Update Commands Reference

### Framework Updates

#### `aura update framework`

Update Aura CLI itself.

**Behavior:**
- Automatically pulls the latest updates from the Git source repository and recompiles the CLI.
- Automatically triggers a template synchronization to your global user repository (`~/.aura-framework/repo`) upon successful compilation.
- In case of network or Git merge conflicts, falls back to displaying manual update instructions.

```bash
# Running framework update
aura update framework

# Rebuild the CLI after git pull (in the source root or ~/.aura-framework/cli-src):
npm run build
```

### Status Checks

#### `aura update status`

Check current sub-project's template update status.

```bash
aura update status
```

**Output:**
```
📊 Template Update Status
============================================================
Local (.aura-workspace):
  Commit: abc1234 Initial template commit
  Message: abc1234 Initial template commit

Global (~/.aura-framework/repo):
  Commit: def5678 Template update from framework v0.1.0
  Message: def5678 Template update from framework v0.1.0

⚠️  Updates available from global repo!
Run 'aura pull' or 'aura update merge' to update.

Pending commits:
def5678 Template update from framework v0.1.0
```

### Smart Merge

#### `aura update merge`

Intelligent merge with conflict resolution.

**Options:**
- `--stash` or `-s` - Stash local changes before merging
- `--force` or `-f` - Force merge (remote wins)

```bash
# Normal merge (aborts on conflicts)
aura update merge

# Stash local changes, then merge
aura update merge --stash

# Force merge (remote overwrites local)
aura update merge --force
```

**Workflow:**
1. Check for uncommitted changes
2. Handle changes based on options (stash/force/cancel)
3. Execute `git pull` merge
4. If conflicts, prompt for manual resolution
5. Restore stashed changes (if `--stash` was used)

### Batch Updates

#### `aura update all`

Update all registered sub-projects.

**Options:**
- `--merge` or `-m` - Use smart merge instead of simple pull

```bash
# Simple pull for all
aura update all

# Smart merge for all
aura update all --merge
```

**Output:**
```
🔄 Updating 3 project(s)...
============================================================

[project-alpha] /Users/user/projects/alpha
  ✓ Updated

[project-beta] /Users/user/projects/beta
  ✓ Updated

[project-gamma] /Users/user/projects/gamma
  ✗ Merge conflicts (requires manual resolution)

============================================================
Summary:
  ✓ Success: 2
  ✗ Failed: 1
```

### Template Management

#### `aura template sync`

Sync framework templates to global repository.

**What it does:**
1. Backs up user custom modifications
2. Removes old global repository
3. Copies latest templates from framework
4. Reinitializes Git repository
5. Commits as new version

```bash
aura template sync
```

**Output:**
```
📦 Syncing templates from framework to global repo...
============================================================

📋 Detecting user modifications...
  Found uncommitted changes, creating backup commit...
  ✓ Backup created

🔄 Syncing templates...
  Source: /path/to/aura/generators/aura/app/templates
  Target: /Users/user/.aura-workspace/repo
  ✓ Removed old global repo
  ✓ Copied new templates

🔧 Reinitializing git repository...

✓ Templates synced to global repo!

💡 Next steps:
  - Sub-projects can now pull updates via: aura pull
  - Or merge with conflict resolution: aura update merge
  - Update all projects: aura update all
```

#### `aura template diff`

Compare framework templates vs global repository.

```bash
aura template diff
```

**Output:**
```
🔍 Comparing framework templates vs global repo...
============================================================
⚠️  Differences found:

Only in /path/to/aura/generators/aura/app/templates/skills: new-skill
Files /path/to/aura/generators/aura/app/templates/config.yml and /Users/user/.aura-workspace/repo/config.yml differ

To sync, run: aura template sync
```

#### `aura template status`

View template sync status.

```bash
aura template status
```

**Output:**
```
📊 Template Sync Status
============================================================
Framework Templates:
  Path: /path/to/aura/generators/aura/app/templates
  Status: ✓ Exists
  Files: 114

Global Repository (~/.aura-framework/repo):
  Path: /Users/user/.aura-workspace/repo
  Status: ✓ Exists
  Git: ✓ Initialized
  Last Commit: def5678 Template update from framework v0.1.0

  ⚠️  Note: To sync framework templates to global repo:
     Run: aura template sync
```

---

## Update Strategy Matrix

| Project Type | Update Frequency | Update Method | Description |
|-------------|-----------------|---------------|-------------|
| **Sandbox** | Every Framework update | `aura update all` | Experimental projects, auto-follow latest |
| **Development** | Regular updates | `aura update merge` | Active projects, need conflict handling |
| **Production** | On-demand | Manual `aura pull` | Production projects, locked version, test before update |
| **Custom** | Rarely | Fork and evolve independently | Deeply customized projects |

---

## Safety Best Practices

### 1. Backup Before Updating

```bash
# Backup entire .aura-workspace directory
cp -r .aura-workspace .aura-workspace.backup

# Or commit current state
cd .aura-workspace
git add .
git commit -m "Before update backup"
```

### 2. Check Update Contents

```bash
# See what updates are available
aura update status

# View differences
aura template diff
```

### 3. Test on One Project First

```bash
# Update one project to test
cd test-project
aura update merge

# Confirm everything works
aura status

# Then batch update
aura update all
```

### 4. Handle Conflicts

```bash
# When encountering conflicts
aura update merge

# Manually resolve conflicts
cd .aura-workspace
git status  # View conflicted files
# Edit conflict files...
git add .
git commit -m "Resolved merge conflicts"
```

---

## Rollback Procedures

### Rollback to Previous Commit

```bash
cd .aura-workspace
git log  # Find the commit to rollback to
git reset --hard <commit-hash>
```

### Restore from Backup

```bash
# Remove current .aura-workspace
rm -rf .aura-workspace

# Restore from backup
cp -r .aura-workspace.backup .aura-workspace
```

### Revert Template Sync

If template sync caused issues:

```bash
cd ~/.aura-framework/repo
git log  # Find commit before sync
git reset --hard <commit-hash>
```

---

## Common Update Scenarios

### Scenario: Developer Daily Workflow

```bash
# Morning: Update Framework
cd ~/projects/aura/aura
git pull
aura update framework

# Sync latest templates
aura template sync

# Check all project status
aura list
aura update status

# Update all development projects
aura update all

# For production projects, handle carefully
cd production-project
aura update merge --stash
# Check if everything works
aura status
```

### Scenario: CI/CD Integration

```bash
#!/bin/bash
# scripts/update-all-projects.sh

# Update framework
cd /opt/aura
git pull
aura update framework

# Sync templates
aura template sync

# Update all projects
aura update all --merge

# Generate report
aura update status > /var/log/aura-update-$(date +%Y%m%d).log
```

### Scenario: Production Deployment

```bash
# Test on staging first
cd staging-project
aura update merge
# Run tests...
# Verify functionality...

# Then update production
cd production-project
aura update merge --stash
# Run tests...
# Verify functionality...

# If issues, rollback
cd .aura-workspace
git reset --hard HEAD~1
```

---

## Troubleshooting

### Updates lost custom configuration

**Solution:** Use `--stash` option or commit changes first:

```bash
cd .aura-workspace
git add .
git commit -m "Save custom configs"
cd ..
aura update merge
```

### Too many conflicts

**Solution:** Use theirs strategy for force merge:

```bash
aura update merge --force
```

Or resolve manually:

```bash
cd .aura-workspace
git mergetool  # Use graphical tool
git add .
git commit -m "Resolved conflicts"
```

### Update status shows nothing

**Solution:** Templates may already be in sync:

```bash
# Force check
aura template diff

# If no differences, you're up to date
```

---

## See Also

- [CLI Reference](../reference/cli.md) - Update commands
- [Configure Aura](configure-aura.md) - Config management
- [Workspace and Template Model](../explanation/workspace-and-template-model.md) - How template repos and workspaces relate
- [Getting Started](../tutorials/getting-started.md) - Initial setup
