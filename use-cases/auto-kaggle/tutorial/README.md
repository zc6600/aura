# AutoKaggle 教程目录

本教程把 AutoKaggle 做成一个面向用户的 Aura use-case：用户只填写比赛参数，agent 自动下载/读取结果、训练、验证、提交、读取 leaderboard 反馈，并在达到提交上限时自动调用等待工具。

在 Aura 术语里，Garden 负责搭建和维护这种项目级上下文：目录结构、任务锚点、提示词、工具边界、阶段约束和可复用模板。AutoKaggle 文档内部把可被 agent 触发和复用的操作规程称为 `skill`；也就是说，`skills/auto-kaggle/SKILL.md` 是 AutoKaggle 的执行规程，`garden/auto-kaggle/garden.md` 是把这个规程、工具、提示词和工作区组织起来的 Garden playbook。

教程按实现顺序组织：

1. [目标架构与运行方式](01-architecture.md)
2. [创建比赛工作区与参数文件](02-workspace-and-config.md)
3. [实现确定性工具](03-tools.md)
4. [创建训练代码与实验账本](04-training-and-registry.md)
5. [编写 Garden、Skill 与提示词](05-prompts-garden-skill.md)
6. [用 Ralph Loop 做提交前 verifier](06-ralph-verifier.md)
7. [启动全自动刷榜循环](07-autonomous-loop.md)
8. [测试、调试与发布](08-testing-and-release.md)
9. [从 AutoKaggle 反推 Aura 设计改进](09-aura-design-notes.md)

最终用户的理想体验：

```bash
aura new ~/kaggle/playground-s5e1
cd ~/kaggle/playground-s5e1

python /path/to/aura/use-cases/auto-kaggle/scripts/bootstrap.py \
  --params params/autokaggle.yml

aura workflow doctor
aura workflow run
```

用户主要只维护 `params/autokaggle.yml`。真实提交、等待、读取提交结果、更新实验账本、下一轮策略都由 agent 按工具返回值自动推进。
