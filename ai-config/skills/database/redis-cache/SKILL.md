---
name: redis-cache
description: >
  Redis caching, sessions, pub/sub, rate limiting, and distributed locks.
  Trigger: redis, cache, session, pub/sub, rate limiting, distributed lock

tools:
  - Read
  - Write
  - Bash
  - Grep

metadata:
  author: plataforma-industrial
  version: "2.0"
  tags: [cache, redis, real-time, session]
  updated: "2026-02"
---

# Redis Cache & Real-time

> Caching, sessions, pub/sub, rate limiting, and distributed locks with Redis.

## Stack

```yaml
Redis: 7.2+
go-redis/redis: v9
ioredis (Node): 5.3+
redis-py: 5.0+
```

## When to Use

- Caching frequently accessed data with TTL
- Session management with expiration
- Real-time pub/sub between services
- Rate limiting API endpoints
- Distributed locks for coordination

## Docker Setup

```yaml
# docker-compose.yml
services:
  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data
      - ./config/redis.conf:/usr/local/etc/redis/redis.conf
    command: redis-server /usr/local/etc/redis/redis.conf
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 5
```

### Redis Config

```conf
# redis.conf
maxmemory 256mb
maxmemory-policy allkeys-lru
save 900 1
save 300 10
save 60 10000
appendonly yes
appendfsync everysec
# requirepass your-strong-password  # Production
```

## Go Connection

```go
package cache

import (
    "context"
    "time"
    "github.com/redis/go-redis/v9"
)

type RedisClient struct {
    client *redis.Client
}

func NewRedisClient(addr, password string, db int) (*RedisClient, error) {
    client := redis.NewClient(&redis.Options{
        Addr:         addr,
        Password:     password,
        DB:           db,
        PoolSize:     100,
        MinIdleConns: 10,
        MaxRetries:   3,
        DialTimeout:  5 * time.Second,
        ReadTimeout:  3 * time.Second,
        WriteTimeout: 3 * time.Second,
    })

    ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
    defer cancel()

    if err := client.Ping(ctx).Err(); err != nil {
        return nil, err
    }
    return &RedisClient{client: client}, nil
}
```

## Cache-Aside Pattern

```go
func (c *Cache) GetOrLoad(ctx context.Context, key string, loader func() (any, error)) (any, error) {
    // Try cache first
    data, err := c.redis.Get(ctx, key).Bytes()
    if err == nil {
        var result any
        json.Unmarshal(data, &result)
        return result, nil
    }
    if err != redis.Nil {
        return nil, err
    }

    // Cache miss - load from source
    result, err := loader()
    if err != nil {
        return nil, err
    }

    // Store in cache (async)
    go func() {
        ctx, cancel := context.WithTimeout(context.Background(), time.Second)
        defer cancel()
        data, _ := json.Marshal(result)
        c.redis.Set(ctx, key, data, 5*time.Minute)
    }()

    return result, nil
}
```

## Session Management

```go
const sessionTTL = 24 * time.Hour

type Session struct {
    ID        string    `json:"id"`
    UserID    string    `json:"user_id"`
    TenantID  string    `json:"tenant_id"`
    Role      string    `json:"role"`
    ExpiresAt time.Time `json:"expires_at"`
}

func (s *SessionStore) Create(ctx context.Context, userID, tenantID, role string) (*Session, error) {
    session := &Session{
        ID:        uuid.New().String(),
        UserID:    userID,
        TenantID:  tenantID,
        Role:      role,
        ExpiresAt: time.Now().Add(sessionTTL),
    }
    data, _ := json.Marshal(session)

    pipe := s.redis.Pipeline()
    pipe.Set(ctx, "session:"+session.ID, data, sessionTTL)
    pipe.SAdd(ctx, "user:"+userID+":sessions", session.ID)
    pipe.Expire(ctx, "user:"+userID+":sessions", sessionTTL)
    _, err := pipe.Exec(ctx)
    return session, err
}

func (s *SessionStore) DeleteAllForUser(ctx context.Context, userID string) error {
    sessionIDs, _ := s.redis.SMembers(ctx, "user:"+userID+":sessions").Result()
    keys := make([]string, len(sessionIDs)+1)
    for i, id := range sessionIDs {
        keys[i] = "session:" + id
    }
    keys[len(sessionIDs)] = "user:" + userID + ":sessions"
    return s.redis.Del(ctx, keys...).Err()
}
```

## Pub/Sub

```go
// Publisher
func (p *Publisher) Publish(ctx context.Context, channel string, event Event) error {
    data, _ := json.Marshal(event)
    return p.redis.Publish(ctx, channel, data).Err()
}

// Subscriber
func (s *Subscriber) Subscribe(ctx context.Context, channels ...string) error {
    pubsub := s.redis.Subscribe(ctx, channels...)
    defer pubsub.Close()

    for msg := range pubsub.Channel() {
        var event Event
        json.Unmarshal([]byte(msg.Payload), &event)
        for _, handler := range s.handlers[event.Type] {
            handler(ctx, event)
        }
    }
    return nil
}
```

## Rate Limiting (Sliding Window)

```go
func (rl *RateLimiter) Allow(ctx context.Context, key string) (bool, int, error) {
    now := time.Now().UnixMilli()
    windowStart := now - rl.window.Milliseconds()
    redisKey := "ratelimit:" + key

    pipe := rl.redis.Pipeline()
    pipe.ZRemRangeByScore(ctx, redisKey, "0", fmt.Sprintf("%d", windowStart))
    countCmd := pipe.ZCard(ctx, redisKey)
    pipe.ZAdd(ctx, redisKey, redis.Z{Score: float64(now), Member: now})
    pipe.Expire(ctx, redisKey, rl.window)
    pipe.Exec(ctx)

    count := int(countCmd.Val())
    remaining := rl.limit - count - 1
    if remaining < 0 {
        remaining = 0
    }
    return count < rl.limit, remaining, nil
}
```

## Distributed Lock

```go
func NewLock(redis *redis.Client, key string, ttl time.Duration) *DistributedLock {
    return &DistributedLock{
        redis: redis,
        key:   "lock:" + key,
        value: uuid.New().String(),
        ttl:   ttl,
    }
}

func (l *DistributedLock) Acquire(ctx context.Context) error {
    success, _ := l.redis.SetNX(ctx, l.key, l.value, l.ttl).Result()
    if !success {
        return ErrLockNotAcquired
    }
    return nil
}

func (l *DistributedLock) Release(ctx context.Context) error {
    script := redis.NewScript(`
        if redis.call("GET", KEYS[1]) == ARGV[1] then
            return redis.call("DEL", KEYS[1])
        end
        return 0
    `)
    _, err := script.Run(ctx, l.redis, []string{l.key}, l.value).Result()
    return err
}

func WithLock(ctx context.Context, redis *redis.Client, key string, ttl time.Duration, fn func() error) error {
    lock := NewLock(redis, key, ttl)
    if err := lock.Acquire(ctx); err != nil {
        return err
    }
    defer lock.Release(ctx)
    return fn()
}
```

## TypeScript/Node.js

```typescript
import Redis from 'ioredis';

export const redis = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379'),
  password: process.env.REDIS_PASSWORD,
  maxRetriesPerRequest: 3,
});

// Pub/Sub requires separate connections
export const publisher = new Redis(/* config */);
export const subscriber = new Redis(/* config */);
```

## Best Practices

| Practice | Description |
|----------|-------------|
| Always set TTL | Avoid memory issues with `Set(key, val, TTL)` |
| Use pipelines | Single round-trip for batch ops |
| Namespace keys | `tenant:{id}:sensor:{id}` format |
| Handle redis.Nil | Not an error, just cache miss |
| Separate pub/sub conn | Pub/sub blocks, use dedicated client |

### Data Structure Selection

```
String    - Simple cache, counters
Hash      - Objects with multiple fields
List      - Queues, recent items
Set       - Tags, unique items
Sorted Set - Leaderboards, time-series
Stream    - Event logs, message queues
```

## Quick Reference

| Task | Command |
|------|---------|
| Set with TTL | `SET key value EX 300` |
| Get | `GET key` |
| Delete | `DEL key1 key2` |
| Publish | `PUBLISH channel message` |
| Rate limit check | `ZRANGEBYSCORE + ZADD` |

## Resources

- [Redis Documentation](https://redis.io/docs/)
- [go-redis Guide](https://redis.uptrace.dev/)
- [ioredis Documentation](https://github.com/redis/ioredis)

---

## Changelog

- **2.0** - Condensed from Plataforma Industrial SKILL-REDIS

## Related Skills

- `timescaledb`: Database caching layer
- `pgx-postgres`: Query result caching
- `chi-router`: Go cache middleware
- `fastapi`: Python cache patterns
