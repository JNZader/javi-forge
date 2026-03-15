---
name: rust-systems
description: >
  Rust systems programming patterns for edge computing, Modbus, MQTT, and async runtime.
  Trigger: Rust, Tokio, Modbus, MQTT, async Rust, edge computing, embedded Rust, systems programming
tools:
  - Read
  - Write
  - Bash
  - Grep
metadata:
  author: plataforma-industrial
  version: "2.0"
  tags: [rust, tokio, modbus, mqtt, async, systems, edge]
  updated: "2026-02"
---

# Rust Systems Programming

Patterns for building high-performance Rust systems with async runtime.

## Stack

```toml
[workspace.dependencies]
tokio = { version = "1.36", features = ["full"] }
serde = { version = "1.0", features = ["derive"] }
serde_json = "1.0"
thiserror = "1.0"
anyhow = "1.0"
tracing = "0.1"
tracing-subscriber = { version = "0.3", features = ["env-filter", "json"] }
config = "0.14"
tokio-modbus = "0.13"
rumqttc = "0.24"
axum = "0.7"
uuid = { version = "1.7", features = ["v4", "serde"] }
chrono = { version = "0.4", features = ["serde"] }
```

## Project Structure

```
apps/service/
├── Cargo.toml
├── config.yaml
├── src/
│   ├── main.rs
│   ├── lib.rs
│   ├── config.rs
│   ├── error.rs
│   └── domain/
│       └── mod.rs
```

## Error Handling

```rust
use thiserror::Error;

#[derive(Error, Debug)]
pub enum AppError {
    #[error("connection failed: {0}")]
    Connection(#[from] std::io::Error),

    #[error("read failed for {address}: {source}")]
    Read {
        address: u16,
        #[source]
        source: std::io::Error,
    },

    #[error("config error: {0}")]
    Config(#[from] config::ConfigError),

    #[error("serialization error: {0}")]
    Serialization(#[from] serde_json::Error),

    #[error("not found: {0}")]
    NotFound(String),
}

pub type Result<T> = std::result::Result<T, AppError>;
```

## Configuration

```rust
use config::{Config, Environment, File};
use serde::Deserialize;
use std::path::Path;

#[derive(Debug, Deserialize, Clone)]
pub struct AppConfig {
    pub server: ServerConfig,
    pub mqtt: MqttConfig,
    pub logging: LoggingConfig,
}

#[derive(Debug, Deserialize, Clone)]
pub struct ServerConfig {
    pub name: String,
    pub port: u16,
}

#[derive(Debug, Deserialize, Clone)]
pub struct MqttConfig {
    pub host: String,
    pub port: u16,
    pub client_id: String,
    pub topic_prefix: String,
}

impl AppConfig {
    pub fn load<P: AsRef<Path>>(path: P) -> Result<Self, config::ConfigError> {
        Config::builder()
            .set_default("logging.level", "info")?
            .add_source(File::from(path.as_ref()))
            .add_source(
                Environment::with_prefix("APP")
                    .separator("__")
                    .try_parsing(true),
            )
            .build()?
            .try_deserialize()
    }
}
```

## MQTT Publisher

```rust
use rumqttc::{AsyncClient, EventLoop, MqttOptions, QoS};
use serde::Serialize;
use std::time::Duration;
use tracing::{debug, error, info};

#[derive(Debug, Clone, Serialize)]
pub struct Message {
    pub id: uuid::Uuid,
    pub timestamp: chrono::DateTime<chrono::Utc>,
    pub value: f64,
}

pub struct MqttPublisher {
    client: AsyncClient,
    topic_prefix: String,
    qos: QoS,
}

impl MqttPublisher {
    pub async fn connect(config: &MqttConfig) -> Result<(Self, EventLoop)> {
        let mut opts = MqttOptions::new(&config.client_id, &config.host, config.port);
        opts.set_keep_alive(Duration::from_secs(30))
            .set_clean_session(true);

        let (client, eventloop) = AsyncClient::new(opts, 100);

        info!(host = %config.host, port = config.port, "MQTT connected");

        Ok((
            Self {
                client,
                topic_prefix: config.topic_prefix.clone(),
                qos: QoS::AtLeastOnce,
            },
            eventloop,
        ))
    }

    pub async fn publish(&self, topic: &str, msg: &Message) -> Result<()> {
        let full_topic = format!("{}/{}", self.topic_prefix, topic);
        let payload = serde_json::to_vec(msg)?;
        self.client.publish(&full_topic, self.qos, false, payload).await?;
        debug!(topic = %full_topic, "Published message");
        Ok(())
    }
}

pub async fn run_eventloop(mut eventloop: EventLoop) {
    loop {
        match eventloop.poll().await {
            Ok(rumqttc::Event::Incoming(rumqttc::Packet::ConnAck(_))) => {
                info!("MQTT connected");
            }
            Ok(_) => {}
            Err(e) => {
                error!(error = %e, "MQTT error, reconnecting...");
                tokio::time::sleep(Duration::from_secs(5)).await;
            }
        }
    }
}
```

## Modbus Client

```rust
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::Mutex;
use tokio::time::timeout;
use tokio_modbus::prelude::*;
use tracing::{debug, instrument, warn};

pub struct ModbusClient {
    context: Arc<Mutex<Box<dyn Reader + Send>>>,
    timeout_ms: u64,
    retry_count: u32,
}

impl ModbusClient {
    pub async fn connect_tcp(host: &str, port: u16, unit_id: u8) -> Result<Self> {
        let socket_addr = format!("{}:{}", host, port);
        let ctx = tcp::connect_slave(socket_addr.parse()?, Slave(unit_id)).await?;

        Ok(Self {
            context: Arc::new(Mutex::new(Box::new(ctx))),
            timeout_ms: 5000,
            retry_count: 3,
        })
    }

    #[instrument(skip(self))]
    pub async fn read_registers(&self, address: u16, count: u16) -> Result<Vec<u16>> {
        let timeout_duration = Duration::from_millis(self.timeout_ms);
        let mut last_error = None;

        for attempt in 0..=self.retry_count {
            if attempt > 0 {
                debug!(attempt, "Retrying read");
                tokio::time::sleep(Duration::from_millis(1000)).await;
            }

            let result = timeout(timeout_duration, async {
                let mut ctx = self.context.lock().await;
                ctx.read_holding_registers(address, count).await
            })
            .await;

            match result {
                Ok(Ok(data)) => {
                    debug!(address, count, "Read {} registers", data.len());
                    return Ok(data);
                }
                Ok(Err(e)) => {
                    warn!(address, error = %e, attempt, "Read failed");
                    last_error = Some(AppError::Read { address, source: e.into() });
                }
                Err(_) => {
                    warn!(address, attempt, "Read timed out");
                    last_error = Some(AppError::Read {
                        address,
                        source: std::io::Error::new(std::io::ErrorKind::TimedOut, "timeout").into(),
                    });
                }
            }
        }

        Err(last_error.unwrap())
    }
}
```

## Axum API

```rust
use axum::{
    extract::{Json, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
    Router,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;

pub struct AppState {
    pub service: Service,
}

pub fn create_router(state: Arc<AppState>) -> Router {
    Router::new()
        .route("/health", get(health))
        .route("/api/v1/items", get(list_items).post(create_item))
        .with_state(state)
}

async fn health() -> impl IntoResponse {
    Json(serde_json::json!({ "status": "ok" }))
}

#[derive(Deserialize)]
pub struct CreateRequest {
    pub name: String,
}

#[derive(Serialize)]
pub struct ItemResponse {
    pub id: String,
    pub name: String,
}

async fn create_item(
    State(state): State<Arc<AppState>>,
    Json(req): Json<CreateRequest>,
) -> Result<Json<ItemResponse>, AppError> {
    let item = state.service.create(&req.name).await?;
    Ok(Json(ItemResponse {
        id: item.id.to_string(),
        name: item.name,
    }))
}

// Error response
impl IntoResponse for AppError {
    fn into_response(self) -> axum::response::Response {
        let body = Json(serde_json::json!({ "error": self.to_string() }));
        (StatusCode::INTERNAL_SERVER_ERROR, body).into_response()
    }
}
```

## Main Entry Point

```rust
use anyhow::Result;
use std::sync::Arc;
use tracing::{info, Level};
use tracing_subscriber::EnvFilter;

mod config;
mod error;
mod mqtt;
mod api;

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env().add_directive(Level::INFO.into()))
        .json()
        .init();

    info!("Starting service");

    let config = config::AppConfig::load("config.yaml")?;

    let (mqtt_pub, mqtt_loop) = mqtt::MqttPublisher::connect(&config.mqtt).await?;
    let mqtt_handle = tokio::spawn(mqtt::run_eventloop(mqtt_loop));

    let state = Arc::new(api::AppState { /* ... */ });
    let router = api::create_router(state);

    let listener = tokio::net::TcpListener::bind("0.0.0.0:8080").await?;
    info!("Listening on :8080");

    tokio::select! {
        _ = tokio::signal::ctrl_c() => {
            info!("Shutdown signal received");
        }
        _ = axum::serve(listener, router) => {}
        _ = mqtt_handle => {}
    }

    info!("Shutdown complete");
    Ok(())
}
```

## Conventions

- **Crates:** snake_case (`my_service`)
- **Modules:** snake_case
- **Types:** PascalCase
- **Functions:** snake_case
- **Constants:** SCREAMING_SNAKE_CASE
- **Error handling:** `thiserror` for libs, `anyhow` for apps
- **Async:** Tokio runtime, Arc<Mutex<T>> for shared state
- **Unsafe:** Forbidden unless absolutely necessary

## Related Skills

- `tokio-async`: Async runtime patterns
- `mqtt-rumqttc`: IoT messaging
- `modbus-protocol`: Industrial protocols
- `websockets`: Real-time communication
