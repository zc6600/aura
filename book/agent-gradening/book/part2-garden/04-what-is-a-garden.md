# Chapter 4: What Is a Garden?

In the Agent Gardening paradigm, we shift our perspective from one-off command execution to long-horizon codebase cultivation.

## The Paradigm Shift

Traditional LLM applications treat the agent as an ephemeral function: you give it a prompt, it executes a tool, and it returns a response. However, for complex engineering tasks, this approach is fundamentally limited. Large contexts suffer from drift, attention dilution, and loss of intermediate states.

A **Garden** is a persistent, structured, and evolving workspace that exists independently of any single task execution session. While individual tasks are temporary, the Garden is permanent. It provides a physical environment where the agent can store, refine, restructure, and retrieve intermediate findings without cluttering the active prompt context.

## Separation of Engineering and Science

A key principle of Agent Gardening is the strict decoupling of **Engineering** and **Science**:
- **Engineering (Soil & Setup)**: Establishing baseline solvers, data loaders, verification configurations, and testing suites. This layer must be locked and verified first to ensure a stable foundation.
- **Science (Exploration & Sweeps)**: Running parallel search runs, model tuning, parameter sweeps, or code refactor variants inside isolated sandboxes. 

By maintaining a clean separation, agents can perform rapid experiments without introducing "moving targets" that compromise stability or correctness.

## Garden Routing in Aura OS

Aura OS uses the `garden.md` playbook router and the `GardenProvider` to scan, discover, and load playbooks matching the workspace domain. Whether the workspace is focused on Software Quality (`software-checking`), Machine Learning (`kaggle`), or Scientific Research (`ai-scientist`), the OS dynamically activates appropriate rules, hints, and anchors to scaffold the execution.
