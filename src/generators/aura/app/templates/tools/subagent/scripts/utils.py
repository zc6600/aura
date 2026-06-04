"""
Shared utilities for the subagent tool.
These are generic helpers that could be used by any tool.
"""
import os
import json
import time


class AtomicWriter:
    """Thread-safe atomic file writer using tmp+rename pattern."""
    @staticmethod
    def write(file_path, data):
        tmp_path = f"{file_path}.{int(time.time() * 1000)}.tmp"
        with open(tmp_path, "w", encoding="utf-8") as f:
            if isinstance(data, str):
                f.write(data)
            else:
                json.dump(data, f, indent=2)
            f.flush()
            os.fsync(f.fileno())
        os.rename(tmp_path, file_path)


def sanitize_name(name):
    """Sanitize a user-provided name for use as a filename/directory."""
    if not name or not name.strip():
        return None
    cleaned = name.strip()
    cleaned = cleaned.replace(" ", "_").replace("/", "_").replace("\\", "_")
    while ".." in cleaned:
        cleaned = cleaned.replace("..", "_")
    if not cleaned:
        return None
    return cleaned


def truncate_text(text, limit=1000):
    """Smart head/tail truncation for long text."""
    if not text:
        return ""
    if len(text) <= limit:
        return text
    
    half = limit // 2
    head = text[:half]
    tail = text[-half:]
    return f"{head} ... [truncated {len(text) - limit} chars] ... {tail}"


def extract_report(result_json, fallback_msg="No report generated"):
    """Extract the report content from a subagent's JSON output."""
    if not result_json:
        return fallback_msg
    
    if "final" in result_json:
        final = result_json["final"]
        if isinstance(final, dict):
            return final.get("content", str(final))
        return str(final)
    
    if "result" in result_json:
        return str(result_json["result"])
        
    return fallback_msg
