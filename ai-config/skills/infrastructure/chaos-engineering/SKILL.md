---
name: chaos-engineering
description: >
  Chaos engineering principles. Fault injection, resilience testing, game days.
  Trigger: chaos, fault injection, resilience, chaos monkey, failure testing
tools:
  - Read
  - Write
  - Edit
  - Grep
metadata:
  author: apigen-team
  version: "1.0"
  tags: [chaos, testing, resilience, sre]
  scope: ["**/chaos/**"]
---

# Chaos Engineering Concepts

## Core Principles

```
Chaos Engineering: Discipline of experimenting on a system
to build confidence in its ability to withstand turbulent
conditions in production.

Key Principles:
1. Build hypothesis around steady state behavior
2. Vary real-world events (failures, traffic spikes)
3. Run experiments in production (safely)
4. Automate experiments for continuous validation
5. Minimize blast radius
```

## Steady State Hypothesis

```
Define "normal" before breaking things:

Metrics to establish:
- Response time P99 < 200ms
- Error rate < 0.1%
- Throughput > 1000 RPS
- CPU utilization < 70%

Hypothesis example:
"When the payment service fails, orders should still
be accepted and queued for later processing.
Response time may increase by 50% but stay under 500ms."
```

## Fault Types

### Network Faults
```
Latency injection:
- Add 100-500ms delay to service calls
- Simulate cross-region communication
- Test timeout configurations

Packet loss:
- Drop 5-10% of packets
- Test retry mechanisms
- Validate idempotency

DNS failures:
- Simulate DNS resolution failures
- Test fallback configurations
- Validate service discovery resilience

Connection limits:
- Exhaust connection pools
- Test circuit breaker activation
- Validate graceful degradation
```

### Service Faults
```
Service unavailability:
- Kill service instances
- Test load balancer failover
- Validate health check accuracy

Slow responses:
- Inject delays before response
- Test client timeouts
- Validate async processing

Error responses:
- Return 500/503 errors
- Test retry with backoff
- Validate error handling
```

### Database Faults
```
Connection failures:
- Drop database connections
- Test connection pool recovery
- Validate transaction rollback

Slow queries:
- Inject query delays
- Test query timeouts
- Validate read replica failover

Data corruption (controlled):
- Inject invalid data
- Test validation layers
- Validate data integrity checks
```

### Resource Faults
```
CPU stress:
- Consume CPU cycles
- Test autoscaling triggers
- Validate performance degradation

Memory pressure:
- Consume available memory
- Test OOM handling
- Validate garbage collection

Disk I/O:
- Slow disk operations
- Fill disk space
- Test log rotation
```

## Experiment Design

```
1. Define Scope
   - Which service(s)?
   - Which environment?
   - What time window?

2. Set Hypothesis
   - Expected behavior under fault
   - Acceptable degradation limits
   - Recovery time expectations

3. Design Fault
   - Type of failure
   - Duration and intensity
   - Rollback mechanism

4. Define Metrics
   - What to measure
   - Baseline values
   - Alert thresholds

5. Execute & Observe
   - Start with small blast radius
   - Monitor dashboards
   - Ready to abort

6. Analyze & Report
   - Did hypothesis hold?
   - What broke unexpectedly?
   - Action items for improvement
```

## Blast Radius Control

```
Start small, expand gradually:

Phase 1: Development
- Local development environment
- Single service instance
- Synthetic traffic

Phase 2: Staging
- Staging/pre-prod environment
- Full service mesh
- Replayed production traffic

Phase 3: Production (canary)
- Single production instance
- < 1% of traffic
- Immediate abort capability

Phase 4: Production (expanded)
- Multiple instances
- 5-10% of traffic
- Automated rollback
```

## Game Days

```
Planned chaos exercises with team participation:

Preparation:
- Schedule 2-4 hours
- Notify stakeholders
- Prepare runbooks
- Set up monitoring dashboards

Execution:
- Inject failures per plan
- Observe and document
- Practice incident response
- Test communication channels

Post-mortem:
- Review what worked/failed
- Update runbooks
- Create improvement tickets
- Share learnings
```

## Tools Landscape

```
| Tool | Best For |
|------|----------|
| Chaos Monkey | Random instance termination |
| Gremlin | Comprehensive fault injection |
| Litmus | Kubernetes-native chaos |
| Toxiproxy | Network fault simulation |
| Chaos Mesh | K8s chaos orchestration |
| AWS FIS | AWS service faults |
```

## Anti-patterns

```
❌ Starting in production without staging tests
❌ No abort mechanism or kill switch
❌ Chaos without monitoring
❌ No hypothesis before experiment
❌ Blaming instead of learning
❌ One-time exercises (should be continuous)
```

## Related Skills

- `chaos-spring`: Spring Boot chaos implementation
- `apigen-architecture`: Overall system architecture


