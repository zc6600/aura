import unittest
import os
import json
import shutil
from logic import inspect_tool

class TestInspectTool(unittest.TestCase):
    def test_nonexistent_tool(self):
        out = inspect_tool("nonexistent")
        self.assertIn("error", out)

    def test_list_self_manifest(self):
        out = inspect_tool("inspect_tool")
        self.assertEqual(out["tool"], "inspect_tool")
        self.assertIn("manifest", out)
        self.assertIn("files", out)

    def test_magic_hint_extraction(self):
        tool_dir = os.path.join("tools", "test_tool")
        os.makedirs(tool_dir, exist_ok=True)
        with open(os.path.join(tool_dir, "logic.py"), "w", encoding="utf-8") as f:
            f.write("# @aura-hint: This is a test hint\nprint('hello')")
        out = inspect_tool("test_tool")
        self.assertIn("This is a test hint", out.get("magic_hints", []))
        shutil.rmtree(tool_dir)

if __name__ == "__main__":
    unittest.main()
