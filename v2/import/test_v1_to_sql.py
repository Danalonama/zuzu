"""Tests for the sheet → extraction conversion. Run: python3 v2/import/test_v1_to_sql.py"""
import datetime as dt
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import v1_to_sql as V  # noqa: E402

D = dt.date


def check(actual, expected, label):
    assert actual == expected, f"FAIL {label}: expected {expected!r}, got {actual!r}"


# year-less dates take the year nearest the row's start, not "next from today"
check(V.day_month("18.9", D(2026, 9, 1)), D(2026, 9, 18), "18.9 near a September start")
check(V.day_month("5.1", D(2026, 12, 20)), D(2027, 1, 5), "January after a December start")
check(V.day_month("18/9/26", None), D(2026, 9, 18), "explicit 2-digit year")
check(V.day_month("31.2", D(2026, 1, 1)), None, "impossible date")

# v1 can't split on "·" (seen in a real course row); here it can
check(V.date_list("8.9 · 15.9 · 20.10", D(2026, 9, 8)),
      [D(2026, 9, 8), D(2026, 9, 15), D(2026, 10, 20)], "middle-dot separator")

# monthly = same nth weekday (3rd Saturday stays 3rd Saturday)
check(V.monthly_dates(D(2026, 9, 19), D(2026, 12, 31), 0),
      [D(2026, 9, 19), D(2026, 10, 17), D(2026, 11, 21), D(2026, 12, 19)], "3rd Saturday")
check(len(V.monthly_dates(D(2026, 9, 19), D(2030, 1, 1), 2)), 2, "count wins")

base = {"title": "t", "date": dt.datetime(2026, 9, 1), "approved": True, "uid": "u"}

meta, x = V.convert({**base, "repeat": "weekly", "count": 8.0})
check(x["weekdays"], [2], "Tuesday = 2 (Sunday = 0)")
check(x["date_end"], "2026-10-20", "8 weekly sessions end 7 weeks later")

meta, x = V.convert({**base, "repeat": "biweekly", "count": 3.0})
check(x["occurrence_dates"], ["2026-09-01", "2026-09-15", "2026-09-29"], "biweekly → dates")

meta, x = V.convert({**base, "repeat": "weekly", "dates": "1.9, 3.9"})
check("weekdays" in x, False, "dates column wins over repeat")

meta, x = V.convert({**base, "teachers": "1.9=נוגה בר; 8.9=המורה יתעדכן; 15.9=שני"})
check(meta["rotation"], [{"date": "2026-09-01", "host": "נוגה בר"}, {"date": "2026-09-15", "host": "שני"}],
      "rotation, placeholder dropped")

meta, x = V.convert({**base, "category": "מחול, נשים בלבד, חקר התנועה", "type": "שיעור", "price": 90.0})
check((x["disciplines"], x["audience"], x["formats"]), (["מחול", "חקר תנועה"], ["women_only"], ["שיעור"]),
      "audience split out, spelling unified")
check((x["price_text"], x["price_min"]), ("90", "90"), "price")

check(V.convert({**base, "approved": False, "review": "rejected"})[0]["status"], "rejected", "rejected")
check(V.convert({**base, "approved": False})[0]["status"], "draft", "pending → draft")
check(V.convert({**base, "venue": "Studio", "city": "Moncalvo, Italy"})[1]["venue"],
      {"name": "Studio", "city": None, "region": None, "kind": "abroad", "country": "Italy"}, "abroad from city cell")
check(V.lit("it's"), "'it''s'", "SQL quoting")
print("ok")
