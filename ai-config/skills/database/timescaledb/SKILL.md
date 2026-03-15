---
name: timescaledb
description: >
  TimescaleDB time-series database patterns with hypertables, continuous aggregates, and compression.
  Trigger: TimescaleDB, time-series, hypertable, continuous aggregate, time bucket, PostgreSQL time-series
tools:
  - Read
  - Write
  - Bash
metadata:
  author: plataforma-industrial
  version: "2.0"
  tags: [timescaledb, postgresql, time-series, database, iot]
  updated: "2026-02"
---

# TimescaleDB Time-Series Database

Patterns for time-series data with TimescaleDB.

## Stack

```yaml
TimescaleDB: 2.14+
PostgreSQL: 16+
```

## Docker Setup

```yaml
services:
  timescaledb:
    image: timescale/timescaledb:latest-pg16
    environment:
      POSTGRES_USER: app
      POSTGRES_PASSWORD: app
      POSTGRES_DB: app
    ports:
      - "5432:5432"
    volumes:
      - timescale_data:/var/lib/postgresql/data
    command: >
      postgres
      -c shared_preload_libraries=timescaledb
      -c timescaledb.max_background_workers=8
```

## Hypertable Creation

```sql
-- Enable extension
CREATE EXTENSION IF NOT EXISTS timescaledb;

-- Create table
CREATE TABLE readings (
    time        TIMESTAMPTZ NOT NULL,
    sensor_id   UUID NOT NULL,
    tenant_id   UUID NOT NULL,
    value       DOUBLE PRECISION NOT NULL,
    quality     SMALLINT DEFAULT 192
);

-- Convert to hypertable
SELECT create_hypertable(
    'readings',
    'time',
    chunk_time_interval => INTERVAL '1 day',
    if_not_exists => TRUE
);

-- Add space partitioning for multi-tenant
SELECT add_dimension('readings', 'tenant_id', number_partitions => 4);

-- Create indexes
CREATE INDEX idx_readings_sensor_time ON readings (sensor_id, time DESC);
CREATE INDEX idx_readings_tenant_time ON readings (tenant_id, time DESC);

-- Enable compression
ALTER TABLE readings SET (
    timescaledb.compress,
    timescaledb.compress_segmentby = 'sensor_id, tenant_id',
    timescaledb.compress_orderby = 'time DESC'
);

-- Add compression policy
SELECT add_compression_policy('readings', INTERVAL '7 days');
```

## Continuous Aggregates

### Hourly Aggregates

```sql
CREATE MATERIALIZED VIEW readings_hourly
WITH (timescaledb.continuous) AS
SELECT
    time_bucket('1 hour', time) AS bucket,
    sensor_id,
    tenant_id,
    AVG(value) AS avg_value,
    MIN(value) AS min_value,
    MAX(value) AS max_value,
    COUNT(*) AS count,
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY value) AS median
FROM readings
GROUP BY bucket, sensor_id, tenant_id
WITH NO DATA;

-- Refresh policy
SELECT add_continuous_aggregate_policy('readings_hourly',
    start_offset => INTERVAL '2 hours',
    end_offset => INTERVAL '1 hour',
    schedule_interval => INTERVAL '1 hour'
);

-- Enable real-time aggregation
ALTER MATERIALIZED VIEW readings_hourly SET (
    timescaledb.materialized_only = false
);
```

### Daily Aggregates

```sql
CREATE MATERIALIZED VIEW readings_daily
WITH (timescaledb.continuous) AS
SELECT
    time_bucket('1 day', time) AS bucket,
    sensor_id,
    tenant_id,
    AVG(value) AS avg_value,
    MIN(value) AS min_value,
    MAX(value) AS max_value,
    COUNT(*) AS count
FROM readings
GROUP BY bucket, sensor_id, tenant_id
WITH NO DATA;

SELECT add_continuous_aggregate_policy('readings_daily',
    start_offset => INTERVAL '3 days',
    end_offset => INTERVAL '1 day',
    schedule_interval => INTERVAL '1 day'
);
```

## Time-Series Queries

### Time Bucket

```sql
SELECT
    time_bucket('15 minutes', time) AS period,
    sensor_id,
    AVG(value) AS avg_value,
    COUNT(*) AS readings
FROM readings
WHERE sensor_id = $1 AND time > NOW() - INTERVAL '24 hours'
GROUP BY period, sensor_id
ORDER BY period DESC;
```

### Gap Filling

```sql
SELECT
    time_bucket_gapfill('1 hour', time) AS period,
    sensor_id,
    COALESCE(AVG(value), interpolate(AVG(value))) AS value,
    locf(AVG(value)) AS last_known
FROM readings
WHERE sensor_id = $1 AND time BETWEEN '2024-01-01' AND '2024-01-02'
GROUP BY period, sensor_id
ORDER BY period;
```

### Latest Per Sensor

```sql
SELECT DISTINCT ON (sensor_id)
    sensor_id,
    time AS last_time,
    value AS last_value
FROM readings
WHERE tenant_id = $1
ORDER BY sensor_id, time DESC;

-- Or using first/last
SELECT
    sensor_id,
    last(value, time) AS last_value,
    last(time, time) AS last_time
FROM readings
WHERE tenant_id = $1 AND time > NOW() - INTERVAL '1 hour'
GROUP BY sensor_id;
```

### Change Detection

```sql
WITH delta AS (
    SELECT
        time,
        sensor_id,
        value,
        value - LAG(value) OVER (PARTITION BY sensor_id ORDER BY time) AS change,
        ABS(value - LAG(value) OVER (PARTITION BY sensor_id ORDER BY time))
            / NULLIF(LAG(value) OVER (PARTITION BY sensor_id ORDER BY time), 0) * 100 AS pct_change
    FROM readings
    WHERE sensor_id = $1
)
SELECT * FROM delta WHERE ABS(pct_change) > 10
ORDER BY time DESC;
```

## Retention Policies

```sql
-- Raw data: 90 days
SELECT add_retention_policy('readings', INTERVAL '90 days');

-- Aggregates: longer
SELECT add_retention_policy('readings_hourly', INTERVAL '2 years');
SELECT add_retention_policy('readings_daily', INTERVAL '5 years');

-- View policies
SELECT * FROM timescaledb_information.jobs WHERE proc_name = 'policy_retention';

-- Manual drop
SELECT drop_chunks('readings', older_than => INTERVAL '90 days');
```

## Go Integration

```go
type Reading struct {
    Time     time.Time `db:"time"`
    SensorID string    `db:"sensor_id"`
    TenantID string    `db:"tenant_id"`
    Value    float64   `db:"value"`
    Quality  int16     `db:"quality"`
}

// Batch insert with COPY
func (r *Repository) InsertBatch(ctx context.Context, readings []Reading) error {
    _, err := r.pool.CopyFrom(
        ctx,
        pgx.Identifier{"readings"},
        []string{"time", "sensor_id", "tenant_id", "value", "quality"},
        pgx.CopyFromSlice(len(readings), func(i int) ([]any, error) {
            return []any{
                readings[i].Time,
                readings[i].SensorID,
                readings[i].TenantID,
                readings[i].Value,
                readings[i].Quality,
            }, nil
        }),
    )
    return err
}

// Aggregated query
func (r *Repository) GetAggregated(ctx context.Context, sensorID string, start, end time.Time, bucket string) ([]Aggregate, error) {
    query := `
        SELECT time_bucket($1, time) AS bucket, AVG(value), MIN(value), MAX(value), COUNT(*)
        FROM readings
        WHERE sensor_id = $2 AND time BETWEEN $3 AND $4
        GROUP BY bucket ORDER BY bucket DESC
    `
    rows, err := r.pool.Query(ctx, query, bucket, sensorID, start, end)
    // ...
}
```

## Python Integration

```python
async def insert_readings(pool, readings: list[Reading]) -> None:
    async with pool.acquire() as conn:
        await conn.copy_records_to_table(
            'readings',
            records=[(r.time, r.sensor_id, r.tenant_id, r.value, r.quality) for r in readings],
            columns=['time', 'sensor_id', 'tenant_id', 'value', 'quality']
        )

async def get_aggregated(pool, sensor_id: str, start: datetime, end: datetime, bucket: str = '1 hour'):
    query = """
        SELECT time_bucket($1::interval, time) AS bucket, AVG(value), MIN(value), MAX(value), COUNT(*)
        FROM readings WHERE sensor_id = $2 AND time BETWEEN $3 AND $4
        GROUP BY bucket ORDER BY bucket DESC
    """
    async with pool.acquire() as conn:
        return await conn.fetch(query, bucket, sensor_id, start, end)
```

## Performance Tips

1. **Use COPY for bulk inserts** - Much faster than INSERT
2. **Tune chunk size** - Based on data volume
3. **Use continuous aggregates** - For dashboards
4. **Compression** - Enable after data stabilizes
5. **Partial indexes** - For recent data queries

```sql
-- Partial index for recent data
CREATE INDEX idx_recent ON readings (sensor_id, time DESC)
WHERE time > NOW() - INTERVAL '7 days';

-- Check compression stats
SELECT hypertable_name, before_compression_total_bytes, after_compression_total_bytes,
    (1 - after_compression_total_bytes::float / before_compression_total_bytes) * 100 AS ratio
FROM chunk_compression_stats('readings');
```

## Related Skills

- `pgx-postgres`: PostgreSQL driver patterns
- `redis-cache`: Hot data caching
- `duckdb-analytics`: Analytics queries
- `opentelemetry`: Metrics storage
