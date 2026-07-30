import os
import re
import json
import sys
import uuid
import datetime

CHANNEL_PATTERN = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$")


def resolve_env_root():
    base_dir = os.getcwd()
    if os.path.exists(os.path.join(base_dir, ".aura-workspace")):
        return os.path.join(base_dir, ".aura-workspace")
    if os.path.exists(os.path.join(base_dir, ".aura")):
        return os.path.join(base_dir, ".aura")
    return base_dir


def resolve_bus_dir(subdir):
    # Same session-scoping convention as the blackboard/mailbox tools, plus
    # a dedicated subdirectory of the shared bus for this tool's data.
    session_name = os.environ.get("AURA_SESSION_NAME")
    state_root = os.path.join(resolve_env_root(), "state")

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


def _parse_inline_list(val):
    val = val.strip()
    if val.startswith("[") and val.endswith("]"):
        inner = val[1:-1]
        return [v.strip().strip("'\"") for v in inner.split(",") if v.strip()]
    return []


def _parse_collaboration_block_fallback(text):
    # Deliberately narrow parser for just the `collaboration:` block, used
    # when PyYAML isn't installed (not guaranteed in this repo — verified by
    # hand that a plain `python3` has no `yaml` module). Only understands the
    # subset this tool's own docs tell users to write:
    #   collaboration:
    #     enabled: true
    #     can_talk_to:
    #       agent-a: [agent-b, agent-c]
    #     channels:
    #       channel-name: [agent-a]
    # Anything fancier (comments mid-line, block-style "- item" lists,
    # multiline strings) isn't supported here — install PyYAML for that.
    result = {}
    in_collab = False
    collab_indent = None
    current_map = None

    def indent_of(line):
        return len(line) - len(line.lstrip(" "))

    for raw in text.splitlines():
        if not raw.strip() or raw.strip().startswith("#"):
            continue
        ind = indent_of(raw)
        stripped = raw.strip()

        if not in_collab:
            if stripped == "collaboration:":
                in_collab = True
                collab_indent = ind
            continue

        if ind <= collab_indent:
            break

        if current_map is not None and ind > collab_indent + 2 and ":" in stripped:
            key, _, val = stripped.partition(":")
            current_map[key.strip().strip("'\"")] = _parse_inline_list(val)
            continue

        if ":" in stripped:
            key, _, val = stripped.partition(":")
            key = key.strip()
            val = val.strip()
            if key in ("can_talk_to", "channels"):
                current_map = {}
                result[key] = current_map
            else:
                current_map = None
                if key == "enabled":
                    result["enabled"] = val.lower() in ("true", "yes", "1")

    return result


def load_collaboration_config():
    cfg_path = os.path.join(resolve_env_root(), "config", "config.yml")
    if not os.path.exists(cfg_path):
        return {}
    try:
        with open(cfg_path, "r", encoding="utf-8") as f:
            raw = f.read()
    except Exception:
        return {}

    try:
        import yaml
    except ImportError:
        return _parse_collaboration_block_fallback(raw)

    try:
        data = yaml.safe_load(raw) or {}
        return data.get("collaboration") or {}
    except Exception:
        return {}


def check_channel_allowed(me, channel):
    collab = load_collaboration_config()
    if collab.get("enabled") is False:
        return False, "Collaboration is disabled by workspace config (collaboration.enabled: false)."

    channels = collab.get("channels")
    if isinstance(channels, dict) and channel in channels:
        # Only channels explicitly listed here are restricted; an unlisted
        # channel stays open to any agent.
        allowed = channels.get(channel) or []
        if me not in allowed:
            return False, (
                f"'{me}' is not allowed to post in channel '{channel}' per "
                "workspace config.collaboration.channels."
            )
    return True, None


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

    allowed, reason = check_channel_allowed(me, channel)
    if not allowed:
        return {"status": "failed", "error": reason}

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
