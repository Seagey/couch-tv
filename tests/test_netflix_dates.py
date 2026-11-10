"""Netflix history dates: day first by default (Australia), month first when the file proves it
(a Canadian export with 3/25/24 in it), couch-tv#71."""
import importlib.util
from pathlib import Path
import unittest

path = Path(__file__).parents[1] / "bridge" / "import" / "netflix.py"
spec = importlib.util.spec_from_file_location("importer_netflix", path)
netflix = importlib.util.module_from_spec(spec)
spec.loader.exec_module(netflix)


def csv_of(*dates):
    return "Title,Date\n" + "\n".join(f'"Show {i}: Season 1: Ep",{d}' for i, d in enumerate(dates)) + "\n"


def when(text):
    return [i["when"] for i in netflix.parse(text, lambda p: "alex")]


class Dates(unittest.TestCase):
    def test_month_first_file_is_read_month_first(self):
        # 3/4/24 is ambiguous on its own; 3/25/24 settles the whole file
        self.assertEqual(when(csv_of("3/4/24", "3/25/24", "11/2/24")),
                         ["2024-03-04", "2024-03-25", "2024-11-02"])

    def test_day_first_file_is_unchanged(self):
        self.assertEqual(when(csv_of("3/4/24", "25/3/24", "11/2/24")),
                         ["2024-04-03", "2024-03-25", "2024-02-11"])

    def test_nothing_settles_it_stays_day_first(self):
        self.assertEqual(when(csv_of("3/4/24", "11/2/24")), ["2024-04-03", "2024-02-11"])

    def test_four_digit_years(self):
        self.assertEqual(when(csv_of("3/25/2024", "1/2/2024")), ["2024-03-25", "2024-01-02"])
        self.assertEqual(when(csv_of("25/3/2024", "1/2/2024")), ["2024-03-25", "2024-02-01"])

    def test_other_formats_still_parse(self):
        self.assertEqual(when(csv_of("2024-03-25", "25.03.24")), ["2024-03-25", "2024-03-25"])

    def test_date_order(self):
        self.assertEqual(netflix.date_order(["3/25/24"]), "mdy")
        self.assertEqual(netflix.date_order(["25/3/24"]), "dmy")
        self.assertEqual(netflix.date_order(["13/13/24"]), "dmy")   # nonsense in both: not month first
        self.assertEqual(netflix.date_order([]), "dmy")


if __name__ == "__main__":
    unittest.main()
