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


def leave_one_out_cv(x, y, lr=0.5, epochs=500, l2=0.0, seed=42):
    """Fits a fresh model with each row held out and predicts it. Meaningful
    for the tiny offline fixture (a handful of rows) where k-fold would leave
    folds with too few points to fit."""
    n = len(x)
    oof_probs = [None] * n
    for i in range(n):
        x_train = x[:i] + x[i + 1 :]
        y_train = y[:i] + y[i + 1 :]
        w, b = fit_logreg(x_train, y_train, lr=lr, epochs=epochs, l2=l2, seed=seed)
        oof_probs[i] = predict_proba([x[i]], w, b)[0]
    return oof_probs
