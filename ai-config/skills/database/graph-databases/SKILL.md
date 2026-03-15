---
name: graph-databases
description: >
  Graph database concepts. Nodes, relationships, traversals, Cypher/Gremlin queries.
  Trigger: graph database, Neo4j, Neptune, ArangoDB, nodes, relationships, Cypher
tools:
  - Read
  - Write
  - Edit
  - Grep
metadata:
  author: apigen-team
  version: "1.0"
  tags: [graph, database, neo4j, neptune]
  scope: ["**/graph/**"]
---

# Graph Database Concepts

## Core Concepts

```
Nodes: Entities (vertices)
- User, Product, Order
- Have properties (key-value)
- Have labels (types)

Relationships: Connections (edges)
- FOLLOWS, PURCHASED, KNOWS
- Have direction (or bidirectional)
- Have properties (weight, timestamp)

Properties: Key-value attributes
- On nodes: name, email, created_at
- On relationships: since, strength, role
```

## When to Use Graph Databases

```
Good fit:
✅ Social networks (friends, followers)
✅ Recommendation engines
✅ Fraud detection (pattern matching)
✅ Knowledge graphs
✅ Network topology
✅ Access control (who can see what)

Poor fit:
❌ Simple CRUD operations
❌ High-volume transactions
❌ Full-text search (use Elasticsearch)
❌ Time-series data
❌ Large binary storage
```

## Graph vs Relational

```
Relational (SQL):
┌─────────┐      ┌────────────────┐      ┌─────────┐
│ users   │──────│ friendships    │──────│ users   │
│ id=1    │      │ user_id=1      │      │ id=2    │
│ name=A  │      │ friend_id=2    │      │ name=B  │
└─────────┘      └────────────────┘      └─────────┘

Graph:
   ┌──────────┐  FOLLOWS   ┌──────────┐
   │  (User)  │───────────▶│  (User)  │
   │ name: A  │            │ name: B  │
   └──────────┘            └──────────┘

SQL for "friends of friends":
SELECT DISTINCT u3.name FROM users u1
JOIN friendships f1 ON u1.id = f1.user_id
JOIN friendships f2 ON f1.friend_id = f2.user_id
JOIN users u3 ON f2.friend_id = u3.id
WHERE u1.id = 1 AND u3.id != 1
-- Becomes complex for N levels

Cypher (Neo4j):
MATCH (u:User {id: 1})-[:FOLLOWS*2]->(fof:User)
WHERE fof <> u
RETURN DISTINCT fof.name
-- Same query, any depth with *N
```

## Cypher Query Language (Neo4j)

### Basic Patterns
```cypher
// Create nodes
CREATE (u:User {name: 'Alice', email: 'alice@example.com'})

// Create relationship
MATCH (a:User {name: 'Alice'}), (b:User {name: 'Bob'})
CREATE (a)-[:FOLLOWS {since: date()}]->(b)

// Find nodes
MATCH (u:User {name: 'Alice'})
RETURN u

// Find relationships
MATCH (a:User)-[r:FOLLOWS]->(b:User)
RETURN a.name, r.since, b.name

// Traversal
MATCH (u:User {name: 'Alice'})-[:FOLLOWS*1..3]->(friend)
RETURN DISTINCT friend.name
```

### Advanced Queries
```cypher
// Shortest path
MATCH path = shortestPath(
  (a:User {name: 'Alice'})-[:FOLLOWS*]-(b:User {name: 'Zara'})
)
RETURN path

// Aggregation
MATCH (u:User)-[:FOLLOWS]->(follower)
RETURN u.name, count(follower) AS followers
ORDER BY followers DESC
LIMIT 10

// Pattern matching (fraud detection)
MATCH (a:Account)-[:TRANSFER]->(b:Account)-[:TRANSFER]->(c:Account)-[:TRANSFER]->(a)
WHERE a.suspicious = true
RETURN a, b, c
```

## Gremlin Query Language (Neptune, JanusGraph)

```groovy
// Create vertex
g.addV('User').property('name', 'Alice')

// Create edge
g.V().has('User', 'name', 'Alice')
  .addE('FOLLOWS').to(g.V().has('User', 'name', 'Bob'))

// Traversal
g.V().has('User', 'name', 'Alice')
  .out('FOLLOWS')
  .out('FOLLOWS')
  .dedup()
  .values('name')

// Shortest path
g.V().has('User', 'name', 'Alice')
  .repeat(out('FOLLOWS').simplePath())
  .until(has('User', 'name', 'Zara'))
  .path()
  .limit(1)
```

## Data Modeling Patterns

### Social Network
```
(:User)-[:FOLLOWS]->(:User)
(:User)-[:POSTED]->(:Post)
(:User)-[:LIKES]->(:Post)
(:Post)-[:TAGGED]->(:Topic)
```

### E-commerce Recommendations
```
(:Customer)-[:PURCHASED]->(:Product)
(:Product)-[:IN_CATEGORY]->(:Category)
(:Customer)-[:VIEWED]->(:Product)
(:Product)-[:SIMILAR_TO]->(:Product)
```

### Access Control
```
(:User)-[:MEMBER_OF]->(:Group)
(:Group)-[:HAS_ROLE]->(:Role)
(:Role)-[:CAN_ACCESS]->(:Resource)
```

## Performance Considerations

```
Indexing:
- Index frequently queried properties
- Composite indexes for common patterns
- Full-text indexes for search

Query optimization:
- Start traversals from selective nodes
- Limit traversal depth
- Use PROFILE to analyze queries

Cardinality:
- Avoid super nodes (millions of edges)
- Consider edge partitioning
- Use intermediate nodes for many-to-many
```

## Graph Database Comparison

```
| Feature | Neo4j | Neptune | ArangoDB |
|---------|-------|---------|----------|
| Query | Cypher | Gremlin | AQL |
| Model | LPG | LPG/RDF | Multi-model |
| Scaling | Read replicas | Auto-scaling | Sharding |
| Hosting | Self/Cloud | AWS only | Self/Cloud |
| ACID | Yes | Yes | Yes |
```

## Related Skills

- `graph-spring`: Spring Boot graph implementation
- `apigen-architecture`: Overall system architecture


