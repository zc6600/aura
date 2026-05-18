import unittest
import os
import shutil
from logic import write_file

class TestWriteFile(unittest.TestCase):
    def setUp(self):
        self.tmp_dir = os.path.join("tmp", "write_test")
        os.makedirs(self.tmp_dir, exist_ok=True)

    def tearDown(self):
        shutil.rmtree("tmp", ignore_errors=True)

    def test_write_denied_without_permission(self):
        target = os.path.join(self.tmp_dir, "a.txt")
        out = write_file(target, "x", allowed_paths=[], strict_mode=True)
        self.assertIn("Permission Denied", out.get("error", ""))

    def test_write_success_with_permission(self):
        target = os.path.join(self.tmp_dir, "b.txt")
        out = write_file(target, "y", allowed_paths=["tmp"], strict_mode=True)
        self.assertEqual(out.get("status"), "ok")
        self.assertTrue(os.path.exists(target))

    def test_forbidden_extension(self):
        target = os.path.join(self.tmp_dir, "secret.env")
        out = write_file(target, "z", allowed_paths=["tmp"], strict_mode=True)
        self.assertIn("forbidden", out.get("error", ""))

if __name__ == "__main__":
    unittest.main()
