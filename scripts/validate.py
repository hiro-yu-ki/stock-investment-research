"""Offline, standard-library walk-forward-style holdout for user-owned adjusted daily CSV.

No data is fetched or transmitted. This is a research baseline, not a trading signal.
"""
from __future__ import annotations

import argparse
import csv
import datetime as dt
import json
import math
from collections import defaultdict
from pathlib import Path

HORIZON = 20
FEATURE_LAGS = (1, 5, 20)


def load_rows(path: Path):
    by_code = defaultdict(list)
    seen = set()
    with path.open(encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        if not reader.fieldnames or not {"date", "code", "adjusted_close"}.issubset(reader.fieldnames):
            raise ValueError("date, code, adjusted_close columns are required")
        for line, row in enumerate(reader, 2):
            try:
                date = dt.date.fromisoformat(row["date"].strip())
                code = row["code"].strip()
                price = float(row["adjusted_close"])
                if not code or not math.isfinite(price) or price <= 0 or date > dt.date.today():
                    raise ValueError()
                key = (code, date)
                if key in seen:
                    raise ValueError("duplicate")
                seen.add(key)
                by_code[code].append((date, price))
            except (ValueError, TypeError) as exc:
                raise ValueError(f"Invalid adjusted price/date/code or duplicate at CSV line {line}") from exc
    for rows in by_code.values():
        rows.sort()
    return by_code


def make_samples(by_code):
    samples = []
    for code, rows in by_code.items():
        for i in range(20, len(rows) - HORIZON - 1):
            current = rows[i][1]
            lag = [current / rows[i - n][1] - 1 for n in FEATURE_LAGS]
            daily = [rows[j][1] / rows[j - 1][1] - 1 for j in range(i - 19, i + 1)]
            mean = sum(daily) / len(daily)
            vol = math.sqrt(sum((x - mean) ** 2 for x in daily) / len(daily))
            entry = rows[i + 1][1]
            exit_price = rows[i + HORIZON + 1][1]
            samples.append({"code": code, "date": rows[i][0], "label_end": rows[i + HORIZON + 1][0],
                            "x": lag + [vol], "y": exit_price / entry - 1})
    return sorted(samples, key=lambda s: (s["date"], s["code"]))


def solve(a, b):
    n = len(b)
    a = [row[:] + [b[i]] for i, row in enumerate(a)]
    for k in range(n):
        pivot = max(range(k, n), key=lambda i: abs(a[i][k]))
        a[k], a[pivot] = a[pivot], a[k]
        if abs(a[k][k]) < 1e-12:
            raise ValueError("Singular model")
        div = a[k][k]
        a[k] = [v / div for v in a[k]]
        for i in range(n):
            if i == k:
                continue
            factor = a[i][k]
            a[i] = [a[i][j] - factor * a[k][j] for j in range(n + 1)]
    return [row[-1] for row in a]


def ridge_fit(train, penalty=10.0):
    means = [sum(s["x"][j] for s in train) / len(train) for j in range(4)]
    scales = [math.sqrt(sum((s["x"][j] - means[j]) ** 2 for s in train) / len(train)) or 1 for j in range(4)]
    xx = [[0.0] * 5 for _ in range(5)]
    xy = [0.0] * 5
    for sample in train:
        x = [1.0] + [(sample["x"][j] - means[j]) / scales[j] for j in range(4)]
        for j in range(5):
            xy[j] += x[j] * sample["y"]
            for k in range(5):
                xx[j][k] += x[j] * x[k]
    for j in range(1, 5):
        xx[j][j] += penalty
    beta = solve(xx, xy)
    return lambda s: beta[0] + sum(beta[j + 1] * (s["x"][j] - means[j]) / scales[j] for j in range(4))


def models(train):
    avg = sum(s["y"] for s in train) / len(train)
    result = {
        "zero": lambda s: 0.0,
        "historical_mean": lambda s: avg,
        "momentum_20d": lambda s: s["x"][2],
        "ridge": ridge_fit(train),
    }
    features = lambda samples: [s["x"] for s in samples]
    try:
        import lightgbm as lgb
        model = lgb.LGBMRegressor(n_estimators=80, num_leaves=7, max_depth=3, learning_rate=0.04, verbosity=-1, random_state=42)
        model.fit(features(train), [s["y"] for s in train])
        result["lightgbm"] = lambda s: float(model.predict([s["x"]])[0])
    except ImportError:
        pass
    try:
        import xgboost as xgb
        model = xgb.XGBRegressor(n_estimators=80, max_depth=2, learning_rate=0.04, subsample=1, n_jobs=1, random_state=42)
        model.fit(features(train), [s["y"] for s in train])
        result["xgboost"] = lambda s: float(model.predict([s["x"]])[0])
    except ImportError:
        pass
    return result


def evaluate(samples, predict):
    errors = [abs(predict(s) - s["y"]) for s in samples]
    correct = sum((predict(s) > 0) == (s["y"] > 0) for s in samples)
    return {"mae": sum(errors) / len(errors), "direction_accuracy": correct / len(samples), "test_count": len(samples)}


def run(path: Path):
    by_code = load_rows(path)
    samples = make_samples(by_code)
    dates = sorted({s["date"] for s in samples})
    if len(dates) < 260 or len(samples) < 500:
        raise ValueError("Insufficient history: require 260 signal dates and 500 samples after feature/label construction")
    val_start, test_start = dates[int(len(dates) * .7)], dates[int(len(dates) * .85)]
    train = [s for s in samples if s["date"] < val_start and s["label_end"] < val_start]
    validation = [s for s in samples if val_start <= s["date"] < test_start and s["label_end"] < test_start]
    test = [s for s in samples if s["date"] >= test_start]
    if min(len(train), len(validation), len(test)) < 50:
        raise ValueError("Insufficient non-overlapping train, validation or test samples")
    fitted = models(train)
    validation_scores = {name: evaluate(validation, predict)["mae"] for name, predict in fitted.items()}
    selected = min(validation_scores, key=validation_scores.get)
    rows = [{"name": name, **evaluate(test, predict), "validation_mae": validation_scores[name]}
            for name, predict in fitted.items()]
    return {
        "schema_version": 1, "kind": "historical_validation", "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
        "source_file": path.name, "stock_count": len(by_code), "sample_count": len(samples),
        "horizon_days": HORIZON, "train_period": f"{train[0]['date']}〜{train[-1]['date']}",
        "validation_period": f"{validation[0]['date']}〜{validation[-1]['date']}",
        "test_period": f"{test[0]['date']}〜{test[-1]['date']}",
        "train_count": len(train), "validation_count": len(validation), "test_count": len(test),
        "selected_on_validation": selected, "models": rows,
        "limitations": ["Input adjusted_close and usage rights are user supplied and not independently verified.",
                        "Survivorship bias remains if delisted stocks are absent.",
                        "No dividends, trading fees, slippage, liquidity constraints or tax are evaluated.",
                        "This regression holdout does not establish a profitable trading strategy or current buy signal."],
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("csv_file", type=Path)
    parser.add_argument("--output", type=Path, default=Path("validation.json"))
    args = parser.parse_args()
    result = run(args.csv_file)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2, default=str), encoding="utf-8")
    print(f"Wrote {args.output}: {result['stock_count']} stocks, {result['test_count']} test samples; selected {result['selected_on_validation']} on validation MAE")


if __name__ == "__main__":
    main()
