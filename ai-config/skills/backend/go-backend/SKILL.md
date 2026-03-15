---
name: go-backend
description: >
  Go backend development patterns with Chi router, PostgreSQL/pgx, JWT auth, and clean architecture.
  Trigger: Go API, Chi router, pgx, PostgreSQL, Go backend, REST API Go, Go service
tools:
  - Read
  - Write
  - Bash
  - Grep
metadata:
  author: plataforma-industrial
  version: "2.0"
  tags: [go, backend, chi, postgresql, jwt, api, clean-architecture]
  updated: "2026-02"
---

# Go Backend Development

Patterns for building production Go backends with Chi, PostgreSQL, and clean architecture.

## Stack

```yaml
Go: 1.22+
Chi: 5.0.12
pgx: v5.5.5
JWT: golang-jwt/jwt/v5
Validator: go-playground/validator/v10
```

## Project Structure

```
apps/api/
├── cmd/
│   └── server/
│       └── main.go
├── internal/
│   ├── config/
│   │   └── config.go
│   ├── server/
│   │   ├── server.go
│   │   └── routes.go
│   ├── middleware/
│   │   ├── auth.go
│   │   ├── logging.go
│   │   └── recovery.go
│   ├── domain/
│   │   └── model.go
│   ├── repository/
│   │   └── postgres.go
│   ├── service/
│   │   └── service.go
│   └── handler/
│       └── handler.go
├── pkg/
│   ├── logger/
│   └── response/
├── go.mod
└── Dockerfile
```

## Model Pattern

```go
package domain

import (
    "time"
    "github.com/google/uuid"
)

type Status string

const (
    StatusActive   Status = "active"
    StatusInactive Status = "inactive"
)

type Entity struct {
    ID        uuid.UUID `json:"id" db:"id"`
    Name      string    `json:"name" db:"name" validate:"required,min=3,max=100"`
    Status    Status    `json:"status" db:"status" validate:"required,oneof=active inactive"`
    CreatedAt time.Time `json:"created_at" db:"created_at"`
    UpdatedAt time.Time `json:"updated_at" db:"updated_at"`
}

type CreateRequest struct {
    Name   string `json:"name" validate:"required,min=3,max=100"`
    Status Status `json:"status" validate:"required,oneof=active inactive"`
}

type UpdateRequest struct {
    Name   *string `json:"name,omitempty" validate:"omitempty,min=3,max=100"`
    Status *Status `json:"status,omitempty" validate:"omitempty,oneof=active inactive"`
}
```

## Repository Pattern

```go
package repository

import (
    "context"
    "errors"
    "fmt"

    "github.com/google/uuid"
    "github.com/jackc/pgx/v5"
    "github.com/jackc/pgx/v5/pgxpool"
)

var (
    ErrNotFound      = errors.New("entity not found")
    ErrDuplicateName = errors.New("name already exists")
)

type Repository interface {
    Create(ctx context.Context, entity *Entity) error
    GetByID(ctx context.Context, id uuid.UUID) (*Entity, error)
    GetAll(ctx context.Context) ([]Entity, error)
    Update(ctx context.Context, entity *Entity) error
    Delete(ctx context.Context, id uuid.UUID) error
}

type PostgresRepository struct {
    db *pgxpool.Pool
}

func NewPostgresRepository(db *pgxpool.Pool) *PostgresRepository {
    return &PostgresRepository{db: db}
}

func (r *PostgresRepository) GetByID(ctx context.Context, id uuid.UUID) (*Entity, error) {
    query := `SELECT id, name, status, created_at, updated_at FROM entities WHERE id = $1`

    var entity Entity
    err := r.db.QueryRow(ctx, query, id).Scan(
        &entity.ID, &entity.Name, &entity.Status,
        &entity.CreatedAt, &entity.UpdatedAt,
    )

    if errors.Is(err, pgx.ErrNoRows) {
        return nil, ErrNotFound
    }
    if err != nil {
        return nil, fmt.Errorf("get entity: %w", err)
    }

    return &entity, nil
}
```

## Service Pattern

```go
package service

import (
    "context"
    "log/slog"
    "time"

    "github.com/google/uuid"
)

type Service struct {
    repo   Repository
    logger *slog.Logger
}

func NewService(repo Repository, logger *slog.Logger) *Service {
    return &Service{repo: repo, logger: logger}
}

func (s *Service) Create(ctx context.Context, req CreateRequest) (*Entity, error) {
    entity := &Entity{
        ID:        uuid.New(),
        Name:      req.Name,
        Status:    req.Status,
        CreatedAt: time.Now().UTC(),
        UpdatedAt: time.Now().UTC(),
    }

    if err := s.repo.Create(ctx, entity); err != nil {
        s.logger.Error("failed to create entity", "error", err)
        return nil, err
    }

    s.logger.Info("entity created", "id", entity.ID)
    return entity, nil
}
```

## Handler Pattern

```go
package handler

import (
    "encoding/json"
    "errors"
    "net/http"

    "github.com/go-chi/chi/v5"
    "github.com/go-playground/validator/v10"
    "github.com/google/uuid"
)

type Handler struct {
    service   *Service
    validator *validator.Validate
}

func NewHandler(service *Service) *Handler {
    return &Handler{
        service:   service,
        validator: validator.New(),
    }
}

func (h *Handler) RegisterRoutes(r chi.Router) {
    r.Route("/entities", func(r chi.Router) {
        r.Get("/", h.GetAll)
        r.Post("/", h.Create)
        r.Route("/{id}", func(r chi.Router) {
            r.Get("/", h.GetByID)
            r.Put("/", h.Update)
            r.Delete("/", h.Delete)
        })
    })
}

func (h *Handler) GetByID(w http.ResponseWriter, r *http.Request) {
    id, err := uuid.Parse(chi.URLParam(r, "id"))
    if err != nil {
        respondError(w, http.StatusBadRequest, "invalid id")
        return
    }

    entity, err := h.service.GetByID(r.Context(), id)
    if errors.Is(err, ErrNotFound) {
        respondError(w, http.StatusNotFound, "entity not found")
        return
    }
    if err != nil {
        respondError(w, http.StatusInternalServerError, "internal error")
        return
    }

    respondJSON(w, http.StatusOK, entity)
}
```

## PostgreSQL Connection

```go
package database

import (
    "context"
    "fmt"
    "time"

    "github.com/jackc/pgx/v5/pgxpool"
)

type Config struct {
    Host     string
    Port     int
    User     string
    Password string
    DBName   string
    SSLMode  string
    MaxConns int32
}

func NewPool(ctx context.Context, cfg Config) (*pgxpool.Pool, error) {
    dsn := fmt.Sprintf(
        "postgres://%s:%s@%s:%d/%s?sslmode=%s",
        cfg.User, cfg.Password, cfg.Host, cfg.Port, cfg.DBName, cfg.SSLMode,
    )

    poolConfig, err := pgxpool.ParseConfig(dsn)
    if err != nil {
        return nil, fmt.Errorf("parse config: %w", err)
    }

    poolConfig.MaxConns = cfg.MaxConns
    poolConfig.MaxConnLifetime = 1 * time.Hour
    poolConfig.MaxConnIdleTime = 30 * time.Minute

    pool, err := pgxpool.NewWithConfig(ctx, poolConfig)
    if err != nil {
        return nil, fmt.Errorf("create pool: %w", err)
    }

    if err := pool.Ping(ctx); err != nil {
        pool.Close()
        return nil, fmt.Errorf("ping: %w", err)
    }

    return pool, nil
}
```

## JWT Authentication

```go
package auth

import (
    "errors"
    "time"

    "github.com/golang-jwt/jwt/v5"
    "github.com/google/uuid"
)

var (
    ErrInvalidToken = errors.New("invalid token")
    ErrExpiredToken = errors.New("token expired")
)

type Claims struct {
    UserID uuid.UUID `json:"sub"`
    Email  string    `json:"email"`
    Role   string    `json:"role"`
    jwt.RegisteredClaims
}

type JWTService struct {
    secretKey    []byte
    accessExpiry time.Duration
}

func NewJWTService(secret string, expiry time.Duration) *JWTService {
    return &JWTService{
        secretKey:    []byte(secret),
        accessExpiry: expiry,
    }
}

func (s *JWTService) GenerateToken(userID uuid.UUID, email, role string) (string, error) {
    claims := Claims{
        UserID: userID,
        Email:  email,
        Role:   role,
        RegisteredClaims: jwt.RegisteredClaims{
            ExpiresAt: jwt.NewNumericDate(time.Now().Add(s.accessExpiry)),
            IssuedAt:  jwt.NewNumericDate(time.Now()),
        },
    }

    token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
    return token.SignedString(s.secretKey)
}

func (s *JWTService) ValidateToken(tokenString string) (*Claims, error) {
    token, err := jwt.ParseWithClaims(tokenString, &Claims{}, func(token *jwt.Token) (interface{}, error) {
        if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
            return nil, ErrInvalidToken
        }
        return s.secretKey, nil
    })

    if err != nil {
        if errors.Is(err, jwt.ErrTokenExpired) {
            return nil, ErrExpiredToken
        }
        return nil, ErrInvalidToken
    }

    claims, ok := token.Claims.(*Claims)
    if !ok || !token.Valid {
        return nil, ErrInvalidToken
    }

    return claims, nil
}
```

## Response Helpers

```go
package response

import (
    "encoding/json"
    "net/http"
)

type ErrorResponse struct {
    Error   string            `json:"error"`
    Details map[string]string `json:"details,omitempty"`
}

func JSON(w http.ResponseWriter, status int, data any) {
    w.Header().Set("Content-Type", "application/json")
    w.WriteHeader(status)
    if data != nil && status != http.StatusNoContent {
        json.NewEncoder(w).Encode(data)
    }
}

func Error(w http.ResponseWriter, status int, message string) {
    JSON(w, status, ErrorResponse{Error: message})
}
```

## Testing

```go
package service_test

import (
    "context"
    "testing"

    "github.com/stretchr/testify/assert"
    "github.com/stretchr/testify/require"
)

func TestService_Create(t *testing.T) {
    repo := NewMockRepository()
    svc := NewService(repo, slog.Default())

    req := CreateRequest{
        Name:   "Test Entity",
        Status: StatusActive,
    }

    entity, err := svc.Create(context.Background(), req)

    require.NoError(t, err)
    assert.Equal(t, "Test Entity", entity.Name)
    assert.NotEmpty(t, entity.ID)
}
```

## Conventions

- **Packages:** lowercase, singular (`user`, not `users`)
- **Files:** snake_case (`user_repository.go`)
- **Error handling:** Always wrap with context `fmt.Errorf("operation: %w", err)`
- **Context:** Always first parameter
- **Validation:** Use `go-playground/validator` tags

## Related Skills

- `chi-router`: Chi HTTP routing patterns
- `pgx-postgres`: PostgreSQL with pgx driver
- `jwt-auth`: Authentication middleware
- `redis-cache`: Caching strategies
- `docker-containers`: Containerization
