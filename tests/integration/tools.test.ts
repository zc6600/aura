import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execa } from 'execa';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MCPManager } from '../../src/core/ext/mcp/manager.js';
import { Runner } from '../../src/core/kernel/runner.js';
import { initializeWorkspaceInPlace } from '../../src/utils/workspaceInitializer.js';

interface GrepResult {
  file: string;
  line: number;
  content: string;
}

describe('Tools Integration', { timeout: 30000 }, () => {
  let projectPath: string;
  let runner: Runner;

  beforeEach(async () => {
    projectPath = fs.mkdtempSync(
      path.join(os.tmpdir(), 'aura-tools-integration-'),
    );

    // Initialize workspace scaffolding directly in-process
    await initializeWorkspaceInPlace(projectPath);

    runner = new Runner(projectPath);
  });

  afterEach(() => {
    try {
      if (runner?.memory?.store) {
        runner.memory.store.close();
      }
    } catch (_e) {}

    try {
      if (fs.existsSync(projectPath)) {
        fs.rmSync(projectPath, { recursive: true, force: true });
      }
    } catch (_e) {}
  });

  // 1. Read File Tool
  it('read_file scenario', async () => {
    const testFile = path.join(projectPath, 'sample.txt');
    fs.writeFileSync(testFile, 'Line 1\nLine 2\nLine 3\nLine 4\n');

    // Read entire file
    const res = await runner.runCall({
      tool: 'read_file',
      args: { file_path: 'sample.txt' },
      summary: 'Read entire sample file',
    });

    expect(res.status).toBe('ok');
    expect(res.content).toContain('Line 2');

    // Read specific range (lines 2 to 3)
    const resRange = await runner.runCall({
      tool: 'read_file',
      args: { file_path: 'sample.txt', start_line: 2, end_line: 3 },
      summary: 'Read lines 2-3',
    });

    expect(resRange.status).toBe('ok');
    expect(resRange.content).toContain('Line 2');
    expect(resRange.content).toContain('Line 3');
    expect(resRange.content).not.toContain('Line 1');
    expect(resRange.content).not.toContain('Line 4');
  });

  // 2. Write File Tool
  it('write_file scenario', async () => {
    // Write file in nested folder
    const res = await runner.runCall({
      tool: 'write_file',
      args: {
        file_path: 'src/nested/hello.txt',
        content: 'Hello Aura!',
      },
      summary: 'Write nested hello file',
    });

    expect(res.status).toBe('ok');
    expect(res.file_path).toBe('src/nested/hello.txt');
    expect(res.bytes_written).toBe(11);

    // Verify physical file existence
    const physicalPath = path.join(projectPath, 'src/nested/hello.txt');
    expect(fs.existsSync(physicalPath)).toBe(true);
    expect(fs.readFileSync(physicalPath, 'utf-8')).toBe('Hello Aura!');

    // Verify security constraint: writing a forbidden extension file fails
    const resForbidden = await runner.runCall({
      tool: 'write_file',
      args: {
        file_path: 'secrets.env',
        content: 'SECRET=123',
      },
      summary: 'Attempt to write forbidden extension',
    });

    expect(resForbidden.status).toBe('failed');
    expect(resForbidden.error).toContain('forbidden');
  });

  // 3. Workspace Grep Tool
  it('workspace_grep scenario', async () => {
    fs.writeFileSync(
      path.join(projectPath, 'math.rb'),
      'def calculate_sum(a, b)\n  a + b\nend\n',
    );
    fs.writeFileSync(
      path.join(projectPath, 'string_utils.py'),
      'def concat_strings(s1, s2):\n  return s1 + s2\n',
    );

    // Plain text search
    const res = (await runner.runCall({
      tool: 'workspace_grep',
      args: { query: 'concat' },
      summary: 'Grep for concat',
    })) as any;

    expect(res.status).toBe('ok');
    expect(res.count).toBe(1);
    expect(res.results[0].file).toBe('string_utils.py');
    expect(res.results[0].content).toContain('def concat_strings');

    // Regex search
    const resRegex = await runner.runCall({
      tool: 'workspace_grep',
      args: {
        query: 'def\\s+[a-z_]+',
        is_regex: true,
      },
      summary: 'Grep for function definitions',
    });

    expect(resRegex.status).toBe('ok');
    expect(resRegex.count).toBeGreaterThanOrEqual(2);

    // Search with file pattern filtering
    const resFilter = (await runner.runCall({
      tool: 'workspace_grep',
      args: {
        query: 'def',
        file_pattern: '*.py',
      },
      summary: 'Grep def in python files only',
    })) as any;

    expect(resFilter.status).toBe('ok');
    const files = resFilter.results.map((r: GrepResult) => r.file);
    expect(files).toContain('string_utils.py');
    expect(files).not.toContain('math.rb');
  });

  // 4. Timer Tool
  it('timer scenario', async () => {
    const startTime = Date.now();
    const res = await runner.runCall({
      tool: 'timer',
      args: { seconds: 0.5 },
      summary: 'Pause for 0.5 seconds',
    });
    const elapsed = (Date.now() - startTime) / 1000;

    expect(res.status).toBe('ok');
    expect(elapsed).toBeGreaterThanOrEqual(0.4);
    expect(res.message).toContain('0.5 seconds');

    // Test wait_pid with non-running/fictional PID
    const resPid = await runner.runCall({
      tool: 'timer',
      args: {
        wait_pid: 9999999,
        poll_interval: 0.05,
        timeout_seconds: 0.5,
      },
      summary: 'Wait for fictional PID',
    });

    expect(resPid.status).toBe('finished');
    expect(resPid.pid).toBe(9999999);
  });

  // 5. Bash Command Tool
  it('bash_command scenario', async () => {
    // Run basic exit-0 command
    const res = (await runner.runCall({
      tool: 'bash_command',
      args: { command: "echo 'hello aura'" },
      summary: 'Run echo command',
    })) as any;

    expect(res.status).toBe('ok');
    expect(res.stdout.trim()).toContain('hello aura');
    expect(res.exit_code).toBe(0);

    // Run exit-1 command
    const resFailed = await runner.runCall({
      tool: 'bash_command',
      args: { command: 'false' },
      summary: 'Run false command',
    });

    expect(resFailed.status).toBe('failed');
    expect(resFailed.exit_code).toBe(1);

    // Test background execution (via low timeout)
    const resBg = await runner.runCall({
      tool: 'bash_command',
      args: {
        command: 'sleep 10 && echo "finished"',
        timeout_seconds: 0.5,
      },
      summary: 'Run slow background sleep',
    });

    expect(resBg.status).toBe('running');
    expect(resBg.pid).toBeDefined();
    expect(resBg.message).toContain('background');

    // Terminate background PID
    const termRes = await runner.runCall({
      tool: 'bash_command',
      args: { terminate_pid: resBg.pid },
      summary: 'Kill slow background sleep',
    });
    expect(termRes.status).toBe('terminated');
  });

  // 6. Inspect Tool Tool
  it('inspect_tool scenario', async () => {
    const res = await runner.runCall({
      tool: 'inspect_tool',
      args: { tool_name: 'read_file' },
      summary: 'Inspect read_file tool properties',
    });

    expect(res.status).toBe('ok');
    expect(res.name).toBe('read_file');
    expect(res.description).toBeDefined();
    expect(res.input_schema).toBeDefined();
  });

  // 7. Blackboard Tool
  it('blackboard scenario', async () => {
    // Write variable
    const resWrite = await runner.runCall({
      tool: 'blackboard',
      args: {
        action: 'write',
        key: 'global_status',
        content: { phase: 'development', step: 5 },
      },
      summary: 'Write status to blackboard',
    });

    expect(resWrite.status).toBe('success');
    expect(resWrite.key).toBe('global_status');

    // Read variable
    const resRead = (await runner.runCall({
      tool: 'blackboard',
      args: {
        action: 'read',
        key: 'global_status',
      },
      summary: 'Read status from blackboard',
    })) as any;

    expect(resRead.status).toBe('success');
    expect(resRead.content.phase).toBe('development');
    expect(resRead.content.step).toBe(5);

    // Lock and release
    const resLock = await runner.runCall({
      tool: 'blackboard',
      args: {
        action: 'lock',
        key: 'consensus_lock',
        timeout: 2,
      },
      summary: 'Acquire consensus lock',
    });

    expect(resLock.status).toBe('success');
    expect(resLock.lock).toBe('acquired');

    const resRelease = await runner.runCall({
      tool: 'blackboard',
      args: {
        action: 'release',
        key: 'consensus_lock',
      },
      summary: 'Release consensus lock',
    });

    expect(resRelease.status).toBe('success');
    expect(resRelease.lock).toBe('released');

    // List variables
    const resList = await runner.runCall({
      tool: 'blackboard',
      args: {
        action: 'list',
        key: '*',
      },
      summary: 'List blackboard keys',
    });

    expect(resList.status).toBe('success');
    expect(resList.keys).toContain('global_status');

    // Delete variable
    const resDel = await runner.runCall({
      tool: 'blackboard',
      args: {
        action: 'delete',
        key: 'global_status',
      },
      summary: 'Delete blackboard key',
    });

    expect(resDel.status).toBe('success');
    expect(resDel.action).toBe('deleted');
  });

  // 8. Knowledge DB Tool
  it('knowledge_db scenario', async () => {
    const resCreate = await runner.runCall({
      tool: 'knowledge_db',
      args: {
        action: 'create',
        db_name: 'test_kb',
      },
      summary: 'Create test knowledge database',
    });

    expect(resCreate.status).toBe('success');
    expect(resCreate.db_path).toBe('knowledge/test_kb.db');

    // Save document
    const resSave1 = await runner.runCall({
      tool: 'knowledge_db',
      args: {
        action: 'save',
        db_name: 'test_kb',
        text: 'Aura OS is an agent operating system that supports self-evolution.',
        tag: 'architecture',
      },
      summary: 'Save architecture document',
    });
    expect(resSave1.status).toBe('success');

    // Search document using keyword mode
    const resSearch = (await runner.runCall({
      tool: 'knowledge_db',
      args: {
        action: 'search',
        db_name: 'test_kb',
        query: 'self-evolution OS',
        retrieval_mode: 'keyword',
      },
      summary: 'Search for OS docs',
    })) as any;

    expect(resSearch.status).toBe('success');
    expect(resSearch.chunks.length).toBeGreaterThanOrEqual(1);

    const chunk = resSearch.chunks[0];
    expect(chunk.tag).toBe('architecture');
    expect(chunk.get_args.action).toBe('get');
    const docId = chunk.get_args.id;
    expect(docId).toBeDefined();

    // Retrieve document
    const resGet = await runner.runCall({
      tool: 'knowledge_db',
      args: {
        action: 'get',
        db_name: 'test_kb',
        id: docId,
      },
      summary: 'Get document contents',
    });

    expect(resGet.status).toBe('success');
    expect(resGet.content).toContain('Aura OS');

    // Delete document
    const resDel = await runner.runCall({
      tool: 'knowledge_db',
      args: {
        action: 'delete',
        db_name: 'test_kb',
        id: docId,
      },
      summary: 'Delete document',
    });

    expect(resDel.status).toBe('success');
    expect(resDel.deleted).toBe(1);
  });

  // 9. Plan Task Tool
  it('plan_task scenario', async () => {
    const resCreate = (await runner.runCall({
      tool: 'plan_task',
      args: {
        action: 'create',
        tasks: ['Create folders', 'Write tests', 'Verify everything'],
        run_id: 'task_run_99',
      },
      summary: 'Initialize task list',
    })) as any;

    expect(resCreate.status).toBe('success');
    expect(resCreate.tasks.length).toBe(3);

    const resUpdate = await runner.runCall({
      tool: 'plan_task',
      args: {
        action: 'update',
        completed_indices: [0],
        in_progress_indices: [1],
        run_id: 'task_run_99',
      },
      summary: 'Update progress on tasks',
    });

    expect(resUpdate.status).toBe('success');
    expect(resUpdate.completed_indices).toContain(0);
    expect(resUpdate.in_progress_indices).toContain(1);

    const resGet = (await runner.runCall({
      tool: 'plan_task',
      args: {
        action: 'get',
        run_id: 'task_run_99',
      },
      summary: 'Fetch task progress overview',
    })) as any;

    expect(resGet.status).toBe('success');
    expect(resGet.completed_indices).toContain(0);
    expect(resGet.in_progress_indices).toContain(1);
    expect(resGet.tasks.length).toBe(3);
  });

  // 10. Plan Proposal Tool
  it('plan_proposal scenario', async () => {
    const resCreate = (await runner.runCall({
      tool: 'plan_proposal',
      args: {
        action: 'create',
        goal: 'Refactor tests to separate plumbing from capabilities',
        steps: [
          'Create tool system test folders',
          'Migrate existing tests',
          'Run verification',
        ],
        files_to_modify: ['test/system/test_system_subagents.rb'],
        verification_commands: ['rake test:system'],
        run_id: 'refactor_run_01',
      },
      summary: 'Draft refactoring plan',
    })) as any;

    expect(resCreate.status).toBe('success');
    expect(resCreate.run_id).toBe('refactor_run_01');
    expect(resCreate.plan.status).toBe('pending');

    const resGet = (await runner.runCall({
      tool: 'plan_proposal',
      args: {
        action: 'get',
        run_id: 'refactor_run_01',
      },
      summary: 'Retrieve refactoring plan',
    })) as any;

    expect(resGet.status).toBe('success');
    expect(resGet.plan.goal).toBe(
      'Refactor tests to separate plumbing from capabilities',
    );
    expect(resGet.plan.steps.length).toBe(3);

    const resApprove = (await runner.runCall({
      tool: 'plan_proposal',
      args: {
        action: 'approve',
        run_id: 'refactor_run_01',
      },
      summary: 'Approve drafted plan',
    })) as any;

    expect(resApprove.status).toBe('success');
    expect(resApprove.plan.status).toBe('approved');
  });

  // 11. Anchor Submit Tool
  it('anchor_submit scenario', async () => {
    const res = await runner.runCall({
      tool: 'anchor_submit',
      args: {
        anchor_id: 'anchor_1',
        summary: 'Phase 1: Finished implementing initial files.',
        selected_next: 'phase_2',
        notes: 'Builds successfully.',
      },
      summary: 'Submit phase 1 anchor completion',
    });

    expect(res.status).toBe('success');
    expect(res.anchor_id).toBe('anchor_1');
    expect(res.next_stage).toBe('phase_2');
    expect(res.summary).toContain('Finished');

    const resErr = await runner.runCall({
      tool: 'anchor_submit',
      args: {
        anchor_id: 'anchor_1',
      },
      summary: 'Attempt to submit missing summary',
    });
    expect(resErr.status).toBe('failed');
    expect(resErr.error).toContain('required');
  });

  // 12. Dynamic Custom Workflow Tool Loading and Run
  it('custom workflow tool loading and run', async () => {
    const workflowDir = path.join(projectPath, '.aura', 'tools', 'workflow');
    fs.mkdirSync(workflowDir, { recursive: true });

    const manifest = {
      name: 'workflow',
      description: 'Custom automated multi-step workflow tool.',
      runtime: 'python',
      entry: 'logic.py',
      input_schema: {
        type: 'object',
        properties: {
          steps: { type: 'array', items: { type: 'string' } },
        },
        required: ['steps'],
      },
    };
    fs.writeFileSync(
      path.join(workflowDir, 'manifest.json'),
      JSON.stringify(manifest, null, 2),
    );

    const pythonScript = `
import sys
import json

def main():
    try:
        if len(sys.argv) > 1 and sys.argv[1].strip():
            args = json.loads(sys.argv[1])
        else:
            args = json.loads(sys.stdin.read())
        steps = args.get("steps", [])
        result_steps = [f"Executed: {step}" for step in steps]
        print(json.dumps({
            "status": "ok",
            "executed_count": len(steps),
            "results": result_steps
        }))
    except Exception as e:
        print(json.dumps({"status": "failed", "error": str(e)}))

if __name__ == "__main__":
    main()
`;
    fs.writeFileSync(path.join(workflowDir, 'logic.py'), pythonScript.trim());

    // Reinitialize runner to detect the new tool
    const localRunner = new Runner(projectPath);

    const res = (await localRunner.runCall({
      tool: 'workflow',
      args: {
        steps: ['lint', 'test', 'build'],
      },
      summary: 'Execute custom automated pipeline steps',
    })) as any;

    localRunner.memory.store.close();

    expect(res.status).toBe('ok');
    expect(res.executed_count).toBe(3);
    expect(res.results[1]).toBe('Executed: test');
  });

  it('walkthrough_generator scenario', async () => {
    // Walkthrough generator expects a git repo to find changes
    await execa('git', ['init'], { cwd: projectPath });
    await execa('git', ['config', 'user.name', 'Test User'], {
      cwd: projectPath,
    });
    await execa('git', ['config', 'user.email', 'test@aura.ai'], {
      cwd: projectPath,
    });
    await execa('git', ['commit', '--allow-empty', '-m', 'Initial commit'], {
      cwd: projectPath,
    });

    // Simulate agent writing a file
    await runner.runCall({
      tool: 'write_file',
      args: {
        file_path: 'lib/new_logic.py',
        content: 'class NewLogic:\n    pass\n',
      },
      summary: 'Implement new business logic',
    });

    // Run walkthrough generator
    const res = (await runner.runCall({
      tool: 'walkthrough_generator',
      args: {
        action: 'generate',
        summary: 'Created NewLogic class to handle core workflows.',
        run_id: 'run_test_123',
      },
      summary: 'Generate changes walkthrough report',
    })) as any;

    expect(res.status).toBe('success');
    expect(res.run_id).toBe('run_test_123');
    expect(res.modified_files).toContain('lib/new_logic.py');
    expect(res.content).toContain(
      'Created NewLogic class to handle core workflows.',
    );
    expect(res.content).toContain('lib/new_logic.py');

    const reportPath = path.join(projectPath, res.walkthrough_path);
    const jsonPath = path.join(projectPath, res.walkthrough_json_path);
    expect(fs.existsSync(reportPath)).toBe(true);
    expect(fs.existsSync(jsonPath)).toBe(true);
  });

  // 14. MCP Client Placeholder
  it('mcp client placeholder behavior', async () => {
    const manager = new MCPManager(projectPath);
    expect(manager.mcpTool('mcp.mock_server.ping')).toBe(true);
    expect(manager.listTools()).toEqual([]);

    const res = await manager.callTool('mcp.mock_server.ping', {});
    expect(res.status).toBe('failed');
    expect(res.error).toContain('mcp server not found: mock_server');

    manager.shutdown();
  });

  // 15. OCR and Verify Tool
  it('ocr_and_verify scenario with non-existent file', async () => {
    const res = await runner.runCall({
      tool: 'ocr_and_verify',
      args: {
        image_path: 'non_existent.png',
        expected_texts: ['Aura'],
      },
      summary: 'Attempt OCR on non-existent file',
    });

    expect(res.status).toBe('failed');
    expect(res.error).toBeDefined();
  });

  // 16. Render Image Tool
  it('render_image scenario failures', async () => {
    const res = await runner.runCall({
      tool: 'render_image',
      args: {
        prompt: 'A high tech neural net visualization',
        output_path: 'output.png',
      },
      summary: 'Attempt to render image',
    });

    expect(res.status).toBe('failed');
    expect(res.error).toBeDefined();
  });
});
