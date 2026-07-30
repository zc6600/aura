import os
import re
import json
import sys
import time
import uuid
import datetime

NAME_PATTERN = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$")


def resolve_env_root():
    base_dir = os.getcwd()
    if os.path.exists(os.path.join(base_dir, ".aura-workspace")):
        return os.path.join(base_dir, ".aura-workspace")
    if os.path.exists(os.path.join(base_dir, ".aura")):
        return os.path.join(base_dir, ".aura")
    return base_dir


def resolve_bus_dir(subdir):
    # Same session-scoping convention as the blackboard tool, plus a
    # dedicated subdirectory of the shared bus for this tool's data.
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


def check_mailbox_allowed(me, to):
    collab = load_collaboration_config()
    if collab.get("enabled") is False:
        return False, "Collaboration is disabled by workspace config (collaboration.enabled: false)."

    allow_map = collab.get("can_talk_to")
    if isinstance(allow_map, dict):
        # Presence of this map makes it an opt-in allowlist: any sender with
        # no entry defaults to deny, not "allow all".
        allowed = allow_map.get(me)
        if not allowed:
            return False, (
                f"'{me}' has no can_talk_to entry in workspace config.collaboration; "
                "default is deny once an allowlist is configured."
            )
        if to not in allowed:
            return False, (
                f"'{me}' is not allowed to message '{to}' per "
                "workspace config.collaboration.can_talk_to."
            )
    return True, None


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


def mailbox_send(to, content, reply_to=None, wait=False, timeout=30):
    me = current_agent_id()
    validate_name(to, "recipient agent id")
    if content is None or (isinstance(content, str) and not content.strip()):
        return {"status": "failed", "error": "Missing 'content' for send action"}

    allowed, reason = check_mailbox_allowed(me, to)
    if not allowed:
        return {"status": "failed", "error": reason}

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
    except Exception as e:
        return {"status": "failed", "error": f"Send failed: {str(e)}"}

    if not wait:
        return {"status": "success", "id": message["id"], "thread": os.path.basename(path)}

    return _wait_for_reply(path, me, to, message, timeout)


def _wait_for_reply(path, me, to, sent_message, timeout):
    # NOTE: this polls the shared thread *file* — there is no live socket/RPC
    # into whatever process `to` might be running as. It only surfaces a
    # reply if some process acting as `to` happens to call mailbox(send) to
    # this same thread while we're polling. If `to` never runs, this simply
    # times out; the original letter was still delivered (written) either way.
    try:
        budget = max(1, int(timeout))
    except (TypeError, ValueError):
        budget = 30
    # Leave headroom below the tool subprocess's own kill timeout (this
    # tool's `timeout` arg doubles as that timeout via the engine's generic
    # timeout_seconds/timeout convention), so we return gracefully instead
    # of getting killed mid-poll.
    deadline = time.time() + max(1, budget - 2)
    poll_interval = 0.5

    while time.time() < deadline:
        time.sleep(poll_interval)
        for m in read_jsonl(path, 0):
            if m.get("id") == sent_message["id"]:
                continue
            if m.get("from") != to or m.get("to") != me:
                continue
            if m.get("reply_to") == sent_message["id"] or m.get("at", "") > sent_message["at"]:
                return {
                    "status": "success",
                    "id": sent_message["id"],
                    "thread": os.path.basename(path),
                    "replied": True,
                    "reply": m,
                }

    return {
        "status": "success",
        "id": sent_message["id"],
        "thread": os.path.basename(path),
        "replied": False,
        "note": (
            f"No reply from '{to}' within {budget}s. The letter was still delivered — "
            f"'{to}' may reply later; check back with action='read'."
        ),
    }


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
            result = mailbox_send(
                args.get("to"),
                args.get("content"),
                args.get("reply_to"),
                wait=bool(args.get("wait", False)),
                timeout=args.get("timeout", args.get("timeout_seconds", 30)),
            )
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
