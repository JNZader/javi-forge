---
name: modbus-protocol
description: >
  Modbus industrial protocol implementation in Rust, Go, and Python.
  Trigger: modbus, plc, scada, industrial protocol, registers, coils
tools:
  - Read
  - Write
  - Bash
  - Grep
metadata:
  author: plataforma-industrial
  version: "2.0"
  tags: [industrial, modbus, plc, sensors, protocol]
  language: rust
  updated: "2026-02"
---

# Modbus Protocol

> Industrial Modbus TCP/RTU implementation for sensor communication

## When to Use

- [ ] Reading data from PLCs (Siemens, Allen-Bradley, Schneider)
- [ ] Communicating with industrial sensors
- [ ] Building SCADA/gateway systems
- [ ] Implementing OT (Operational Technology) integrations

## Stack

```yaml
# Rust
tokio-modbus: "0.13+"

# Go
github.com/simonvetter/modbus: latest

# Python
pymodbus: "3.6+"
```

## Modbus Fundamentals

### Register Types

| Type | Address Range | Access | Use Case |
|------|---------------|--------|----------|
| Coils | 00001-09999 | R/W | Digital outputs (on/off) |
| Discrete Inputs | 10001-19999 | R | Digital inputs (read-only) |
| Input Registers | 30001-39999 | R | Analog inputs (16-bit) |
| Holding Registers | 40001-49999 | R/W | Configuration & data |

### Function Codes

| Code | Function | Description |
|------|----------|-------------|
| 01 | Read Coils | Read multiple digital outputs |
| 02 | Read Discrete Inputs | Read digital inputs |
| 03 | Read Holding Registers | Read configuration registers |
| 04 | Read Input Registers | Read analog inputs |
| 05 | Write Single Coil | Set single output |
| 06 | Write Single Register | Write one register |
| 16 | Write Multiple Registers | Write block of registers |

## Rust Implementation

### Client Setup

```rust
use tokio_modbus::prelude::*;
use tokio_modbus::client::tcp;
use std::net::SocketAddr;
use tokio::time::{timeout, Duration};

pub struct ModbusClient {
    ctx: client::Context,
    timeout_duration: Duration,
}

impl ModbusClient {
    pub async fn connect(addr: SocketAddr, slave_id: u8) -> Result<Self, ModbusError> {
        let ctx = tcp::connect_slave(addr, Slave(slave_id)).await?;
        Ok(Self { ctx, timeout_duration: Duration::from_secs(5) })
    }

    pub async fn read_holding_registers(&mut self, address: u16, count: u16) -> Result<Vec<u16>> {
        timeout(self.timeout_duration, self.ctx.read_holding_registers(address, count))
            .await
            .map_err(|_| ModbusError::Timeout)?
            .map_err(ModbusError::from)
    }

    pub async fn write_single_register(&mut self, address: u16, value: u16) -> Result<()> {
        timeout(self.timeout_duration, self.ctx.write_single_register(address, value))
            .await
            .map_err(|_| ModbusError::Timeout)?
            .map_err(ModbusError::from)
    }
}
```

### Data Type Conversions

```rust
/// Two 16-bit registers to f32 (big-endian)
pub fn registers_to_f32(regs: &[u16]) -> f32 {
    let bytes = [
        (regs[0] >> 8) as u8, regs[0] as u8,
        (regs[1] >> 8) as u8, regs[1] as u8,
    ];
    f32::from_be_bytes(bytes)
}

/// Two 16-bit registers to f32 (little-endian, swapped)
pub fn registers_to_f32_le(regs: &[u16]) -> f32 {
    let bytes = [
        regs[1] as u8, (regs[1] >> 8) as u8,
        regs[0] as u8, (regs[0] >> 8) as u8,
    ];
    f32::from_le_bytes(bytes)
}

/// f32 to two 16-bit registers
pub fn f32_to_registers(value: f32) -> [u16; 2] {
    let bytes = value.to_be_bytes();
    [
        ((bytes[0] as u16) << 8) | (bytes[1] as u16),
        ((bytes[2] as u16) << 8) | (bytes[3] as u16),
    ]
}

/// Scale raw value to engineering units
pub fn scale_value(raw: u16, min_raw: u16, max_raw: u16, min_eng: f32, max_eng: f32) -> f32 {
    let range_raw = (max_raw - min_raw) as f32;
    let range_eng = max_eng - min_eng;
    let normalized = (raw - min_raw) as f32 / range_raw;
    min_eng + (normalized * range_eng)
}
```

### Sensor Reader

```rust
#[derive(Debug, Clone)]
pub struct SensorConfig {
    pub id: String,
    pub name: String,
    pub address: u16,
    pub data_type: DataType,
    pub unit: String,
    pub scale: Option<Scale>,
}

#[derive(Debug, Clone)]
pub enum DataType {
    UInt16,
    Int16,
    Float32,
    Float32LE,
}

#[derive(Debug, Clone)]
pub struct SensorReading {
    pub sensor_id: String,
    pub value: f64,
    pub quality: u8,  // 192=Good, 128=Uncertain, 0=Bad
    pub timestamp: i64,
}

pub struct SensorReader {
    client: ModbusClient,
    sensors: Vec<SensorConfig>,
}

impl SensorReader {
    pub async fn read_sensor(&mut self, sensor: &SensorConfig) -> Result<SensorReading> {
        let count = match sensor.data_type {
            DataType::UInt16 | DataType::Int16 => 1,
            DataType::Float32 | DataType::Float32LE => 2,
        };

        let registers = self.client.read_holding_registers(sensor.address, count).await?;

        let raw_value: f64 = match sensor.data_type {
            DataType::UInt16 => registers[0] as f64,
            DataType::Int16 => (registers[0] as i16) as f64,
            DataType::Float32 => registers_to_f32(&registers) as f64,
            DataType::Float32LE => registers_to_f32_le(&registers) as f64,
        };

        let value = if let Some(scale) = &sensor.scale {
            scale_value(raw_value as u16, scale.min_raw, scale.max_raw, scale.min_eng, scale.max_eng) as f64
        } else {
            raw_value
        };

        Ok(SensorReading {
            sensor_id: sensor.id.clone(),
            value,
            quality: 192, // Good
            timestamp: chrono::Utc::now().timestamp_millis(),
        })
    }
}
```

## Go Implementation

```go
package modbus

import (
    "encoding/binary"
    "math"
    "sync"
    "time"

    "github.com/simonvetter/modbus"
)

type Client struct {
    client *modbus.ModbusClient
    mu     sync.Mutex
}

func NewClient(address string, slaveID uint8) (*Client, error) {
    client, err := modbus.NewClient(&modbus.ClientConfiguration{
        URL:     fmt.Sprintf("tcp://%s", address),
        Speed:   19200,
        Timeout: 5 * time.Second,
    })
    if err != nil { return nil, err }

    if err := client.Open(); err != nil { return nil, err }
    client.SetUnitId(slaveID)

    return &Client{client: client}, nil
}

func (c *Client) ReadHoldingRegisters(address, count uint16) ([]uint16, error) {
    c.mu.Lock()
    defer c.mu.Unlock()
    return c.client.ReadRegisters(address, count, modbus.HOLDING_REGISTER)
}

func RegistersToFloat32(regs []uint16) float32 {
    bytes := make([]byte, 4)
    binary.BigEndian.PutUint16(bytes[0:2], regs[0])
    binary.BigEndian.PutUint16(bytes[2:4], regs[1])
    return math.Float32frombits(binary.BigEndian.Uint32(bytes))
}
```

## Python Implementation

```python
from pymodbus.client import AsyncModbusTcpClient
from dataclasses import dataclass
import struct

@dataclass
class SensorConfig:
    id: str
    address: int
    data_type: str  # 'uint16', 'int16', 'float32'
    unit: str

class ModbusReader:
    def __init__(self, host: str, port: int = 502, slave_id: int = 1):
        self.host = host
        self.port = port
        self.slave_id = slave_id

    async def connect(self):
        self.client = AsyncModbusTcpClient(self.host, port=self.port)
        await self.client.connect()

    async def read_holding_registers(self, address: int, count: int):
        result = await self.client.read_holding_registers(address, count, slave=self.slave_id)
        return result.registers

    async def read_sensor(self, config: SensorConfig) -> float:
        count = 2 if 'float32' in config.data_type else 1
        regs = await self.read_holding_registers(config.address, count)

        if config.data_type == 'uint16':
            return regs[0]
        elif config.data_type == 'int16':
            return struct.unpack('>h', struct.pack('>H', regs[0]))[0]
        elif config.data_type == 'float32':
            bytes_data = struct.pack('>HH', regs[0], regs[1])
            return struct.unpack('>f', bytes_data)[0]
```

## PLC Address Maps

### Siemens S7-1200/1500

```yaml
holding_registers:
  40001: DB1.DBD0   # Float, first double word in DB1
  40003: DB1.DBD4   # Float, second double word
  40005: MW100      # Word memory

coils:
  00001: Q0.0       # Output bit 0.0
  00002: Q0.1       # Output bit 0.1
```

### Allen-Bradley ControlLogix

```yaml
holding_registers:
  40001: N7:0       # Integer file
  40002: F8:0       # Float (uses 2 registers)
```

### Schneider Modicon

```yaml
holding_registers:
  40001: %MW0       # Memory word 0
  40003: %MF0       # Float (2 registers)
```

## Error Handling

```rust
pub fn modbus_error_description(code: u8) -> &'static str {
    match code {
        0x01 => "Illegal Function",
        0x02 => "Illegal Data Address",
        0x03 => "Illegal Data Value",
        0x04 => "Slave Device Failure",
        0x05 => "Acknowledge",
        0x06 => "Slave Device Busy",
        _ => "Unknown Error",
    }
}
```

## Best Practices

### Batch Reads

```rust
// ✅ Single read for contiguous registers
client.read_holding_registers(40001, 10).await?;

// ❌ Multiple individual reads - slow!
for addr in 40001..40011 {
    client.read_holding_registers(addr, 1).await?;
}
```

### Connection Reuse

```rust
// ✅ Reuse connection
let client = ModbusClient::connect(addr, slave_id).await?;
for _ in 0..100 {
    client.read_holding_registers(addr, count).await?;
}

// ❌ New connection per read
for _ in 0..100 {
    let client = ModbusClient::connect(addr, slave_id).await?;
    client.read_holding_registers(addr, count).await?;
}
```

### Polling Intervals

| Sensor Type | Recommended Interval |
|-------------|---------------------|
| Vibration | 10-50ms |
| Temperature/Pressure | 500ms-1s |
| Level/Flow totals | 5-10s |

## Quick Reference

| Task | Rust |
|------|------|
| Read holding | `ctx.read_holding_registers(addr, count).await` |
| Read input | `ctx.read_input_registers(addr, count).await` |
| Write single | `ctx.write_single_register(addr, value).await` |
| Write multiple | `ctx.write_multiple_registers(addr, &values).await` |
| Read coils | `ctx.read_coils(addr, count).await` |

## Quality Codes (OPC UA)

| Code | Meaning |
|------|---------|
| 192 (0xC0) | Good |
| 128 (0x80) | Uncertain |
| 0 (0x00) | Bad |

## Resources

- [Modbus Specification](https://modbus.org/specs.php)
- [tokio-modbus Docs](https://docs.rs/tokio-modbus)
- [pymodbus Documentation](https://pymodbus.readthedocs.io/)

## Related Skills

- `mqtt-rumqttc`: Data forwarding to MQTT
- `tokio-async`: Async polling patterns
- `timescaledb`: Industrial data storage
- `rust-systems`: Full Rust integration
