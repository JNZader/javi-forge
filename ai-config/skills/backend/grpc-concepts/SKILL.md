---
name: grpc-concepts
description: >
  gRPC concepts. Protocol Buffers, service definitions, streaming, error handling.
  Trigger: gRPC, protobuf, Protocol Buffers, RPC, streaming, service definition
tools:
  - Read
  - Write
  - Edit
  - Grep
metadata:
  author: apigen-team
  version: "1.0"
  tags: [grpc, protobuf, rpc, microservices]
  scope: ["**/grpc/**"]
---

# gRPC Concepts

## What is gRPC?

```
gRPC = Google Remote Procedure Call

Features:
- Binary protocol (Protocol Buffers)
- HTTP/2 transport
- Bi-directional streaming
- Language agnostic
- Strong typing

Use cases:
- Microservices communication
- Real-time data streaming
- Mobile-backend communication
- IoT device communication
```

## Protocol Buffers (Protobuf)

### Message Definition
```protobuf
syntax = "proto3";

package com.example.user;

option java_package = "com.example.user.proto";
option java_multiple_files = true;

message User {
  string id = 1;
  string email = 2;
  string name = 3;
  UserStatus status = 4;
  google.protobuf.Timestamp created_at = 5;
  repeated Role roles = 6;
  optional string phone = 7;  // proto3 optional
}

enum UserStatus {
  USER_STATUS_UNSPECIFIED = 0;
  USER_STATUS_ACTIVE = 1;
  USER_STATUS_INACTIVE = 2;
  USER_STATUS_SUSPENDED = 3;
}

message Role {
  string id = 1;
  string name = 2;
}
```

### Field Numbers
```
Rules:
- 1-15: Single byte encoding (use for frequent fields)
- 16-2047: Two byte encoding
- 19000-19999: Reserved by protobuf
- Once assigned, never change

Best practices:
- Reserve removed field numbers
- Document field number allocations
```

## Service Definition

```protobuf
service UserService {
  // Unary RPC
  rpc GetUser(GetUserRequest) returns (User);

  // Server streaming
  rpc ListUsers(ListUsersRequest) returns (stream User);

  // Client streaming
  rpc CreateUsers(stream CreateUserRequest) returns (BatchCreateResponse);

  // Bi-directional streaming
  rpc Chat(stream ChatMessage) returns (stream ChatMessage);
}

message GetUserRequest {
  string user_id = 1;
}

message ListUsersRequest {
  int32 page_size = 1;
  string page_token = 2;
  UserFilter filter = 3;
}

message UserFilter {
  optional UserStatus status = 1;
  optional string email_contains = 2;
}
```

## RPC Types

### Unary RPC
```
Client sends single request, server returns single response

Client ──request──> Server
Client <──response── Server

Use for: CRUD operations, simple queries
```

### Server Streaming
```
Client sends single request, server returns stream of responses

Client ──request──> Server
Client <──response1── Server
Client <──response2── Server
Client <──response3── Server

Use for: Large result sets, real-time updates
```

### Client Streaming
```
Client sends stream of requests, server returns single response

Client ──request1──> Server
Client ──request2──>
Client ──request3──>
Client <──response── Server

Use for: File uploads, batch operations
```

### Bi-directional Streaming
```
Both client and server send streams

Client ──request1──> Server
Client <──response1──
Client ──request2──>
Client <──response2──

Use for: Chat, real-time collaboration
```

## Error Handling

### Status Codes
```
OK (0): Success
CANCELLED (1): Operation cancelled
UNKNOWN (2): Unknown error
INVALID_ARGUMENT (3): Client error
DEADLINE_EXCEEDED (4): Timeout
NOT_FOUND (5): Resource not found
ALREADY_EXISTS (6): Duplicate
PERMISSION_DENIED (7): Authorization failed
UNAUTHENTICATED (16): Authentication required
RESOURCE_EXHAUSTED (8): Rate limited
FAILED_PRECONDITION (9): State conflict
ABORTED (10): Concurrency conflict
OUT_OF_RANGE (11): Invalid range
UNIMPLEMENTED (12): Not implemented
INTERNAL (13): Server error
UNAVAILABLE (14): Service unavailable
DATA_LOSS (15): Unrecoverable data loss
```

### Rich Error Details
```protobuf
import "google/rpc/error_details.proto";

// Error with field violations
google.rpc.BadRequest bad_request = {
  field_violations: [
    {field: "email", description: "Invalid email format"},
    {field: "password", description: "Too short"}
  ]
};

// Error with retry info
google.rpc.RetryInfo retry_info = {
  retry_delay: {seconds: 30}
};
```

## Metadata

```
Headers sent with requests:

Standard metadata:
- :authority (host)
- :path (method)
- content-type
- user-agent
- grpc-timeout

Custom metadata:
- authorization: Bearer token
- x-request-id: correlation ID
- x-tenant-id: multi-tenancy
```

## Interceptors

```
Client-side:
1. Add authentication token
2. Log request/response
3. Handle errors
4. Add tracing context

Server-side:
1. Validate authentication
2. Rate limiting
3. Log request/response
4. Extract tracing context
```

## Best Practices

```
Proto design:
✅ Use descriptive field names
✅ Reserve deprecated field numbers
✅ Use well-known types (Timestamp, Duration)
✅ Define enums with UNSPECIFIED = 0
✅ Use optional for nullable fields

Performance:
✅ Reuse channels/stubs
✅ Use streaming for large data
✅ Set appropriate deadlines
✅ Enable compression

Versioning:
✅ Add fields (backward compatible)
❌ Remove/rename fields
❌ Change field types
❌ Change field numbers
```

## gRPC vs REST

```
| Aspect | gRPC | REST |
|--------|------|------|
| Protocol | HTTP/2 | HTTP/1.1 or 2 |
| Format | Binary (Protobuf) | Text (JSON) |
| Contract | Strong (.proto) | Weak (OpenAPI) |
| Streaming | Native | Limited |
| Browser | Needs grpc-web | Native |
| Tools | Limited | Extensive |
```

## Related Skills

- `grpc-spring`: Spring Boot gRPC implementation
- `apigen-architecture`: Overall system architecture


