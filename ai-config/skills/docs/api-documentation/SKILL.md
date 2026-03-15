---
name: api-documentation
description: >
  API documentation concepts. OpenAPI/Swagger, interactive docs, versioning, examples.
  Trigger: API docs, OpenAPI, Swagger, Redoc, documentation, API reference
tools:
  - Read
  - Write
  - Edit
  - Grep
metadata:
  author: apigen-team
  version: "1.0"
  tags: [documentation, openapi, swagger, api]
  scope: ["**/docs/**"]
---

# API Documentation Concepts

## OpenAPI Specification (OAS)

### Structure
```yaml
openapi: 3.1.0
info:
  title: My API
  version: 1.0.0
  description: API description with **markdown** support

servers:
  - url: https://api.example.com/v1
    description: Production
  - url: https://staging-api.example.com/v1
    description: Staging

paths:
  /users:
    get:
      summary: List users
      operationId: listUsers
      tags: [Users]
      parameters:
        - name: page
          in: query
          schema:
            type: integer
            default: 1
      responses:
        '200':
          description: Successful response
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/UserList'

components:
  schemas:
    User:
      type: object
      required: [id, email]
      properties:
        id:
          type: string
          format: uuid
        email:
          type: string
          format: email
```

### Key Elements
```
Info: API metadata, contact, license
Servers: Base URLs for environments
Paths: Endpoints and operations
Components: Reusable schemas, parameters, responses
Tags: Logical grouping of operations
Security: Authentication schemes
```

## Documentation Tools

### Swagger UI
```
Features:
- Interactive API explorer
- Try it out functionality
- Authorization support
- Request/response examples

Best for:
- Developer testing
- Internal documentation
- Quick prototyping
```

### Redoc
```
Features:
- Clean, professional look
- Three-panel layout
- Search functionality
- No interactivity (reference only)

Best for:
- Public API documentation
- Customer-facing docs
- Embedded in websites
```

### Stoplight
```
Features:
- Design-first approach
- Mock servers
- Style guides
- Git integration

Best for:
- API design
- Enterprise documentation
- Team collaboration
```

## Documentation Best Practices

### Descriptions
```yaml
# Good: Explains purpose and context
description: |
  Retrieves a paginated list of users in the organization.
  Results are sorted by creation date, newest first.

  **Note:** Requires `users:read` permission.

# Bad: States the obvious
description: Gets users
```

### Examples
```yaml
# Provide realistic examples
schema:
  type: object
  properties:
    email:
      type: string
      format: email
      example: john.doe@example.com
    createdAt:
      type: string
      format: date-time
      example: "2024-01-15T10:30:00Z"

# Multiple examples for different scenarios
examples:
  admin:
    summary: Admin user
    value:
      id: "123"
      email: "admin@example.com"
      role: "admin"
  regular:
    summary: Regular user
    value:
      id: "456"
      email: "user@example.com"
      role: "user"
```

### Error Responses
```yaml
responses:
  '400':
    description: Validation error
    content:
      application/problem+json:
        schema:
          $ref: '#/components/schemas/ProblemDetail'
        examples:
          invalidEmail:
            summary: Invalid email format
            value:
              type: "https://api.example.com/errors/validation"
              title: "Validation Error"
              status: 400
              detail: "Invalid email format"
              errors:
                - field: "email"
                  message: "Must be a valid email address"
```

## API Versioning Documentation

### URL Versioning
```yaml
servers:
  - url: https://api.example.com/v1
  - url: https://api.example.com/v2

paths:
  /v1/users:
    deprecated: true
    x-deprecation-date: 2024-06-01
```

### Header Versioning
```yaml
parameters:
  - name: API-Version
    in: header
    required: false
    schema:
      type: string
      default: "2024-01-01"
      enum:
        - "2024-01-01"
        - "2023-06-01"
```

## Authentication Documentation

```yaml
components:
  securitySchemes:
    bearerAuth:
      type: http
      scheme: bearer
      bearerFormat: JWT
      description: |
        JWT token obtained from `/auth/login`.
        Token expires after 1 hour.

    apiKey:
      type: apiKey
      in: header
      name: X-API-Key
      description: |
        API key for server-to-server communication.
        Contact support to obtain a key.

    oauth2:
      type: oauth2
      flows:
        authorizationCode:
          authorizationUrl: https://auth.example.com/authorize
          tokenUrl: https://auth.example.com/token
          scopes:
            users:read: Read user information
            users:write: Create and update users
```

## Changelog & Migration

```markdown
## API Changelog

### v2.0.0 (2024-01-15)
#### Breaking Changes
- `GET /users` now returns paginated response
- `email` field renamed to `emailAddress`

#### New Features
- Added `GET /users/{id}/preferences`
- Added filtering by `status` parameter

### v1.5.0 (2023-12-01)
#### Deprecations
- `GET /users/all` deprecated, use `GET /users` with pagination
```

## Documentation-as-Code

```
Benefits:
- Version controlled
- Review process
- CI/CD integration
- Single source of truth

Workflow:
1. Write OpenAPI spec (YAML/JSON)
2. Review changes via PR
3. Generate docs on merge
4. Deploy to documentation site
5. Generate SDKs from spec
```

## Related Skills

- `docs-spring`: Spring Boot API documentation
- `apigen-architecture`: Overall system architecture


