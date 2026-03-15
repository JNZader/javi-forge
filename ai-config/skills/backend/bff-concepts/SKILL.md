---
name: bff-concepts
description: >
  Backend for Frontend pattern. Client-specific APIs, response tailoring, aggregation.
  Trigger: BFF, backend for frontend, aggregation, client-specific, mobile API
tools:
  - Read
  - Write
  - Edit
  - Grep
metadata:
  author: apigen-team
  version: "1.0"
  tags: [bff, architecture, api-design, microservices]
  scope: ["**/bff/**"]
---

# Backend for Frontend (BFF) Pattern

## Core Concept

```
Traditional API:
┌─────────────────────────────────────────┐
│         Single Generic API              │
│  (serves Web, Mobile, TV, Partners)     │
└─────────────────────────────────────────┘
         ↓         ↓         ↓
      [Web]    [Mobile]    [TV]
   (over-fetching + under-fetching)

BFF Pattern:
┌───────────┐ ┌───────────┐ ┌───────────┐
│  Web BFF  │ │Mobile BFF │ │  TV BFF   │
└─────┬─────┘ └─────┬─────┘ └─────┬─────┘
      ↓             ↓             ↓
┌─────────────────────────────────────────┐
│         Backend Microservices           │
└─────────────────────────────────────────┘
```

## Client Types

### Web BFF
```
Characteristics:
- Full data payloads (fast connections)
- Rich interaction capabilities
- SEO requirements (SSR data)
- Complex filtering/sorting UI

Typical operations:
- Large paginated lists
- Real-time updates (WebSocket)
- Complex search queries
- File uploads
```

### Mobile BFF
```
Characteristics:
- Bandwidth optimization
- Battery conservation
- Offline support (sync)
- Push notifications

Optimizations:
- Compressed responses
- Delta sync (only changes)
- Image CDN URLs (different sizes)
- Aggressive caching headers
```

### IoT / Embedded BFF
```
Characteristics:
- Minimal payloads
- Low memory footprint
- Binary protocols (gRPC/MQTT)
- Intermittent connectivity

Patterns:
- Batch operations
- Store-and-forward
- Heartbeat polling
```

## Response Tailoring

### Field Selection
```json
// Web: Full response
{
  "user": {
    "id": "123",
    "name": "John Doe",
    "email": "john@example.com",
    "avatar": "https://...",
    "bio": "...",
    "preferences": {...},
    "stats": {...}
  }
}

// Mobile: Tailored response
{
  "user": {
    "id": "123",
    "name": "John Doe",
    "avatar_thumb": "https://.../48x48"
  }
}
```

### Aggregation Strategies
```
Sequential:
1. Get user profile
2. Get user's orders
3. Get recommendations
4. Combine and return

Parallel:
1. Fork: [profile, orders, recommendations]
2. Join: Combine results
3. Return aggregated response

Conditional:
1. Get user profile
2. IF premium user THEN get recommendations
3. Return appropriate response
```

## Rate Limiting per Client

```
Web clients:
- 1000 req/min (authenticated)
- 100 req/min (anonymous)

Mobile clients:
- 500 req/min (aggressive caching expected)

Partner APIs:
- Per-contract limits
- Separate quotas per partner
```

## Query Composition

### GraphQL-like Behavior
```
Request:
GET /bff/dashboard?include=profile,notifications,orders

Response:
{
  "profile": {...},
  "notifications": [...],
  "orders": [...]
}

Backend calls:
- GET /users/me → profile
- GET /notifications?limit=5 → notifications
- GET /orders?status=pending → orders
```

### Partial Failure Handling
```json
{
  "profile": {...},
  "notifications": {
    "_error": "Service temporarily unavailable",
    "_fallback": []
  },
  "orders": [...]
}
```

## Caching Strategies

```
Per-client-type:
- Web: 5 min cache, ETags
- Mobile: 30 min cache, stale-while-revalidate
- IoT: 1 hour cache

Per-resource:
- User profile: 5 min
- Product catalog: 1 hour
- Recommendations: 15 min
```

## Implementation Patterns

### Request/Response DTOs
```
// Client-specific DTOs
WebUserResponse:
  - All fields
  - Nested objects
  - Full links

MobileUserResponse:
  - Essential fields only
  - IDs instead of nested objects
  - Thumbnail URLs
```

### Service Orchestration
```
BFF Controller:
1. Parse client context (User-Agent, Accept)
2. Determine required data
3. Call services (parallel when possible)
4. Apply transformations
5. Return tailored response
```

## Anti-patterns to Avoid

```
❌ Business logic in BFF
   → BFF should only orchestrate and transform

❌ Direct database access
   → Always go through services

❌ Shared BFF for different clients
   → Each client type needs its own BFF

❌ Duplicating validation
   → Let backend services handle validation
```

## Related Skills

- `bff-spring`: Spring Boot BFF implementation
