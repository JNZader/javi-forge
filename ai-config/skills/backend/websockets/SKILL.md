---
name: websockets
description: >
  WebSocket real-time communication patterns for Go and TypeScript.
  Trigger: websocket, real-time, pubsub, hub pattern, live updates
tools:
  - Read
  - Write
  - Bash
  - Grep
metadata:
  author: plataforma-industrial
  version: "2.0"
  tags: [websocket, realtime, go, typescript, pubsub]
  language: go
  updated: "2026-02"
---

# WebSockets

> Real-time bidirectional communication with Hub pattern

## When to Use

- [ ] Building live dashboards with real-time updates
- [ ] Implementing chat or notification systems
- [ ] Streaming sensor data to web clients
- [ ] Push updates without polling

## Stack

```yaml
# Go Server
gorilla/websocket: "1.5+"
nhooyr.io/websocket: "1.8+"

# TypeScript Client
Native WebSocket API
@tanstack/react-query (for cache sync)

# Rust
tokio-tungstenite: "0.21+"
```

## Go Server - Hub Pattern

### Hub Structure

```go
package ws

import (
    "encoding/json"
    "sync"
    "time"

    "github.com/gorilla/websocket"
)

const (
    writeWait      = 10 * time.Second
    pongWait       = 60 * time.Second
    pingPeriod     = (pongWait * 9) / 10
    maxMessageSize = 512 * 1024
)

type Message struct {
    Type    string          `json:"type"`
    Payload json.RawMessage `json:"payload"`
}

type Client struct {
    hub      *Hub
    conn     *websocket.Conn
    send     chan []byte
    tenantID string
    userID   string
    rooms    map[string]bool
    mu       sync.RWMutex
}

type Hub struct {
    clients    map[*Client]bool
    byTenant   map[string]map[*Client]bool
    byRoom     map[string]map[*Client]bool
    register   chan *Client
    unregister chan *Client
    broadcast  chan BroadcastMessage
    mu         sync.RWMutex
}

type BroadcastMessage struct {
    TenantID string
    Room     string
    Data     []byte
}

func NewHub() *Hub {
    return &Hub{
        clients:    make(map[*Client]bool),
        byTenant:   make(map[string]map[*Client]bool),
        byRoom:     make(map[string]map[*Client]bool),
        register:   make(chan *Client),
        unregister: make(chan *Client),
        broadcast:  make(chan BroadcastMessage, 256),
    }
}
```

### Hub Run Loop

```go
func (h *Hub) Run(ctx context.Context) {
    for {
        select {
        case <-ctx.Done():
            return

        case client := <-h.register:
            h.mu.Lock()
            h.clients[client] = true
            if h.byTenant[client.tenantID] == nil {
                h.byTenant[client.tenantID] = make(map[*Client]bool)
            }
            h.byTenant[client.tenantID][client] = true
            h.mu.Unlock()

        case client := <-h.unregister:
            h.mu.Lock()
            if _, ok := h.clients[client]; ok {
                delete(h.clients, client)
                delete(h.byTenant[client.tenantID], client)
                for room := range client.rooms {
                    delete(h.byRoom[room], client)
                }
                close(client.send)
            }
            h.mu.Unlock()

        case msg := <-h.broadcast:
            h.mu.RLock()
            var targets map[*Client]bool
            if msg.Room != "" {
                targets = h.byRoom[msg.Room]
            } else {
                targets = h.byTenant[msg.TenantID]
            }
            for client := range targets {
                select {
                case client.send <- msg.Data:
                default:
                    close(client.send)
                    delete(h.clients, client)
                }
            }
            h.mu.RUnlock()
        }
    }
}
```

### Room Management

```go
func (h *Hub) JoinRoom(client *Client, room string) {
    h.mu.Lock()
    defer h.mu.Unlock()

    if h.byRoom[room] == nil {
        h.byRoom[room] = make(map[*Client]bool)
    }
    h.byRoom[room][client] = true

    client.mu.Lock()
    client.rooms[room] = true
    client.mu.Unlock()
}

func (h *Hub) BroadcastToRoom(room string, msgType string, payload interface{}) error {
    data, err := json.Marshal(Message{Type: msgType, Payload: mustMarshal(payload)})
    if err != nil { return err }

    h.broadcast <- BroadcastMessage{Room: room, Data: data}
    return nil
}
```

### Client Read/Write Pumps

```go
func (c *Client) readPump() {
    defer func() {
        c.hub.unregister <- c
        c.conn.Close()
    }()

    c.conn.SetReadLimit(maxMessageSize)
    c.conn.SetReadDeadline(time.Now().Add(pongWait))
    c.conn.SetPongHandler(func(string) error {
        c.conn.SetReadDeadline(time.Now().Add(pongWait))
        return nil
    })

    for {
        _, message, err := c.conn.ReadMessage()
        if err != nil { break }
        c.handleMessage(message)
    }
}

func (c *Client) writePump() {
    ticker := time.NewTicker(pingPeriod)
    defer func() {
        ticker.Stop()
        c.conn.Close()
    }()

    for {
        select {
        case message, ok := <-c.send:
            c.conn.SetWriteDeadline(time.Now().Add(writeWait))
            if !ok {
                c.conn.WriteMessage(websocket.CloseMessage, []byte{})
                return
            }
            w, _ := c.conn.NextWriter(websocket.TextMessage)
            w.Write(message)
            // Coalesce queued messages
            for i := 0; i < len(c.send); i++ {
                w.Write([]byte{'\n'})
                w.Write(<-c.send)
            }
            w.Close()

        case <-ticker.C:
            c.conn.SetWriteDeadline(time.Now().Add(writeWait))
            c.conn.WriteMessage(websocket.PingMessage, nil)
        }
    }
}
```

### HTTP Upgrade Handler

```go
var upgrader = websocket.Upgrader{
    ReadBufferSize:  1024,
    WriteBufferSize: 1024,
    CheckOrigin: func(r *http.Request) bool {
        origin := r.Header.Get("Origin")
        return origin == "https://app.example.com" || origin == "http://localhost:4321"
    },
}

func (h *Hub) HandleWebSocket(w http.ResponseWriter, r *http.Request) {
    tenantID := r.Context().Value("tenant_id").(string)
    userID := r.Context().Value("user_id").(string)

    conn, err := upgrader.Upgrade(w, r, nil)
    if err != nil { return }

    client := &Client{
        hub:      h,
        conn:     conn,
        send:     make(chan []byte, 256),
        tenantID: tenantID,
        userID:   userID,
        rooms:    make(map[string]bool),
    }

    h.register <- client
    go client.writePump()
    go client.readPump()
}
```

## TypeScript Client

### WebSocket Hook

```typescript
import { useEffect, useRef, useState, useCallback } from 'react';

interface WebSocketMessage<T = unknown> {
  type: string;
  payload: T;
}

export function useWebSocket(options: {
  onMessage?: (msg: WebSocketMessage) => void;
  onConnect?: () => void;
  reconnect?: boolean;
} = {}) {
  const { onMessage, onConnect, reconnect = true } = options;
  const ws = useRef<WebSocket | null>(null);
  const [isConnected, setIsConnected] = useState(false);

  const connect = useCallback(() => {
    if (ws.current?.readyState === WebSocket.OPEN) return;

    ws.current = new WebSocket(import.meta.env.PUBLIC_WS_URL);

    ws.current.onopen = () => {
      setIsConnected(true);
      onConnect?.();
    };

    ws.current.onclose = () => {
      setIsConnected(false);
      if (reconnect) setTimeout(connect, 3000);
    };

    ws.current.onmessage = (event) => {
      const message = JSON.parse(event.data);
      onMessage?.(message);
    };
  }, [onMessage, onConnect, reconnect]);

  const send = useCallback((type: string, payload: unknown) => {
    if (ws.current?.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify({ type, payload }));
    }
  }, []);

  const subscribe = useCallback((room: string) => send('subscribe', { room }), [send]);
  const unsubscribe = useCallback((room: string) => send('unsubscribe', { room }), [send]);

  useEffect(() => {
    connect();
    return () => ws.current?.close();
  }, [connect]);

  return { isConnected, send, subscribe, unsubscribe };
}
```

### React Query Integration

```typescript
import { useQueryClient } from '@tanstack/react-query';
import { useWebSocket } from './useWebSocket';

interface SensorReading {
  sensorId: string;
  value: number;
  timestamp: number;
}

export function useRealtimeSensors(sensorIds: string[]) {
  const queryClient = useQueryClient();

  const handleMessage = useCallback((msg: { type: string; payload: unknown }) => {
    if (msg.type === 'sensor.reading') {
      const reading = msg.payload as SensorReading;

      // Update individual sensor cache
      queryClient.setQueryData(['sensor', reading.sensorId, 'latest'], reading);

      // Update list cache
      queryClient.setQueryData<SensorReading[]>(['sensors', 'latest'], (old) => {
        if (!old) return [reading];
        const index = old.findIndex((r) => r.sensorId === reading.sensorId);
        if (index >= 0) {
          const updated = [...old];
          updated[index] = reading;
          return updated;
        }
        return [...old, reading];
      });
    }
  }, [queryClient]);

  const { isConnected, subscribe, unsubscribe } = useWebSocket({
    onMessage: handleMessage,
    onConnect: () => sensorIds.forEach((id) => subscribe(`sensor:${id}`)),
  });

  useEffect(() => {
    if (isConnected) sensorIds.forEach((id) => subscribe(`sensor:${id}`));
    return () => sensorIds.forEach((id) => unsubscribe(`sensor:${id}`));
  }, [sensorIds, isConnected]);

  return { isConnected };
}
```

## Reconnection with Exponential Backoff

```typescript
class ReconnectingWebSocket {
  private ws: WebSocket | null = null;
  private reconnectAttempts = 0;
  private maxAttempts = 10;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private missedHeartbeats = 0;

  constructor(
    private url: string,
    private onMessage: (data: unknown) => void,
    private onStateChange: (connected: boolean) => void
  ) {
    this.connect();
  }

  private connect() {
    this.ws = new WebSocket(this.url);

    this.ws.onopen = () => {
      this.reconnectAttempts = 0;
      this.missedHeartbeats = 0;
      this.onStateChange(true);
      this.startHeartbeat();
    };

    this.ws.onclose = () => {
      this.onStateChange(false);
      this.stopHeartbeat();
      this.scheduleReconnect();
    };

    this.ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === 'pong') {
        this.missedHeartbeats = 0;
        return;
      }
      this.onMessage(data);
    };
  }

  private startHeartbeat() {
    this.heartbeatInterval = setInterval(() => {
      if (this.missedHeartbeats >= 3) {
        this.ws?.close();
        return;
      }
      this.ws?.send(JSON.stringify({ type: 'ping' }));
      this.missedHeartbeats++;
    }, 30000);
  }

  private scheduleReconnect() {
    if (this.reconnectAttempts >= this.maxAttempts) return;

    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
    this.reconnectAttempts++;
    setTimeout(() => this.connect(), delay);
  }
}
```

## Best Practices

### Use Rooms for Targeted Broadcasts

```go
// ✅ Send only to interested clients
hub.BroadcastToRoom("sensor:temp-1", "reading", reading)

// ❌ Broadcast to everyone
hub.BroadcastToTenant(tenantID, "reading", reading)
```

### Implement Heartbeats

```typescript
// Detect stale connections
setInterval(() => ws.send(JSON.stringify({ type: 'ping' })), 30000);
```

### Coalesce Messages

```go
// Combine pending messages in single write
n := len(c.send)
for i := 0; i < n; i++ {
    w.Write(<-c.send)
}
```

### Exponential Backoff

```typescript
const delay = Math.min(1000 * Math.pow(2, attempts), 30000);
```

## Quick Reference

| Task | Go Server |
|------|-----------|
| Create hub | `hub := NewHub()` |
| Run hub | `go hub.Run(ctx)` |
| Join room | `hub.JoinRoom(client, "room")` |
| Broadcast | `hub.BroadcastToRoom("room", "type", data)` |
| Upgrade | `upgrader.Upgrade(w, r, nil)` |

| Task | TypeScript Client |
|------|-------------------|
| Connect | `new WebSocket(url)` |
| Send | `ws.send(JSON.stringify(msg))` |
| Subscribe | `send('subscribe', { room })` |
| Close | `ws.close()` |

## Message Protocol

```json
// Subscribe to room
{"type": "subscribe", "payload": {"room": "sensor:temp-1"}}

// Unsubscribe
{"type": "unsubscribe", "payload": {"room": "sensor:temp-1"}}

// Heartbeat
{"type": "ping"}
{"type": "pong"}

// Data message
{"type": "sensor.reading", "payload": {"sensorId": "temp-1", "value": 25.5}}
```

## Resources

- [gorilla/websocket](https://github.com/gorilla/websocket)
- [MDN WebSocket API](https://developer.mozilla.org/en-US/docs/Web/API/WebSocket)
- [RFC 6455 WebSocket Protocol](https://tools.ietf.org/html/rfc6455)

## Related Skills

- `tokio-async`: Async WebSocket handling
- `chi-router`: Go WebSocket integration
- `fastapi`: Python WebSocket endpoints
- `mqtt-rumqttc`: IoT data streaming
