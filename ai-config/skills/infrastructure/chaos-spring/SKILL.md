---
name: chaos-spring
description: >
  Spring Boot chaos engineering. Chaos Monkey, fault simulators, test orchestration.
  Trigger: apigen-chaos, ChaosMonkey, NetworkChaosSimulator, DatabaseChaosSimulator
tools:
  - Read
  - Write
  - Edit
  - Bash
  - Grep
metadata:
  author: apigen-team
  version: "1.0"
  tags: [chaos, spring-boot, testing, java]
  scope: ["apigen-chaos/**"]
---

# Chaos Spring Boot (apigen-chaos)

## Configuration

```yaml
apigen:
  chaos:
    enabled: true
    # Only enable in non-production by default
    environment: ${SPRING_PROFILES_ACTIVE:dev}

    network:
      enabled: true
      latency:
        min-ms: 100
        max-ms: 500
        probability: 0.1
      packet-loss:
        probability: 0.05

    service:
      enabled: true
      failure-probability: 0.1
      slow-response:
        enabled: true
        delay-ms: 2000
        probability: 0.05

    database:
      enabled: true
      connection-failure:
        probability: 0.02
      slow-query:
        delay-ms: 3000
        probability: 0.05

    resource:
      enabled: true
      cpu-stress:
        enabled: false
        cores: 2
        load-percent: 80
      memory-stress:
        enabled: false
        allocation-mb: 512
```

## Chaos Monkey Configuration

```java
@Configuration
@ConditionalOnProperty(prefix = "apigen.chaos", name = "enabled", havingValue = "true")
public class ChaosMonkeyConfiguration {

    @Bean
    public ChaosMonkeySettings chaosMonkeySettings(ChaosProperties props) {
        return ChaosMonkeySettings.builder()
            .enabled(props.isEnabled())
            .latencyActive(props.getNetwork().isEnabled())
            .latencyRangeStart(props.getNetwork().getLatency().getMinMs())
            .latencyRangeEnd(props.getNetwork().getLatency().getMaxMs())
            .exceptionActive(props.getService().isEnabled())
            .killApplicationActive(false)  // Never auto-kill
            .build();
    }

    @Bean
    public AssaultProperties assaultProperties(ChaosProperties props) {
        return AssaultProperties.builder()
            .level(props.getService().getFailureProbability())
            .exceptionsActive(true)
            .exception(new RuntimeException("Chaos Monkey attack!"))
            .build();
    }
}
```

## Network Chaos Simulator

```java
@Component
@ConditionalOnProperty(prefix = "apigen.chaos.network", name = "enabled")
public class NetworkChaosSimulator {

    private final ChaosProperties.NetworkProperties config;
    private final Random random = new SecureRandom();
    private final MeterRegistry meterRegistry;

    public void maybeInjectLatency() {
        if (shouldInject(config.getLatency().getProbability())) {
            int delay = random.nextInt(
                config.getLatency().getMaxMs() - config.getLatency().getMinMs()
            ) + config.getLatency().getMinMs();

            meterRegistry.counter("chaos.network.latency.injected").increment();
            log.info("Chaos: Injecting {}ms latency", delay);

            try {
                Thread.sleep(delay);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
        }
    }

    public void maybeInjectPacketLoss() {
        if (shouldInject(config.getPacketLoss().getProbability())) {
            meterRegistry.counter("chaos.network.packet_loss.injected").increment();
            log.info("Chaos: Simulating packet loss (dropping request)");
            throw new NetworkChaosException("Simulated packet loss");
        }
    }

    private boolean shouldInject(double probability) {
        return random.nextDouble() < probability;
    }
}
```

## Database Chaos Simulator

```java
@Component
@ConditionalOnProperty(prefix = "apigen.chaos.database", name = "enabled")
public class DatabaseChaosSimulator {

    private final ChaosProperties.DatabaseProperties config;
    private final Random random = new SecureRandom();

    @Around("execution(* javax.sql.DataSource.getConnection(..))")
    public Object maybeFailConnection(ProceedingJoinPoint pjp) throws Throwable {
        if (shouldInject(config.getConnectionFailure().getProbability())) {
            log.info("Chaos: Simulating database connection failure");
            throw new SQLException("Chaos: Connection refused");
        }
        return pjp.proceed();
    }

    @Around("execution(* org.springframework.data.repository.Repository+.*(..))")
    public Object maybeSlowQuery(ProceedingJoinPoint pjp) throws Throwable {
        if (shouldInject(config.getSlowQuery().getProbability())) {
            int delay = config.getSlowQuery().getDelayMs();
            log.info("Chaos: Injecting {}ms query delay", delay);
            Thread.sleep(delay);
        }
        return pjp.proceed();
    }
}
```

## Service Failure Simulator

```java
@Component
@ConditionalOnProperty(prefix = "apigen.chaos.service", name = "enabled")
public class ServiceFailureSimulator {

    private final ChaosProperties.ServiceProperties config;
    private final Random random = new SecureRandom();

    @Around("@within(org.springframework.web.bind.annotation.RestController)")
    public Object maybeFailRequest(ProceedingJoinPoint pjp) throws Throwable {
        // Fail with configured probability
        if (shouldInject(config.getFailureProbability())) {
            log.info("Chaos: Simulating service failure for {}",
                pjp.getSignature().getName());
            throw new ServiceChaosException("Chaos: Service unavailable");
        }

        // Slow response with configured probability
        if (config.getSlowResponse().isEnabled() &&
            shouldInject(config.getSlowResponse().getProbability())) {

            int delay = config.getSlowResponse().getDelayMs();
            log.info("Chaos: Injecting {}ms response delay", delay);
            Thread.sleep(delay);
        }

        return pjp.proceed();
    }
}
```

## Resource Stress Simulator

```java
@Component
@ConditionalOnProperty(prefix = "apigen.chaos.resource", name = "enabled")
public class ResourceStressSimulator {

    private final ChaosProperties.ResourceProperties config;
    private final ExecutorService executor = Executors.newCachedThreadPool();
    private volatile boolean stressActive = false;

    public void startCpuStress(Duration duration) {
        if (!config.getCpuStress().isEnabled()) return;

        int cores = config.getCpuStress().getCores();
        int loadPercent = config.getCpuStress().getLoadPercent();

        log.info("Chaos: Starting CPU stress on {} cores at {}% for {}",
            cores, loadPercent, duration);

        stressActive = true;
        for (int i = 0; i < cores; i++) {
            executor.submit(() -> {
                long startTime = System.currentTimeMillis();
                while (stressActive &&
                       System.currentTimeMillis() - startTime < duration.toMillis()) {
                    // Busy work
                    if (loadPercent < 100) {
                        try {
                            Thread.sleep(100 - loadPercent);
                        } catch (InterruptedException e) {
                            Thread.currentThread().interrupt();
                            break;
                        }
                    }
                }
            });
        }

        // Auto-stop after duration
        executor.submit(() -> {
            try {
                Thread.sleep(duration.toMillis());
                stopCpuStress();
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
        });
    }

    public void stopCpuStress() {
        stressActive = false;
        log.info("Chaos: CPU stress stopped");
    }

    public void startMemoryStress(int allocationMb) {
        if (!config.getMemoryStress().isEnabled()) return;

        log.info("Chaos: Allocating {}MB of memory", allocationMb);
        byte[][] allocations = new byte[allocationMb][];
        for (int i = 0; i < allocationMb; i++) {
            allocations[i] = new byte[1024 * 1024]; // 1MB chunks
        }
        // Hold reference to prevent GC
    }
}
```

## Chaos Test Orchestrator

```java
@Service
public class ChaosTestOrchestrator {

    private final NetworkChaosSimulator networkChaos;
    private final DatabaseChaosSimulator databaseChaos;
    private final ServiceFailureSimulator serviceFailure;
    private final ResourceStressSimulator resourceStress;

    public ChaosExperiment createExperiment(ChaosExperimentRequest request) {
        return ChaosExperiment.builder()
            .id(UUID.randomUUID())
            .name(request.getName())
            .hypothesis(request.getHypothesis())
            .faults(request.getFaults())
            .duration(request.getDuration())
            .metrics(request.getMetricsToMonitor())
            .status(ExperimentStatus.PENDING)
            .build();
    }

    @Async
    public CompletableFuture<ChaosExperimentResult> runExperiment(
            ChaosExperiment experiment) {

        log.info("Starting chaos experiment: {}", experiment.getName());

        // Collect baseline metrics
        MetricsSnapshot baseline = collectMetrics();

        // Start experiment
        experiment.setStatus(ExperimentStatus.RUNNING);
        experiment.setStartedAt(Instant.now());

        try {
            // Inject faults
            for (FaultConfig fault : experiment.getFaults()) {
                injectFault(fault);
            }

            // Wait for duration
            Thread.sleep(experiment.getDuration().toMillis());

            // Collect experiment metrics
            MetricsSnapshot experimentMetrics = collectMetrics();

            // Stop faults
            stopAllFaults();

            // Analyze results
            return CompletableFuture.completedFuture(
                analyzeResults(experiment, baseline, experimentMetrics));

        } catch (Exception e) {
            log.error("Chaos experiment failed", e);
            stopAllFaults();
            return CompletableFuture.failedFuture(e);
        }
    }

    public void abortExperiment(UUID experimentId) {
        log.warn("Aborting chaos experiment: {}", experimentId);
        stopAllFaults();
    }
}
```

## REST API for Chaos Control

```java
@RestController
@RequestMapping("/chaos")
@ConditionalOnProperty(prefix = "apigen.chaos", name = "enabled")
public class ChaosController {

    private final ChaosTestOrchestrator orchestrator;

    @PostMapping("/experiments")
    public ChaosExperiment createExperiment(
            @RequestBody @Valid ChaosExperimentRequest request) {
        return orchestrator.createExperiment(request);
    }

    @PostMapping("/experiments/{id}/start")
    public void startExperiment(@PathVariable UUID id) {
        orchestrator.runExperiment(id);
    }

    @PostMapping("/experiments/{id}/abort")
    public void abortExperiment(@PathVariable UUID id) {
        orchestrator.abortExperiment(id);
    }

    @GetMapping("/experiments/{id}/status")
    public ChaosExperimentStatus getStatus(@PathVariable UUID id) {
        return orchestrator.getStatus(id);
    }
}
```

## Related Skills

- `chaos-engineering`: Chaos engineering concepts
- `spring-boot-4`: Spring Boot 4.0 patterns
- `testcontainers`: Integration testing


