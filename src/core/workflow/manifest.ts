import fs from 'node:fs';
import path from 'node:path';
import yaml from 'yaml';
import { z } from 'zod';

export const WorkflowStageSchema = z.object({
  id: z.string().min(1),
  title: z.string().optional(),
  anchor: z.string().optional(),
  description: z.string().optional(),
  assert_files: z.array(z.string()).optional(),
  freeze_files: z.array(z.string()).optional(),
  requires: z.array(z.string()).optional(),
  guard: z
    .object({
      tool: z.string(),
      args: z.record(z.any()).optional(),
    })
    .optional(),
  ralph: z
    .object({
      verify_cmd: z.string(),
      target: z.string().optional(),
      max_steps: z.number().optional(),
    })
    .optional(),
});

export const WorkflowManifestSchema = z
  .object({
    version: z.union([z.literal(1), z.string()]).default(1),
    name: z.string().min(1),
    description: z.string().optional(),
    params: z
      .union([
        z.string(),
        z.object({
          path: z.string(),
          schema: z.string().optional(),
        }),
      ])
      .optional(),
    context: z
      .object({
        garden: z.string().optional(),
        skill: z.string().optional(),
        prompts: z.array(z.string()).optional(),
      })
      .passthrough()
      .optional(),
    tools: z
      .object({
        required: z.array(z.string()).optional(),
      })
      .passthrough()
      .optional(),
    stages: z.array(WorkflowStageSchema).optional(),
    registry: z
      .object({
        db_path: z.string().optional(),
        metrics: z
          .array(
            z.object({
              name: z.string(),
              higher_is_better: z.boolean().optional(),
            }),
          )
          .optional(),
      })
      .optional(),
    run: z
      .object({
        mode: z.string().optional(),
        max_steps: z.number().int().positive().optional(),
        goal: z.string().min(1),
      })
      .passthrough(),
  })
  .passthrough();

export type WorkflowManifest = z.infer<typeof WorkflowManifestSchema>;

export interface LoadedWorkflow {
  root: string;
  path: string;
  manifest: WorkflowManifest;
}

export function resolveWorkflowPath(root: string, name?: string): string {
  const resolvedRoot = path.resolve(root);
  if (name?.trim()) {
    const explicit = path.join(resolvedRoot, 'workflows', `${name}.yml`);
    if (fs.existsSync(explicit)) return explicit;
    const explicitYaml = path.join(resolvedRoot, 'workflows', `${name}.yaml`);
    if (fs.existsSync(explicitYaml)) return explicitYaml;
    const rootNamed = path.join(resolvedRoot, `${name}.workflow.yml`);
    if (fs.existsSync(rootNamed)) return rootNamed;
    return explicit;
  }

  const rootYml = path.join(resolvedRoot, 'workflow.yml');
  if (fs.existsSync(rootYml)) return rootYml;
  const rootYaml = path.join(resolvedRoot, 'workflow.yaml');
  if (fs.existsSync(rootYaml)) return rootYaml;

  const workflowsDir = path.join(resolvedRoot, 'workflows');
  if (fs.existsSync(workflowsDir) && fs.statSync(workflowsDir).isDirectory()) {
    const candidates = fs
      .readdirSync(workflowsDir)
      .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
      .sort();
    if (candidates.length === 1) {
      return path.join(workflowsDir, candidates[0]);
    }
  }

  return rootYml;
}

export function loadWorkflow(root: string, name?: string): LoadedWorkflow {
  const workflowPath = resolveWorkflowPath(root, name);
  if (!fs.existsSync(workflowPath) || !fs.statSync(workflowPath).isFile()) {
    throw new Error(
      name
        ? `Workflow '${name}' not found at ${path.relative(root, workflowPath)}`
        : 'No workflow.yml found. Create workflow.yml or workflows/<name>.yml.',
    );
  }

  const raw = fs.readFileSync(workflowPath, 'utf-8');
  const parsed = yaml.parse(raw);
  const manifest = WorkflowManifestSchema.parse(parsed);
  return {
    root: path.resolve(root),
    path: workflowPath,
    manifest,
  };
}

export function paramsPath(manifest: WorkflowManifest): string | undefined {
  if (!manifest.params) return undefined;
  return typeof manifest.params === 'string'
    ? manifest.params
    : manifest.params.path;
}

export function paramsSchemaPath(
  manifest: WorkflowManifest,
): string | undefined {
  if (!manifest.params || typeof manifest.params === 'string') return undefined;
  return manifest.params.schema;
}

export function rel(root: string, target: string): string {
  return path.relative(root, path.resolve(root, target)).replace(/\\/g, '/');
}
