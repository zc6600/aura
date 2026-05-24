import unittest
import os
import tempfile
import json
import sqlite3
from logic import get_modified_files, compile_walkthrough, get_file_diff

class TestWalkthroughGeneratorTool(unittest.TestCase):
    def test_get_modified_files(self):
        with tempfile.TemporaryDirectory() as d:
            db_path = os.path.join(d, "aura.db")
            conn = sqlite3.connect(db_path)
            conn.execute("CREATE TABLE events (id INTEGER PRIMARY KEY AUTOINCREMENT, phase TEXT, tool TEXT, payload TEXT)")
            
            # Setup mock events
            # 1. Planned write_file to lib/auth.py
            conn.execute("INSERT INTO events (phase, tool, payload) VALUES (?, ?, ?)",
                         ("plan", "write_file", json.dumps({"args": {"file_path": "lib/auth.py"}})))
            # 2. Executed successfully
            conn.execute("INSERT INTO events (phase, tool, payload) VALUES (?, ?, ?)",
                         ("execution", "write_file", json.dumps({"result": {"status": "ok"}})))
                         
            # 3. Planned write_file to test/auth.py
            conn.execute("INSERT INTO events (phase, tool, payload) VALUES (?, ?, ?)",
                         ("plan", "write_file", json.dumps({"args": {"file_path": "test/auth.py"}})))
            # 4. Execution failed
            conn.execute("INSERT INTO events (phase, tool, payload) VALUES (?, ?, ?)",
                         ("execution", "write_file", json.dumps({"result": {"status": "failed"}})))

            conn.commit()
            
            modified = get_modified_files(conn)
            self.assertEqual(modified, ["lib/auth.py"])
            
            conn.close()

    def test_compile_walkthrough(self):
        markdown = compile_walkthrough(
            summary="Completed refactoring task",
            modified_files=["lib/auth.py"],
            diffs={"lib/auth.py": "+ new content"},
            run_id="run_test"
        )
        self.assertIn("Task Walkthrough - Run run_test", markdown)
        self.assertIn("Completed refactoring task", markdown)
        self.assertIn("- `lib/auth.py`", markdown)
        self.assertIn("+ new content", markdown)

if __name__ == "__main__":
    unittest.main()
