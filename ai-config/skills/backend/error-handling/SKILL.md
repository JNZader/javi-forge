---
name: error-handling
description: >
  API error handling patterns. RFC 7807 Problem Details, error codes, client handling.
  Trigger: error handling, exceptions, problem details, RFC 7807, error response
tools:
  - Read
  - Write
  - Edit
  - Grep
metadata:
  author: apigen-team
  version: "1.0"
  tags: [errors, exceptions, api-design, standards]
  scope: ["**/exceptions/**", "**/error/**"]
---

# Error Handling Concepts

## RFC 7807 Problem Details

```json
{
  "type": "https://api.example.com/errors/validation",
  "title": "Validation Error",
  "status": 400,
  "detail": "The request contains invalid data",
  "instance": "/api/users/123",
  "errors": [
    {
      "field": "email",
      "message": "Invalid email format"
    }
  ]
}
```

### Required Fields
```
type: URI identifying the error type (documentation link)
title: Human-readable summary (stable, not localized)
status: HTTP status code
```

### Optional Fields
```
detail: Human-readable explanation (may vary per occurrence)
instance: URI identifying the specific occurrence
<extensions>: Custom fields for additional context
```

## Error Categorization

### Client Errors (4xx)
```
400 Bad Request
- Malformed syntax
- Invalid field values
- Missing required fields

401 Unauthorized
- Missing authentication
- Expired token
- Invalid credentials

403 Forbidden
- Valid auth but insufficient permissions
- Resource access denied
- Rate limit exceeded (also 429)

404 Not Found
- Resource doesn't exist
- Endpoint not found
- Soft-deleted resource

409 Conflict
- Duplicate resource
- Optimistic locking failure
- State conflict

422 Unprocessable Entity
- Semantic errors
- Business rule violations
- Validation errors (alternative to 400)
```

### Server Errors (5xx)
```
500 Internal Server Error
- Unexpected exceptions
- Programming errors
- Configuration issues

502 Bad Gateway
- Upstream service failure
- Invalid upstream response

503 Service Unavailable
- Maintenance mode
- Overloaded
- Circuit breaker open

504 Gateway Timeout
- Upstream timeout
- Slow dependency
```

## Error Code System

```
Format: DOMAIN-CATEGORY-NUMBER

Examples:
AUTH-TOKEN-001: Token expired
AUTH-TOKEN-002: Token invalid
AUTH-TOKEN-003: Token revoked

USER-VAL-001: Email already exists
USER-VAL-002: Password too weak
USER-VAL-003: Invalid phone format

ORDER-BIZ-001: Insufficient inventory
ORDER-BIZ-002: Shipping address invalid
ORDER-BIZ-003: Payment declined
```

## Error Response Patterns

### Validation Errors
```json
{
  "type": "https://api.example.com/errors/validation",
  "title": "Validation Failed",
  "status": 400,
  "detail": "2 validation errors occurred",
  "errors": [
    {
      "field": "email",
      "code": "USER-VAL-001",
      "message": "Email is already registered",
      "rejectedValue": "test@example.com"
    },
    {
      "field": "password",
      "code": "USER-VAL-002",
      "message": "Password must be at least 8 characters",
      "rejectedValue": null
    }
  ]
}
```

### Business Logic Errors
```json
{
  "type": "https://api.example.com/errors/business",
  "title": "Business Rule Violation",
  "status": 422,
  "detail": "Cannot complete order",
  "code": "ORDER-BIZ-001",
  "context": {
    "requiredStock": 10,
    "availableStock": 3,
    "productId": "PROD-123"
  }
}
```

### Authentication Errors
```json
{
  "type": "https://api.example.com/errors/authentication",
  "title": "Authentication Failed",
  "status": 401,
  "detail": "Token has expired",
  "code": "AUTH-TOKEN-001",
  "expiredAt": "2024-01-15T10:30:00Z",
  "refreshable": true
}
```

## Client Error Handling

### Retry Strategy
```
Retryable errors:
- 429 Too Many Requests (with backoff)
- 500 Internal Server Error (limited)
- 502 Bad Gateway
- 503 Service Unavailable
- 504 Gateway Timeout

Non-retryable:
- 400 Bad Request
- 401 Unauthorized
- 403 Forbidden
- 404 Not Found
- 409 Conflict
- 422 Unprocessable Entity
```

### Exponential Backoff
```
Attempt 1: Wait 1 second
Attempt 2: Wait 2 seconds
Attempt 3: Wait 4 seconds
Attempt 4: Wait 8 seconds
...with jitter to prevent thundering herd
```

## Logging Strategy

```
Log levels by error type:

ERROR (investigate immediately):
- 500 Internal Server Error
- Unhandled exceptions
- Data corruption

WARN (monitor trends):
- 401/403 authentication failures
- 409 conflicts
- Circuit breaker trips

INFO (normal operations):
- 400/422 validation errors
- 404 not found
- Rate limiting

DEBUG (troubleshooting):
- Full request/response
- Stack traces
- Context details
```

## Security Considerations

```
Never expose:
- Stack traces to clients
- Internal paths or class names
- Database error details
- System configuration

Always:
- Use generic messages for auth errors
- Log full details server-side
- Correlate with request ID
- Rate limit error responses
```

## Related Skills

- `exceptions-spring`: Spring Boot exception handling
