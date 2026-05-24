import unittest
import os
import tempfile
import json
import sqlite3
from logic import resolve_db_path, get_db_connection, get_variable, set_variable, generate_markdown

class TestPlanProposalTool(unittest.TestCase):
    def test_db_operations(self):
        with tempfile.TemporaryDirectory() as d:
            db_path = os.path.join(d, "aura.db")
            conn = get_db_connection(db_path)
            
            set_variable(conn, "test_key", "test_val")
            val = get_variable(conn, "test_key")
            self.assertEqual(val, "test_val")
            
            conn.close()

    def test_generate_markdown(self):
        markdown = generate_markdown(
            goal="Refactor authentication",
            steps=["Step 1: Edit auth.py", "Step 2: Add tests"],
            files=["lib/auth.py", "test/test_auth.py"],
            verifications=["pytest test/test_auth.py"],
            run_id="run_12345"
        )
        self.assertIn("Implementation Plan - Run run_12345", markdown)
        self.assertIn("Refactor authentication", markdown)
        self.assertIn("- [ ] Step 1: Edit auth.py", markdown)
        self.assertIn("- `lib/auth.py`", markdown)
        self.assertIn("- `pytest test/test_auth.py`", markdown)

if __name__ == "__main__":
    unittest.main()
