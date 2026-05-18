import unittest
import os
import tempfile
import json
import subprocess
import sqlite3
import time
import sys
from unittest.mock import patch, MagicMock
# Utility functions are now in scripts package
from scripts import sanitize_name, resolve_subagent_id, build_subagent_paths, extract_report, find_aura_executable, export_trajectory, truncate_text, check_subagent_status, build_async_wrapper_script
# Main orchestration stays in logic
from logic import run_subagent

class TestSubagentTool(unittest.TestCase):
    def test_sanitize_name(self):
        self.assertEqual(sanitize_name("a b"), "a_b")
        self.assertEqual(sanitize_name("a/b"), "a_b")
        self.assertIsNone(sanitize_name("   "))

    def test_resolve_subagent_id(self):
        sid = resolve_subagent_id("")
        self.assertTrue(sid.startswith("subagent_"))
        
        sid_ab = resolve_subagent_id("a/b")
        self.assertTrue(sid_ab.startswith("a_b_"))
        self.assertEqual(len(sid_ab), 8) # a_b_ + 4 chars

    def test_build_paths(self):
        with tempfile.TemporaryDirectory() as d:
            paths = build_subagent_paths("abc123", base_dir=d)
            # With depth-based hierarchy, it should be state/subagents/root/abc123 if AURA_AGENT_ID is not set
            expected_dir = os.path.join(d, "state", "subagents", "root", "abc123")
            self.assertEqual(paths["state_dir"], expected_dir)
            self.assertTrue(paths["db_path"].startswith(expected_dir))

    def test_extract_report(self):
        # Case 1: Simple result
        self.assertEqual(extract_report({"result": "done"}, "fallback"), "done")
        # Case 2: Final content
        self.assertEqual(extract_report({"final": {"content": "report"}}, "fallback"), "report")
        # Case 3: Final string
        self.assertEqual(extract_report({"final": "report"}, "fallback"), "report")
        # Case 4: Fallback
        self.assertEqual(extract_report({}, "fallback"), "fallback")

    def test_truncate_text(self):
        # Short text
        self.assertEqual(truncate_text("abc", 10), "abc")
        # Exact limit
        self.assertEqual(truncate_text("abcdefghij", 10), "abcdefghij")
        # Long text
        text = "a" * 20
        truncated = truncate_text(text, 10)
        # Expected: 5 'a's ... [...] ... 5 'a's
        self.assertTrue(truncated.startswith("aaaaa"))
        self.assertTrue(truncated.endswith("aaaaa"))
        self.assertIn("truncated", truncated)
        self.assertLess(len(truncated), len(text) + 50) # Just check it's somewhat reasonable

    def test_export_trajectory(self):
        with tempfile.TemporaryDirectory() as d:
            db_path = os.path.join(d, "aura.db")
            out_path = os.path.join(d, "trajectory.txt")
            
            # Setup DB
            conn = sqlite3.connect(db_path)
            conn.execute("CREATE TABLE events (id INTEGER PRIMARY KEY, timestamp INTEGER, phase TEXT, tool TEXT, payload TEXT)")
            conn.execute("INSERT INTO events (timestamp, phase, tool, payload) VALUES (?, ?, ?, ?)", 
                         (int(time.time()), "plan", "planner", json.dumps({"plan": {"summary": "do it"}})))
            conn.execute("INSERT INTO events (timestamp, phase, tool, payload) VALUES (?, ?, ?, ?)", 
                         (int(time.time()), "execution", "tool_a", json.dumps({"result": {"status": "ok", "output": "done"}})))
            conn.commit()
            conn.close()
            
            # Run export
            res = export_trajectory(db_path, out_path)
            self.assertEqual(res, out_path)
            self.assertTrue(os.path.exists(out_path))
            
            with open(out_path, "r") as f:
                content = f.read()
                self.assertIn("Task: do it", content)
                self.assertIn("Result: OK", content)

    def test_export_trajectory_text_truncation(self):
        with tempfile.TemporaryDirectory() as d:
            db_path = os.path.join(d, "aura_long_text.db")
            out_path = os.path.join(d, "trajectory_long_text.txt")
            
            long_output = "BEGIN" + "x" * 2000 + "END"
            
            # Setup DB
            conn = sqlite3.connect(db_path)
            conn.execute("CREATE TABLE events (id INTEGER PRIMARY KEY, timestamp INTEGER, phase TEXT, tool TEXT, payload TEXT)")
            conn.execute("INSERT INTO events (timestamp, phase, tool, payload) VALUES (?, ?, ?, ?)", 
                         (int(time.time()), "execution", "tool_long", json.dumps({"result": {"status": "ok", "output": long_output}})))
            conn.commit()
            conn.close()
            
            # Run export
            res = export_trajectory(db_path, out_path)
            self.assertEqual(res, out_path)
            
            with open(out_path, "r") as f:
                content = f.read()
                self.assertIn("tool_long", content)
                self.assertIn("BEGIN", content)
                self.assertIn("END", content)
                self.assertIn("truncated", content)
                # Check that we don't have the full string
                self.assertNotIn("x" * 2000, content)

    @patch("logic.subprocess.run")
    @patch("logic.find_aura_executable")
    @patch("logic.export_trajectory")
    def test_run_subagent_success(self, mock_export, mock_find, mock_run):
        mock_find.return_value = "/bin/aura"
        mock_run.return_value = MagicMock(returncode=0, stdout='{"final": "done"}', stderr="")
        mock_export.return_value = "/path/to/trajectory.txt"
        
        res = run_subagent("test goal")
        self.assertEqual(res["status"], "success")
        self.assertEqual(res["report"], "done")
        self.assertEqual(res["trajectory_path"], "/path/to/trajectory.txt")
        self.assertTrue(res["db_path"].endswith("aura.db"))
        mock_run.assert_called_once()
        mock_export.assert_called_once()

    @patch("logic.subprocess.run")
    @patch("logic.find_aura_executable")
    @patch("logic.export_trajectory")
    def test_run_subagent_name_alias(self, mock_export, mock_find, mock_run):
        mock_find.return_value = "/bin/aura"
        mock_run.return_value = MagicMock(returncode=0, stdout='{"final": "done"}', stderr="")
        mock_export.return_value = "/path/to/trajectory.txt"
        res = run_subagent("test goal", name="a b")
        self.assertTrue(res["subagent_id"].startswith("a_b_"))

    @patch("logic.subprocess.run")
    @patch("logic.find_aura_executable")
    def test_run_subagent_timeout(self, mock_find, mock_run):
        mock_find.return_value = "/bin/aura"
        mock_run.side_effect = subprocess.TimeoutExpired(["cmd"], 5)
        
        res = run_subagent("test goal", timeout=5)
        self.assertEqual(res["status"], "failed")
        self.assertIn("timed out", res["error"])

    @patch("logic.subprocess.run")
    @patch("logic.find_aura_executable")
    def test_run_subagent_error(self, mock_find, mock_run):
        mock_find.return_value = "/bin/aura"
        mock_run.return_value = MagicMock(returncode=1, stdout="", stderr="Error occurred")
        
        res = run_subagent("test goal")
        self.assertEqual(res["status"], "failed")
        self.assertIn("Subagent process exited with code 1", res["error"])
        self.assertEqual(res["stderr"], "Error occurred")

    def test_entry_point_with_empty_goal(self):
        payload = json.dumps({"goal": ""})
        script_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "logic.py")
        env = os.environ.copy()
        env["PYTHONPATH"] = os.path.dirname(os.path.abspath(__file__))
        result = subprocess.run([sys.executable, script_path, payload], capture_output=True, text=True, env=env, cwd=os.path.dirname(os.path.abspath(__file__)))
        data = json.loads(result.stdout)
        self.assertEqual(data["status"], "failed")
        self.assertIn("Missing 'goal'", data["error"])

    def test_persona_loading(self):
        with tempfile.TemporaryDirectory() as d:
            persona_dir = os.path.join(d, "state", "personas")
            os.makedirs(persona_dir)
            with open(os.path.join(persona_dir, "test_p.json"), "w") as f:
                json.dump({"instructions": "You are a tester."}, f)
            
            # Subagent goal should be enriched
            with patch("logic.subprocess.run") as mock_run:
                mock_run.return_value = MagicMock(returncode=0, stdout='{"final": "done"}', stderr="")
                with patch("logic.os.getcwd", return_value=d):
                    res = run_subagent("do work", persona="test_p")
                    self.assertEqual(res["status"], "success")
                    # Check env or cmd? run_subagent calls find_aura_executable which we patch
                    # But the goal passed to cmd should have the role.
                    mock_run.assert_called_once()
                    args, kwargs = mock_run.call_args
                    cmd = args[0]
                    self.assertIn("[ROLE: TEST_P]", cmd[cmd.index("-g") + 1])
                    self.assertIn("You are a tester.", cmd[cmd.index("-g") + 1])

    def test_check_status(self):
        with tempfile.TemporaryDirectory() as d:
            subagents_root = os.path.join(d, "state", "subagents", "root")
            os.makedirs(os.path.join(subagents_root, "job123"))
            status_data = {"job_id": "job123", "status": "success", "report": "all good"}
            with open(os.path.join(subagents_root, "job123", "status.json"), "w") as f:
                json.dump(status_data, f)
            
            res = check_subagent_status("job123", base_dir=d)
            self.assertEqual(res["status"], "success")
            self.assertEqual(res["report"], "all good")

    def test_check_status_not_found(self):
        with tempfile.TemporaryDirectory() as d:
            os.makedirs(os.path.join(d, "state", "subagents"))
            res = check_subagent_status("nonexistent", base_dir=d)
            self.assertEqual(res["status"], "failed")
            self.assertIn("not found", res["error"])

    @patch("logic.subprocess.Popen")
    @patch("logic.find_aura_executable")
    def test_async_mode_returns_job_id(self, mock_find, mock_popen):
        mock_find.return_value = "/bin/aura"
        mock_popen.return_value = MagicMock()

        res = run_subagent("test goal", name="async_test", async_mode=True)
        self.assertEqual(res["status"], "success")
        self.assertEqual(res["mode"], "async")
        self.assertIn("job_id", res)
        self.assertTrue(res["job_id"].startswith("async_test_"))
        self.assertIn("state_dir", res)
        mock_popen.assert_called_once()

    def test_build_async_wrapper_script(self):
        with tempfile.TemporaryDirectory() as d:
            paths = {
                "status_path": os.path.join(d, "status.json"),
                "db_path": os.path.join(d, "aura.db"),
                "trajectory_path": os.path.join(d, "trajectory.txt"),
            }
            cmd = ["echo", '{"final": "done"}']
            script = build_async_wrapper_script(cmd, paths)
            # Verify it's valid Python by compiling
            compile(script, "<wrapper>", "exec")
            # Verify important tokens are embedded
            self.assertIn("status_path", script)
            self.assertIn("atomic_write", script)
            self.assertIn("subprocess.run", script)

if __name__ == "__main__":
    unittest.main()
