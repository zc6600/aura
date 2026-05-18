import json
import os
import urllib.request

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

def keyword_scores(query, texts):
    text = (query or "").strip()
    if not text:
        return [0.0 for _ in texts]
    tokens = tokenize(text)
    if not tokens:
        tokens = [text.lower()]
    scores = []
    for content in texts:
        content_text = (content or "").lower()
        score = 0.0
        for tok in tokens:
            if not tok:
                continue
            score += content_text.count(tok)
        scores.append(float(score))
    return scores

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

def compute_scores(query, texts, retrieval_mode=None, embedding_provider=None, embedding_model=None, embedding_api_base=None, embedding_api_key=None, embedding_api_key_env=None, embedding_batch_size=64, embedding_max_doc_chars=None):
    mode = retrieval_mode.lower() if retrieval_mode else None
    if mode and mode not in ["embedding", "tfidf", "keyword"]:
        return None, "invalid_retrieval_mode"
    if mode == "keyword":
        return keyword_scores(query, texts), None
    if mode == "tfidf":
        vectors, norms, idf = tf_idf_vectors(texts)
        return score_query(query, vectors, norms, idf), None
    provider = embedding_provider
    api_key = embedding_api_key
    api_base = embedding_api_base
    model = embedding_model
    if provider == "tfidf" and mode == "embedding":
        return None, "invalid_retrieval_mode"
    if provider is None:
        if os.environ.get("OPENAI_API_KEY"):
            provider = "openai"
            api_key = os.environ.get("OPENAI_API_KEY")
        elif os.environ.get("OPENROUTER_API_KEY"):
            provider = "openrouter"
            api_key = os.environ.get("OPENROUTER_API_KEY")
        elif mode == "embedding":
            return None, "missing_api_key"
        else:
            provider = "tfidf"
    if provider == "tfidf":
        vectors, norms, idf = tf_idf_vectors(texts)
        return score_query(query, vectors, norms, idf), None
    if embedding_api_key_env and not api_key:
        api_key = os.environ.get(embedding_api_key_env)
    if not api_key:
        return None, "missing_api_key"
    if not api_base:
        api_base = "https://api.openai.com" if provider == "openai" else "https://openrouter.ai/api"
    if not model:
        model = "text-embedding-3-small" if provider == "openai" else "openai/text-embedding-3-small"
    eligible = list(range(len(texts)))
    if embedding_max_doc_chars is not None:
        limit = int(embedding_max_doc_chars)
        eligible = [i for i, text in enumerate(texts) if len(text or "") <= limit]
    if not eligible:
        vectors, norms, idf = tf_idf_vectors(texts)
        return score_query(query, vectors, norms, idf), None
    doc_texts = [texts[i] for i in eligible]
    doc_vectors, err = embed_texts(doc_texts, provider, model, api_base, api_key, int(embedding_batch_size))
    if err:
        return None, "embedding_error"
    query_vector, err = embed_texts([query], provider, model, api_base, api_key, int(embedding_batch_size))
    if err:
        return None, "embedding_error"
    qv = query_vector[0] if query_vector else []
    scores = [0.0 for _ in texts]
    for i, v in zip(eligible, doc_vectors):
        scores[i] = cosine_similarity(qv, v)
    return scores, None
