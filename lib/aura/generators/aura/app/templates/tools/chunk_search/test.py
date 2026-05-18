import unittest
import os
import shutil
from logic import chunk_search

class TestChunkSearch(unittest.TestCase):
    def setUp(self):
        self.base_dir = os.getcwd()
        self.test_dir = os.path.join(self.base_dir, "tmp_rag_test")
        os.makedirs(self.test_dir, exist_ok=True)
        self.file_one = os.path.join(self.test_dir, "sample.txt")
        self.file_two = os.path.join(self.test_dir, "other.txt")
        with open(self.file_one, "w", encoding="utf-8") as f:
            f.write("alpha beta gamma delta")
        with open(self.file_two, "w", encoding="utf-8") as f:
            f.write("sigma tau omega")
        with open(self.file_one + ".hint", "w", encoding="utf-8") as f:
            f.write("sample hint")

    def tearDown(self):
        if os.path.exists(self.test_dir):
            shutil.rmtree(self.test_dir)

    def test_chunks_and_hint(self):
        out = chunk_search("tmp_rag_test", "path", ["./tmp_rag_test"], 10, 2)
        self.assertEqual(out["status"], "success")
        files = [item["file_path"] for item in out["files"]]
        self.assertIn("tmp_rag_test/sample.txt", files)
        chunks = [c for c in out["chunks"] if c["file_path"] == "tmp_rag_test/sample.txt"]
        self.assertGreater(len(chunks), 1)
        self.assertTrue(all(c["hint"] == "sample hint" for c in chunks))

    def test_query_top_k_and_fields(self):
        out = chunk_search(
            "tmp_rag_test",
            "path",
            ["./tmp_rag_test"],
            200,
            0,
            query="beta gamma",
            top_k=1,
            chunk_fields=["file_path", "score"],
            max_chunk_fields=1
        )
        self.assertEqual(out["status"], "success")
        self.assertEqual(len(out["chunks"]), 1)
        self.assertEqual(list(out["chunks"][0].keys()), ["file_path"])
        self.assertIn("sample.txt", out["chunks"][0]["file_path"])

    def test_permission_denied(self):
        out = chunk_search("tmp_rag_test", "path", ["./knowledge"], 10, 2)
        self.assertEqual(out["status"], "failed")
        self.assertEqual(out["code"], "permission_denied")

if __name__ == "__main__":
    unittest.main()
