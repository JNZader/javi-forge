---
name: duckdb-analytics
description: >
  DuckDB OLAP analytics with Parquet, S3, and columnar queries for BI/ML.
  Trigger: duckdb, olap, analytics, parquet, columnar, data warehouse, BI

tools:
  - Read
  - Write
  - Bash
  - Grep

metadata:
  author: plataforma-industrial
  version: "2.0"
  tags: [duckdb, olap, analytics, parquet, bi]
  updated: "2026-02"
---

# DuckDB OLAP Analytics

> Columnar analytics engine for Parquet files, S3 data lakes, and BI workloads.

## Stack

```yaml
DuckDB: 0.10+
Go Driver: github.com/marcboeker/go-duckdb
Python: duckdb 0.10+
Extensions: httpfs, parquet, postgres
```

## When to Use

- Analytical queries over historical data
- Reading Parquet files from S3/MinIO
- BI reports and aggregations
- ML feature engineering
- Time-series analysis on archived data

### Data Architecture

```
TimescaleDB (OLTP - Hot, <90 days)
    |
    | ETL / Export
    v
Parquet Files (S3/MinIO - Warm)
    |
    | Direct read
    v
DuckDB (OLAP - Analytical queries)
    |
    v
BI Tools / Reports / ML
```

## Python Setup

```python
import duckdb

class DuckDBAnalytics:
    def __init__(self, db_path: str = ":memory:"):
        self.conn = duckdb.connect(db_path)
        self._setup()

    def _setup(self):
        self.conn.execute("INSTALL httpfs; LOAD httpfs;")
        self.conn.execute("INSTALL parquet; LOAD parquet;")

    def configure_s3(self, endpoint: str, access_key: str, secret_key: str):
        self.conn.execute(f"SET s3_endpoint = '{endpoint}';")
        self.conn.execute(f"SET s3_access_key_id = '{access_key}';")
        self.conn.execute(f"SET s3_secret_access_key = '{secret_key}';")
        self.conn.execute("SET s3_use_ssl = false;")

    def query_df(self, sql: str):
        return self.conn.execute(sql).fetchdf()

    def query(self, sql: str) -> list[dict]:
        result = self.conn.execute(sql)
        columns = [desc[0] for desc in result.description]
        return [dict(zip(columns, row)) for row in result.fetchall()]
```

## Go Setup

```go
package analytics

import (
    "database/sql"
    _ "github.com/marcboeker/go-duckdb"
)

type DuckDB struct {
    db *sql.DB
}

func NewDuckDB(path string) (*DuckDB, error) {
    db, err := sql.Open("duckdb", path)
    if err != nil {
        return nil, err
    }
    db.Exec("INSTALL parquet; LOAD parquet;")
    return &DuckDB{db: db}, nil
}
```

## Schema for Analytics

### Fact Tables

```sql
CREATE SCHEMA IF NOT EXISTS analytics;

CREATE TABLE IF NOT EXISTS analytics.sensor_readings (
    time TIMESTAMP NOT NULL,
    sensor_id UUID NOT NULL,
    sensor_name VARCHAR,
    tenant_id UUID,
    value DOUBLE,
    unit VARCHAR,
    -- Pre-computed time dimensions
    year INTEGER,
    month INTEGER,
    week INTEGER,
    day_of_week INTEGER,
    hour INTEGER,
    partition_date DATE
);

CREATE TABLE IF NOT EXISTS analytics.events (
    id UUID,
    event_type VARCHAR,
    entity_id UUID,
    tenant_id UUID,
    payload JSON,
    occurred_at TIMESTAMP NOT NULL,
    year INTEGER,
    month INTEGER,
    partition_date DATE
);
```

### Dimension Tables

```sql
-- Date dimension
CREATE TABLE IF NOT EXISTS analytics.dim_date (
    date_key DATE PRIMARY KEY,
    year INTEGER,
    quarter INTEGER,
    month INTEGER,
    month_name VARCHAR,
    week INTEGER,
    day_of_week INTEGER,
    day_name VARCHAR,
    is_weekend BOOLEAN
);

-- Populate 10 years
INSERT INTO analytics.dim_date
SELECT
    date_key,
    YEAR(date_key), QUARTER(date_key), MONTH(date_key),
    MONTHNAME(date_key), WEEKOFYEAR(date_key),
    DAYOFWEEK(date_key), DAYNAME(date_key),
    DAYOFWEEK(date_key) IN (0, 6)
FROM (
    SELECT UNNEST(generate_series(
        DATE '2020-01-01', DATE '2030-12-31', INTERVAL 1 DAY
    ))::DATE as date_key
);
```

## Loading from Parquet

### Direct Query (No Load)

```sql
-- Query directly from Parquet files
SELECT
    sensor_id,
    AVG(value) as avg_value,
    COUNT(*) as readings
FROM read_parquet('s3://data/readings/**/*.parquet')
WHERE partition_date >= '2024-01-01'
GROUP BY sensor_id;
```

### Load into Table

```sql
-- Load with transformation
INSERT INTO analytics.sensor_readings
SELECT
    time::TIMESTAMP,
    sensor_id::UUID,
    sensor_name,
    tenant_id::UUID,
    value,
    unit,
    YEAR(time), MONTH(time), WEEKOFYEAR(time),
    DAYOFWEEK(time), HOUR(time),
    time::DATE as partition_date
FROM read_parquet('s3://data/readings/date=2024-01-15/*.parquet')
WHERE partition_date NOT IN (SELECT DISTINCT partition_date FROM analytics.sensor_readings);
```

### Python ETL

```python
from datetime import datetime, timedelta

conn = duckdb.connect("analytics.duckdb")
conn.execute("SET s3_endpoint = 'minio:9000';")
conn.execute("SET s3_access_key_id = 'admin';")
conn.execute("SET s3_secret_access_key = 'password';")

# Load last 30 days
for i in range(30):
    date = (datetime.now() - timedelta(days=i)).strftime("%Y-%m-%d")
    conn.execute(f"""
        INSERT INTO analytics.sensor_readings
        SELECT * FROM read_parquet('s3://data/readings/date={date}/*.parquet')
    """)
```

## Analytical Views

### Daily Summary

```sql
CREATE OR REPLACE VIEW reports.daily_summary AS
SELECT
    partition_date,
    sensor_id,
    sensor_name,
    COUNT(*) as reading_count,
    AVG(value) as avg_value,
    MIN(value) as min_value,
    MAX(value) as max_value,
    STDDEV(value) as stddev_value
FROM analytics.sensor_readings
GROUP BY partition_date, sensor_id, sensor_name;
```

### Monthly KPIs

```sql
CREATE OR REPLACE VIEW reports.monthly_kpis AS
SELECT
    tenant_id,
    year,
    month,
    COUNT(DISTINCT sensor_id) as active_sensors,
    SUM(reading_count) as total_readings,
    AVG(avg_value) as overall_avg
FROM reports.daily_summary
GROUP BY tenant_id, year, month;
```

## Advanced Analytics

### Z-Score Anomaly Detection

```sql
WITH stats AS (
    SELECT
        sensor_id,
        AVG(value) as avg_val,
        STDDEV(value) as std_val
    FROM analytics.sensor_readings
    WHERE partition_date >= CURRENT_DATE - INTERVAL 90 DAY
    GROUP BY sensor_id
)
SELECT
    r.time,
    r.sensor_id,
    r.value,
    (r.value - s.avg_val) / NULLIF(s.std_val, 0) as z_score,
    CASE
        WHEN ABS(r.value - s.avg_val) > 3 * s.std_val THEN 'ANOMALY'
        WHEN ABS(r.value - s.avg_val) > 2 * s.std_val THEN 'WARNING'
        ELSE 'NORMAL'
    END as status
FROM analytics.sensor_readings r
JOIN stats s ON s.sensor_id = r.sensor_id
WHERE r.partition_date >= CURRENT_DATE - INTERVAL 7 DAY
  AND ABS(r.value - s.avg_val) > 2 * s.std_val;
```

### Correlation Analysis

```sql
SELECT
    sensor_name,
    CORR(temperature, gas_flow) as temp_gas_correlation,
    COUNT(*) as samples
FROM analytics.readings
WHERE partition_date >= CURRENT_DATE - INTERVAL 30 DAY
GROUP BY sensor_name
HAVING COUNT(*) > 100;
```

### Window Functions

```sql
SELECT
    partition_date,
    sensor_id,
    value,
    -- Month cumulative
    SUM(value) OVER (
        PARTITION BY sensor_id, year, month
        ORDER BY partition_date
    ) as month_cumulative,
    -- 7-day moving average
    AVG(value) OVER (
        PARTITION BY sensor_id
        ORDER BY partition_date
        ROWS BETWEEN 6 PRECEDING AND CURRENT ROW
    ) as ma7,
    -- Week-over-week change
    value - LAG(value, 7) OVER (
        PARTITION BY sensor_id ORDER BY partition_date
    ) as wow_change
FROM analytics.daily_agg;
```

### Percentiles

```sql
SELECT
    sensor_name,
    MIN(value) as min,
    PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY value) as p25,
    PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY value) as median,
    PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY value) as p75,
    MAX(value) as max
FROM analytics.sensor_readings
WHERE partition_date >= CURRENT_DATE - INTERVAL 30 DAY
GROUP BY sensor_name;
```

## Export to Parquet

```sql
-- Simple export
COPY (SELECT * FROM reports.monthly_kpis)
TO 'monthly_kpis.parquet' (FORMAT PARQUET);

-- Partitioned export
COPY analytics.sensor_readings
TO 'sensor_readings' (FORMAT PARQUET, PARTITION_BY (year, month));

-- Export to S3
COPY reports.daily_summary
TO 's3://data/reports/daily_summary.parquet' (FORMAT PARQUET);
```

## Python/Pandas Integration

```python
# Query to DataFrame
df = conn.execute("""
    SELECT partition_date, sensor_id, AVG(value) as avg
    FROM analytics.sensor_readings
    GROUP BY partition_date, sensor_id
""").fetchdf()

# DataFrame to DuckDB
import pandas as pd
df = pd.DataFrame({'date': [...], 'value': [...]})
conn.register('temp_data', df)
conn.execute("INSERT INTO analytics.processed SELECT * FROM temp_data")
```

## DuckDB vs TimescaleDB

| Aspect | DuckDB | TimescaleDB |
|--------|--------|-------------|
| Type | OLAP (analytical) | OLTP (transactional) |
| Storage | Columnar | Row-based + chunks |
| Inserts | Batch (slow individual) | Streaming (fast) |
| Queries | Massive aggregations | Point + range |
| Latency | Seconds | Milliseconds |
| Use case | Reports, BI, ML | Dashboard, alerts |

## Performance Tips

```sql
-- Filter early (pushdown to Parquet)
SELECT * FROM read_parquet('data/*.parquet')
WHERE year = 2024 AND month = 3;  -- Good

-- Project only needed columns
SELECT sensor_id, AVG(value)
FROM read_parquet('data.parquet')
GROUP BY sensor_id;  -- Columnar = efficient

-- Configure resources
SET threads = 4;
SET memory_limit = '4GB';

-- Analyze query plan
EXPLAIN ANALYZE SELECT ...;
```

## Quick Reference

| Task | Command |
|------|---------|
| Load Parquet | `SELECT * FROM read_parquet('file.parquet')` |
| Load from S3 | `SELECT * FROM read_parquet('s3://bucket/path/*.parquet')` |
| Export Parquet | `COPY (query) TO 'file.parquet' (FORMAT PARQUET)` |
| In-memory DB | `duckdb.connect(':memory:')` |
| Check tables | `SELECT * FROM duckdb_tables()` |
| Memory usage | `SELECT * FROM duckdb_memory()` |

## Resources

- [DuckDB Documentation](https://duckdb.org/docs/)
- [go-duckdb](https://github.com/marcboeker/go-duckdb)
- [DuckDB Python API](https://duckdb.org/docs/api/python/overview)

---

## Changelog

- **2.0** - Condensed from Plataforma Industrial SKILL-DUCKDB

## Related Skills

- `timescaledb`: Time-series source data
- `scikit-learn`: ML data preparation
- `powerbi`: BI visualization
- `sqlite-embedded`: Embedded alternative
