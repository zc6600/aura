import unittest
from logic import final

class TestFinal(unittest.TestCase):
    def test_success(self):
        result = final("hello")
        self.assertEqual(result["content"], "hello")
        self.assertEqual(result["status"], "ok")

if __name__ == "__main__":
    unittest.main()
