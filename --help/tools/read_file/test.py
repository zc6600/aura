import unittest
import os
from logic import read_file

class TestReadFile(unittest.TestCase):
    def setUp(self):
        # 创建一个临时测试文件
        self.test_file = "test_sample.txt"
        with open(self.test_file, "w") as f:
            f.write("Hello Aura OS")

    def tearDown(self):
        # 清理测试文件
        if os.path.exists(self.test_file):
            os.remove(self.test_file)

    def test_read_success(self):
        result = read_file(self.test_file)
        self.assertEqual(result["content"], "Hello Aura OS")
        self.assertEqual(result["status"], "success")

    def test_file_not_found(self):
        result = read_file("non_existent_file.txt")
        self.assertIn("error", result)

if __name__ == "__main__":
    unittest.main()