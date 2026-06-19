import sys
import json

def main():
    try:
        if len(sys.argv) > 1 and sys.argv[1].strip():
            args = json.loads(sys.argv[1])
        else:
            args = json.loads(sys.stdin.read())
    except Exception as e:
        print(json.dumps({"status": "failed", "error": str(e)}))
        return
    anchor_id = args.get("anchor_id")
    summary = args.get("summary")
    selected_next = args.get("selected_next")
    notes = args.get("notes")
    runtime_update = args.get("anchor_runtime_update")
    if not anchor_id or not summary:
        print(json.dumps({"status": "failed", "error": "anchor_id and summary are required"}))
        return
    res = {
        "status": "success",
        "anchor_id": anchor_id,
        "selected_next": selected_next or "",
        "next_stage": selected_next or "",
        "summary": summary,
        "notes": notes or "",
        "anchor_runtime_update": runtime_update or {},
        "content": summary
    }
    print(json.dumps(res))

if __name__ == "__main__":
    main()
