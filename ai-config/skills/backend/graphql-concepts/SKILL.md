---
name: graphql-concepts
description: >
  GraphQL concepts. Schema design, queries, mutations, subscriptions, best practices.
  Trigger: GraphQL, schema, query, mutation, subscription, resolver
tools:
  - Read
  - Write
  - Edit
  - Grep
metadata:
  author: apigen-team
  version: "1.0"
  tags: [graphql, api, schema, queries]
  scope: ["**/graphql/**"]
---

# GraphQL Concepts

## Core Concepts

### Schema Definition Language (SDL)
```graphql
# Types
type User {
  id: ID!
  email: String!
  name: String
  posts: [Post!]!
  createdAt: DateTime!
}

type Post {
  id: ID!
  title: String!
  content: String!
  author: User!
  comments: [Comment!]!
  status: PostStatus!
}

# Enums
enum PostStatus {
  DRAFT
  PUBLISHED
  ARCHIVED
}

# Input types
input CreateUserInput {
  email: String!
  name: String
  password: String!
}

# Root types
type Query {
  user(id: ID!): User
  users(page: Int, size: Int): UserConnection!
  post(id: ID!): Post
}

type Mutation {
  createUser(input: CreateUserInput!): User!
  updateUser(id: ID!, input: UpdateUserInput!): User!
  deleteUser(id: ID!): Boolean!
}

type Subscription {
  postCreated: Post!
  commentAdded(postId: ID!): Comment!
}
```

### Type System
```
Scalar Types:
- ID: Unique identifier
- String: UTF-8 text
- Int: 32-bit integer
- Float: Double-precision float
- Boolean: true/false

Custom Scalars:
- DateTime: ISO 8601 timestamp
- JSON: Arbitrary JSON
- UUID: UUID string
- URL: Valid URL

Modifiers:
- !: Non-nullable
- []: List
- [!]!: Non-null list of non-null items
```

## Queries

### Basic Query
```graphql
query GetUser {
  user(id: "123") {
    id
    name
    email
  }
}
```

### Nested Query
```graphql
query GetUserWithPosts {
  user(id: "123") {
    id
    name
    posts {
      id
      title
      comments {
        id
        content
      }
    }
  }
}
```

### Variables
```graphql
query GetUser($userId: ID!) {
  user(id: $userId) {
    id
    name
  }
}

# Variables:
{
  "userId": "123"
}
```

### Fragments
```graphql
fragment UserFields on User {
  id
  name
  email
}

query GetUsers {
  user1: user(id: "1") {
    ...UserFields
  }
  user2: user(id: "2") {
    ...UserFields
  }
}
```

## Mutations

```graphql
mutation CreateUser($input: CreateUserInput!) {
  createUser(input: $input) {
    id
    email
    name
  }
}

# Variables:
{
  "input": {
    "email": "john@example.com",
    "name": "John Doe",
    "password": "SecurePass123"
  }
}
```

## Subscriptions

```graphql
subscription OnPostCreated {
  postCreated {
    id
    title
    author {
      name
    }
  }
}
```

## Pagination

### Cursor-based (Relay Connection Spec)
```graphql
type UserConnection {
  edges: [UserEdge!]!
  pageInfo: PageInfo!
  totalCount: Int!
}

type UserEdge {
  cursor: String!
  node: User!
}

type PageInfo {
  hasNextPage: Boolean!
  hasPreviousPage: Boolean!
  startCursor: String
  endCursor: String
}

# Query
query GetUsers($first: Int, $after: String) {
  users(first: $first, after: $after) {
    edges {
      cursor
      node {
        id
        name
      }
    }
    pageInfo {
      hasNextPage
      endCursor
    }
  }
}
```

### Offset-based
```graphql
type UserPage {
  content: [User!]!
  page: Int!
  size: Int!
  totalElements: Int!
  totalPages: Int!
}

query GetUsers($page: Int!, $size: Int!) {
  users(page: $page, size: $size) {
    content {
      id
      name
    }
    totalPages
  }
}
```

## Error Handling

```graphql
# Union approach
union CreateUserResult = User | ValidationError | ConflictError

type ValidationError {
  field: String!
  message: String!
}

type ConflictError {
  message: String!
  existingId: ID!
}

# Query
mutation CreateUser($input: CreateUserInput!) {
  createUser(input: $input) {
    ... on User {
      id
      email
    }
    ... on ValidationError {
      field
      message
    }
    ... on ConflictError {
      message
    }
  }
}
```

## N+1 Problem

```
Problem:
1. Query users (1 query)
2. For each user, query posts (N queries)
Total: N+1 queries

Solutions:
1. DataLoader - Batch and cache
2. Join fetching - Eager load
3. Look-ahead - Analyze query, optimize
```

## Security Considerations

```
Query depth limiting:
- Prevent deeply nested queries
- Set max depth (e.g., 10)

Query complexity:
- Assign costs to fields
- Limit total complexity

Rate limiting:
- Per query/mutation
- Per operation complexity

Field authorization:
- Per-field access control
- Role-based visibility
```

## Best Practices

```
Schema Design:
✅ Use non-null (!) where appropriate
✅ Consistent naming (camelCase)
✅ Avoid generic "data" fields
✅ Use enums for fixed values
✅ Input types for mutations

Performance:
✅ Use DataLoader for batching
✅ Implement pagination
✅ Limit query depth/complexity
✅ Cache resolved data

Security:
✅ Validate input
✅ Authorize at resolver level
✅ Limit query complexity
✅ Disable introspection in production
```

## Related Skills

- `graphql-spring`: Spring Boot GraphQL implementation
- `apigen-architecture`: Overall system architecture


