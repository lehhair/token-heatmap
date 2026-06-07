#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import sqlite3
import subprocess
import sys
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path

DB_PATH = os.environ.get("OPENCODE_DB") or os.path.expanduser(
    "~/.local/share/opencode/opencode.db"
)
STATS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "stats")
STATS_FILE = os.path.join(STATS_DIR, "opencode-tokens.json")
SCHEMA_VERSION = 1
DEFAULT_SYNC_DAYS = 1


def connect_ro(db_path: str) -> sqlite3.Connection:
    return sqlite3.connect(Path(db_path).resolve().as_uri() + "?mode=ro", uri=True)


def day_start_ms(day: date) -> int:
    return int(datetime.combine(day, time.min, tzinfo=timezone.utc).timestamp() * 1000)


def ms_to_day(ms: int) -> str:
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).date().isoformat()


def strip_legacy_cost(value):
    if isinstance(value, dict):
        return {k: strip_legacy_cost(v) for k, v in value.items() if k not in ("cost", "total_cost", "provider")}
    if isinstance(value, list):
        return [strip_legacy_cost(v) for v in value]
    return value


def without_updated_at(data: dict | None) -> dict | None:
    if data is None:
        return None
    clean = dict(data)
    clean.pop("updated_at", None)
    return clean


def latest_daily_date(existing: dict | None) -> date | None:
    if not existing or not existing.get("daily"):
        return None
    dates = []
    for entry in existing["daily"]:
        try:
            dates.append(date.fromisoformat(entry["date"]))
        except (KeyError, TypeError, ValueError):
            pass
    return max(dates) if dates else None


def has_existing_daily(existing: dict | None) -> bool:
    return latest_daily_date(existing) is not None


def incremental_since_ms(existing: dict | None, days: int) -> int | None:
    if days <= 0:
        return None
    cutoff = date.today() - timedelta(days=days)
    latest = latest_daily_date(existing)
    if latest is not None:
        cutoff = min(cutoff, latest)
    return day_start_ms(cutoff)


def has_data_changed(existing: dict | None, merged: dict) -> bool:
    if existing is None:
        return True
    cleaned_existing = strip_legacy_cost(existing)
    return existing != cleaned_existing or without_updated_at(cleaned_existing) != without_updated_at(merged)


def find_db() -> str:
    if os.path.exists(DB_PATH):
        return DB_PATH
    candidates = []
    home = os.path.expanduser("~")
    if sys.platform == "win32":
        local_app_data = os.environ.get("LOCALAPPDATA", "")
        if local_app_data:
            candidates.append(os.path.join(local_app_data, "opencode", "opencode.db"))
        candidates.append(os.path.join(home, "AppData", "Local", "opencode", "opencode.db"))
    else:
        candidates.append(os.path.join(home, ".local", "share", "opencode", "opencode.db"))
    for p in candidates:
        if os.path.exists(p):
            return p
    print(f"DB not found. Tried: {DB_PATH}", file=sys.stderr)
    print("Set OPENCODE_DB environment variable to your opencode.db path.", file=sys.stderr)
    sys.exit(1)


def query_longest_turns(db_path: str, since_ms: int | None = None) -> dict[str, int]:
    conn = connect_ro(db_path)
    try:
        if since_ms is None:
            cursor = conn.execute("""
                SELECT
                    date(m.time_created / 1000, 'unixepoch') as day,
                    MAX(
                        json_extract(m.data, '$.time.completed') -
                        json_extract(m.data, '$.time.created')
                    ) as longest_turn_ms
                FROM message m
                WHERE json_extract(m.data, '$.role') = 'assistant'
                  AND json_extract(m.data, '$.time.completed') IS NOT NULL
                GROUP BY day
            """)
        else:
            cursor = conn.execute("""
                SELECT
                    date(m.time_created / 1000, 'unixepoch') as day,
                    MAX(
                        json_extract(m.data, '$.time.completed') -
                        json_extract(m.data, '$.time.created')
                    ) as longest_turn_ms
                FROM session s
                CROSS JOIN message m INDEXED BY message_session_time_created_id_idx
                    ON m.session_id = s.id
                WHERE s.time_updated >= ?
                  AND m.time_created >= ?
                  AND json_extract(m.data, '$.role') = 'assistant'
                  AND json_extract(m.data, '$.time.completed') IS NOT NULL
                GROUP BY day
            """, (since_ms, since_ms))
        return {row[0]: row[1] or 0 for row in cursor.fetchall()}
    except sqlite3.OperationalError:
        return {}
    finally:
        conn.close()


def rows_to_daily(rows) -> list[dict]:
    daily = []
    for row in rows:
        day_date, sessions, t_in, t_out, t_cr, t_cw, t_re = row
        daily.append({
            "date": day_date,
            "sessions": sessions or 0,
            "tokens_input": t_in or 0,
            "tokens_output": t_out or 0,
            "tokens_cache_read": t_cr or 0,
            "tokens_cache_write": t_cw or 0,
            "tokens_reasoning": t_re or 0,
        })
    return daily


def query_tokens(db_path: str, since_ms: int | None = None) -> list[dict]:
    conn = connect_ro(db_path)
    try:
        if since_ms is None:
            cursor = conn.execute("""
                SELECT
                    date(p.time_created / 1000, 'unixepoch') as day,
                    COUNT(DISTINCT p.session_id) as sessions,
                    SUM(json_extract(p.data, '$.tokens.input')) as tokens_input,
                    SUM(json_extract(p.data, '$.tokens.output')) as tokens_output,
                    SUM(json_extract(p.data, '$.tokens.cache.read')) as tokens_cache_read,
                    SUM(json_extract(p.data, '$.tokens.cache.write')) as tokens_cache_write,
                    SUM(json_extract(p.data, '$.tokens.reasoning')) as tokens_reasoning
                FROM part p
                WHERE json_extract(p.data, '$.type') = 'step-finish'
                GROUP BY day
                ORDER BY day
            """)
        else:
            cursor = conn.execute("""
                SELECT
                    date(p.time_created / 1000, 'unixepoch') as day,
                    COUNT(DISTINCT p.session_id) as sessions,
                    SUM(json_extract(p.data, '$.tokens.input')) as tokens_input,
                    SUM(json_extract(p.data, '$.tokens.output')) as tokens_output,
                    SUM(json_extract(p.data, '$.tokens.cache.read')) as tokens_cache_read,
                    SUM(json_extract(p.data, '$.tokens.cache.write')) as tokens_cache_write,
                    SUM(json_extract(p.data, '$.tokens.reasoning')) as tokens_reasoning
                FROM session s
                CROSS JOIN part p INDEXED BY part_session_idx ON p.session_id = s.id
                WHERE s.time_updated >= ?
                  AND p.time_created >= ?
                  AND json_extract(p.data, '$.type') = 'step-finish'
                GROUP BY day
                ORDER BY day
            """, (since_ms, since_ms))
        return rows_to_daily(cursor.fetchall())
    except sqlite3.OperationalError:
        cols = [r[1] for r in conn.execute("PRAGMA table_info(session)").fetchall()]
        if "tokens_input" in cols:
            where = "time_created > 0" if since_ms is None else "time_updated >= ?"
            args = () if since_ms is None else (since_ms,)
            cursor = conn.execute(f"""
                    SELECT
                        date(time_created / 1000, 'unixepoch') as day,
                        COUNT(*) as sessions,
                        SUM(tokens_input) as tokens_input,
                        SUM(tokens_output) as tokens_output,
                        SUM(tokens_cache_read) as tokens_cache_read,
                        SUM(tokens_cache_write) as tokens_cache_write,
                        SUM(tokens_reasoning) as tokens_reasoning
                    FROM session
                    WHERE {where}
                    GROUP BY day
                    ORDER BY day
                """, args)
            return rows_to_daily(cursor.fetchall())
        raise
    finally:
        conn.close()


def query_models(db_path: str, since_ms: int | None = None) -> dict[str, list[dict]]:
    conn = connect_ro(db_path)
    try:
        if since_ms is None:
            cursor = conn.execute("""
                SELECT
                    date(p.time_created / 1000, 'unixepoch') as day,
                    json_extract(m.data, '$.modelID') as model,
                    SUM(json_extract(p.data, '$.tokens.input')) as tokens_input,
                    SUM(json_extract(p.data, '$.tokens.output')) as tokens_output,
                    SUM(json_extract(p.data, '$.tokens.cache.read')) as tokens_cache_read,
                    SUM(json_extract(p.data, '$.tokens.cache.write')) as tokens_cache_write,
                    SUM(json_extract(p.data, '$.tokens.reasoning')) as tokens_reasoning,
                    COUNT(DISTINCT m.id) as messages
                FROM part p
                JOIN message m ON p.message_id = m.id
                WHERE json_extract(p.data, '$.type') = 'step-finish'
                  AND json_extract(m.data, '$.modelID') IS NOT NULL
                GROUP BY day, json_extract(m.data, '$.modelID')
                ORDER BY day, messages DESC
            """)
        else:
            cursor = conn.execute("""
                SELECT
                    date(p.time_created / 1000, 'unixepoch') as day,
                    json_extract(m.data, '$.modelID') as model,
                    SUM(json_extract(p.data, '$.tokens.input')) as tokens_input,
                    SUM(json_extract(p.data, '$.tokens.output')) as tokens_output,
                    SUM(json_extract(p.data, '$.tokens.cache.read')) as tokens_cache_read,
                    SUM(json_extract(p.data, '$.tokens.cache.write')) as tokens_cache_write,
                    SUM(json_extract(p.data, '$.tokens.reasoning')) as tokens_reasoning,
                    COUNT(DISTINCT m.id) as messages
                FROM session s
                CROSS JOIN part p INDEXED BY part_session_idx ON p.session_id = s.id
                JOIN message m ON p.message_id = m.id
                WHERE s.time_updated >= ?
                  AND p.time_created >= ?
                  AND json_extract(p.data, '$.type') = 'step-finish'
                  AND json_extract(m.data, '$.modelID') IS NOT NULL
                GROUP BY day, json_extract(m.data, '$.modelID')
                ORDER BY day, messages DESC
            """, (since_ms, since_ms))
        result: dict[str, list[dict]] = {}
        for row in cursor.fetchall():
            day, model, t_in, t_out, t_cr, t_cw, t_re, messages = row
            if day not in result:
                result[day] = []
            name = model or "unknown"
            existing = next((entry for entry in result[day] if entry["model"] == name), None)
            if existing is None:
                existing = {
                    "model": name,
                    "tokens_input": 0,
                    "tokens_output": 0,
                    "tokens_cache_read": 0,
                    "tokens_cache_write": 0,
                    "tokens_reasoning": 0,
                    "messages": 0,
                }
                result[day].append(existing)
            existing["tokens_input"] += t_in or 0
            existing["tokens_output"] += t_out or 0
            existing["tokens_cache_read"] += t_cr or 0
            existing["tokens_cache_write"] += t_cw or 0
            existing["tokens_reasoning"] += t_re or 0
            existing["messages"] += messages or 0
        for entries in result.values():
            entries.sort(key=lambda entry: entry["messages"], reverse=True)
        return result
    except sqlite3.OperationalError:
        return {}
    finally:
        conn.close()


def compute_stats(daily: list[dict]) -> dict:
    from datetime import date, timedelta

    lifetime_tokens = 0
    peak_daily_tokens = 0
    longest_turn_sec = 0

    for d in daily:
        total = d["tokens_input"] + d["tokens_output"]
        d["tokens"] = total
        lifetime_tokens += total
        if total > peak_daily_tokens:
            peak_daily_tokens = total
        if d["longest_turn_ms"] // 1000 > longest_turn_sec:
            longest_turn_sec = d["longest_turn_ms"] // 1000

    daily_map = {d["date"]: d["tokens"] for d in daily}
    dates_with_data = [d["date"] for d in daily if d["tokens"] > 0]
    today = date.today()

    current_streak = 0
    d = today
    while d.isoformat() in daily_map and daily_map[d.isoformat()] > 0:
        current_streak += 1
        d -= timedelta(days=1)

    longest_streak = 0
    streak = 0
    for d_str in dates_with_data:
        if daily_map[d_str] > 0:
            streak += 1
            longest_streak = max(longest_streak, streak)
        else:
            streak = 0

    return {
        "lifetime_tokens": lifetime_tokens,
        "peak_daily_tokens": peak_daily_tokens,
        "longest_turn_sec": longest_turn_sec,
        "current_streak_days": current_streak,
        "longest_streak_days": longest_streak,
        "total_sessions": sum(d["sessions"] for d in daily),
    }


def load_existing() -> dict | None:
    if not os.path.exists(STATS_FILE):
        return None
    with open(STATS_FILE, "r", encoding="utf-8") as f:
        return json.load(f)


def trim_to_one_year(daily: list[dict]) -> list[dict]:
    from datetime import date, timedelta
    cutoff = (date.today() - timedelta(days=365)).isoformat()
    return [d for d in daily if d["date"] >= cutoff]


def merge(existing: dict | None, new_daily: list[dict], since_ms: int | None = None) -> dict:
    if existing is None:
        stats = compute_stats(new_daily)
        return {
            "version": SCHEMA_VERSION,
            "updated_at": datetime.now(timezone.utc).isoformat(),
            "daily": trim_to_one_year(new_daily),
            "stats": stats,
        }

    existing = strip_legacy_cost(existing)
    existing_map = {d["date"]: d for d in existing["daily"]}
    new_map = {d["date"]: d for d in new_daily}

    if since_ms is not None:
        since_day = ms_to_day(since_ms)
        for date_key in list(existing_map):
            if date_key >= since_day:
                del existing_map[date_key]

    for date_key, entry in new_map.items():
        existing_map[date_key] = entry

    merged_daily = sorted(existing_map.values(), key=lambda d: d["date"])
    stats = compute_stats(merged_daily)

    return {
        "version": SCHEMA_VERSION,
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "daily": trim_to_one_year(merged_daily),
        "stats": stats,
    }


JS_FILE = os.path.join(STATS_DIR, "opencode-tokens.js")


def save(data: dict) -> None:
    os.makedirs(STATS_DIR, exist_ok=True)
    with open(STATS_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    js_content = "window.__OPENCODE_TOKEN_DATA__ = " + \
                 json.dumps(data, ensure_ascii=False, indent=2) + ";\n"
    with open(JS_FILE, "w", encoding="utf-8") as f:
        f.write(js_content)


def git_commit_push() -> None:
    repo_root = os.path.dirname(os.path.abspath(__file__))
    try:
        subprocess.run(["git", "add", "-f", "stats/"], cwd=repo_root, check=True)
        result = subprocess.run(
            ["git", "diff", "--cached", "--quiet"],
            cwd=repo_root,
            capture_output=True,
        )
        if result.returncode == 0:
            print("No changes to commit.")
            return
        subprocess.run(
            ["git", "commit", "-m", "update token stats"],
            cwd=repo_root,
            check=True,
        )
        subprocess.run(["git", "push"], cwd=repo_root, check=True)
        print("Pushed to remote.")
    except subprocess.CalledProcessError as e:
        print(f"Git operation failed: {e}", file=sys.stderr)
        sys.exit(1)


def main():
    import argparse
    parser = argparse.ArgumentParser(description="Sync opencode token data")
    parser.add_argument("--db", default=None, help="Path to opencode.db")
    parser.add_argument("--push", action="store_true", help="Git commit and push after sync")
    parser.add_argument("--dry-run", action="store_true", help="Print result without writing")
    parser.add_argument("--full", action="store_true", help="Rebuild all history instead of recent days")
    parser.add_argument("--days", type=int, default=DEFAULT_SYNC_DAYS, help=f"Recent days to sync (default: {DEFAULT_SYNC_DAYS})")
    args = parser.parse_args()

    db_path = args.db or find_db()
    print(f"Reading DB: {db_path}")

    existing = load_existing()
    since_ms = None if args.full else incremental_since_ms(existing, args.days)
    if since_ms is not None and not has_existing_daily(existing):
        since_ms = None

    new_daily = query_tokens(db_path, since_ms)
    if not new_daily:
        print("No session data found in DB.", file=sys.stderr)
        sys.exit(1)

    turns = query_longest_turns(db_path, since_ms)
    models = query_models(db_path, since_ms)
    for d in new_daily:
        d["longest_turn_ms"] = turns.get(d["date"], 0)
        d["models"] = models.get(d["date"], [])

    merged = merge(existing, new_daily, since_ms)

    print(f"Days: {len(merged['daily'])} | "
          f"Sessions: {merged['stats']['total_sessions']} | "
          f"Tokens: {merged['stats']['lifetime_tokens']:,}")

    if args.dry_run:
        print(json.dumps(merged, ensure_ascii=False, indent=2))
        return

    if not has_data_changed(existing, merged):
        print("No data changes.")
        return

    save(merged)
    print(f"Saved to {STATS_FILE}")

    if args.push:
        git_commit_push()


if __name__ == "__main__":
    main()
