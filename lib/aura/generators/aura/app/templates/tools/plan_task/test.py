import unittest
import os
import sqlite3
import tempfile
from logic import set_plan

class TestPlanTask(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.test_dir = os.path.join(self.temp_dir.name, "state")
        os.makedirs(self.test_dir, exist_ok=True)

        self.db_path = os.path.join(self.test_dir, "plan_task_test.db")
        os.environ["AURA_STATE_DB_PATH"] = self.db_path
        conn = sqlite3.connect(self.db_path)
        conn.execute("CREATE TABLE IF NOT EXISTS variables (key TEXT PRIMARY KEY, value TEXT)")
        conn.close()

    def tearDown(self):
        os.environ.pop("AURA_STATE_DB_PATH", None)
        self.temp_dir.cleanup()

    def test_set_plan(self):
        res = set_plan("My Plan")
        self.assertEqual(res["status"], "ok")
        
        conn = sqlite3.connect(self.db_path)
        val = conn.execute("SELECT value FROM variables WHERE key='plan'").fetchone()[0]
        conn.close()
        self.assertEqual(val, "My Plan")

if __name__ == "__main__":
    unittest.main()
