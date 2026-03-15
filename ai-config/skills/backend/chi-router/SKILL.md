---
name: chi-router
description: >
  Go HTTP router patterns with Chi v5 - routing, middleware, handlers.
  Trigger: chi, go router, http handlers, go middleware, rest api go
tools:
  - Read
  - Write
  - Bash
  - Grep
metadata:
  author: plataforma-industrial
  version: "2.0"
  tags: [go, chi, http, router, backend]
  updated: "2026-02"
---

# Chi Router Skill

Go HTTP router patterns using Chi v5 for REST APIs.

## Stack

```go
require (
    github.com/go-chi/chi/v5 v5.0.12
    github.com/go-chi/cors v1.2.1
    github.com/go-chi/httprate v0.9.0
    github.com/go-chi/render v1.0.3
)
```

## Project Structure

```
apps/api/
├── cmd/api/main.go
├── internal/
│   ├── config/config.go
│   ├── handler/
│   │   ├── handler.go
│   │   ├── resource_handler.go
│   │   └── response.go
│   ├── middleware/
│   │   ├── auth.go
│   │   ├── tenant.go
│   │   └── logging.go
│   ├── router/router.go
│   ├── service/
│   └── repository/
└── go.mod
```

## Router Setup

```go
package router

import (
    "time"
    "github.com/go-chi/chi/v5"
    "github.com/go-chi/chi/v5/middleware"
    "github.com/go-chi/cors"
    "github.com/go-chi/httprate"
)

func New(handlers *Handlers, cfg *config.Config) *chi.Mux {
    r := chi.NewRouter()

    // Global middleware
    r.Use(middleware.RequestID)
    r.Use(middleware.RealIP)
    r.Use(middleware.Logger)
    r.Use(middleware.Recoverer)
    r.Use(middleware.Timeout(30 * time.Second))

    // CORS
    r.Use(cors.Handler(cors.Options{
        AllowedOrigins:   cfg.CORSOrigins,
        AllowedMethods:   []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
        AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type"},
        AllowCredentials: true,
        MaxAge:           300,
    }))

    // Rate limiting
    r.Use(httprate.LimitByIP(100, time.Minute))

    // Health (no auth)
    r.Get("/health", handlers.Health.Live)

    // API v1
    r.Route("/api/v1", func(r chi.Router) {
        // Public
        r.Post("/auth/login", handlers.Auth.Login)

        // Protected
        r.Group(func(r chi.Router) {
            r.Use(JWTAuthMiddleware(cfg.JWTSecret))
            r.Use(TenantMiddleware)

            r.Route("/resources", func(r chi.Router) {
                r.Get("/", handlers.Resource.List)
                r.Post("/", handlers.Resource.Create)
                r.Route("/{resourceID}", func(r chi.Router) {
                    r.Use(ResourceCtx)
                    r.Get("/", handlers.Resource.Get)
                    r.Put("/", handlers.Resource.Update)
                    r.Delete("/", handlers.Resource.Delete)
                })
            })
        })
    })

    return r
}
```

## Handler Pattern

```go
package handler

import (
    "encoding/json"
    "net/http"
    "github.com/go-chi/chi/v5"
)

type ResourceHandler struct {
    service *service.ResourceService
}

func NewResourceHandler(svc *service.ResourceService) *ResourceHandler {
    return &ResourceHandler{service: svc}
}

func (h *ResourceHandler) List(w http.ResponseWriter, r *http.Request) {
    ctx := r.Context()
    tenantID := TenantFromContext(ctx)

    filters := &Filters{
        Status: r.URL.Query().Get("status"),
        Page:   parseIntOrDefault(r.URL.Query().Get("page"), 1),
        Limit:  parseIntOrDefault(r.URL.Query().Get("limit"), 20),
    }

    items, total, err := h.service.List(ctx, tenantID, filters)
    if err != nil {
        respondError(w, http.StatusInternalServerError, "failed to list")
        return
    }

    respondPaginated(w, items, total, filters.Page, filters.Limit)
}

func (h *ResourceHandler) Create(w http.ResponseWriter, r *http.Request) {
    ctx := r.Context()
    tenantID := TenantFromContext(ctx)

    var input CreateInput
    if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
        respondError(w, http.StatusBadRequest, "invalid json")
        return
    }

    if err := input.Validate(); err != nil {
        respondValidationError(w, err)
        return
    }

    item, err := h.service.Create(ctx, tenantID, &input)
    if err != nil {
        respondError(w, http.StatusInternalServerError, "failed to create")
        return
    }

    respondJSON(w, http.StatusCreated, DataResponse{Data: item})
}

func (h *ResourceHandler) Get(w http.ResponseWriter, r *http.Request) {
    resource := ResourceFromContext(r.Context())
    respondJSON(w, http.StatusOK, DataResponse{Data: resource})
}
```

## JWT Middleware

```go
package middleware

import (
    "context"
    "net/http"
    "strings"
    "github.com/golang-jwt/jwt/v5"
)

type contextKey string

const (
    ClaimsKey contextKey = "claims"
    UserIDKey contextKey = "userID"
    TenantKey contextKey = "tenantID"
)

func JWTAuthMiddleware(secret string) func(next http.Handler) http.Handler {
    return func(next http.Handler) http.Handler {
        return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
            authHeader := r.Header.Get("Authorization")
            if authHeader == "" {
                respondError(w, http.StatusUnauthorized, "missing authorization")
                return
            }

            parts := strings.Split(authHeader, " ")
            if len(parts) != 2 || parts[0] != "Bearer" {
                respondError(w, http.StatusUnauthorized, "invalid authorization")
                return
            }

            token, err := jwt.Parse(parts[1], func(token *jwt.Token) (interface{}, error) {
                if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
                    return nil, fmt.Errorf("unexpected signing method")
                }
                return []byte(secret), nil
            })

            if err != nil || !token.Valid {
                respondError(w, http.StatusUnauthorized, "invalid token")
                return
            }

            claims := token.Claims.(jwt.MapClaims)
            ctx := context.WithValue(r.Context(), ClaimsKey, claims)
            ctx = context.WithValue(ctx, UserIDKey, claims["sub"].(string))

            next.ServeHTTP(w, r.WithContext(ctx))
        })
    }
}

func UserIDFromContext(ctx context.Context) string {
    if v := ctx.Value(UserIDKey); v != nil {
        return v.(string)
    }
    return ""
}
```

## Resource Context Middleware

```go
func ResourceCtx(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        resourceID := chi.URLParam(r, "resourceID")

        id, err := uuid.Parse(resourceID)
        if err != nil {
            respondError(w, http.StatusBadRequest, "invalid id")
            return
        }

        tenantID := TenantFromContext(r.Context())
        resource, err := resourceService.GetByID(r.Context(), tenantID, id)
        if err != nil {
            respondError(w, http.StatusNotFound, "not found")
            return
        }

        ctx := context.WithValue(r.Context(), resourceContextKey{}, resource)
        next.ServeHTTP(w, r.WithContext(ctx))
    })
}
```

## Response Helpers

```go
package handler

type DataResponse struct {
    Data interface{} `json:"data"`
}

type ErrorResponse struct {
    Error   string            `json:"error"`
    Code    string            `json:"code,omitempty"`
    Details map[string]string `json:"details,omitempty"`
}

type PaginatedResponse struct {
    Data interface{} `json:"data"`
    Meta Meta        `json:"meta"`
}

type Meta struct {
    Total      int `json:"total"`
    Page       int `json:"page"`
    Limit      int `json:"limit"`
    TotalPages int `json:"totalPages"`
}

func respondJSON(w http.ResponseWriter, status int, data interface{}) {
    w.Header().Set("Content-Type", "application/json")
    w.WriteHeader(status)
    json.NewEncoder(w).Encode(data)
}

func respondError(w http.ResponseWriter, status int, message string) {
    respondJSON(w, status, ErrorResponse{Error: message})
}

func respondPaginated(w http.ResponseWriter, data interface{}, total, page, limit int) {
    totalPages := (total + limit - 1) / limit
    respondJSON(w, http.StatusOK, PaginatedResponse{
        Data: data,
        Meta: Meta{Total: total, Page: page, Limit: limit, TotalPages: totalPages},
    })
}
```

## Route Patterns

```go
// Middleware per group
r.Group(func(r chi.Router) {
    r.Use(AuthMiddleware)
    r.Get("/protected", handler)
})

// Middleware per route
r.With(RateLimitMiddleware).Post("/login", handler)

// Mount subrouters
r.Mount("/api/v1/resources", ResourceRouter(handler))

// Get URL param
id := chi.URLParam(r, "id")

// Get query param
status := r.URL.Query().Get("status")

// Route context
rctx := chi.RouteContext(r.Context())
pattern := rctx.RoutePattern()
```

## Testing

```go
func TestHandler_List(t *testing.T) {
    mockService := &MockService{}
    handler := NewHandler(mockService)

    mockService.On("List", mock.Anything, mock.Anything).Return(
        []*model.Item{{ID: "1", Name: "Test"}}, 1, nil,
    )

    req := httptest.NewRequest("GET", "/api/v1/resources", nil)
    req = req.WithContext(context.WithValue(req.Context(), TenantKey, "tenant-1"))
    rec := httptest.NewRecorder()

    handler.List(rec, req)

    assert.Equal(t, http.StatusOK, rec.Code)
}

func TestRoutes(t *testing.T) {
    r := chi.NewRouter()
    r.Use(testAuthMiddleware)
    r.Route("/api/v1/resources", func(r chi.Router) {
        r.Get("/", handler.List)
        r.Get("/{id}", handler.Get)
    })

    req := httptest.NewRequest("GET", "/api/v1/resources", nil)
    rec := httptest.NewRecorder()
    r.ServeHTTP(rec, req)
    assert.Equal(t, http.StatusOK, rec.Code)
}
```

## Best Practices

1. **Middleware levels**: Global for logging, group for auth, route for rate limiting
2. **Resource context pattern**: Load and validate resources in middleware
3. **Consistent responses**: Always use helper functions
4. **Validate input**: Decode JSON, then validate before processing

## Related Skills

- `pgx-postgres`: Database access patterns
- `jwt-auth`: Auth middleware integration
- `redis-cache`: Response caching
- `opentelemetry`: Distributed tracing
