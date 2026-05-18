import sys
import json

def main():
    if len(sys.argv) < 2:
        print(json.dumps({"status": "failed", "error": "missing args"}))
        return
    try:
        args = json.loads(sys.argv[1])
    except Exception as e:
        print(json.dumps({"status": "failed", "error": str(e)}))
        return
    anchor_id = args.get("anchor_id")
    summary = args.get("summary")
    selected_next = args.get("selected_next")
    notes = args.get("notes")
    if not anchor_id or not summary:
        print(json.dumps({"status": "failed", "error": "anchor_id and summary are required"}))
        return
    res = {
        "status": "success",
        "anchor_id": anchor_id,
        "next_stage": selected_next or "",
        "summary": summary,
        "notes": notes or "",
        "content": summary
    }
    print(json.dumps(res))

if __name__ == "__main__":
    main()
