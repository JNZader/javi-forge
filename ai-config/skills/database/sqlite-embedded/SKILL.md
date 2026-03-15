---
name: sqlite-embedded
description: >
  SQLite embedded database for edge/offline scenarios with sync queue patterns.
  Trigger: sqlite, embedded database, offline, edge, sync queue, local storage

tools:
  - Read
  - Write
  - Bash
  - Grep

metadata:
  author: plataforma-industrial
  version: "2.0"
  tags: [sqlite, edge, embedded, offline, database]
  updated: "2026-02"
---

# SQLite Embedded Database

> Edge/offline embedded database with zero configuration and sync queue patterns.

## Stack

```yaml
SQLite: 3.45+
Driver Go: modernc.org/sqlite  # Pure Go, no CGO
Driver Rust: rusqlite 0.31+
Mobile: @capacitor-community/sqlite
```

## When to Use

- Edge/offline-first applications
- Local configuration storage
- Sync queue for pending cloud operations
- Low-footprint deployments (<5MB RAM)
- Single-file database with easy backup

## Optimal PRAGMAs

```sql
PRAGMA journal_mode = WAL;          -- Write-Ahead Logging (better concurrency)
PRAGMA synchronous = NORMAL;        -- Balance durability/speed
PRAGMA foreign_keys = ON;           -- Referential integrity
PRAGMA cache_size = -64000;         -- 64MB cache
PRAGMA mmap_size = 268435456;       -- 256MB memory-mapped I/O
PRAGMA busy_timeout = 5000;         -- 5s retry if locked
PRAGMA temp_store = MEMORY;         -- Temp tables in memory
```

## Go Connection (Pure Go, No CGO)

```go
package db

import (
    "context"
    "database/sql"
    "fmt"
    "time"
    _ "modernc.org/sqlite"
)

type SQLiteConfig struct {
    Path            string
    MaxOpenConns    int
    MaxIdleConns    int
    ConnMaxLifetime time.Duration
}

func NewSQLiteDB(cfg SQLiteConfig) (*sql.DB, error) {
    dsn := fmt.Sprintf(
        "file:%s?_journal_mode=WAL&_synchronous=NORMAL&_foreign_keys=ON&_busy_timeout=5000&_cache_size=-64000",
        cfg.Path,
    )

    db, err := sql.Open("sqlite", dsn)
    if err != nil {
        return nil, fmt.Errorf("open sqlite: %w", err)
    }

    // SQLite: 1 writer, multiple readers
    db.SetMaxOpenConns(cfg.MaxOpenConns)  // Typically 1-4
    db.SetMaxIdleConns(cfg.MaxIdleConns)
    db.SetConnMaxLifetime(cfg.ConnMaxLifetime)

    ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
    defer cancel()
    if err := db.PingContext(ctx); err != nil {
        return nil, fmt.Errorf("ping sqlite: %w", err)
    }
    return db, nil
}

func DefaultConfig(path string) SQLiteConfig {
    return SQLiteConfig{
        Path:            path,
        MaxOpenConns:    4,
        MaxIdleConns:    2,
        ConnMaxLifetime: time.Hour,
    }
}
```

## Rust Connection

```rust
use rusqlite::{Connection, OpenFlags, Result};
use std::path::Path;

pub struct SqliteDb {
    conn: Connection,
}

impl SqliteDb {
    pub fn new(path: &Path) -> Result<Self> {
        let conn = Connection::open_with_flags(
            path,
            OpenFlags::SQLITE_OPEN_READ_WRITE
                | OpenFlags::SQLITE_OPEN_CREATE
                | OpenFlags::SQLITE_OPEN_NO_MUTEX,
        )?;

        conn.execute_batch("
            PRAGMA journal_mode = WAL;
            PRAGMA synchronous = NORMAL;
            PRAGMA foreign_keys = ON;
            PRAGMA cache_size = -64000;
            PRAGMA busy_timeout = 5000;
        ")?;

        Ok(Self { conn })
    }
}
```

## Schema Patterns

### Configuration Table

```sql
CREATE TABLE IF NOT EXISTS sensors (
    id TEXT PRIMARY KEY,
    plant_id TEXT NOT NULL REFERENCES plants(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    unit TEXT NOT NULL,
    modbus_address INTEGER,
    modbus_register INTEGER,
    scale_factor REAL DEFAULT 1.0,
    warning_low REAL,
    warning_high REAL,
    critical_low REAL,
    critical_high REAL,
    read_interval_secs INTEGER DEFAULT 10,
    is_active INTEGER NOT NULL DEFAULT 1,
    metadata TEXT DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_sensors_plant ON sensors(plant_id);
CREATE INDEX idx_sensors_active ON sensors(is_active);
```

### Recent Readings Cache (with cleanup trigger)

```sql
CREATE TABLE IF NOT EXISTS sensor_readings_recent (
    id TEXT PRIMARY KEY,
    sensor_id TEXT NOT NULL REFERENCES sensors(id) ON DELETE CASCADE,
    value REAL NOT NULL,
    quality TEXT DEFAULT 'good' CHECK (quality IN ('good', 'uncertain', 'bad')),
    timestamp TEXT NOT NULL,
    synced INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_readings_sensor ON sensor_readings_recent(sensor_id, timestamp DESC);
CREATE INDEX idx_readings_synced ON sensor_readings_recent(synced) WHERE synced = 0;

-- Auto-cleanup: keep only last 1000 per sensor
CREATE TRIGGER IF NOT EXISTS trg_readings_cleanup
AFTER INSERT ON sensor_readings_recent
BEGIN
    DELETE FROM sensor_readings_recent
    WHERE id IN (
        SELECT id FROM sensor_readings_recent
        WHERE sensor_id = NEW.sensor_id
        ORDER BY timestamp DESC
        LIMIT -1 OFFSET 1000
    );
END;
```

### Sync Queue

```sql
CREATE TABLE IF NOT EXISTS sync_queue (
    id TEXT PRIMARY KEY,
    plant_id TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    operation TEXT NOT NULL CHECK (operation IN ('create', 'update', 'delete')),
    payload TEXT NOT NULL,
    priority INTEGER NOT NULL DEFAULT 0,
    retries INTEGER NOT NULL DEFAULT 0,
    max_retries INTEGER NOT NULL DEFAULT 5,
    last_error TEXT,
    next_retry_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    processed_at TEXT
);

CREATE INDEX idx_sync_queue_pending ON sync_queue(priority DESC, created_at)
    WHERE processed_at IS NULL;
```

## Sync Queue Repository

```go
type SyncItem struct {
    ID         string          `json:"id"`
    PlantID    string          `json:"plant_id"`
    EntityType string          `json:"entity_type"`
    EntityID   string          `json:"entity_id"`
    Operation  string          `json:"operation"`
    Payload    json.RawMessage `json:"payload"`
    Priority   int             `json:"priority"`
    Retries    int             `json:"retries"`
    MaxRetries int             `json:"max_retries"`
}

func (r *SyncQueueRepository) GetPending(ctx context.Context, limit int) ([]SyncItem, error) {
    query := `
        SELECT id, plant_id, entity_type, entity_id, operation, payload,
               priority, retries, max_retries, last_error, created_at
        FROM sync_queue
        WHERE processed_at IS NULL
          AND (next_retry_at IS NULL OR next_retry_at <= datetime('now'))
        ORDER BY priority DESC, created_at ASC
        LIMIT ?
    `
    // ... scan rows
}

func (r *SyncQueueRepository) MarkFailed(ctx context.Context, id string, errMsg string) error {
    query := `
        UPDATE sync_queue
        SET retries = retries + 1,
            last_error = ?,
            next_retry_at = datetime('now', '+' || (retries + 1) * 30 || ' seconds')
        WHERE id = ?
    `
    _, err := r.db.ExecContext(ctx, query, errMsg, id)
    return err
}
```

## Batch Insert Pattern

```go
func (r *ReadingRepository) InsertBatch(ctx context.Context, readings []Reading) error {
    if len(readings) == 0 {
        return nil
    }

    tx, err := r.db.BeginTx(ctx, nil)
    if err != nil {
        return err
    }
    defer tx.Rollback()

    placeholders := make([]string, len(readings))
    args := make([]any, 0, len(readings)*6)

    for i, rd := range readings {
        placeholders[i] = "(?, ?, ?, ?, ?, ?)"
        args = append(args, rd.ID, rd.SensorID, rd.Value, rd.Quality, rd.RawValue, rd.Timestamp)
    }

    query := `INSERT INTO sensor_readings_recent (id, sensor_id, value, quality, raw_value, timestamp)
              VALUES ` + strings.Join(placeholders, ", ")
    _, err = tx.ExecContext(ctx, query, args...)
    if err != nil {
        return err
    }
    return tx.Commit()
}
```

## Useful Views

```sql
-- Latest reading per sensor with status
CREATE VIEW IF NOT EXISTS v_sensor_latest_readings AS
SELECT
    s.id AS sensor_id,
    s.name AS sensor_name,
    r.value,
    r.timestamp,
    CASE
        WHEN r.value IS NULL THEN 'no_data'
        WHEN s.critical_low IS NOT NULL AND r.value < s.critical_low THEN 'critical_low'
        WHEN s.critical_high IS NOT NULL AND r.value > s.critical_high THEN 'critical_high'
        WHEN s.warning_low IS NOT NULL AND r.value < s.warning_low THEN 'warning_low'
        WHEN s.warning_high IS NOT NULL AND r.value > s.warning_high THEN 'warning_high'
        ELSE 'normal'
    END AS status
FROM sensors s
LEFT JOIN (
    SELECT sensor_id, value, timestamp,
           ROW_NUMBER() OVER (PARTITION BY sensor_id ORDER BY timestamp DESC) AS rn
    FROM sensor_readings_recent
) r ON r.sensor_id = s.id AND r.rn = 1
WHERE s.is_active = 1;
```

## Backup (Hot Backup with WAL)

```go
func BackupDatabase(ctx context.Context, db *sql.DB, destDir string) (string, error) {
    filename := fmt.Sprintf("backup_%s.db", time.Now().Format("20060102_150405"))
    destPath := filepath.Join(destDir, filename)

    // VACUUM INTO creates consistent backup without stopping
    query := fmt.Sprintf("VACUUM INTO '%s'", destPath)
    _, err := db.ExecContext(ctx, query)
    return destPath, err
}
```

## SQLite vs PostgreSQL Syntax

| Aspect | SQLite | PostgreSQL |
|--------|--------|------------|
| Datetime | `datetime('now')` | `NOW()` |
| Interval | `datetime('now', '-1 hour')` | `NOW() - INTERVAL '1 hour'` |
| Boolean | `INTEGER (0/1)` | `BOOLEAN` |
| UUID | `TEXT` | `UUID` |
| Auto-ID | `INTEGER PRIMARY KEY` | `SERIAL` |
| JSON | `TEXT + json_*()` | `JSONB` |

## Performance Tips

```sql
-- Partial indexes (smaller, faster)
CREATE INDEX idx_readings_unsynced ON sensor_readings_recent(synced)
    WHERE synced = 0;

-- Check query plan
EXPLAIN QUERY PLAN
SELECT * FROM sensor_readings_recent WHERE sensor_id = 'abc';

-- Update statistics
ANALYZE;
```

## Quick Reference

| Task | Command |
|------|---------|
| Check integrity | `PRAGMA integrity_check;` |
| Enable WAL | `PRAGMA journal_mode = WAL;` |
| Set busy timeout | `PRAGMA busy_timeout = 5000;` |
| Hot backup | `VACUUM INTO 'backup.db'` |
| DB size | `SELECT page_count * page_size FROM pragma_page_count(), pragma_page_size();` |

## Resources

- [SQLite Documentation](https://sqlite.org/docs.html)
- [modernc.org/sqlite](https://pkg.go.dev/modernc.org/sqlite)
- [rusqlite](https://docs.rs/rusqlite)

---

## Changelog

- **2.0** - Condensed from Plataforma Industrial SKILL-SQLITE

## Related Skills

- `mobile-ionic`: Offline-first mobile apps
- `ionic-capacitor`: Native SQLite access
- `duckdb-analytics`: Embedded analytics
- `rust-systems`: Embedded Rust apps
