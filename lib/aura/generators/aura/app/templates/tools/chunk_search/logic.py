import sys
import json
import os
import urllib.request

def _is_within_base(base_dir, target_path):
    try:
        return os.path.commonpath([base_dir, target_path]) == base_dir
    except Exception:
        return False

def normalize_allowed_paths(allowed_paths, base_dir):
    if not allowed_paths:
        allowed_paths = ["./knowledge", "./tools"]
    return [
        os.path.abspath(os.path.join(base_dir, p))
        for p in allowed_paths
    ]

def check_path_allowed(target_path, allowed_paths, base_dir, strict_mode):
    if not _is_within_base(base_dir, target_path):
        return False, "security_violation", "Security Error: Attempted to access file outside of workspace."
    if not strict_mode:
        return True, None, None
    allowed_abs = normalize_allowed_paths(allowed_paths, base_dir)
    authorized = any(_is_within_base(p, target_path) for p in allowed_abs)
    if not authorized:
        return False, "permission_denied", f"Permission Denied: Path not allowed. Allowed: {allowed_paths}"
    return True, None, None

def collect_files(target_path):
    if os.path.isfile(target_path):
        return [target_path]
    files = []
    for root, _, filenames in os.walk(target_path):
        for name in filenames:
            if name.endswith(".hint"):
                continue
            files.append(os.path.join(root, name))
    return files

def read_text(path):
    with open(path, "r", encoding="utf-8") as f:
        return f.read()

def read_hint_for(path):
    hint_path = path + ".hint"
    if not os.path.exists(hint_path):
        return None
    try:
        return read_text(hint_path).strip()
    except Exception:
        return None

def chunk_text(text, size, overlap):
    if size <= 0:
        return []
    if overlap < 0:
        overlap = 0
    if overlap >= size:
        overlap = max(0, size - 1)
    chunks = []
    start = 0
    length = len(text)
    while start < length:
        end = min(length, start + size)
        chunks.append(text[start:end])
        if end >= length:
            break
        start = end - overlap
    return chunks

def tokenize(text):
    tokens = []
    current = []
    for ch in text.lower():
        if ch.isalnum():
            current.append(ch)
        else:
            if current:
                tokens.append("".join(current))
                current = []
    if current:
        tokens.append("".join(current))
    return tokens

def tf_idf_vectors(texts):
    docs = [tokenize(t) for t in texts]
    df = {}
    for tokens in docs:
        seen = set(tokens)
        for tok in seen:
            df[tok] = df.get(tok, 0) + 1
    n = len(docs)
    idf = {tok: (n + 1) / (df_val + 1) for tok, df_val in df.items()}
    vectors = []
    norms = []
    for tokens in docs:
        tf = {}
        for tok in tokens:
            tf[tok] = tf.get(tok, 0) + 1
        vec = {}
        norm = 0.0
        for tok, freq in tf.items():
            val = freq * idf.get(tok, 0.0)
            vec[tok] = val
            norm += val * val
        norms.append(norm ** 0.5)
        vectors.append(vec)
    return vectors, norms, idf

def score_query(query, vectors, norms, idf):
    q_tokens = tokenize(query)
    q_tf = {}
    for tok in q_tokens:
        q_tf[tok] = q_tf.get(tok, 0) + 1
    q_vec = {}
    q_norm = 0.0
    for tok, freq in q_tf.items():
        val = freq * idf.get(tok, 0.0)
        if val == 0.0:
            continue
        q_vec[tok] = val
        q_norm += val * val
    q_norm = q_norm ** 0.5
    scores = []
    for vec, norm in zip(vectors, norms):
        if norm == 0.0 or q_norm == 0.0:
            scores.append(0.0)
            continue
        dot = 0.0
        for tok, qv in q_vec.items():
            dot += qv * vec.get(tok, 0.0)
        scores.append(dot / (norm * q_norm))
    return scores

def keyword_scores(query, chunks):
    text = (query or "").strip()
    if not text:
        return [0.0 for _ in chunks]
    tokens = tokenize(text)
    if not tokens:
        tokens = [text.lower()]
    scores = []
    for c in chunks:
        content = (c.get("chunk") or "").lower()
        score = 0.0
        for tok in tokens:
            if not tok:
                continue
            score += content.count(tok)
        scores.append(float(score))
    return scores

def cosine_similarity(vec_a, vec_b):
    if not vec_a or not vec_b or len(vec_a) != len(vec_b):
        return 0.0
    dot = 0.0
    norm_a = 0.0
    norm_b = 0.0
    for a, b in zip(vec_a, vec_b):
        dot += a * b
        norm_a += a * a
        norm_b += b * b
    if norm_a == 0.0 or norm_b == 0.0:
        return 0.0
    return dot / ((norm_a ** 0.5) * (norm_b ** 0.5))

def embedding_request(url, api_key, payload):
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=data, method="POST")
    req.add_header("Content-Type", "application/json")
    req.add_header("Authorization", f"Bearer {api_key}")
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.loads(resp.read().decode("utf-8"))

def embed_texts(texts, provider, model, api_base, api_key, batch_size):
    if provider == "openai":
        url = api_base.rstrip("/") + "/v1/embeddings"
    elif provider == "openrouter":
        url = api_base.rstrip("/") + "/v1/embeddings"
    else:
        return None, f"Unsupported embedding provider: {provider}"
    vectors = []
    idx = 0
    while idx < len(texts):
        batch = texts[idx:idx + batch_size]
        payload = {"model": model, "input": batch}
        data = embedding_request(url, api_key, payload)
        items = data.get("data", [])
        if len(items) != len(batch):
            return None, "Embedding response size mismatch"
        items.sort(key=lambda x: x.get("index", 0))
        vectors.extend([i.get("embedding", []) for i in items])
        idx += batch_size
    return vectors, None

def sort_files(files, order, base_dir):
    if order == "mtime_asc":
        return sorted(files, key=lambda p: os.path.getmtime(p))
    if order == "mtime_desc":
        return sorted(files, key=lambda p: os.path.getmtime(p), reverse=True)
    if order == "path":
        return sorted(files, key=lambda p: os.path.relpath(p, base_dir))
    return None

def apply_field_limits(items, fields, max_fields):
    if fields is None:
        return items
    filtered = []
    for item in items:
        entry = {k: item.get(k) for k in fields if k in item}
        if max_fields is not None:
            entry = dict(list(entry.items())[:max_fields])
        filtered.append(entry)
    return filtered

def chunk_search(path, order, allowed_paths=None, strict_mode=None, chunk_size=1200, chunk_overlap=200, query=None, top_k=None, max_chunks=None, chunk_fields=None, file_fields=None, max_chunk_fields=None, max_file_fields=None, embedding_provider=None, embedding_model=None, embedding_api_base=None, embedding_api_key=None, embedding_api_key_env=None, embedding_batch_size=64, embedding_max_file_chars=None, retrieval_mode=None):
    base_dir = os.path.abspath(os.getcwd())
    target_path = os.path.abspath(os.path.join(base_dir, path or ""))
    if strict_mode is None:
        strict_mode = allowed_paths is not None
    ok, code, msg = check_path_allowed(target_path, allowed_paths, base_dir, strict_mode)
    if not ok:
        return {"error": msg, "status": "failed", "code": code}
    if not os.path.exists(target_path):
        return {"error": f"Path not found: {path}", "status": "failed", "code": "not_found"}
    files = collect_files(target_path)
    ordered = sort_files(files, order, base_dir)
    if ordered is None:
        return {"error": f"Unsupported order: {order}", "status": "failed", "code": "invalid_order"}
    chunks = []
    files_out = []
    errors = []
    file_sizes = {}
    for file_path in ordered:
        rel_path = os.path.relpath(file_path, base_dir)
        try:
            content = read_text(file_path)
        except Exception as e:
            errors.append({"file_path": rel_path, "error": str(e)})
            continue
        hint = read_hint_for(file_path)
        file_sizes[rel_path] = len(content)
        file_chunks = chunk_text(content, int(chunk_size), int(chunk_overlap))
        files_out.append({
            "file_path": rel_path,
            "chunk_count": len(file_chunks),
            "hint": hint
        })
        for idx, chunk in enumerate(file_chunks):
            chunks.append({
                "file_path": rel_path,
                "chunk_index": idx,
                "chunk": chunk,
                "hint": hint
            })
    if query:
        mode = retrieval_mode.lower() if retrieval_mode else None
        if mode and mode not in ["embedding", "tfidf", "keyword"]:
            return {"error": f"Unsupported retrieval mode: {retrieval_mode}", "status": "failed", "code": "invalid_retrieval_mode"}
        if mode == "keyword":
            scores = keyword_scores(query, chunks)
            for c, s in zip(chunks, scores):
                c["score"] = s
        elif mode == "tfidf":
            texts = [c["chunk"] for c in chunks]
            vectors, norms, idf = tf_idf_vectors(texts)
            scores = score_query(query, vectors, norms, idf)
            for c, s in zip(chunks, scores):
                c["score"] = s
        else:
            provider = embedding_provider
            api_key = embedding_api_key
            api_base = embedding_api_base
            model = embedding_model
            if provider == "tfidf" and mode == "embedding":
                return {"error": "Retrieval mode 'embedding' conflicts with embedding_provider 'tfidf'", "status": "failed", "code": "invalid_retrieval_mode"}
            if provider is None:
                if os.environ.get("OPENAI_API_KEY"):
                    provider = "openai"
                    api_key = os.environ.get("OPENAI_API_KEY")
                elif os.environ.get("OPENROUTER_API_KEY"):
                    provider = "openrouter"
                    api_key = os.environ.get("OPENROUTER_API_KEY")
                elif mode == "embedding":
                    return {"error": "Missing embedding API key", "status": "failed", "code": "missing_api_key"}
                else:
                    provider = "tfidf"
            if provider == "tfidf":
                texts = [c["chunk"] for c in chunks]
                vectors, norms, idf = tf_idf_vectors(texts)
                scores = score_query(query, vectors, norms, idf)
                for c, s in zip(chunks, scores):
                    c["score"] = s
            else:
                if embedding_api_key_env and not api_key:
                    api_key = os.environ.get(embedding_api_key_env)
                if not api_key:
                    return {"error": "Missing embedding API key", "status": "failed", "code": "missing_api_key"}
                if not api_base:
                    api_base = "https://api.openai.com" if provider == "openai" else "https://openrouter.ai/api"
                if not model:
                    model = "text-embedding-3-small" if provider == "openai" else "openai/text-embedding-3-small"
                eligible = list(range(len(chunks)))
                if embedding_max_file_chars is not None:
                    limit = int(embedding_max_file_chars)
                    eligible = [i for i, c in enumerate(chunks) if file_sizes.get(c["file_path"], 0) <= limit]
                if not eligible:
                    texts = [c["chunk"] for c in chunks]
                    vectors, norms, idf = tf_idf_vectors(texts)
                    scores = score_query(query, vectors, norms, idf)
                    for c, s in zip(chunks, scores):
                        c["score"] = s
                else:
                    texts = [chunks[i]["chunk"] for i in eligible]
                    chunk_vectors, err = embed_texts(texts, provider, model, api_base, api_key, int(embedding_batch_size))
                    if err:
                        return {"error": err, "status": "failed", "code": "embedding_error"}
                    query_vector, err = embed_texts([query], provider, model, api_base, api_key, int(embedding_batch_size))
                    if err:
                        return {"error": err, "status": "failed", "code": "embedding_error"}
                    qv = query_vector[0] if query_vector else []
                    for i, v in zip(eligible, chunk_vectors):
                        chunks[i]["score"] = cosine_similarity(qv, v)
                    for i in range(len(chunks)):
                        if "score" not in chunks[i]:
                            chunks[i]["score"] = 0.0
        order_index = {os.path.relpath(fp, base_dir): i for i, fp in enumerate(ordered)}
        chunks.sort(key=lambda c: (-c.get("score", 0.0), order_index.get(c["file_path"], 0), c["chunk_index"]))
        if top_k is not None:
            chunks = chunks[:int(top_k)]
    if max_chunks is not None:
        chunks = chunks[:int(max_chunks)]
    files_out = apply_field_limits(files_out, file_fields, max_file_fields)
    chunks = apply_field_limits(chunks, chunk_fields, max_chunk_fields)
    result = {"status": "success", "chunks": chunks, "files": files_out}
    if errors:
        result["errors"] = errors
    return result

if __name__ == "__main__":
    try:
        args = json.loads(sys.argv[1]) if len(sys.argv) > 1 else {}
        path = args.get("path")
        order = args.get("order")
        perms = args.get("context_permissions")
        strict_mode = args.get("strict_mode")
        chunk_size = args.get("chunk_size", 1200)
        chunk_overlap = args.get("chunk_overlap", 200)
        query = args.get("query")
        top_k = args.get("top_k")
        max_chunks = args.get("max_chunks")
        chunk_fields = args.get("chunk_fields")
        file_fields = args.get("file_fields")
        max_chunk_fields = args.get("max_chunk_fields")
        max_file_fields = args.get("max_file_fields")
        embedding_provider = args.get("embedding_provider")
        embedding_model = args.get("embedding_model")
        embedding_api_base = args.get("embedding_api_base")
        embedding_api_key = args.get("embedding_api_key")
        embedding_api_key_env = args.get("embedding_api_key_env")
        embedding_batch_size = args.get("embedding_batch_size", 64)
        embedding_max_file_chars = args.get("embedding_max_file_chars")
        retrieval_mode = args.get("retrieval_mode")
        if not path or not order:
            raise ValueError("Fields 'path' and 'order' are required.")
        result = chunk_search(path, order, perms, strict_mode, chunk_size, chunk_overlap, query, top_k, max_chunks, chunk_fields, file_fields, max_chunk_fields, max_file_fields, embedding_provider, embedding_model, embedding_api_base, embedding_api_key, embedding_api_key_env, embedding_batch_size, embedding_max_file_chars, retrieval_mode)
        print(json.dumps(result))
    except Exception as e:
        print(json.dumps({"error": f"Kernel communication error: {str(e)}", "status": "failed", "code": "execution_error"}))
