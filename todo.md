# Garden Concept - Remaining Implementation TODOs

This document outlines the deferred features for the Agent Gardening integration into Aura OS. These will be implemented in subsequent phases.

## 1. Web GUI Dashboard
- [ ] **Garden Dashboard View**:
  - Add a dedicated "Garden Board" tab to the Web Dashboard.
  - Implement a visual node-based check-list or a DAG (Directed Acyclic Graph) showing standard playbook steps.
  - Create a sidecar hints/constraints panel displaying currently active and inactive hints.
  - Render metrics charts for "Soil" (SQLite event volume, DB size over time) and "Metabolism" (active context compression ratio).
- [ ] **Interactive Scaffolding**:
  - Allow users to initialize playbooks directly from the GUI (e.g., clicking "Grow Kaggle Garden" or "Grow AI Scientist Garden").
  - Auto-generate visual progress bars based on anchors completed vs total anchors.
- [ ] **Workspace & Harvest Visualization Panel**:
  - Add a visual file tree explorer focused on the "Garden layout":
    - **Soil**: Highlight SQLite session database files.
    - **Seeds**: List and link anchors files in `anchors/`.
    - **Plants**: Explore active source code files in `src/`.
    - **Harvest**: Display output datasets, models, or report files in `data/` or target directories (e.g., checking for deliverables like `submission.csv` or `report.pdf` dynamically).
  - Add a code-viewer/markdown-renderer in the GUI to allow the user to read/edit playbook markdown and active source code files.

## 2. API Endpoints (`lib/aura/cli/shell/web_server.rb`)

### 2.1 Filesystem Information & Operations APIs
- [ ] **GET `/api/filesystem/tree`**:
  - Scan the active workspace directory and return a nested JSON representation of the directory structure (ignoring `.git`, `.aura`, and large cache directories like `node_modules` or `.venv`).
- [ ] **GET `/api/filesystem/read`**:
  - Query parameter `?path=relative/file/path`.
  - Read and return the content of a workspace file with UTF-8 encoding.
- [ ] **POST `/api/filesystem/write`**:
  - Query parameter `?path=relative/file/path` and JSON payload `{"content": "..."}`.
  - Write/save content to a workspace file securely (incorporating `PathResolver.validate_safe_path` to prevent path traversal).
- [ ] **GET `/api/filesystem/status`**:
  - Return Git/shadow workspace status, listing untracked, modified, and deleted files.

### 2.2 Garden & Scaffolding APIs
- [ ] **GET `/api/garden/playbooks`**:
  - Return a list of all available templates and local playbooks with YAML metadata.
- [ ] **GET `/api/garden/status`**:
  - Return JSON payload of the workspace health (Soil size, sessions count, anchors progress, and active hints count).
- [ ] **POST `/api/garden/init`**:
  - Endpoint to trigger workspace scaffolding (copying files, creating directories) remotely.

### 2.3 Hints & Context Metabolism APIs
- [ ] **GET `/api/hints`**:
  - List all files scanned for hints (e.g. `.hint` files, markdown, code files) and their active status.
- [ ] **POST `/api/hints/toggle`**:
  - JSON payload `{"file_path": "...", "enabled": true/false}`.
  - Toggle hint injection status for a specific file (updating the `.aura` metadata/configuration).

### 2.4 Anchors Progress APIs
- [ ] **GET `/api/anchors`**:
  - Return a list of all defined anchors in `anchors/` (metadata, description, checklist items) along with their completion status (completed/pending) based on SQLite `anchor_submit` events.
- [ ] **POST `/api/anchors/submit`**:
  - JSON payload `{"anchor_id": "...", "status": "completed/pending"}`.
  - Programmatically submit or revoke an anchor completion event in the session database.

## 3. Advanced Metabolism & Pruning Logic
- [ ] **Tiered Context Compression**:
  - Automatically compress past conversation history or archives when SQLite DB limits or hint constraint limits are hit.
- [ ] **Metabolic Hint Rotator**:
  - Periodically disable hints that have not been triggered or references that are out-of-scope for the active step.
- [ ] **Auto-harvest Verification**:
  - Trigger automated test suites or check scripts defined in `garden.md` under a `verification` hook once all anchors are marked as complete.
