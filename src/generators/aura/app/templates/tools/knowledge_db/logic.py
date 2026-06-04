import sys
import json
import os
import sqlite3
import re
import time
script_dir = os.path.join(os.path.dirname(__file__), "script")
if script_dir not in sys.path:
    sys.path.append(script_dir)
from retrieval import compute_scores

def validate_db_name(name):
    if not name or not re.match(r"^[A-Za-z0-9_-]+$", name):
        return False
    return True

def db_path_for(name):
    base_dir = os.getcwd()
    knowledge_dir = os.path.abspath(os.path.join(base_dir, "knowledge"))
    db_path = os.path.abspath(os.path.join(knowledge_dir, f"{name}.db"))
    if not (db_path == knowledge_dir or db_path.startswith(knowledge_dir + os.sep)):
        return None
    return db_path

def load_storage_mode():
    cfg_path = os.path.join(os.getcwd(), "config", "config.yml")
    mode = "local"
    if not os.path.exists(cfg_path):
        return mode
    try:
        in_section = False
        with open(cfg_path, "r", encoding="utf-8") as f:
            for raw in f.readlines():
                line = raw.rstrip("\n")
                if line.strip() == "knowledge_db:":
                    in_section = True
                    continue
                if in_section and line.strip().endswith(":") and not line.lstrip().startswith("storage:"):
                    in_section = False
                if in_section and line.lstrip().startswith("storage:"):
                    val = line.split(":", 1)[1].strip().strip("\"'")
                    if val:
                        return val
    except Exception:
        return mode
    return mode

def ensure_local_storage():
    mode = load_storage_mode()
    if mode != "local":
        return {"error": "Cloud storage is not configured", "status": "failed", "code": "cloud_not_configured"}
    return None

def create_db(db_name):
    storage_err = ensure_local_storage()
    if storage_err:
        return storage_err
    if not validate_db_name(db_name):
        return {"error": "Invalid db_name", "status": "failed", "code": "invalid_db_name"}
    db_path = db_path_for(db_name)
    if not db_path:
        return {"error": "Invalid db_name path", "status": "failed", "code": "invalid_db_path"}
    os.makedirs(os.path.dirname(db_path), exist_ok=True)
    try:
        conn = sqlite3.connect(db_path)
        conn.execute("CREATE TABLE IF NOT EXISTS documents (id INTEGER PRIMARY KEY AUTOINCREMENT, content TEXT, tag TEXT, created_at INTEGER)")
        conn.commit()
        conn.close()
        rel_path = os.path.relpath(db_path, os.getcwd())
        return {"status": "success", "db_path": rel_path}
    except Exception as e:
        return {"error": str(e), "status": "failed", "code": "db_error"}

def save_text(db_name, text, tag=None):
    storage_err = ensure_local_storage()
    if storage_err:
        return storage_err
    if not validate_db_name(db_name):
        return {"error": "Invalid db_name", "status": "failed", "code": "invalid_db_name"}
    db_path = db_path_for(db_name)
    if not db_path:
        return {"error": "Invalid db_name path", "status": "failed", "code": "invalid_db_path"}
    if not os.path.exists(db_path):
        return {"error": "Database not found", "status": "failed", "code": "db_not_found"}
    try:
        now = int(time.time())
        conn = sqlite3.connect(db_path)
        conn.execute("CREATE TABLE IF NOT EXISTS documents (id INTEGER PRIMARY KEY AUTOINCREMENT, content TEXT, tag TEXT, created_at INTEGER)")
        conn.execute("INSERT INTO documents (content, tag, created_at) VALUES (?, ?, ?)", (text, tag, now))
        conn.commit()
        conn.close()
        return {"status": "success", "inserted": 1}
    except Exception as e:
        return {"error": str(e), "status": "failed", "code": "db_error"}

def search_documents(db_name, query=None, tag=None, top_k=None, retrieval_mode=None, embedding_provider=None, embedding_model=None, embedding_api_base=None, embedding_api_key=None, embedding_api_key_env=None, embedding_batch_size=64, embedding_max_doc_chars=None):
    storage_err = ensure_local_storage()
    if storage_err:
        return storage_err
    if not validate_db_name(db_name):
        return {"error": "Invalid db_name", "status": "failed", "code": "invalid_db_name"}
    db_path = db_path_for(db_name)
    if not db_path:
        return {"error": "Invalid db_name path", "status": "failed", "code": "invalid_db_path"}
    if not os.path.exists(db_path):
        return {"error": "Database not found", "status": "failed", "code": "db_not_found"}
    try:
        conn = sqlite3.connect(db_path)
        rows = conn.execute("SELECT id, content, tag, created_at FROM documents").fetchall()
        conn.close()
        items = []
        for row in rows:
            cid, content, ctag, created_at = row
            if tag is not None and ctag != tag:
                continue
            items.append({"id": cid, "tag": ctag, "content": content, "created_at": created_at})
        if query:
            texts = [item["content"] for item in items]
            scores, err = compute_scores(query, texts, retrieval_mode, embedding_provider, embedding_model, embedding_api_base, embedding_api_key, embedding_api_key_env, embedding_batch_size, embedding_max_doc_chars)
            if err == "invalid_retrieval_mode":
                return {"error": f"Unsupported retrieval mode: {retrieval_mode}", "status": "failed", "code": "invalid_retrieval_mode"}
            if err == "missing_api_key":
                return {"error": "Missing embedding API key", "status": "failed", "code": "missing_api_key"}
            if err == "embedding_error":
                return {"error": "Embedding error", "status": "failed", "code": "embedding_error"}
            if err:
                return {"error": err, "status": "failed", "code": "embedding_error"}
            for item, score in zip(items, scores):
                item["score"] = score
            items.sort(key=lambda x: (-x.get("score", 0.0), -x["created_at"], -x["id"]))
        else:
            items.sort(key=lambda x: (-x["created_at"], -x["id"]))
        limit = int(top_k) if top_k is not None else 20
        items = items[:limit]
        results = []
        for item in items:
            results.append({
                "tag": item.get("tag"),
                "get_args": {"action": "get", "db_name": db_name, "id": item["id"]}
            })
        return {"status": "success", "chunks": results}
    except Exception as e:
        return {"error": str(e), "status": "failed", "code": "db_error"}

def update_document(db_name, doc_id, content=None, tag=None):
    storage_err = ensure_local_storage()
    if storage_err:
        return storage_err
    if not validate_db_name(db_name):
        return {"error": "Invalid db_name", "status": "failed", "code": "invalid_db_name"}
    if content is None and tag is None:
        return {"error": "No fields to update", "status": "failed", "code": "invalid_update"}
    db_path = db_path_for(db_name)
    if not db_path:
        return {"error": "Invalid db_name path", "status": "failed", "code": "invalid_db_path"}
    if not os.path.exists(db_path):
        return {"error": "Database not found", "status": "failed", "code": "db_not_found"}
    try:
        conn = sqlite3.connect(db_path)
        fields = []
        params = []
        if content is not None:
            fields.append("content = ?")
            params.append(content)
        if tag is not None:
            fields.append("tag = ?")
            params.append(tag)
        params.append(int(doc_id))
        sql = "UPDATE documents SET " + ", ".join(fields) + " WHERE id = ?"
        cur = conn.execute(sql, params)
        conn.commit()
        conn.close()
        return {"status": "success", "updated": cur.rowcount}
    except Exception as e:
        return {"error": str(e), "status": "failed", "code": "db_error"}

def delete_document(db_name, doc_id):
    storage_err = ensure_local_storage()
    if storage_err:
        return storage_err
    if not validate_db_name(db_name):
        return {"error": "Invalid db_name", "status": "failed", "code": "invalid_db_name"}
    db_path = db_path_for(db_name)
    if not db_path:
        return {"error": "Invalid db_name path", "status": "failed", "code": "invalid_db_path"}
    if not os.path.exists(db_path):
        return {"error": "Database not found", "status": "failed", "code": "db_not_found"}
    try:
        conn = sqlite3.connect(db_path)
        cur = conn.execute("DELETE FROM documents WHERE id = ?", (int(doc_id),))
        conn.commit()
        conn.close()
        return {"status": "success", "deleted": cur.rowcount}
    except Exception as e:
        return {"error": str(e), "status": "failed", "code": "db_error"}

def get_document(db_name, doc_id):
    storage_err = ensure_local_storage()
    if storage_err:
        return storage_err
    if not validate_db_name(db_name):
        return {"error": "Invalid db_name", "status": "failed", "code": "invalid_db_name"}
    db_path = db_path_for(db_name)
    if not db_path:
        return {"error": "Invalid db_name path", "status": "failed", "code": "invalid_db_path"}
    if not os.path.exists(db_path):
        return {"error": "Database not found", "status": "failed", "code": "db_not_found"}
    try:
        conn = sqlite3.connect(db_path)
        row = conn.execute("SELECT id, content, tag FROM documents WHERE id = ?", (int(doc_id),)).fetchone()
        conn.close()
        if not row:
            return {"error": "Document not found", "status": "failed", "code": "not_found"}
        did, content, tag = row
        return {"status": "success", "id": did, "content": content, "tag": tag}
    except Exception as e:
        return {"error": str(e), "status": "failed", "code": "db_error"}

def handle_action(args):
    action = (args.get("action") or "").lower()
    db_name = args.get("db_name")
    if action == "create":
        return create_db(db_name)
    if action == "save":
        return save_text(db_name, args.get("text"), args.get("tag"))
    if action == "search":
        return search_documents(db_name, args.get("query"), args.get("tag"), args.get("top_k"), args.get("retrieval_mode"), args.get("embedding_provider"), args.get("embedding_model"), args.get("embedding_api_base"), args.get("embedding_api_key"), args.get("embedding_api_key_env"), args.get("embedding_batch_size", 64), args.get("embedding_max_doc_chars"))
    if action == "update":
        return update_document(db_name, args.get("id"), args.get("text"), args.get("tag"))
    if action == "delete":
        return delete_document(db_name, args.get("id"))
    if action == "get":
        return get_document(db_name, args.get("id"))
    return {"error": f"Unsupported action: {action}", "status": "failed", "code": "invalid_action"}

if __name__ == "__main__":
    try:
        if len(sys.argv) > 1 and sys.argv[1].strip():
            args = json.loads(sys.argv[1])
        else:
            args = json.loads(sys.stdin.read())
        if not args.get("action") or not args.get("db_name"):
            raise ValueError("Fields 'action' and 'db_name' are required.")
        result = handle_action(args)
        print(json.dumps(result))
    except Exception as e:
        print(json.dumps({"error": f"Kernel communication error: {str(e)}", "status": "failed", "code": "execution_error"}))
