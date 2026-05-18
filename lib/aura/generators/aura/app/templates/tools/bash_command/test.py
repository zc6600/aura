import unittest
from logic import execute_command

class TestBashCommand(unittest.TestCase):
    def test_echo(self):
        res = execute_command("echo 'hello'")
        self.assertEqual(res["status"], "ok")
        self.assertIn("hello", res["stdout"])

if __name__ == "__main__":
    unittest.main()
