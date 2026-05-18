import unittest
import os
import tempfile
import json
import time
import datetime
from logic import blackboard_read, blackboard_write, blackboard_lock, blackboard_list, blackboard_delete

class TestBlackboardTool(unittest.TestCase):
    def setUp(self):
        self.test_dir = tempfile.TemporaryDirectory()
        self.old_cwd = os.getcwd()
        os.chdir(self.test_dir.name)
        os.makedirs("state/bus", exist_ok=True)

    def tearDown(self):
        os.chdir(self.old_cwd)
        self.test_dir.cleanup()

    def test_write_read_json(self):
        data = {"count": 1}
        res_w = blackboard_write("v1", data)
        self.assertEqual(res_w["status"], "success")
        
        res_r = blackboard_read("v1")
        self.assertEqual(res_r["status"], "success")
        self.assertEqual(res_r["payload"], data)
        self.assertIn("timestamp", res_r["metadata"])

    def test_write_read_string(self):
        content = "hello world"
        res_w = blackboard_write("v2", content)
        self.assertEqual(res_w["status"], "success")
        
        res_r = blackboard_read("v2")
        self.assertEqual(res_r["status"], "success")
        self.assertEqual(res_r["payload"], content)

    def test_lock_release(self):
        res_l = blackboard_lock("lock1", "lock")
        self.assertEqual(res_l["status"], "success")
        
        # Try to acquire again, should timeout (set small timeout)
        res_l2 = blackboard_lock("lock1", "lock", timeout=1)
        self.assertEqual(res_l2["status"], "failed")
        
        res_rel = blackboard_lock("lock1", "release")
        self.assertEqual(res_rel["status"], "success")
        
        # Now can acquire again
        res_l3 = blackboard_lock("lock1", "lock")
        self.assertEqual(res_l3["status"], "success")

    def test_list_keys(self):
        blackboard_write("key_a", {"val": 1})
        blackboard_write("key_b", {"val": 2})
        res = blackboard_list()
        self.assertEqual(res["status"], "success")
        self.assertIn("key_a", res["keys"])
        self.assertIn("key_b", res["keys"])
        self.assertEqual(len(res["keys"]), 2)

    def test_delete_key(self):
        blackboard_write("to_delete", {"temp": True})
        res_d = blackboard_delete("to_delete")
        self.assertEqual(res_d["status"], "success")
        # Verify read now fails
        res_r = blackboard_read("to_delete")
        self.assertEqual(res_r["status"], "failed")
        self.assertIn("not found", res_r["error"])

    def test_delete_nonexistent(self):
        res = blackboard_delete("no_such_key")
        self.assertEqual(res["status"], "failed")
        self.assertIn("not found", res["error"])

if __name__ == "__main__":
    unittest.main()
