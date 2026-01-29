import sys
import json
import os

def read_file(file_path):
    # 安全检查：防止路径穿越攻击（例如 ../../../etc/passwd）
    base_dir = os.getcwd()
    absolute_path = os.path.abspath(file_path)
    
    if not absolute_path.startswith(base_dir):
        return {"error": "Access Denied: Path is outside of workspace."}

    if not os.path.exists(absolute_path):
        return {"error": f"File not found: {file_path}"}

    try:
        with open(absolute_path, 'r', encoding='utf-8') as f:
            content = f.read()
            return {"content": content, "status": "success"}
    except Exception as e:
        return {"error": str(e), "status": "failed"}

if __name__ == "__main__":
    # 从命令行参数获取 JSON 输入（Aura 内核的标准通信方式）
    try:
        args = json.loads(sys.argv[1])
        result = read_file(args.get("file_path"))
        print(json.dumps(result))
    except Exception as e:
        print(json.dumps({"error": f"Invalid input: {str(e)}"}))