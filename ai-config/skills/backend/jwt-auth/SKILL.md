---
name: jwt-auth
description: >
  JWT authentication with access/refresh tokens, RBAC, and multi-tenant support.
  Trigger: jwt, authentication, auth, token, rbac, authorization, login
tools:
  - Read
  - Write
  - Bash
  - Grep
metadata:
  author: plataforma-industrial
  version: "2.0"
  tags: [security, jwt, auth, rbac]
  updated: "2026-02"
---

# JWT Authentication Skill

## Stack

```yaml
# Go
golang-jwt/jwt: v5
bcrypt: golang.org/x/crypto/bcrypt

# TypeScript
jose: 5.2+

# Python
PyJWT: 2.8+
passlib: 1.7+
```

## Token Structure

### Claims

```json
{
  "iss": "app-name",
  "sub": "user-123",
  "aud": ["api"],
  "exp": 1704067200,
  "iat": 1704063600,
  "uid": "user-123",
  "tid": "tenant-456",
  "role": "operator",
  "scopes": ["items:read", "items:write", "alerts:read"]
}
```

## Go Implementation

### JWT Service

```go
// auth/jwt.go
package auth

import (
    "time"
    "github.com/golang-jwt/jwt/v5"
)

type AccessTokenClaims struct {
    jwt.RegisteredClaims
    UserID   string   `json:"uid"`
    TenantID string   `json:"tid"`
    Role     string   `json:"role"`
    Scopes   []string `json:"scopes,omitempty"`
}

type JWTConfig struct {
    AccessSecret    []byte
    RefreshSecret   []byte
    AccessDuration  time.Duration  // 15 minutes
    RefreshDuration time.Duration  // 7 days
    Issuer          string
}

type JWTService struct {
    config JWTConfig
}

func (s *JWTService) GenerateAccessToken(user *User) (string, error) {
    now := time.Now()
    claims := AccessTokenClaims{
        RegisteredClaims: jwt.RegisteredClaims{
            Issuer:    s.config.Issuer,
            Subject:   user.ID,
            ExpiresAt: jwt.NewNumericDate(now.Add(s.config.AccessDuration)),
            IssuedAt:  jwt.NewNumericDate(now),
        },
        UserID:   user.ID,
        TenantID: user.TenantID,
        Role:     user.Role,
        Scopes:   user.Scopes,
    }
    token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
    return token.SignedString(s.config.AccessSecret)
}

func (s *JWTService) ValidateAccessToken(tokenString string) (*AccessTokenClaims, error) {
    token, err := jwt.ParseWithClaims(
        tokenString,
        &AccessTokenClaims{},
        func(token *jwt.Token) (interface{}, error) {
            if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
                return nil, ErrInvalidToken
            }
            return s.config.AccessSecret, nil
        },
    )
    if err != nil {
        return nil, ErrInvalidToken
    }
    claims, ok := token.Claims.(*AccessTokenClaims)
    if !ok || !token.Valid {
        return nil, ErrInvalidClaims
    }
    return claims, nil
}
```

### Auth Middleware

```go
// middleware/auth.go
type contextKey string

const (
    UserIDKey   contextKey = "user_id"
    TenantIDKey contextKey = "tenant_id"
    RoleKey     contextKey = "role"
    ScopesKey   contextKey = "scopes"
)

func (m *AuthMiddleware) Authenticate(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        authHeader := r.Header.Get("Authorization")
        if !strings.HasPrefix(authHeader, "Bearer ") {
            http.Error(w, "Unauthorized", http.StatusUnauthorized)
            return
        }

        claims, err := m.jwtService.ValidateAccessToken(authHeader[7:])
        if err != nil {
            http.Error(w, "Invalid token", http.StatusUnauthorized)
            return
        }

        ctx := r.Context()
        ctx = context.WithValue(ctx, UserIDKey, claims.UserID)
        ctx = context.WithValue(ctx, TenantIDKey, claims.TenantID)
        ctx = context.WithValue(ctx, RoleKey, claims.Role)
        ctx = context.WithValue(ctx, ScopesKey, claims.Scopes)

        next.ServeHTTP(w, r.WithContext(ctx))
    })
}

func (m *AuthMiddleware) RequireRole(roles ...string) func(http.Handler) http.Handler {
    return func(next http.Handler) http.Handler {
        return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
            role := r.Context().Value(RoleKey).(string)
            for _, allowed := range roles {
                if role == allowed {
                    next.ServeHTTP(w, r)
                    return
                }
            }
            http.Error(w, "Forbidden", http.StatusForbidden)
        })
    }
}

func (m *AuthMiddleware) RequireScope(required string) func(http.Handler) http.Handler {
    return func(next http.Handler) http.Handler {
        return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
            scopes := r.Context().Value(ScopesKey).([]string)
            for _, scope := range scopes {
                if scope == required || scope == "*" {
                    next.ServeHTTP(w, r)
                    return
                }
            }
            http.Error(w, "Insufficient permissions", http.StatusForbidden)
        })
    }
}

// Helpers
func GetUserID(ctx context.Context) string {
    if v := ctx.Value(UserIDKey); v != nil {
        return v.(string)
    }
    return ""
}

func GetTenantID(ctx context.Context) string {
    if v := ctx.Value(TenantIDKey); v != nil {
        return v.(string)
    }
    return ""
}
```

### Login Handler

```go
type TokenResponse struct {
    AccessToken  string `json:"access_token"`
    RefreshToken string `json:"refresh_token"`
    ExpiresIn    int    `json:"expires_in"`
    TokenType    string `json:"token_type"`
}

func (h *Handler) handleLogin(w http.ResponseWriter, r *http.Request) {
    var req LoginRequest
    json.NewDecoder(r.Body).Decode(&req)

    user, _ := h.userRepo.GetByEmail(r.Context(), req.Email)

    if err := bcrypt.CompareHashAndPassword(
        []byte(user.PasswordHash), []byte(req.Password),
    ); err != nil {
        respondError(w, http.StatusUnauthorized, "Invalid credentials")
        return
    }

    accessToken, _ := h.jwtService.GenerateAccessToken(user)
    refreshToken, tokenID, _ := h.jwtService.GenerateRefreshToken(user)

    h.tokenStore.Store(r.Context(), tokenID, user.ID, 7*24*time.Hour)

    respondJSON(w, http.StatusOK, TokenResponse{
        AccessToken:  accessToken,
        RefreshToken: refreshToken,
        ExpiresIn:    900,
        TokenType:    "Bearer",
    })
}
```

## TypeScript Client

### Auth Store (Zustand)

```typescript
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { jwtDecode } from 'jwt-decode';

interface TokenPayload {
  uid: string;
  tid: string;
  role: string;
  scopes: string[];
  exp: number;
}

interface AuthState {
  accessToken: string | null;
  refreshToken: string | null;
  user: TokenPayload | null;
  isAuthenticated: boolean;
  setTokens: (access: string, refresh: string) => void;
  logout: () => void;
  isTokenExpired: () => boolean;
  hasScope: (scope: string) => boolean;
  hasRole: (role: string) => boolean;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      accessToken: null,
      refreshToken: null,
      user: null,
      isAuthenticated: false,

      setTokens: (accessToken, refreshToken) => {
        const payload = jwtDecode<TokenPayload>(accessToken);
        set({ accessToken, refreshToken, user: payload, isAuthenticated: true });
      },

      logout: () => set({
        accessToken: null, refreshToken: null, user: null, isAuthenticated: false
      }),

      isTokenExpired: () => {
        const { user } = get();
        return !user || Date.now() >= user.exp * 1000;
      },

      hasScope: (scope) => {
        const { user } = get();
        return user?.scopes.includes(scope) || user?.scopes.includes('*') || false;
      },

      hasRole: (role) => get().user?.role === role,
    }),
    { name: 'auth-storage' }
  )
);
```

### API Client with Auto-Refresh

```typescript
class ApiClient {
  private refreshPromise: Promise<void> | null = null;

  async fetch<T>(path: string, options: RequestInit = {}): Promise<T> {
    const { accessToken, isTokenExpired } = useAuthStore.getState();

    if (accessToken && isTokenExpired()) {
      await this.refreshToken();
    }

    const response = await this.makeRequest(path, options);

    if (response.status === 401) {
      await this.refreshToken();
      return this.makeRequest(path, options).then(r => r.json());
    }

    return response.json();
  }

  private async refreshToken(): Promise<void> {
    if (this.refreshPromise) return this.refreshPromise;

    const { refreshToken, setTokens, logout } = useAuthStore.getState();
    if (!refreshToken) { logout(); throw new Error('No refresh token'); }

    this.refreshPromise = (async () => {
      try {
        const response = await fetch(`${API_URL}/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refresh_token: refreshToken }),
        });
        if (!response.ok) { logout(); throw new Error('Refresh failed'); }
        const data = await response.json();
        setTokens(data.access_token, data.refresh_token);
      } finally {
        this.refreshPromise = null;
      }
    })();

    return this.refreshPromise;
  }
}
```

### Protected Route (React)

```tsx
function ProtectedRoute({ children, requiredRole, requiredScope }: Props) {
  const { isAuthenticated, hasRole, hasScope } = useAuthStore();

  if (!isAuthenticated) return <Navigate to="/login" />;
  if (requiredRole && !hasRole(requiredRole)) return <Navigate to="/unauthorized" />;
  if (requiredScope && !hasScope(requiredScope)) return <Navigate to="/unauthorized" />;

  return <>{children}</>;
}
```

## Database Schema

```sql
CREATE TABLE roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL UNIQUE,
    scopes TEXT[] NOT NULL DEFAULT '{}'
);

INSERT INTO roles (name, scopes) VALUES
('viewer', ARRAY['items:read', 'dashboard:read']),
('operator', ARRAY['items:read', 'items:write', 'alerts:acknowledge']),
('admin', ARRAY['*']);

CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    email TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role_id UUID NOT NULL REFERENCES roles(id),
    active BOOLEAN DEFAULT true,
    UNIQUE(tenant_id, email)
);
```

## Security Best Practices

1. **Short access tokens**: 15 minutes max
2. **Longer refresh tokens**: 7 days for UX
3. **Token revocation**: Store refresh token IDs in Redis
4. **Rate limit auth endpoints**: 5 attempts/minute
5. **Password hashing**: bcrypt with cost >= 12
6. **Secure storage**: HttpOnly cookies for refresh, memory for access
7. **Rotate on refresh**: Issue new refresh token on each use

## Related Skills

- `fastapi`: Python auth integration
- `chi-router`: Go auth middleware
- `redis-cache`: Token blacklist storage
- `zod-validation`: Token payload validation
