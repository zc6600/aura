import sys
import json

def final(content):
    if content is None:
        content = ""
    return {"content": content, "status": "ok"}

if __name__ == "__main__":
    try:
        args = json.loads(sys.argv[1])
        content = args.get("content")
        result = final(content)
        print(json.dumps(result))
    except Exception as e:
        print(json.dumps({"status": "failed", "error": f"Kernel communication error: {str(e)}", "code": "bad_request"}))
