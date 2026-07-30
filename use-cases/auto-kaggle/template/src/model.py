import math
import random


def sigmoid(z):
    if z < -60.0:
        return 0.0
    if z > 60.0:
        return 1.0
    return 1.0 / (1.0 + math.exp(-z))


def fit_logreg(x, y, lr=0.5, epochs=500, l2=0.0, seed=42):
    """Pure-Python batch-gradient-descent logistic regression. No numpy/sklearn
    dependency so it runs anywhere a bare python3 interpreter is available."""
    n = len(x)
    d = len(x[0])
    rng = random.Random(seed)
    w = [rng.uniform(-0.01, 0.01) for _ in range(d)]
    b = 0.0
    for _ in range(epochs):
        grad_w = [0.0] * d
        grad_b = 0.0
        for xi, yi in zip(x, y):
            z = sum(wj * xij for wj, xij in zip(w, xi)) + b
            err = sigmoid(z) - yi
            for j in range(d):
                grad_w[j] += err * xi[j]
            grad_b += err
        for j in range(d):
            w[j] -= lr * (grad_w[j] / n + l2 * w[j])
        b -= lr * (grad_b / n)
    return w, b


def predict_proba(x, w, b):
    return [sigmoid(sum(wj * xij for wj, xij in zip(w, xi)) + b) for xi in x]


def k_fold_cv(x, y, n_splits=5, lr=0.5, epochs=500, l2=0.0, seed=42):
    """Out-of-fold predictions via k-fold CV. Refits n_splits times instead of
    len(x) times, so it stays usable on real-sized competition data (leave-
    one-out is O(n) fits and becomes impractical past a few hundred rows).
    n_splits is clamped to [2, len(x)], so it degrades to leave-one-out on
    the tiny offline fixture where len(x) < the configured n_splits."""
    n = len(x)
    n_splits = max(2, min(n_splits, n))
    rng = random.Random(seed)
    order = list(range(n))
    rng.shuffle(order)
    folds = [order[i::n_splits] for i in range(n_splits)]
    oof_probs = [None] * n
    for k in range(n_splits):
        valid_idx = set(folds[k])
        train_idx = [i for i in order if i not in valid_idx]
        x_train = [x[i] for i in train_idx]
        y_train = [y[i] for i in train_idx]
        w, b = fit_logreg(x_train, y_train, lr=lr, epochs=epochs, l2=l2, seed=seed)
        for i in folds[k]:
            oof_probs[i] = predict_proba([x[i]], w, b)[0]
    return oof_probs
