import csv
import datetime as dt
import math
import tempfile
import unittest
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from validate import run


class ValidationTests(unittest.TestCase):
    def test_time_split_and_model_result(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "synthetic.csv"
            with path.open("w", encoding="utf-8", newline="") as handle:
                writer = csv.writer(handle)
                writer.writerow(["date", "code", "adjusted_close"])
                start = dt.date(2022, 1, 1)
                for i in range(420):
                    day = start + dt.timedelta(days=i)
                    for code, shift in (("A", 0), ("B", 1)):
                        writer.writerow([day.isoformat(), code, round(100 + i * .04 + 3 * math.sin(i / 10 + shift), 6)])
            result = run(path)
            self.assertEqual(result["stock_count"], 2)
            self.assertGreater(result["test_count"], 50)
            self.assertLess(result["train_period"].split("〜")[-1], result["validation_period"].split("〜")[0])
            self.assertLess(result["validation_period"].split("〜")[-1], result["test_period"].split("〜")[0])
            self.assertIn(result["selected_on_validation"], {m["name"] for m in result["models"]})


if __name__ == "__main__":
    unittest.main()
