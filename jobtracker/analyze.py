import sqlite3

import matplotlib.pyplot as plt
import pandas as pd

DB_PATH = "jobs.db"
QUERY = "backend engineer"


def load_snapshots(db_path: str = DB_PATH) -> pd.DataFrame:
    conn = sqlite3.connect(db_path)
    df = pd.read_sql_query("SELECT * FROM snapshots", conn, parse_dates=["snapshot_date"])
    conn.close()
    return df


def chart_postings_by_city(df: pd.DataFrame, query: str, out_path: str) -> pd.DataFrame:
    daily = (df.groupby(["snapshot_date", "city"])["job_key"]
               .nunique().unstack(fill_value=0).sort_index())

    fig, ax = plt.subplots(figsize=(11, 5))
    daily.plot(ax=ax, marker="o", linewidth=1.8, markersize=4)
    ax.set_title(f'Live "{query}" postings by city')
    ax.set_xlabel("")
    ax.set_ylabel("distinct postings")
    ax.grid(alpha=0.25)
    ax.legend(title=None, frameon=False, ncol=5)
    fig.tight_layout()
    fig.savefig(out_path, dpi=150)
    plt.close(fig)
    return daily


def chart_remote_share(df: pd.DataFrame, out_path: str) -> pd.Series:
    latest = df[df.snapshot_date == df.snapshot_date.max()]
    share = (latest.assign(is_remote=latest.work_mode.eq("remote"))
                   .groupby("city")["is_remote"].mean().mul(100)
                   .sort_values(ascending=True))

    fig, ax = plt.subplots(figsize=(8, 4.5))
    share.plot.barh(ax=ax, color="#3b6ea5")
    ax.set_title("Share of postings classified remote")
    ax.set_xlabel("% of listings")
    ax.set_ylabel("")
    ax.bar_label(ax.containers[0], fmt="%.0f%%", padding=3)
    ax.spines[["top", "right"]].set_visible(False)
    fig.tight_layout()
    fig.savefig(out_path, dpi=150)
    plt.close(fig)
    return share


def compute_churn(df: pd.DataFrame) -> pd.DataFrame:
    by_day = df.groupby("snapshot_date")["job_key"].apply(set)
    churn = pd.DataFrame({
        "new": [len(by_day.iloc[i] - by_day.iloc[i - 1]) for i in range(1, len(by_day))],
        "gone": [len(by_day.iloc[i - 1] - by_day.iloc[i]) for i in range(1, len(by_day))],
    }, index=by_day.index[1:])
    return churn


def salary_coverage(df: pd.DataFrame) -> tuple[float, float]:
    has_salary = df.salary_min.notna().mean() * 100
    from_field = df[df.salary_min.notna()].salary_source.eq("detected_extensions").mean() * 100
    return has_salary, from_field


def main() -> None:
    df = load_snapshots()
    chart_postings_by_city(df, QUERY, "images/postings_by_city.png")
    chart_remote_share(df, "images/remote_share.png")
    print(compute_churn(df).describe())
    has_salary, from_field = salary_coverage(df)
    print(f"{has_salary:.0f}% disclose; {from_field:.0f}% of those via detected_extensions")


if __name__ == "__main__":
    main()
