import unittest
import os
from logic import handle_action

class TestKnowledgeDb(unittest.TestCase):
    def setUp(self):
        self.base_dir = os.getcwd()
        self.knowledge_dir = os.path.join(self.base_dir, "knowledge")
        os.makedirs(self.knowledge_dir, exist_ok=True)
        self.db_path = os.path.join(self.knowledge_dir, "unit_test_kb.db")
        if os.path.exists(self.db_path):
            os.remove(self.db_path)

    def tearDown(self):
        if os.path.exists(self.db_path):
            os.remove(self.db_path)

    def test_crud_flow(self):
        res = handle_action({"action": "create", "db_name": "unit_test_kb"})
        self.assertEqual(res["status"], "success")
        res = handle_action({"action": "save", "db_name": "unit_test_kb", "text": "alpha beta gamma", "tag": "t1"})
        self.assertEqual(res["status"], "success")
        res = handle_action({"action": "save", "db_name": "unit_test_kb", "text": "delta epsilon zeta", "tag": "t3"})
        self.assertEqual(res["status"], "success")
        res = handle_action({"action": "search", "db_name": "unit_test_kb", "query": "beta", "retrieval_mode": "keyword"})
        self.assertEqual(res["status"], "success")
        self.assertGreaterEqual(len(res["chunks"]), 1)
        get_args = res["chunks"][0]["get_args"]
        doc_id = get_args["id"]
        res = handle_action({"action": "search", "db_name": "unit_test_kb", "query": "delta", "retrieval_mode": "tfidf"})
        self.assertEqual(res["status"], "success")
        res = handle_action({"action": "get", "db_name": "unit_test_kb", "id": doc_id})
        self.assertEqual(res["status"], "success")
        self.assertIn("beta", res["content"])
        res = handle_action({"action": "update", "db_name": "unit_test_kb", "id": doc_id, "text": "beta updated", "tag": "t2"})
        self.assertEqual(res["status"], "success")
        res = handle_action({"action": "delete", "db_name": "unit_test_kb", "id": doc_id})
        self.assertEqual(res["status"], "success")

if __name__ == "__main__":
    unittest.main()
