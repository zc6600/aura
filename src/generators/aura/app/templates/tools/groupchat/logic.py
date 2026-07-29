import os
import re
import json
import sys
import uuid
import datetime

CHANNEL_PATTERN = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$")


def resolve_bus_dir(subdir):
    # Same session-scoping convention as the blackboard/mailbox tools, plus
    # a dedicated subdirectory of the shared bus for this tool's data.
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


def validate_channel(name):
    if not name or not isinstance(name, str) or not CHANNEL_PATTERN.match(name):
        raise ValueError(
            f"Invalid channel '{name}': must start with a letter/digit and contain "
            "only letters, numbers, '_' or '-' (max 64 chars)."
        )
    return name


def channel_path(groupchat_dir, channel):
    return os.path.join(groupchat_dir, f"{channel}.jsonl")


def append_jsonl(path, obj):
    # A single write() of one JSON line is atomic up to PIPE_BUF (~4KB on
    # macOS/Linux) at the OS level, so concurrent agent processes posting to
    # the same channel won't tear or overwrite each other's messages.
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


def groupchat_send(channel, content, mentions=None):
    me = current_agent_id()
    validate_channel(channel)
    if content is None or (isinstance(content, str) and not content.strip()):
        return {"status": "failed", "error": "Missing 'content' for send action"}

    groupchat_dir = resolve_bus_dir("groupchat")
    path = channel_path(groupchat_dir, channel)
    message = {
        "id": str(uuid.uuid4()),
        "from": me,
        "channel": channel,
        "at": datetime.datetime.now().isoformat(),
        "content": content,
    }
    if mentions:
        if not isinstance(mentions, list):
            return {"status": "failed", "error": "'mentions' must be a list of agent ids"}
        message["mentions"] = mentions

    try:
        append_jsonl(path, message)
        return {"status": "success", "id": message["id"], "channel": channel}
    except Exception as e:
        return {"status": "failed", "error": f"Send failed: {str(e)}"}


def groupchat_read(channel, limit=30):
    validate_channel(channel)
    groupchat_dir = resolve_bus_dir("groupchat")
    path = channel_path(groupchat_dir, channel)
    return {"status": "success", "channel": channel, "messages": read_jsonl(path, limit)}


def groupchat_list_channels():
    groupchat_dir = resolve_bus_dir("groupchat")
    if not os.path.exists(groupchat_dir):
        return {"status": "success", "channels": []}

    channels = []
    for fname in sorted(os.listdir(groupchat_dir)):
        if fname.endswith(".jsonl"):
            channels.append(fname[:-6])
    return {"status": "success", "channels": channels}


def main():
    try:
        if len(sys.argv) > 1 and sys.argv[1].strip():
            args = json.loads(sys.argv[1])
        else:
            args = json.loads(sys.stdin.read())
        action = args.get("action")

        if action == "send":
            result = groupchat_send(args.get("channel"), args.get("content"), args.get("mentions"))
        elif action == "read":
            channel = args.get("channel")
            if not channel:
                result = {"status": "failed", "error": "Missing 'channel' for read action"}
            else:
                result = groupchat_read(channel, args.get("limit", 30))
        elif action == "list_channels":
            result = groupchat_list_channels()
        else:
            result = {"status": "failed", "error": f"Unknown action: {action}"}

        print(json.dumps(result, ensure_ascii=False))
    except ValueError as e:
        print(json.dumps({"status": "failed", "error": str(e)}))
    except Exception as e:
        print(json.dumps({"status": "failed", "error": f"Unexpected error: {str(e)}"}))


if __name__ == "__main__":
    main()
