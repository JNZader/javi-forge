---
name: pgx-postgres
description: >
  PostgreSQL driver for Go with pgx v5 - connection pools, queries, transactions.
  Trigger: pgx, postgres go, postgresql driver, go database, sql go
tools:
  - Read
  - Write
  - Bash
  - Grep
metadata:
  author: plataforma-industrial
  version: "2.0"
  tags: [go, postgresql, pgx, database, backend]
  updated: "2026-02"
---

# PGX PostgreSQL Skill

PostgreSQL database patterns using pgx v5 for Go applications.

## Stack

```go
require (
    github.com/jackc/pgx/v5 v5.5.5
    github.com/jackc/pgx/v5/pgxpool v5.5.5
    github.com/jackc/pgx/v5/stdlib v5.5.5
)
```

## Connection Pool

```go
package database

import (
    "context"
    "fmt"
    "time"
    "github.com/jackc/pgx/v5/pgxpool"
)

type PostgresDB struct {
    pool *pgxpool.Pool
}

func NewPostgres(ctx context.Context, connString string) (*PostgresDB, error) {
    config, err := pgxpool.ParseConfig(connString)
    if err != nil {
        return nil, fmt.Errorf("parse config: %w", err)
    }

    // Pool configuration
    config.MaxConns = 25
    config.MinConns = 5
    config.MaxConnLifetime = time.Hour
    config.MaxConnIdleTime = 30 * time.Minute
    config.HealthCheckPeriod = time.Minute

    pool, err := pgxpool.NewWithConfig(ctx, config)
    if err != nil {
        return nil, fmt.Errorf("create pool: %w", err)
    }

    if err := pool.Ping(ctx); err != nil {
        return nil, fmt.Errorf("ping: %w", err)
    }

    return &PostgresDB{pool: pool}, nil
}

func (db *PostgresDB) Close() { db.pool.Close() }
func (db *PostgresDB) Pool() *pgxpool.Pool { return db.pool }
```

## Database Config

```go
type DatabaseConfig struct {
    Host     string
    Port     int
    User     string
    Password string
    Database string
    SSLMode  string
}

func (c *DatabaseConfig) ConnectionString() string {
    return fmt.Sprintf(
        "postgres://%s:%s@%s:%d/%s?sslmode=%s",
        c.User, c.Password, c.Host, c.Port, c.Database, c.SSLMode,
    )
}
```

## Repository Pattern

### Base Repository

```go
package repository

import (
    "context"
    "github.com/jackc/pgx/v5"
    "github.com/jackc/pgx/v5/pgxpool"
)

type BaseRepository struct {
    pool *pgxpool.Pool
}

func NewBaseRepository(pool *pgxpool.Pool) *BaseRepository {
    return &BaseRepository{pool: pool}
}

func (r *BaseRepository) WithTx(ctx context.Context, fn func(tx pgx.Tx) error) error {
    tx, err := r.pool.Begin(ctx)
    if err != nil {
        return err
    }

    defer func() {
        if p := recover(); p != nil {
            tx.Rollback(ctx)
            panic(p)
        }
    }()

    if err := fn(tx); err != nil {
        tx.Rollback(ctx)
        return err
    }

    return tx.Commit(ctx)
}
```

### Entity Repository

```go
type EntityRepository struct {
    *BaseRepository
}

func NewEntityRepository(pool *pgxpool.Pool) *EntityRepository {
    return &EntityRepository{BaseRepository: NewBaseRepository(pool)}
}

func (r *EntityRepository) GetByID(ctx context.Context, id uuid.UUID) (*model.Entity, error) {
    query := `SELECT id, name, status, tenant_id, created_at, updated_at
              FROM entities WHERE id = $1`

    var e model.Entity
    err := r.pool.QueryRow(ctx, query, id).Scan(
        &e.ID, &e.Name, &e.Status, &e.TenantID, &e.CreatedAt, &e.UpdatedAt,
    )
    if err != nil {
        if err == pgx.ErrNoRows {
            return nil, ErrNotFound
        }
        return nil, err
    }
    return &e, nil
}

func (r *EntityRepository) List(ctx context.Context, filters *Filters) ([]*model.Entity, int, error) {
    // Count
    countQuery := `SELECT COUNT(*) FROM entities WHERE tenant_id = $1`
    args := []interface{}{filters.TenantID}

    if filters.Status != "" {
        countQuery += ` AND status = $2`
        args = append(args, filters.Status)
    }

    var total int
    if err := r.pool.QueryRow(ctx, countQuery, args...).Scan(&total); err != nil {
        return nil, 0, err
    }

    // Data
    query := `SELECT id, name, status, tenant_id, created_at, updated_at
              FROM entities WHERE tenant_id = $1`

    if filters.Status != "" {
        query += ` AND status = $2`
    }

    query += fmt.Sprintf(` ORDER BY name LIMIT $%d OFFSET $%d`, len(args)+1, len(args)+2)
    args = append(args, filters.Limit, (filters.Page-1)*filters.Limit)

    rows, err := r.pool.Query(ctx, query, args...)
    if err != nil {
        return nil, 0, err
    }
    defer rows.Close()

    entities := make([]*model.Entity, 0)
    for rows.Next() {
        var e model.Entity
        if err := rows.Scan(&e.ID, &e.Name, &e.Status, &e.TenantID, &e.CreatedAt, &e.UpdatedAt); err != nil {
            return nil, 0, err
        }
        entities = append(entities, &e)
    }

    return entities, total, rows.Err()
}

func (r *EntityRepository) Create(ctx context.Context, e *model.Entity) error {
    query := `INSERT INTO entities (id, name, status, tenant_id, created_at, updated_at)
              VALUES ($1, $2, $3, $4, $5, $6)`

    _, err := r.pool.Exec(ctx, query, e.ID, e.Name, e.Status, e.TenantID, e.CreatedAt, e.UpdatedAt)
    return err
}

func (r *EntityRepository) Update(ctx context.Context, e *model.Entity) error {
    query := `UPDATE entities SET name = $2, status = $3, updated_at = $4 WHERE id = $1`

    result, err := r.pool.Exec(ctx, query, e.ID, e.Name, e.Status, time.Now())
    if err != nil {
        return err
    }
    if result.RowsAffected() == 0 {
        return ErrNotFound
    }
    return nil
}

func (r *EntityRepository) Delete(ctx context.Context, id uuid.UUID) error {
    result, err := r.pool.Exec(ctx, `DELETE FROM entities WHERE id = $1`, id)
    if err != nil {
        return err
    }
    if result.RowsAffected() == 0 {
        return ErrNotFound
    }
    return nil
}
```

## Batch Operations

```go
// Batch Insert
func (r *EntityRepository) BatchCreate(ctx context.Context, entities []*model.Entity) error {
    batch := &pgx.Batch{}

    for _, e := range entities {
        batch.Queue(`INSERT INTO entities (id, name, status, tenant_id, created_at)
                     VALUES ($1, $2, $3, $4, $5)`,
            e.ID, e.Name, e.Status, e.TenantID, e.CreatedAt)
    }

    results := r.pool.SendBatch(ctx, batch)
    defer results.Close()

    for range entities {
        if _, err := results.Exec(); err != nil {
            return err
        }
    }
    return nil
}

// Bulk Insert with CopyFrom
func (r *EntityRepository) BulkInsert(ctx context.Context, entities []*model.Entity) error {
    columns := []string{"id", "name", "status", "tenant_id", "created_at"}

    rows := make([][]interface{}, len(entities))
    for i, e := range entities {
        rows[i] = []interface{}{e.ID, e.Name, e.Status, e.TenantID, e.CreatedAt}
    }

    _, err := r.pool.CopyFrom(ctx, pgx.Identifier{"entities"}, columns, pgx.CopyFromRows(rows))
    return err
}
```

## Transactions

```go
// Simple transaction
func (r *EntityRepository) CreateWithRelated(ctx context.Context, entity *model.Entity, related []*model.Related) error {
    return r.WithTx(ctx, func(tx pgx.Tx) error {
        if _, err := tx.Exec(ctx, `INSERT INTO entities (...) VALUES (...)`, ...); err != nil {
            return err
        }

        for _, rel := range related {
            if _, err := tx.Exec(ctx, `INSERT INTO related (...) VALUES (...)`, ...); err != nil {
                return err
            }
        }
        return nil
    })
}

// Service layer transaction
func (s *EntityService) Transfer(ctx context.Context, entityID, newParentID uuid.UUID) error {
    tx, err := s.db.Pool().Begin(ctx)
    if err != nil {
        return err
    }
    defer tx.Rollback(ctx)

    if err := s.entityRepo.UpdateParentTx(ctx, tx, entityID, newParentID); err != nil {
        return err
    }

    if err := s.auditRepo.LogTransferTx(ctx, tx, entityID, newParentID); err != nil {
        return err
    }

    return tx.Commit(ctx)
}
```

## Row Level Security (Multi-tenant)

```sql
-- Enable RLS
ALTER TABLE entities ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY tenant_entities ON entities
    USING (tenant_id = current_setting('app.tenant_id')::uuid);

CREATE POLICY tenant_entities_insert ON entities
    FOR INSERT WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
```

```go
// Set tenant context
func (db *PostgresDB) AcquireWithTenant(ctx context.Context, tenantID string) (*pgxpool.Conn, error) {
    conn, err := db.pool.Acquire(ctx)
    if err != nil {
        return nil, err
    }

    _, err = conn.Exec(ctx, "SELECT set_config('app.tenant_id', $1, false)", tenantID)
    if err != nil {
        conn.Release()
        return nil, fmt.Errorf("set tenant: %w", err)
    }

    return conn, nil
}
```

## Query Builder

```go
type QueryBuilder struct {
    baseQuery  string
    conditions []string
    args       []interface{}
    argIndex   int
}

func NewQueryBuilder(base string) *QueryBuilder {
    return &QueryBuilder{baseQuery: base, conditions: []string{}, args: []interface{}{}}
}

func (qb *QueryBuilder) Where(condition string, arg interface{}) *QueryBuilder {
    qb.argIndex++
    qb.conditions = append(qb.conditions, fmt.Sprintf(condition, qb.argIndex))
    qb.args = append(qb.args, arg)
    return qb
}

func (qb *QueryBuilder) WhereIf(cond bool, condition string, arg interface{}) *QueryBuilder {
    if cond { return qb.Where(condition, arg) }
    return qb
}

func (qb *QueryBuilder) Build() (string, []interface{}) {
    query := qb.baseQuery
    if len(qb.conditions) > 0 {
        query += " WHERE " + strings.Join(qb.conditions, " AND ")
    }
    return query, qb.args
}

// Usage
qb := NewQueryBuilder("SELECT * FROM entities").
    Where("tenant_id = $%d", tenantID).
    WhereIf(status != "", "status = $%d", status).
    WhereIf(search != "", "name ILIKE $%d", "%"+search+"%")

query, args := qb.Build()
rows, err := r.pool.Query(ctx, query, args...)
```

## Scanning Patterns

```go
// CollectRows
func (r *EntityRepository) List(ctx context.Context) ([]*model.Entity, error) {
    rows, err := r.pool.Query(ctx, `SELECT id, name, status FROM entities`)
    if err != nil {
        return nil, err
    }

    return pgx.CollectRows(rows, pgx.RowToAddrOfStructByName[model.Entity])
}

// Custom scanner
func scanEntity(row pgx.Row) (*model.Entity, error) {
    var e model.Entity
    err := row.Scan(&e.ID, &e.Name, &e.Status, &e.TenantID, &e.CreatedAt, &e.UpdatedAt)
    if err != nil { return nil, err }
    return &e, nil
}
```

## JSONB Operations

```go
type Entity struct {
    ID       uuid.UUID
    Name     string
    Metadata map[string]interface{} // JSONB column
}

// Insert JSONB
_, err := r.pool.Exec(ctx,
    `INSERT INTO entities (id, name, metadata) VALUES ($1, $2, $3)`,
    e.ID, e.Name, e.Metadata) // pgx handles map -> JSONB

// Query JSONB
rows, err := r.pool.Query(ctx,
    `SELECT id, name, metadata FROM entities WHERE metadata->>$1 = $2`,
    key, value)

// Update JSONB field
_, err := r.pool.Exec(ctx,
    `UPDATE entities SET metadata = jsonb_set(metadata, $2, $3) WHERE id = $1`,
    id, "{"+key+"}", `"`+value+`"`)
```

## Error Handling

```go
package repository

import (
    "errors"
    "github.com/jackc/pgx/v5"
    "github.com/jackc/pgx/v5/pgconn"
)

var (
    ErrNotFound   = errors.New("not found")
    ErrDuplicate  = errors.New("duplicate entry")
    ErrForeignKey = errors.New("foreign key violation")
)

func wrapError(err error) error {
    if err == nil { return nil }

    if errors.Is(err, pgx.ErrNoRows) {
        return ErrNotFound
    }

    var pgErr *pgconn.PgError
    if errors.As(err, &pgErr) {
        switch pgErr.Code {
        case "23505": return ErrDuplicate   // unique_violation
        case "23503": return ErrForeignKey  // foreign_key_violation
        }
    }

    return err
}
```

## Best Practices

1. **Always use context**: Include timeout for queries
   ```go
   ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
   defer cancel()
   ```

2. **Always close rows**: Use defer immediately after Query
   ```go
   rows, err := pool.Query(ctx, query)
   if err != nil { return err }
   defer rows.Close()
   ```

3. **Use pools, not connections**: Pools manage connection lifecycle
   ```go
   pool, _ := pgxpool.New(ctx, connString)
   pool.Query(ctx, query) // Pool handles acquire/release
   ```

4. **Parameterize queries**: Never concatenate user input
   ```go
   pool.Query(ctx, "SELECT * FROM users WHERE id = $1", id) // Safe
   ```

## Related Skills

- `chi-router`: HTTP handler integration
- `redis-cache`: Query result caching
- `timescaledb`: Time-series extensions
- `go-backend`: Full Go patterns
