"""Exercise every snippet from the Google Jobs tracker article.

Run from jobtracker/:  python -m unittest test_article.py -v
"""
from __future__ import annotations

import hashlib
import json
import os
import sqlite3
import tempfile
import unittest
from datetime import date, timedelta
from pathlib import Path
from unittest.mock import MagicMock, patch
from urllib.parse import unquote

os.environ.setdefault("SEARCHAPI_KEY", "test-key-not-real")

import matplotlib

matplotlib.use("Agg")

import pandas as pd
import yaml

import analyze
import tracker


SAMPLE_JOB = {
    "position": 1,
    "title": "Senior Backend Engineer",
    "company_name": "Acme Corp",
    "location": "Austin, TX",
    "via": "via LinkedIn",
    "description": "About this role…",
    "extensions": ["3 days ago", "Full-time", "Health insurance"],
    "detected_extensions": {
        "posted_at": "3 days ago",
        "schedule": "Full-time",
        "salary": "$150K a year",
        "work_from_home": True,
        "health_insurance": True,
    },
    "apply_link": "https://example.com/apply",
    "sharing_link": (
        "https://www.google.com/search?ibp=htl;jobs&htidocid="
        "2_EkUK_X1ZOKUz-CAAAAAA%3D%3D"
    ),
}

SNAPSHOT = date(2026, 8, 21)


class ParsePostedAtTests(unittest.TestCase):
    def test_missing(self):
        self.assertEqual(tracker.parse_posted_at(None, SNAPSHOT), (None, "missing"))
        self.assertEqual(tracker.parse_posted_at("", SNAPSHOT), (None, "missing"))

    def test_immediate_strings(self):
        for raw in ("Just posted", "just now", "Today", "posted today"):
            with self.subTest(raw=raw):
                self.assertEqual(
                    tracker.parse_posted_at(raw, SNAPSHOT),
                    ("2026-08-21", "day"),
                )

    def test_three_days_ago(self):
        self.assertEqual(
            tracker.parse_posted_at("3 days ago", SNAPSHOT),
            ("2026-08-18", "day"),
        )

    def test_twenty_two_hours_ago(self):
        posted, precision = tracker.parse_posted_at("22 hours ago", SNAPSHOT)
        self.assertEqual(precision, "day")
        self.assertEqual(posted, (SNAPSHOT - timedelta(hours=22)).isoformat())

    def test_thirty_plus_days_is_floor(self):
        posted, precision = tracker.parse_posted_at("30+ days ago", SNAPSHOT)
        self.assertEqual(precision, "floor")
        self.assertEqual(posted, (SNAPSHOT - timedelta(days=30)).isoformat())

    def test_over_two_weeks_is_floor_and_approx_unit(self):
        posted, precision = tracker.parse_posted_at("over 2 weeks ago", SNAPSHOT)
        self.assertEqual(precision, "floor")
        self.assertEqual(posted, (SNAPSHOT - timedelta(weeks=2)).isoformat())

    def test_weeks_without_floor_are_approx(self):
        posted, precision = tracker.parse_posted_at("2 weeks ago", SNAPSHOT)
        self.assertEqual(precision, "approx")
        self.assertEqual(posted, (SNAPSHOT - timedelta(weeks=2)).isoformat())

    def test_months_round_to_thirty_days(self):
        posted, precision = tracker.parse_posted_at("1 month ago", SNAPSHOT)
        self.assertEqual(precision, "approx")
        self.assertEqual(posted, (SNAPSHOT - timedelta(days=30)).isoformat())

    def test_unparsed(self):
        self.assertEqual(
            tracker.parse_posted_at("last Tuesday", SNAPSHOT),
            (None, "unparsed"),
        )


class ClassifyWorkModeTests(unittest.TestCase):
    def test_flagged_remote_without_office_language(self):
        job = {"detected_extensions": {"work_from_home": True}, "location": "Austin, TX",
               "description": "Build APIs in Python."}
        self.assertEqual(tracker.classify_work_mode(job), "remote")

    def test_location_says_remote(self):
        job = {"location": "Remote", "description": "Write services."}
        self.assertEqual(tracker.classify_work_mode(job), "remote")

    def test_remote_flag_plus_hybrid_language_is_hybrid(self):
        job = {
            "detected_extensions": {"work_from_home": True},
            "location": "Remote",
            "description": "This is a hybrid role with 3 days per week in the office.",
        }
        self.assertEqual(tracker.classify_work_mode(job), "hybrid")

    def test_onsite_in_description_does_not_become_hybrid(self):
        job = {
            "location": "San Francisco, CA",
            "description": "You will work onsite with the platform team.",
        }
        self.assertEqual(tracker.classify_work_mode(job), "onsite")

    def test_hybrid_from_description_only(self):
        job = {"location": "Denver, CO", "description": "Hybrid schedule, come in Tuesdays."}
        self.assertEqual(tracker.classify_work_mode(job), "hybrid")

    def test_flagged_false_is_onsite(self):
        job = {"detected_extensions": {"work_from_home": False}, "location": "Atlanta, GA"}
        self.assertEqual(tracker.classify_work_mode(job), "onsite")

    def test_unknown_when_no_signal(self):
        job = {"location": "Seattle, WA", "description": "Ship backend services."}
        self.assertEqual(tracker.classify_work_mode(job), "unknown")

    def test_benefits_boilerplate_beyond_2000_chars_is_ignored(self):
        padding = "x" * 2000
        job = {
            "location": "New York, NY",
            "description": padding + " We offer remote work from home and hybrid flexibility.",
        }
        self.assertEqual(tracker.classify_work_mode(job), "unknown")

    def test_remote_flag_plus_onsite_language_is_hybrid(self):
        job = {
            "detected_extensions": {"work_from_home": True},
            "location": "San Francisco, CA",
            "description": "You will work onsite with the platform team one week a month.",
        }
        self.assertEqual(tracker.classify_work_mode(job), "hybrid")


class ParseSalaryTests(unittest.TestCase):
    def test_structured_annual_range(self):
        job = {"detected_extensions": {"salary": "$132,500 - $157,500 a year"}}
        result = tracker.parse_salary(job)
        self.assertEqual(result["salary_min"], 132500.0)
        self.assertEqual(result["salary_max"], 157500.0)
        self.assertEqual(result["salary_source"], "detected_extensions")

    def test_hourly_annualizes_at_2080(self):
        job = {"detected_extensions": {"salary": "$55 - $70 an hour"}}
        result = tracker.parse_salary(job)
        self.assertEqual(result["salary_min"], 55 * 2080)
        self.assertEqual(result["salary_max"], 70 * 2080)

    def test_ceiling_recorded_as_point_value(self):
        job = {"detected_extensions": {"salary": "Up to $180,000 a year"}}
        result = tracker.parse_salary(job)
        self.assertEqual(result["salary_min"], 180000.0)
        self.assertEqual(result["salary_max"], 180000.0)

    def test_pounds_are_discarded(self):
        job = {"detected_extensions": {"salary": "£50,000 - £65,000 a year"}}
        self.assertEqual(
            tracker.parse_salary(job),
            {"salary_min": None, "salary_max": None, "salary_source": None},
        )

    def test_equity_range_wins_then_fails_sanity_floor(self):
        job = {
            "detected_extensions": {
                "salary": "Equity grant of $2,000 - $8,000. Base salary $140,000 - $170,000."
            }
        }
        self.assertEqual(
            tracker.parse_salary(job),
            {"salary_min": None, "salary_max": None, "salary_source": None},
        )

    def test_k_suffix_from_sample_job(self):
        result = tracker.parse_salary(SAMPLE_JOB)
        self.assertEqual(result["salary_min"], 150000.0)
        self.assertEqual(result["salary_max"], 150000.0)

    def test_falls_back_to_description(self):
        job = {"description": "Compensation: $140,000 to $170,000 per year. Benefits include..."}
        result = tracker.parse_salary(job)
        self.assertEqual(result["salary_min"], 140000.0)
        self.assertEqual(result["salary_max"], 170000.0)
        self.assertEqual(result["salary_source"], "description")

    def test_swaps_inverted_range(self):
        job = {"detected_extensions": {"salary": "$170,000 - $140,000 a year"}}
        result = tracker.parse_salary(job)
        self.assertEqual(result["salary_min"], 140000.0)
        self.assertEqual(result["salary_max"], 170000.0)

    def test_empty_job_returns_nones(self):
        self.assertEqual(
            tracker.parse_salary({}),
            {"salary_min": None, "salary_max": None, "salary_source": None},
        )

    def test_canadian_and_australian_singles_match_as_usd(self):
        cad = tracker.parse_salary({"detected_extensions": {"salary": "C$120,000 a year"}})
        aud = tracker.parse_salary({"detected_extensions": {"salary": "A$150,000 a year"}})
        self.assertEqual(cad["salary_min"], 120000.0)
        self.assertEqual(aud["salary_min"], 150000.0)

    def test_cad_range_collapses_to_first_number(self):
        """C$ low - C$ high is not a SALARY_RANGE match; SALARY_SINGLE takes $120,000."""
        result = tracker.parse_salary(
            {"detected_extensions": {"salary": "C$120,000 - C$150,000 a year"}}
        )
        self.assertEqual(result["salary_min"], 120000.0)
        self.assertEqual(result["salary_max"], 120000.0)


class JobKeyTests(unittest.TestCase):
    def test_extracts_and_unquotes_htidocid(self):
        self.assertEqual(tracker.job_key(SAMPLE_JOB), "2_EkUK_X1ZOKUz-CAAAAAA==")

    def test_hash_fallback_when_sharing_link_missing(self):
        job = {"title": "Backend Engineer", "company_name": "Acme", "location": "Austin, TX"}
        seed = "backend engineer|acme|austin, tx"
        expected = "h:" + hashlib.sha1(seed.encode()).hexdigest()[:16]
        self.assertEqual(tracker.job_key(job), expected)

    def test_same_content_same_hash(self):
        a = {"title": "X", "company_name": "Y", "location": "Z"}
        b = {"title": " x ", "company_name": "Y", "location": "Z"}
        self.assertEqual(tracker.job_key(a), tracker.job_key(b))


class StorageTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
        self.tmp.close()
        self.conn = sqlite3.connect(self.tmp.name)
        self.conn.executescript(tracker.SCHEMA)

    def tearDown(self):
        self.conn.close()
        os.unlink(self.tmp.name)

    def _row(self, **overrides):
        posted = tracker.parse_posted_at("3 days ago", SNAPSHOT)
        base = {
            "snapshot_date": SNAPSHOT.isoformat(),
            "job_key": tracker.job_key(SAMPLE_JOB),
            "query": tracker.QUERY,
            "city": "Austin",
            "title": SAMPLE_JOB["title"],
            "company": SAMPLE_JOB["company_name"],
            "location": SAMPLE_JOB["location"],
            "via": SAMPLE_JOB["via"].replace("via ", ""),
            "posted_at_raw": "3 days ago",
            "posted_date": posted[0],
            "posted_precision": posted[1],
            "work_mode": tracker.classify_work_mode(SAMPLE_JOB),
            "schedule": "Full-time",
            "position": 1,
            **tracker.parse_salary(SAMPLE_JOB),
        }
        base.update(overrides)
        return base

    def test_insert_and_count(self):
        n = tracker.save_snapshot(self.conn, [self._row()])
        self.assertEqual(n, 1)
        count = self.conn.execute("SELECT COUNT(*) FROM snapshots").fetchone()[0]
        self.assertEqual(count, 1)

    def test_insert_or_replace_is_idempotent(self):
        tracker.save_snapshot(self.conn, [self._row(title="A")])
        tracker.save_snapshot(self.conn, [self._row(title="B")])
        rows = self.conn.execute("SELECT title FROM snapshots").fetchall()
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0][0], "B")

    def test_same_key_different_days_are_both_kept(self):
        tracker.save_snapshot(self.conn, [self._row()])
        tracker.save_snapshot(self.conn, [self._row(snapshot_date="2026-08-22")])
        count = self.conn.execute("SELECT COUNT(*) FROM snapshots").fetchone()[0]
        self.assertEqual(count, 2)

    def test_empty_rows_raises_index_error(self):
        with self.assertRaises(IndexError):
            tracker.save_snapshot(self.conn, [])


class FetchCityTests(unittest.TestCase):
    def _response(self, status, payload=None, text=""):
        resp = MagicMock()
        resp.status_code = status
        resp.text = text or json.dumps(payload or {})
        resp.json.return_value = payload or {}
        return resp

    def test_walks_two_pages_and_returns_location_used(self):
        page1 = self._response(200, {
            "search_parameters": {"location_used": "Austin, TX"},
            "jobs": [{"title": "A", "sharing_link": "https://x?htidocid=aaa"}],
            "pagination": {"next_page_token": "tok-2"},
        })
        page2 = self._response(200, {
            "jobs": [{"title": "B", "sharing_link": "https://x?htidocid=bbb"}],
            "pagination": {},
        })
        with patch.object(tracker.requests, "get", side_effect=[page1, page2]) as get:
            with patch.object(tracker.time, "sleep"):
                jobs, location_used = tracker.fetch_city("backend engineer", "Austin,Texas,United States")
        self.assertEqual(len(jobs), 2)
        self.assertEqual(location_used, "Austin, TX")
        self.assertEqual(get.call_count, 2)
        second_params = get.call_args_list[1].kwargs["params"]
        self.assertEqual(second_params["next_page_token"], "tok-2")

    def test_stops_when_page_empty(self):
        empty = self._response(200, {"jobs": [], "pagination": {"next_page_token": "tok"}})
        with patch.object(tracker.requests, "get", return_value=empty):
            jobs, _ = tracker.fetch_city("q", "Austin")
        self.assertEqual(jobs, [])

    def test_http_error_stops(self):
        err = self._response(500, text="boom")
        with patch.object(tracker.requests, "get", return_value=err):
            jobs, location_used = tracker.fetch_city("q", "Austin")
        self.assertEqual(jobs, [])
        self.assertIsNone(location_used)

    def test_network_error_stops(self):
        with patch.object(tracker.requests, "get", side_effect=tracker.requests.Timeout("nope")):
            jobs, _ = tracker.fetch_city("q", "Austin")
        self.assertEqual(jobs, [])

    def test_rate_limit_continue_skips_the_retried_page(self):
        """Article 429 handler continues the for-loop, consuming a page slot."""
        limited = self._response(429, text="slow down")
        ok = self._response(200, {
            "jobs": [{"title": "only-page-2"}],
            "search_parameters": {"location_used": "Austin, TX"},
            "pagination": {},
        })
        with patch.object(tracker.requests, "get", side_effect=[limited, ok]) as get:
            with patch.object(tracker.time, "sleep"):
                jobs, _ = tracker.fetch_city("q", "Austin", max_pages=2)
        self.assertEqual(get.call_count, 2)
        self.assertEqual(len(jobs), 1)
        self.assertEqual(jobs[0]["title"], "only-page-2")
        first_params = get.call_args_list[0].kwargs["params"]
        second_params = get.call_args_list[1].kwargs["params"]
        self.assertNotIn("next_page_token", first_params)
        self.assertNotIn("next_page_token", second_params)

    def test_page2_distinct_keys_snippet(self):
        jobs = [
            {"sharing_link": "https://x?htidocid=aaa"},
            {"sharing_link": "https://x?htidocid=bbb"},
            {"sharing_link": "https://x?htidocid=aaa"},
        ]
        keys = [tracker.job_key(j) for j in jobs]
        self.assertEqual(len(keys), 3)
        self.assertEqual(len(set(keys)), 2)


class RunSnapshotTests(unittest.TestCase):
    def test_normalizes_and_writes_one_city_batch(self):
        tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
        tmp.close()
        job = dict(SAMPLE_JOB)
        try:
            with patch.object(tracker, "DB_PATH", tmp.name), \
                 patch.object(tracker, "CITIES", ["Austin,Texas,United States"]), \
                 patch.object(tracker, "fetch_city", return_value=([job], "Austin, Texas, United States")), \
                 patch.object(tracker.time, "sleep"):
                tracker.run_snapshot()
            conn = sqlite3.connect(tmp.name)
            row = conn.execute(
                "SELECT title, company, city, work_mode, salary_min, job_key, via FROM snapshots"
            ).fetchone()
            conn.close()
            self.assertIsNotNone(row)
            title, company, city, work_mode, salary_min, job_key, via = row
            self.assertEqual(title, "Senior Backend Engineer")
            self.assertEqual(company, "Acme Corp")
            self.assertEqual(city, "Austin")
            self.assertEqual(work_mode, "remote")
            self.assertEqual(salary_min, 150000.0)
            self.assertEqual(job_key, unquote("2_EkUK_X1ZOKUz-CAAAAAA%3D%3D"))
            self.assertEqual(via, "LinkedIn")
        finally:
            os.unlink(tmp.name)


class AnalyzeTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
        self.tmp.close()
        self.outdir = tempfile.TemporaryDirectory()
        conn = sqlite3.connect(self.tmp.name)
        conn.executescript(tracker.SCHEMA)
        rows = []
        for day, city, key, mode, salary in [
            ("2026-08-01", "Austin", "a1", "remote", 140000),
            ("2026-08-01", "Austin", "a2", "onsite", None),
            ("2026-08-01", "Denver", "d1", "hybrid", 120000),
            ("2026-08-02", "Austin", "a2", "onsite", None),
            ("2026-08-02", "Austin", "a3", "remote", 160000),
            ("2026-08-02", "Denver", "d1", "hybrid", 120000),
            ("2026-08-02", "Denver", "d2", "remote", None),
        ]:
            rows.append({
                "snapshot_date": day,
                "job_key": key,
                "query": "backend engineer",
                "city": city,
                "title": "Backend Engineer",
                "company": "Acme",
                "location": city,
                "via": "LinkedIn",
                "posted_at_raw": "3 days ago",
                "posted_date": "2026-07-29",
                "posted_precision": "day",
                "work_mode": mode,
                "schedule": "Full-time",
                "salary_min": salary,
                "salary_max": salary,
                "salary_source": "detected_extensions" if salary else None,
                "position": 1,
            })
        tracker.save_snapshot(conn, rows)
        conn.close()
        self.df = analyze.load_snapshots(self.tmp.name)

    def tearDown(self):
        os.unlink(self.tmp.name)
        self.outdir.cleanup()

    def test_daily_distinct_counts(self):
        out = Path(self.outdir.name) / "postings_by_city.png"
        daily = analyze.chart_postings_by_city(self.df, "backend engineer", str(out))
        self.assertTrue(out.exists())
        self.assertGreater(out.stat().st_size, 0)
        self.assertEqual(int(daily.loc[pd.Timestamp("2026-08-01"), "Austin"]), 2)
        self.assertEqual(int(daily.loc[pd.Timestamp("2026-08-02"), "Austin"]), 2)
        self.assertEqual(int(daily.loc[pd.Timestamp("2026-08-02"), "Denver"]), 2)

    def test_remote_share_latest_snapshot(self):
        out = Path(self.outdir.name) / "remote_share.png"
        share = analyze.chart_remote_share(self.df, str(out))
        self.assertTrue(out.exists())
        self.assertAlmostEqual(float(share["Austin"]), 50.0)
        self.assertAlmostEqual(float(share["Denver"]), 50.0)

    def test_churn_delta(self):
        churn = analyze.compute_churn(self.df)
        self.assertEqual(int(churn.iloc[0]["new"]), 2)   # a3, d2
        self.assertEqual(int(churn.iloc[0]["gone"]), 1)  # a1

    def test_salary_coverage_snippet(self):
        has_salary, from_field = analyze.salary_coverage(self.df)
        self.assertAlmostEqual(has_salary, 4 / 7 * 100)
        self.assertAlmostEqual(from_field, 100.0)


class WorkflowAndLayoutTests(unittest.TestCase):
    ROOT = Path(__file__).resolve().parent

    def test_workflow_yaml_parses(self):
        path = self.ROOT / ".github" / "workflows" / "snapshot.yml"
        with path.open(encoding="utf-8") as fh:
            data = yaml.safe_load(fh)
        self.assertEqual(data["name"], "job-snapshot")
        # PyYAML 1.1 treats the key `on` as boolean True.
        trigger = data.get("on", data.get(True))
        self.assertIn("schedule", trigger)
        self.assertEqual(
            data["jobs"]["snapshot"]["steps"][3]["env"]["SEARCHAPI_KEY"],
            "${{ secrets.SEARCHAPI_KEY }}",
        )

    def test_tracker_import_requires_api_key(self):
        env = {k: v for k, v in os.environ.items() if k != "SEARCHAPI_KEY"}
        result = __import__("subprocess").run(
            ["python", "-c", "import tracker"],
            cwd=self.ROOT,
            env=env,
            capture_output=True,
            text=True,
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("SEARCHAPI_KEY", result.stderr)

    def test_requirements_pins(self):
        text = (self.ROOT / "requirements.txt").read_text(encoding="utf-8")
        self.assertIn("requests==2.32.3", text)
        self.assertIn("pandas==2.2.3", text)
        self.assertIn("matplotlib==3.9.2", text)

    def test_module_level_api_key_reads_env(self):
        self.assertEqual(tracker.API_KEY, os.environ["SEARCHAPI_KEY"])


if __name__ == "__main__":
    unittest.main()
