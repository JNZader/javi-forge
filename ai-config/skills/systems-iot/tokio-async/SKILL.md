---
name: tokio-async
description: >
  Async runtime patterns for Rust with Tokio - spawning, channels, sync primitives.
  Trigger: tokio, async rust, spawn, channels, mpsc, broadcast, mutex, rwlock
tools:
  - Read
  - Write
  - Bash
  - Grep
metadata:
  author: plataforma-industrial
  version: "2.0"
  tags: [rust, async, concurrency, tokio, runtime]
  language: rust
  updated: "2026-02"
---

# Tokio Async Runtime

> Comprehensive async patterns for Rust using Tokio 1.36+

## When to Use

- [ ] Building async Rust applications
- [ ] Implementing concurrent task processing
- [ ] Managing channels for inter-task communication
- [ ] Handling graceful shutdown patterns

## Stack

```toml
[dependencies]
tokio = { version = "1.36", features = ["full"] }
tokio-util = "0.7"
futures = "0.3"
async-trait = "0.1"
tracing = "0.1"
tracing-subscriber = { version = "0.3", features = ["env-filter"] }
```

## Critical Patterns

### Pattern 1: Main Entry Point

```rust
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::registry()
        .with(tracing_subscriber::EnvFilter::new(
            std::env::var("RUST_LOG").unwrap_or_else(|_| "info".into()),
        ))
        .with(tracing_subscriber::fmt::layer())
        .init();

    run().await
}
```

### Pattern 2: Async Trait

```rust
use async_trait::async_trait;

#[async_trait]
pub trait SensorReader: Send + Sync {
    async fn read(&self, address: u16) -> Result<f64>;
    async fn write(&self, address: u16, value: u16) -> Result<()>;
}
```

### Pattern 3: Spawn Blocking for CPU Work

```rust
// ✅ Correct - Move CPU work to blocking pool
let result = tokio::task::spawn_blocking(move || {
    heavy_computation(&data)
}).await?;

// ❌ Incorrect - Blocks the async runtime
let result = heavy_computation(&data);
```

## Channels

### mpsc (Multi-producer, Single-consumer)

```rust
use tokio::sync::mpsc;

#[derive(Debug)]
enum Command {
    Read(String),
    Write(String, f64),
    Shutdown,
}

let (tx, mut rx) = mpsc::channel::<Command>(100);

// Producer
let tx2 = tx.clone();
tokio::spawn(async move {
    tx2.send(Command::Read("sensor-1".into())).await.unwrap();
});

// Consumer
tokio::spawn(async move {
    while let Some(cmd) = rx.recv().await {
        match cmd {
            Command::Read(id) => { /* handle */ }
            Command::Write(id, val) => { /* handle */ }
            Command::Shutdown => break,
        }
    }
});
```

### broadcast (Multi-producer, Multi-consumer)

```rust
use tokio::sync::broadcast;

let (tx, _) = broadcast::channel::<Event>(100);

// Multiple subscribers
let mut rx1 = tx.subscribe();
let mut rx2 = tx.subscribe();

tokio::spawn(async move {
    while let Ok(event) = rx1.recv().await {
        // Handle event
    }
});

// Publisher
tx.send(event).unwrap();
```

### watch (Latest Value)

```rust
use tokio::sync::watch;

let (tx, rx) = watch::channel(initial_value);

// Updater
tx.send_modify(|status| {
    status.online = true;
});

// Reader - always gets latest value
let mut rx2 = rx.clone();
rx2.changed().await.unwrap();
let status = rx2.borrow();
```

## Synchronization

### Mutex & RwLock

```rust
use std::sync::Arc;
use tokio::sync::{Mutex, RwLock};

// Mutex for exclusive access
let cache = Arc::new(Mutex::new(HashMap::new()));
{
    let mut guard = cache.lock().await;
    guard.insert(key, value);
}

// RwLock for many readers, few writers
let config = Arc::new(RwLock::new(Config::default()));
let read_guard = config.read().await;   // Multiple concurrent reads
let write_guard = config.write().await; // Exclusive write
```

### Semaphore (Rate Limiting)

```rust
use tokio::sync::Semaphore;

let semaphore = Arc::new(Semaphore::new(10)); // Max 10 concurrent

for item in items {
    let permit = semaphore.clone().acquire_owned().await?;
    tokio::spawn(async move {
        process(item).await;
        drop(permit); // Release when done
    });
}
```

## Timers

```rust
use tokio::time::{sleep, interval, timeout, Duration};

// Sleep
sleep(Duration::from_secs(5)).await;

// Interval - regular polling
let mut interval = interval(Duration::from_secs(1));
loop {
    interval.tick().await;
    poll_sensors().await;
}

// Timeout - fail if too slow
let result = timeout(Duration::from_secs(5), slow_operation()).await;
match result {
    Ok(Ok(value)) => { /* success */ }
    Ok(Err(e)) => { /* operation error */ }
    Err(_) => { /* timeout */ }
}
```

## Select & Graceful Shutdown

```rust
use tokio::{select, signal};
use tokio::sync::broadcast;

async fn run_with_shutdown() -> Result<()> {
    let (shutdown_tx, _) = broadcast::channel::<()>(1);
    let mut shutdown_rx = shutdown_tx.subscribe();
    let mut interval = tokio::time::interval(Duration::from_secs(1));

    loop {
        select! {
            _ = interval.tick() => {
                // Normal work
                poll_sensors().await;
            }
            _ = shutdown_rx.recv() => {
                tracing::info!("Shutdown signal received");
                break;
            }
            _ = signal::ctrl_c() => {
                let _ = shutdown_tx.send(());
                break;
            }
        }
    }

    Ok(())
}
```

## JoinSet for Multiple Tasks

```rust
use tokio::task::JoinSet;

async fn poll_all(sensors: Vec<Config>) -> Vec<Result<Reading>> {
    let mut set = JoinSet::new();

    for sensor in sensors {
        set.spawn(async move { read_sensor(&sensor).await });
    }

    let mut results = Vec::new();
    while let Some(result) = set.join_next().await {
        match result {
            Ok(reading) => results.push(reading),
            Err(e) => tracing::error!("Task failed: {}", e),
        }
    }
    results
}
```

## Anti-Patterns

### Blocking the Runtime

```rust
// ❌ Never block in async context
let data = std::fs::read("file.txt")?;

// ✅ Use async I/O or spawn_blocking
let data = tokio::fs::read("file.txt").await?;
// Or for sync code:
let data = tokio::task::spawn_blocking(|| std::fs::read("file.txt")).await??;
```

### Missing Timeouts on External I/O

```rust
// ❌ Can hang forever
let result = client.read().await?;

// ✅ Always timeout external calls
let result = timeout(Duration::from_secs(5), client.read()).await??;
```

## Quick Reference

| Task | Pattern |
|------|---------|
| Spawn task | `tokio::spawn(async { ... })` |
| CPU-bound | `spawn_blocking(move \|\| { ... })` |
| mpsc channel | `mpsc::channel::<T>(100)` |
| broadcast | `broadcast::channel::<T>(100)` |
| Mutex | `Mutex::new(data).lock().await` |
| Semaphore | `Semaphore::new(n).acquire().await` |
| Timeout | `timeout(Duration::from_secs(5), fut).await` |
| Interval | `interval(Duration::from_secs(1)).tick().await` |
| Ctrl+C | `tokio::signal::ctrl_c().await` |

## Resources

- [Tokio Documentation](https://tokio.rs)
- [Tokio Tutorial](https://tokio.rs/tokio/tutorial)
- [async-std vs Tokio](https://rust-lang.github.io/async-book/)

## Related Skills

- `rust-systems`: Full Rust patterns
- `websockets`: Async WebSocket handlers
- `mqtt-rumqttc`: Async MQTT client
- `redis-cache`: Async Redis operations
