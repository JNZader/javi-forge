---
name: mqtt-rumqttc
description: >
  MQTT client patterns for Rust using rumqttc - pub/sub, QoS, event handling.
  Trigger: mqtt, rumqttc, publish, subscribe, broker, iot messaging
tools:
  - Read
  - Write
  - Bash
  - Grep
metadata:
  author: plataforma-industrial
  version: "2.0"
  tags: [rust, mqtt, messaging, iot, pubsub]
  language: rust
  updated: "2026-02"
---

# MQTT with rumqttc

> MQTT client patterns for IoT and industrial messaging in Rust

## When to Use

- [ ] Building IoT/industrial messaging systems
- [ ] Publishing sensor data to MQTT brokers
- [ ] Subscribing to real-time data streams
- [ ] Implementing pub/sub patterns in Rust

## Stack

```toml
[dependencies]
rumqttc = "0.24"
tokio = { version = "1.36", features = ["full"] }
serde = { version = "1.0", features = ["derive"] }
serde_json = "1.0"
```

## Critical Patterns

### Pattern 1: Client Setup

```rust
use rumqttc::{AsyncClient, MqttOptions, QoS, EventLoop};
use std::time::Duration;

pub struct MqttClient {
    client: AsyncClient,
    event_loop: EventLoop,
}

impl MqttClient {
    pub fn new(config: &MqttConfig) -> Self {
        let mut options = MqttOptions::new(
            &config.client_id,
            &config.host,
            config.port,
        );

        options.set_keep_alive(Duration::from_secs(30));
        options.set_clean_session(true);

        // Optional credentials
        if let (Some(user), Some(pass)) = (&config.username, &config.password) {
            options.set_credentials(user, pass);
        }

        let (client, event_loop) = AsyncClient::new(options, 100);
        Self { client, event_loop }
    }
}
```

### Pattern 2: Last Will Testament (LWT)

```rust
use rumqttc::LastWill;

// LWT - broker publishes when client disconnects unexpectedly
options.set_last_will(LastWill::new(
    "system/gateway/status",
    "offline",
    QoS::AtLeastOnce,
    true,  // retained
));
```

### Pattern 3: QoS Selection

```rust
// QoS 0: At most once - fire and forget (fastest)
client.publish("sensors/temp/reading", QoS::AtMostOnce, false, payload).await?;

// QoS 1: At least once - confirmed delivery (recommended default)
client.publish("alerts/critical", QoS::AtLeastOnce, false, payload).await?;

// QoS 2: Exactly once - guaranteed delivery (highest overhead)
client.publish("commands/shutdown", QoS::ExactlyOnce, false, payload).await?;
```

## Publishing

### Basic Publish

```rust
impl MqttClient {
    pub async fn publish(&self, topic: &str, payload: &[u8]) -> Result<()> {
        self.client
            .publish(topic, QoS::AtLeastOnce, false, payload)
            .await
            .map_err(|e| Error::Mqtt(e.to_string()))
    }

    pub async fn publish_json<T: serde::Serialize>(&self, topic: &str, data: &T) -> Result<()> {
        let payload = serde_json::to_vec(data)?;
        self.publish(topic, &payload).await
    }

    // Retained - new subscribers get last value immediately
    pub async fn publish_retained(&self, topic: &str, payload: &[u8]) -> Result<()> {
        self.client
            .publish(topic, QoS::AtLeastOnce, true, payload)
            .await
            .map_err(|e| Error::Mqtt(e.to_string()))
    }
}
```

### Sensor Publisher

```rust
use serde::Serialize;

#[derive(Debug, Serialize)]
pub struct SensorReading {
    pub sensor_id: String,
    pub value: f64,
    pub unit: String,
    pub timestamp: i64,
}

pub struct SensorPublisher {
    client: AsyncClient,
}

impl SensorPublisher {
    pub async fn publish_reading(&self, reading: &SensorReading) -> Result<()> {
        let topic = format!("sensors/{}/reading", reading.sensor_id);
        let payload = serde_json::to_vec(reading)?;

        self.client
            .publish(&topic, QoS::AtLeastOnce, false, payload)
            .await?;
        Ok(())
    }

    // Status should be retained
    pub async fn publish_status(&self, sensor_id: &str, status: &str) -> Result<()> {
        let topic = format!("sensors/{}/status", sensor_id);
        self.client
            .publish(&topic, QoS::AtLeastOnce, true, status.as_bytes())
            .await?;
        Ok(())
    }
}
```

## Subscribing

### Topic Patterns

```rust
// Single level wildcard (+)
const SENSOR_READINGS: &str = "sensors/+/reading";     // sensors/temp-1/reading, sensors/pressure-2/reading
const SENSOR_STATUS: &str = "sensors/+/status";

// Multi-level wildcard (#)
const ALL_ALERTS: &str = "alerts/#";                   // alerts/critical, alerts/warning/temp-1
const ALL_SYSTEM: &str = "system/#";

// Exact topic
const GATEWAY_COMMAND: &str = "system/gateway/command";
```

### Event Loop Processing

```rust
use rumqttc::{Event, Packet};

pub async fn run_event_loop(mut event_loop: EventLoop) {
    loop {
        match event_loop.poll().await {
            Ok(Event::Incoming(Packet::Publish(publish))) => {
                let topic = publish.topic.as_str();
                let payload = &publish.payload;
                handle_message(topic, payload).await;
            }
            Ok(Event::Incoming(Packet::ConnAck(_))) => {
                tracing::info!("Connected to MQTT broker");
            }
            Ok(Event::Incoming(Packet::SubAck(_))) => {
                tracing::debug!("Subscription acknowledged");
            }
            Err(e) => {
                tracing::error!("MQTT error: {}", e);
                tokio::time::sleep(Duration::from_secs(1)).await;
            }
            _ => {}
        }
    }
}
```

## Complete Service Pattern

```rust
use tokio::sync::{broadcast, mpsc};

pub struct MqttService {
    client: AsyncClient,
    shutdown_rx: broadcast::Receiver<()>,
}

impl MqttService {
    pub async fn run(mut self, mut event_loop: EventLoop) -> Result<()> {
        // Subscribe to topics
        self.client.subscribe("commands/#", QoS::AtLeastOnce).await?;
        self.client.subscribe("config/+", QoS::AtLeastOnce).await?;

        loop {
            tokio::select! {
                event = event_loop.poll() => {
                    match event {
                        Ok(Event::Incoming(Packet::Publish(p))) => {
                            self.handle_publish(p).await?;
                        }
                        Ok(Event::Incoming(Packet::ConnAck(_))) => {
                            self.on_connect().await?;
                        }
                        Err(e) => {
                            tracing::error!("MQTT error: {}", e);
                            tokio::time::sleep(Duration::from_secs(1)).await;
                        }
                        _ => {}
                    }
                }
                _ = self.shutdown_rx.recv() => {
                    tracing::info!("MQTT service shutting down");
                    break;
                }
            }
        }
        Ok(())
    }

    async fn on_connect(&self) -> Result<()> {
        // Publish online status (retained)
        self.client
            .publish("system/gateway/status", QoS::AtLeastOnce, true, b"online")
            .await?;
        Ok(())
    }
}
```

## Reconnection Pattern

```rust
pub async fn run_with_reconnect(config: MqttConfig) {
    loop {
        let mqtt = MqttClient::new(&config);
        let client = mqtt.client();
        let mut event_loop = mqtt.event_loop();

        if let Err(e) = client.subscribe("sensors/#", QoS::AtLeastOnce).await {
            tracing::error!("Subscribe failed: {}", e);
            tokio::time::sleep(Duration::from_secs(5)).await;
            continue;
        }

        loop {
            match event_loop.poll().await {
                Ok(event) => handle_event(event).await,
                Err(e) => {
                    tracing::error!("Connection error: {}", e);
                    break; // Outer loop will reconnect
                }
            }
        }

        tracing::info!("Reconnecting in 5 seconds...");
        tokio::time::sleep(Duration::from_secs(5)).await;
    }
}
```

## Message Schemas

```rust
use serde::{Deserialize, Serialize};
use chrono::{DateTime, Utc};

#[derive(Debug, Serialize, Deserialize)]
pub struct SensorReadingMessage {
    pub sensor_id: String,
    pub value: f64,
    pub unit: String,
    pub quality: ReadingQuality,
    pub timestamp: DateTime<Utc>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ReadingQuality {
    Good,
    Uncertain,
    Bad,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AlertMessage {
    pub alert_id: String,
    pub sensor_id: String,
    pub severity: AlertSeverity,
    pub message: String,
    pub triggered_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AlertSeverity {
    Info,
    Warning,
    Critical,
}
```

## Topic Naming Convention

```rust
pub mod topics {
    // Sensors: sensors/{sensor_id}/{type}
    pub fn sensor_reading(id: &str) -> String { format!("sensors/{}/reading", id) }
    pub fn sensor_status(id: &str) -> String { format!("sensors/{}/status", id) }
    pub fn sensor_config(id: &str) -> String { format!("sensors/{}/config", id) }

    // Alerts: alerts/{alert_id}/{action}
    pub fn alert_triggered(id: &str) -> String { format!("alerts/{}/triggered", id) }
    pub fn alert_acknowledged(id: &str) -> String { format!("alerts/{}/acknowledged", id) }

    // System: system/{component}/{type}
    pub const GATEWAY_STATUS: &str = "system/gateway/status";
    pub const GATEWAY_COMMAND: &str = "system/gateway/command";

    // Wildcards
    pub const ALL_SENSOR_READINGS: &str = "sensors/+/reading";
    pub const ALL_ALERTS: &str = "alerts/#";
}
```

## Anti-Patterns

### Retaining Temporal Data

```rust
// ❌ Don't retain frequent readings
client.publish("sensors/temp/reading", QoS::AtLeastOnce, true, payload);

// ✅ Only retain state/status
client.publish("sensors/temp/status", QoS::AtLeastOnce, true, b"online");
client.publish("sensors/temp/reading", QoS::AtLeastOnce, false, payload);
```

### Using QoS 2 Everywhere

```rust
// ❌ QoS 2 for frequent data - too much overhead
client.publish("sensors/temp/reading", QoS::ExactlyOnce, false, payload);

// ✅ Match QoS to importance
// Readings: QoS 0 or 1
// Commands: QoS 1 or 2
```

## Quick Reference

| Task | Code |
|------|------|
| Publish | `client.publish(topic, QoS::AtLeastOnce, false, payload).await?` |
| Publish retained | `client.publish(topic, QoS::AtLeastOnce, true, payload).await?` |
| Subscribe | `client.subscribe(topic, QoS::AtLeastOnce).await?` |
| Clear retained | `client.publish(topic, QoS::AtLeastOnce, true, b"").await?` |
| Single wildcard | `sensors/+/reading` |
| Multi wildcard | `alerts/#` |

## Resources

- [rumqttc Documentation](https://docs.rs/rumqttc)
- [MQTT Specification](https://mqtt.org/mqtt-specification/)
- [HiveMQ MQTT Essentials](https://www.hivemq.com/mqtt-essentials/)

## Related Skills

- `tokio-async`: Async runtime integration
- `modbus-protocol`: Industrial data sources
- `websockets`: Browser data streaming
- `timescaledb`: Time-series storage
