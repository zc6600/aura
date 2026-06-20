def accuracy_from_probs(y_true, y_prob):
    correct = 0
    for y, p in zip(y_true, y_prob):
        pred = 1.0 if p >= 0.5 else 0.0
        if pred == y:
            correct += 1
    return correct / max(1, len(y_true))
