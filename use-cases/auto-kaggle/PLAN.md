# AutoKaggle 可实施项目计划

状态：可执行设计稿，等待审阅后进入实现  
所在目录：`use-cases/auto-kaggle`  
适用对象：Aura 源码仓库中的一个 use-case 分发包，用来初始化并驱动独立 Kaggle competition workspace

## 1. 项目边界

AutoKaggle 不是把 `use-cases/auto-kaggle` 本身变成一个可直接刷榜的工作区。根据 Aura docs，运行时只会在当前 Aura workspace 的这些位置发现能力：

- tools：`<project>/tools/` 和 `<project>/.aura-workspace/tools/`
- skills：`<project>/skills/` 和 `<project>/.aura-workspace/skills/`
- garden：`<project>/garden/garden.md`、`<project>/garden/<name>/garden.md`，以及 template repo 中的 garden
- state：`<project>/.aura-workspace/state/sessions/...`

因此本项目的正确形态是：

1. `use-cases/auto-kaggle/` 是分发包和模板源。
2. 用户先用 `aura new <competition_workspace>` 创建独立工作区。
3. AutoKaggle 的 bootstrap 脚本把 tool、skill、garden、模板代码复制到该工作区根目录。
4. 用户在独立 competition workspace 中运行 `aura workflow doctor`、`aura workflow status`、`aura workflow run`，必要时再用 `aura tools list`、`aura garden status`、`aura anchor status` 做底层排查。

这个边界避免污染 Aura 源码根目录，也符合 docs 中 Source Root Protection、Workspace and Template Model、Tools/Skills/Garden Provider 的实际行为。

## 2. 一句话目标

给定一个 Kaggle competition slug，AutoKaggle 初始化一个可复现、可审计、默认 dry-run 的竞赛工作区，让 Aura agent 可以自动完成数据 catalog、baseline、验证冻结、实验记录、submission 格式检查、候选排序，并在明确开启后执行受控提交。

## 3. 非目标

第一期不做这些事：

- 不默认真实提交 Kaggle。
- 不绕过 Kaggle 的比赛规则、提交次数限制或认证机制。
- 不依赖 public leaderboard 作为唯一优化信号。
- 不把大数据文件直接注入上下文。
- 不修改 Aura kernel 核心来支持 AutoKaggle。
- 不在 Aura 源码根目录里运行长任务。

## 4. 用户使用流程

审阅通过并实现后，目标使用方式如下：

```bash
# 1. 在源码仓库外创建真实比赛工作区
aura new ~/kaggle/playground-series-sX-eYY
cd ~/kaggle/playground-series-sX-eYY

# 2. 初始化 AutoKaggle 能力
python /Users/frank/Desktop/Towards\ AGI/aura/aura/use-cases/auto-kaggle/scripts/bootstrap.py \
  --slug playground-series-sX-eYY \
  --mode offline

# 3. 验证 Aura 可以发现能力
aura tools list
aura skill list
aura garden list
aura garden status
aura anchor status
aura workflow doctor
aura workflow status
aura kernel observe

# 4. 离线 MVP 跑通
aura kernel run_call ak_run_registry '{"action":"init"}'
python src/baseline.py
aura kernel run_call ak_submit_guard '{"action":"validate","submission_path":"submissions/baseline.csv","dry_run":true}'

# 5. 让 agent 接管下一步
aura workflow run
```

真实 Kaggle 接入时：

```bash
python use-cases/auto-kaggle/scripts/bootstrap.py \
  --slug playground-series-sX-eYY \
  --mode kaggle \
  --allow-download

# 真实提交仍默认关闭。需要用户在 config/autokaggle.yml 中显式设置 allow_submit: true。
```

## 5. 分发包目录

在 `use-cases/auto-kaggle/` 下实现：

```text
use-cases/auto-kaggle/
├── PLAN.md
├── README.md
├── scripts/
│   ├── bootstrap.py
│   └── smoke_offline.py
├── garden/
│   └── auto-kaggle/
│       └── garden.md
├── skills/
│   └── auto-kaggle/
│       └── SKILL.md
├── workflow.yml
├── tools/
│   ├── ak_competition/
│   │   ├── manifest.json
│   │   ├── logic.py
│   │   └── logic.py.hint
│   ├── ak_run_registry/
│   │   ├── manifest.json
│   │   ├── logic.py
│   │   └── logic.py.hint
│   └── ak_submit_guard/
│       ├── manifest.json
│       ├── logic.py
│       └── logic.py.hint
├── template/
│   ├── config/
│   │   └── autokaggle.yml
│   ├── prompts/
│   │   └── system/
│   │       ├── SOUL.md
│   │       └── TOOLS.md
│   ├── anchors/
│   │   ├── 00_workspace_ready.json
│   │   ├── 01_data_cataloged.json
│   │   ├── 02_baseline_recorded.json
│   │   ├── 03_validation_frozen.json
│   │   ├── 04_candidate_selected.json
│   │   ├── 05_submit_guard_passed.json
│   │   └── 06_feedback_recorded.json
│   ├── src/
│   │   ├── data.py
│   │   ├── metric.py
│   │   ├── baseline.py
│   │   ├── features.py
│   │   ├── models.py
│   │   ├── ensemble.py
│   │   └── submit.py
│   ├── experiments/
│   │   └── README.md
│   ├── reports/
│   │   └── README.md
│   ├── submissions/
│   │   └── README.md
│   ├── knowledge/
│   │   └── README.md
│   └── task.md
└── docs/
    ├── architecture.md
    ├── tool-contracts.md
    └── operations.md
```

bootstrap 后，目标 competition workspace 中应出现：

```text
<competition_workspace>/
├── .aura-workspace/
├── tools/
│   ├── ak_competition/
│   ├── ak_run_registry/
│   └── ak_submit_guard/
├── skills/
│   └── auto-kaggle/
├── garden/
│   ├── garden.md
│   └── auto-kaggle/garden.md
├── config/
│   └── autokaggle.yml
├── prompts/system/
├── anchors/
├── src/
├── data/raw/
├── data/processed/
├── experiments/
├── reports/
├── submissions/
├── knowledge/
└── task.md
```

## 6. Bootstrap 设计

`scripts/bootstrap.py` 是第一期最关键的可用性入口。

### 输入

```text
--slug <competition_slug>      必填，Kaggle competition slug
--workspace <path>             可选，默认当前目录
--mode offline|kaggle          默认 offline
--allow-download               允许调用 Kaggle CLI 下载
--force                        允许覆盖 AutoKaggle 管理的同名文件
```

### 行为

1. 检查当前目录是否是 Aura workspace：
   - 必须存在 `.aura-workspace/`，否则提示先运行 `aura new <path>`。
2. 复制 tools 到 `<workspace>/tools/`。
3. 复制 skill 到 `<workspace>/skills/auto-kaggle/`。
4. 复制 garden 到 `<workspace>/garden/auto-kaggle/`。
5. 如 `<workspace>/garden/garden.md` 不存在，创建一个 router garden。
6. 复制 template 中的 `src/`、`anchors/`、`prompts/`、`params/autokaggle.yml`、`workflow.yml`、`task.md`。
7. 创建数据和 artifact 目录。
8. 写入 `config/autokaggle.yml` 的 slug、mode、allow_submit=false。
9. offline 模式生成一个 tiny tabular fixture：
   - `data/raw/train.csv`
   - `data/raw/test.csv`
   - `data/raw/sample_submission.csv`
10. 生成 `.hint`：
   - `data/raw/train.csv.hint`
   - `data/raw/test.csv.hint`
   - `data/raw/sample_submission.csv.hint`
11. 输出下一步命令。

### 不做的事

- 不执行真实提交。
- 不把 token 写入 repo。
- 不覆盖用户修改过的文件，除非 `--force`。

## 7. Workspace 配置

`config/autokaggle.yml` 示例：

```yaml
competition:
  slug: ""
  mode: "offline"
  metric: ""
  target_column: ""
  id_column: "id"
  higher_is_better: true

data:
  raw_dir: "data/raw"
  processed_dir: "data/processed"
  train_file: "data/raw/train.csv"
  test_file: "data/raw/test.csv"
  sample_submission_file: "data/raw/sample_submission.csv"

validation:
  fold_file: "data/processed/folds.csv"
  frozen: false
  random_seed: 42
  n_splits: 5

submissions:
  dir: "submissions"
  allow_submit: false
  dry_run_default: true
  daily_budget: 3
  cooldown_minutes: 30
  require_cv_record: true
  require_format_check: true

experiments:
  dir: "experiments"
  registry_db: "experiments/runs.sqlite"
  artifacts_dir: "experiments/artifacts"

kaggle:
  cli_command: "kaggle"
  use_cli: true
  allow_external_data: false
```

这个文件是 AutoKaggle 自己的配置，不替代 `.aura-workspace/config/config.yml`。Aura 的 LLM、tool timeout、state metabolism、security 仍由 `.aura-workspace/config/config.yml` 管理。

## 8. Garden 设计

Garden 的定位是 AutoKaggle 项目的上下文工程和脚手架 playbook。它负责把 workspace 布局、提示词、锚点、工具边界、阶段门禁和内部 skill 组织成一个可运行的 Aura use-case。AutoKaggle 文档内部的可复用执行规程叫 `skill`，写在 `skills/auto-kaggle/SKILL.md`；Garden 可以引用和要求这个 skill，但不要把 Garden 解释成另一个同层级的 AutoKaggle 操作规程。

`garden/auto-kaggle/garden.md` 应包含可被 Aura `GardenProvider` 和 `aura garden list` 发现的 frontmatter：

```yaml
---
name: auto-kaggle
description: Controlled Kaggle competition workflow with validation, experiment registry, and submission guard.
requires:
  - ak_competition
  - ak_run_registry
  - ak_submit_guard
  - blackboard
  - plan_task
---
```

Garden 内容按阶段组织 agent 上下文：

1. Workspace ready
   - 运行 `aura tools list` 可见 `ak_*` 工具。
   - 运行 `aura garden status` 可见 workspace 总览和 anchor 聚合进度。
   - 运行 `aura anchor status` 可见具体 anchors、完成状态和推荐后继节点。
2. Data catalog
   - 只读大文件的 `.hint` 和 catalog，不直接读取完整 CSV。
   - 生成 `reports/data_catalog.json`。
3. Baseline
   - 运行 `python src/baseline.py`。
   - 通过 `ak_run_registry record` 记录 baseline。
4. Validation freeze
   - 生成 folds。
   - `validation.frozen=true` 后，实验 agent 默认不得修改 `src/data.py`、`src/metric.py`、fold 文件。
5. Exploration
   - 实验只能写 `src/features.py`、`src/models.py`、`src/ensemble.py`、`experiments/<run_id>/`。
   - 每个实验必须记录 hypothesis、changed files、CV、artifact path。
6. Candidate selection
   - 读取 registry，而不是相信自然语言总结。
   - 候选必须通过 `ak_submit_guard validate`。
7. Submission
   - 默认 dry-run。
   - 真实 submit 需要 `allow_submit=true` 且 budget/cooldown/format/CV 全通过。
8. Feedback
   - 记录 LB 分数。
   - 根据 CV/LB 分歧更新 reports 和 knowledge。

## 9. Skill 设计

`skills/auto-kaggle/SKILL.md` 是 AutoKaggle 文档内部的 agent 操作规程。它不执行确定性动作，只约束决策，并由 Garden 装配进项目上下文。

必须写入的规则：

- 先读 `config/autokaggle.yml`、`task.md`、`garden/auto-kaggle/garden.md`。
- 对大数据文件优先读 `.hint`，必要时写脚本抽样，不整文件注入上下文。
- 提交前必须调用 `ak_submit_guard`。
- registry 是实验事实来源，blackboard 是并行临时共享，不是永久账本。
- 每个实验要有 hypothesis 和 stop condition。
- 如果 CV 异常高，优先怀疑 leakage。
- 如果 CV/LB 背离，不允许继续盲目用 public LB 调参。
- 没有用户明确开启 `allow_submit` 时，只能 dry-run。

## 10. Tool 契约

所有 tool 遵守 Aura docs 的 Tool Protocol：

- 目录：`tools/<name>/manifest.json`、`logic.py`、`logic.py.hint`
- 输入：JSON via STDIN
- 输出：单个 JSON object
- schema：顶层 `type: object`
- 权限：尽量用 `read-write` 和 `allow_paths`，避免 `full-access`

建议所有需要参与恢复语义的 tool 额外支持一个可选输出字段：

- `anchor_runtime_update`

它不是完整状态机，只是一个轻量恢复接口，供 agent 在调用
`anchor_submit` 时一并提交。推荐字段：

```json
{
  "phase": "waiting_guard",
  "active_run_id": "candidate_004",
  "active_submission_path": "submissions/candidate_004.csv",
  "active_submission_id": "12345",
  "resume_action": "retry_guard_for_same_candidate",
  "resume_at": "2026-06-18T00:00:00Z",
  "tool_note": "guard wait 900s for candidate_004"
}
```

约束：

- 每个字段都应保持很短；
- `tool_note` 只写对恢复最关键的一句；
- LLM 另写一段 `summary`，与 `anchor_runtime_update` 一起持久化到 anchor event；
- 最新 anchor event 作为 workflow 的轻量 runtime snapshot。

### 10.1 `ak_run_registry`

职责：本地实验账本，第一期必须实现。

存储：`experiments/runs.sqlite`

动作：

- `init`
- `record`
- `get`
- `best`
- `list`
- `compare`
- `attach_lb`
- `export_report`

最小 manifest：

```json
{
  "name": "ak_run_registry",
  "description": "Record, query, and export AutoKaggle experiment runs.",
  "runtime": "python3",
  "entry": "logic.py",
  "auto_load": true,
  "permissions": {
    "file_system": "read-write",
    "allow_paths": ["./experiments", "./reports", "./submissions", "./config"]
  },
  "input_schema": {
    "type": "object",
    "properties": {
      "action": { "type": "string" },
      "run_id": { "type": "string" },
      "payload": { "type": "object" },
      "top_k": { "type": "integer" }
    },
    "required": ["action"]
  },
  "memory": {
    "retention": "ephemeral",
    "summarize": true,
    "max_steps": 5
  }
}
```

SQLite schema：

```sql
CREATE TABLE IF NOT EXISTS runs (
  run_id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  status TEXT NOT NULL,
  hypothesis TEXT,
  model_family TEXT,
  metric_name TEXT,
  cv_score REAL,
  cv_std REAL,
  higher_is_better INTEGER,
  params_json TEXT,
  changed_files_json TEXT,
  artifacts_json TEXT,
  submission_path TEXT,
  submission_sha256 TEXT,
  lb_score REAL,
  notes TEXT
);
```

`record` 输出示例：

```json
{
  "status": "ok",
  "run_id": "baseline_20260617_001",
  "cv_score": 0.8123,
  "submission_sha256": "...",
  "anchor_runtime_update": {
    "phase": "candidate_recorded",
    "active_run_id": "baseline_20260617_001",
    "active_submission_path": "submissions/baseline_20260617_001.csv",
    "resume_action": "run_verifier_for_same_candidate",
    "tool_note": "registry recorded baseline_20260617_001"
  }
}
```

### 10.2 `ak_submit_guard`

职责：提交前格式、预算、冷却、重复 hash、CV 记录检查。第一期只需要 dry-run validate，第二期再真实 submit。

动作：

- `validate`
- `budget`
- `submit`
- `history`

第一期 `submit` 永远拒绝真实提交，除非实现第二期并且 config 明确允许。

检查项：

- `submission_path` 存在且在 `submissions/` 下。
- sample submission 存在。
- 列名完全一致。
- 行数一致。
- ID 列顺序一致。
- 无缺失值。
- 无重复 ID。
- sha256 没有提交过。
- registry 中存在对应 run 且有 CV。
- daily budget 未耗尽。
- cooldown 已满足。
- `allow_submit=true` 才允许真实提交。

输出示例：

```json
{
  "status": "wait_required",
  "submission_path": "submissions/baseline.csv",
  "checks": {
    "columns": "ok",
    "rows": "ok",
    "id_alignment": "ok",
    "missing_values": "ok",
    "budget": "cooldown_active",
    "duplicate_hash": "ok"
  },
  "wait_seconds": 1800,
  "wait_chunk_seconds": 900,
  "sha256": "...",
  "anchor_runtime_update": {
    "phase": "waiting_guard",
    "active_run_id": "baseline_20260617_001",
    "active_submission_path": "submissions/baseline.csv",
    "resume_action": "retry_guard_for_same_candidate",
    "resume_at": "2026-06-18T00:00:00Z",
    "tool_note": "guard wait 900s for baseline_20260617_001"
  }
}
```

`submit` 成功后应进一步返回：

```json
{
  "status": "ok",
  "submit_result": {
    "status": "ok",
    "submission_id": "12345"
  },
  "anchor_runtime_update": {
    "phase": "submission_sent",
    "active_run_id": "baseline_20260617_001",
    "active_submission_path": "submissions/baseline.csv",
    "active_submission_id": "12345",
    "resume_action": "poll_submission_feedback",
    "tool_note": "submission 12345 sent for baseline_20260617_001"
  }
}
```

### 10.3 `ak_competition`

职责：封装 Kaggle CLI/API。第一期只实现 offline metadata 和本地 catalog，第二期接真实 Kaggle CLI。

动作：

- `inspect`
- `catalog`
- `download`
- `leaderboard`
- `submissions`

第一期：

- `inspect` 读取 `config/autokaggle.yml`。
- `catalog` 扫描 `data/raw/` 并生成 `reports/data_catalog.json` 与 `.hint`。
- `download` 在 offline 模式返回失败并说明需要 `--mode kaggle --allow-download`。

第二期：

- 使用本机 `kaggle` CLI。
- 实现时以本机 `kaggle --help` 和官方 Kaggle CLI docs 为准。
- 不把 token 输出到 stdout/stderr。

`submissions` 推荐输出：

```json
{
  "status": "ok",
  "submissions": [
    {
      "submission_id": "12345",
      "status": "pending"
    }
  ],
  "polled_at": 1781700000,
  "anchor_runtime_update": {
    "phase": "polling_feedback",
    "active_submission_id": "12345",
    "resume_action": "attach_lb_feedback",
    "tool_note": "polled submission 12345"
  }
}
```

## 11. Template 代码设计

### `src/data.py`

职责：

- 读取 `config/autokaggle.yml`。
- 加载 train/test/sample submission。
- 推断 target/id column 的默认值。
- 生成 folds。

约束：

- 只使用 pandas/numpy/sklearn 标准依赖。
- 大数据读取需要可配置抽样。

### `src/metric.py`

职责：

- 提供统一 `score(y_true, y_pred)`。
- offline fixture 默认做二分类 AUC 或 RMSE 中的一个简单 metric。

第一期不做复杂 metric 自动推断；只允许 bootstrap 写入默认 metric，agent 可提出修改，但 validation freeze 后要记录。

### `src/baseline.py`

职责：

- 跑一个稳定 baseline。
- 生成 OOF、test prediction、submission。
- 调用或提示调用 `ak_run_registry record`。

输出：

- `experiments/baseline/oof.csv`
- `submissions/baseline.csv`
- `reports/baseline.json`

### `src/features.py`、`src/models.py`、`src/ensemble.py`

职责：

- 作为后续 agent 实验编辑区域。
- 初始只放最小可用函数和 `@aura-hint`。

## 12. State 与长任务设计

Aura docs 中 state 是 session SQLite，blackboard 位于 session bus。AutoKaggle 的使用方式：

- `task.md`：人类可读的当前阶段 checklist。
- `anchors/`：阶段门禁，被 `aura garden status` 汇总，并由 `aura anchor status` 展示节点详情。
- `experiments/runs.sqlite`：事实账本，不随 session 切换丢失。
- `blackboard`：并行 subagent 临时交换结果。
- `.aura-workspace/state/sessions/...`：Aura 自身事件历史。
- `knowledge/`：长期可检索经验和比赛说明摘要。

不要把长期实验结果只存到 Aura session history。session 可以被切换、压缩或清理，实验事实必须落盘到 registry。

## 13. Agent 开放性与 Workflow 稳定性

开放部分：

- 特征假设。
- 模型族选择。
- 超参搜索。
- ensemble 权重。
- 错误分析。

稳定部分：

- 数据目录。
- sample submission 对齐。
- fold 文件。
- metric 接口。
- registry schema。
- submit guard。
- budget/cooldown。
- report 格式。

权限建议：

- 父 agent：可以修改 `src/ensemble.py`、读 registry、调用 submit guard。
- 实验 agent：只能写 `experiments/<run_id>/` 和指定实验文件。
- 真实 submit：只能通过 `ak_submit_guard submit`，不能直接让 agent 跑 shell submit。

第一期可以不启用 Aura `subagent`。先用单 agent + registry 跑通；第二期再把 subagent 并行加入 garden。

## 14. 实施阶段

### Phase 1：离线可运行 MVP

交付：

- `README.md`
- `scripts/bootstrap.py`
- `workflow.yml`
- `garden/auto-kaggle/garden.md`
- `skills/auto-kaggle/SKILL.md`
- `tools/ak_run_registry`
- `tools/ak_submit_guard`
- `tools/ak_competition` 的 offline catalog
- `template/` 中最小可运行代码
- `scripts/smoke_offline.py`

验收：

```bash
tmpdir=$(mktemp -d)
aura new "$tmpdir"
cd "$tmpdir"
python /path/to/aura/use-cases/auto-kaggle/scripts/bootstrap.py --slug offline-demo --mode offline
aura tools list
aura skill list
aura garden list
aura workflow doctor
aura workflow status
python src/baseline.py
aura kernel run_call ak_run_registry '{"action":"best","top_k":3}'
aura kernel run_call ak_submit_guard '{"action":"validate","submission_path":"submissions/baseline.csv","dry_run":true}'
```

### Phase 2：真实 Kaggle 下载与元数据

交付：

- `ak_competition download`
- `ak_competition submissions`
- `ak_competition leaderboard`
- Kaggle CLI 存在性和认证检查
- 不泄露 token 的错误处理

验收：

```bash
aura kernel run_call ak_competition '{"action":"inspect"}'
aura kernel run_call ak_competition '{"action":"download"}'
aura kernel run_call ak_competition '{"action":"catalog"}'
```

### Phase 3：受控真实提交

交付：

- `ak_submit_guard submit`
- budget/cooldown 持久化
- submission hash 去重
- LB score attach 到 registry

验收：

```bash
# config/autokaggle.yml 中 allow_submit 必须为 true
aura kernel run_call ak_submit_guard '{"action":"submit","submission_path":"submissions/candidate.csv","run_id":"..."}'
aura kernel run_call ak_run_registry '{"action":"get","run_id":"..."}'
```

### Phase 4：并行实验与知识沉淀

交付：

- garden 中加入 subagent 分派模式。
- blackboard payload schema。
- `reports/round_<n>.md` 汇总。
- `knowledge/competition_notes.md` 和失败模式沉淀。

验收：

- 至少两个实验 run 写入 registry。
- 父 agent 从 registry 和 blackboard 选择候选。
- CV/LB 分歧能写入 postmortem。

## 15. 测试计划

### 本地脚本测试

`scripts/smoke_offline.py`：

1. 创建临时目录。
2. 运行 `aura new`。
3. 运行 bootstrap offline。
4. 检查文件存在。
5. 运行 `python src/baseline.py`。
6. 直接执行 tool logic 或通过 `aura kernel run_call` 检查 registry 和 guard。

### Aura 集成测试建议

如果要纳入 Aura 测试套件，按 docs 的测试分层：

- bootstrap 和纯 Python tool 行为：`tests/integration/` 或 use-case 自带 smoke。
- tool 被 kernel 调用：`tests/system/kernel-tools/`，需要 `RUN_SYSTEM_TESTS=1`。
- agent 端到端：`tests/system/kernel-workflows/`，只做 offline 小任务，不下载真实 Kaggle 数据。

默认 CI 不应依赖真实 Kaggle 网络和凭证。

### 必测用例

- bootstrap 拒绝非 Aura workspace。
- bootstrap 不覆盖用户文件，除非 `--force`。
- `aura tools list` 能看到 `ak_*`。
- `aura skill list` 能看到 `auto-kaggle`。
- `aura garden list` 能看到 `auto-kaggle`。
- baseline 产生 submission。
- submit guard 接受正确 submission。
- submit guard 拒绝错误列名。
- submit guard 拒绝错误行数。
- submit guard 拒绝重复 hash。
- registry 能返回 best run。

## 16. 风险与约束

### Kaggle CLI 变化

Kaggle CLI 参数可能变化。`ak_competition` 第二期实现时必须：

- 使用 `kaggle --help` 或子命令 help 做本机校验。
- 将 CLI 输出解析为受控 JSON。
- 不把完整 stderr 长输出注入上下文。

### Metric 推断不可靠

第一期不追求自动完美推断 metric。策略：

- 从 sample submission、target dtype、用户配置推断默认值。
- 生成 `reports/metric_assumption.md`。
- agent 必须复核。
- validation freeze 后变更 metric 需要 registry 记录。

### Public leaderboard 过拟合

策略：

- daily budget 和 cooldown。
- CV/LB 背离报告。
- 不允许将 CV 变差但 LB 偶然变好的实验自动推广为主线。

### 大数据上下文污染

策略：

- `.hint` + `reports/data_catalog.json`。
- 工具输出截断。
- `experiments/` 和 `data/` 下大文件不读入上下文。

## 17. Definition of Done

第一期完成的标准：

- 从一个空 Aura workspace 能一条 bootstrap 命令初始化 AutoKaggle。
- `aura tools list`、`aura skill list`、`aura garden list`、`aura workflow doctor` 都能发现或验证对应能力。
- offline fixture 可以跑 baseline。
- baseline run 被写入 registry。
- baseline submission 能通过 dry-run guard。
- 错误 submission 能被 guard 拒绝。
- README 中有完整命令。
- 不需要真实 Kaggle 凭证、不需要网络、不需要真实 LLM 即可跑 smoke。

第二期完成的标准：

- 在用户已有 Kaggle CLI 认证的机器上可以下载真实比赛文件。
- catalog/hint/report 能处理真实数据目录。
- 仍不会自动提交。

第三期完成的标准：

- 真实提交只通过 `ak_submit_guard`。
- budget、cooldown、hash 去重、registry attach 全部生效。
- 每次提交都有可审计记录。

## 18. 推荐立即实现顺序

1. 写 `README.md` 和 bootstrap。
2. 写 template offline fixture 和 baseline。
3. 写 `ak_run_registry`。
4. 写 `ak_submit_guard` dry-run validate。
5. 写 `ak_competition catalog`。
6. 写 garden 和 skill。
7. 写 `scripts/smoke_offline.py`。
8. 手动在临时 Aura workspace 中跑 Definition of Done。

这个顺序先证明 AutoKaggle 能作为 Aura use-case 被实际安装、发现和运行，再接真实 Kaggle API。这样 agent 的探索空间足够开放，但 workflow 的入口、账本和提交门禁都是确定的。
