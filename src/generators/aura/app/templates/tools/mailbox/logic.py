import os
import re
import json
import sys
import uuid
import datetime

NAME_PATTERN = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$")


def resolve_bus_dir(subdir):
    # Same session-scoping convention as the blackboard tool, plus a
    # dedicated subdirectory of the shared bus for this tool's data.
    session_name = os.environ.get("AURA_SESSION_NAME")
    base_dir = os.getcwd()
    if os.path.exists(os.path.join(base_dir, ".aura-workspace")):
        state_root = os.path.join(base_dir, ".aura-workspace", "state")
    elif os.path.exists(os.path.join(base_dir, ".aura")):
        state_root = os.path.join(base_dir, ".aura", "state")
    else:
        state_root = os.path.join(base_dir, "state")

    if not session_name:
        active_txt = os.path.join(state_root, "active_session.txt")
        if os.path.exists(active_txt):
            try:
                with open(active_txt, "r") as f:
                    session_name = f.read().strip()
            except Exception:
                pass
    if not session_name:
        session_name = "default"

    bus_dir = os.path.join(state_root, "sessions", session_name, "bus", subdir)
    os.makedirs(bus_dir, exist_ok=True)
    return bus_dir


def current_agent_id():
    return os.environ.get("AURA_AGENT_ID", "unknown")


def validate_name(name, label="agent id"):
    if not name or not isinstance(name, str) or not NAME_PATTERN.match(name):
        raise ValueError(
            f"Invalid {label} '{name}': must start with a letter/digit and contain "
            "only letters, numbers, '_' or '-' (max 64 chars)."
        )
    return name


def thread_path(mailbox_dir, a, b):
    pair = "--".join(sorted([a, b]))
    return os.path.join(mailbox_dir, f"{pair}.jsonl")


def append_jsonl(path, obj):
    # A single write() of one JSON line is atomic up to PIPE_BUF (~4KB on
    # macOS/Linux) at the OS level, so concurrent agent processes appending
    # to the same thread file won't tear or overwrite each other's letters
    # the way a read-modify-write-whole-file approach would.
    line = json.dumps(obj, ensure_ascii=False)
    with open(path, "a", encoding="utf-8") as f:
        f.write(line + "\n")
        f.flush()
        os.fsync(f.fileno())


def read_jsonl(path, limit=None):
    if not os.path.exists(path):
        return []
    messages = []
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                messages.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    if limit:
        messages = messages[-limit:]
    return messages


def mailbox_send(to, content, reply_to=None):
    me = current_agent_id()
    validate_name(to, "recipient agent id")
    if content is None or (isinstance(content, str) and not content.strip()):
        return {"status": "failed", "error": "Missing 'content' for send action"}

    mailbox_dir = resolve_bus_dir("mailbox")
    path = thread_path(mailbox_dir, me, to)
    message = {
        "id": str(uuid.uuid4()),
        "from": me,
        "to": to,
        "at": datetime.datetime.now().isoformat(),
        "content": content,
    }
    if reply_to:
        message["reply_to"] = reply_to

    try:
        append_jsonl(path, message)
        return {"status": "success", "id": message["id"], "thread": os.path.basename(path)}
    except Exception as e:
        return {"status": "failed", "error": f"Send failed: {str(e)}"}


def mailbox_read(with_agent=None, limit=20):
    me = current_agent_id()
    mailbox_dir = resolve_bus_dir("mailbox")

    if with_agent:
        validate_name(with_agent, "recipient agent id")
        path = thread_path(mailbox_dir, me, with_agent)
        return {
            "status": "success",
            "thread": os.path.basename(path),
            "messages": read_jsonl(path, limit),
        }

    # No partner given: merge every thread my id is a party to.
    if not os.path.exists(mailbox_dir):
        return {"status": "success", "messages": []}

    merged = []
    for fname in sorted(os.listdir(mailbox_dir)):
        if not fname.endswith(".jsonl"):
            continue
        parties = fname[:-6].split("--")
        if me not in parties:
            continue
        merged.extend(read_jsonl(os.path.join(mailbox_dir, fname)))

    merged.sort(key=lambda m: m.get("at", ""))
    if limit:
        merged = merged[-limit:]
    return {"status": "success", "messages": merged}


def mailbox_list():
    me = current_agent_id()
    mailbox_dir = resolve_bus_dir("mailbox")
    if not os.path.exists(mailbox_dir):
        return {"status": "success", "threads": []}

    partners = []
    for fname in sorted(os.listdir(mailbox_dir)):
        if not fname.endswith(".jsonl"):
            continue
        parties = fname[:-6].split("--")
        if me not in parties:
            continue
        other = [p for p in parties if p != me]
        partners.append(other[0] if other else me)
    return {"status": "success", "threads": partners}


def main():
    try:
        if len(sys.argv) > 1 and sys.argv[1].strip():
            args = json.loads(sys.argv[1])
        else:
            args = json.loads(sys.stdin.read())
        action = args.get("action")

        if action == "send":
            result = mailbox_send(args.get("to"), args.get("content"), args.get("reply_to"))
        elif action == "read":
            result = mailbox_read(args.get("with"), args.get("limit", 20))
        elif action == "list":
            result = mailbox_list()
        else:
            result = {"status": "failed", "error": f"Unknown action: {action}"}

        print(json.dumps(result, ensure_ascii=False))
    except ValueError as e:
        print(json.dumps({"status": "failed", "error": str(e)}))
    except Exception as e:
        print(json.dumps({"status": "failed", "error": f"Unexpected error: {str(e)}"}))


if __name__ == "__main__":
    main()
