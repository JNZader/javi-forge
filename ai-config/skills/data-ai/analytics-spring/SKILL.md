---
name: analytics-spring
description: >
  Spring Boot analytics with multi-provider support. GA4, Mixpanel, Amplitude, Segment.
  Trigger: apigen-analytics, AnalyticsService, provider, tracking, Spring analytics
tools:
  - Read
  - Write
  - Edit
  - Bash
  - Grep
metadata:
  author: apigen-team
  version: "1.0"
  tags: [analytics, spring-boot, providers, java]
  scope: ["apigen-analytics/**"]
---

# Analytics Spring Boot (apigen-analytics)

## Configuration

```yaml
apigen:
  analytics:
    enabled: true
    default-provider: segment

    providers:
      google-analytics:
        enabled: true
        measurement-id: G-XXXXXXXXXX
        api-secret: ${GA_API_SECRET}

      mixpanel:
        enabled: true
        token: ${MIXPANEL_TOKEN}
        api-secret: ${MIXPANEL_SECRET}

      amplitude:
        enabled: true
        api-key: ${AMPLITUDE_API_KEY}

      segment:
        enabled: true
        write-key: ${SEGMENT_WRITE_KEY}

    batching:
      enabled: true
      size: 100
      flush-interval: 10s

    async:
      enabled: true
      pool-size: 4
```

## Provider Pattern

```java
public interface AnalyticsProvider {
    String getProviderId();

    TrackingResult track(AnalyticsEvent event);
    IdentifyResult identify(IdentifyRequest request);
    AliasResult alias(AliasRequest request);
    void setUserProperties(UserPropertiesRequest request);

    CompletableFuture<BatchTrackingResult> trackBatch(List<AnalyticsEvent> events);
    ProviderHealth healthCheck();
    void flush();
}
```

## Abstract Provider Base

```java
public abstract class AbstractAnalyticsProvider implements AnalyticsProvider {

    protected final RestClient restClient;
    protected final MeterRegistry meterRegistry;

    @Override
    public TrackingResult track(AnalyticsEvent event) {
        Timer.Sample sample = Timer.start(meterRegistry);
        try {
            TrackingResult result = doTrack(event);
            recordSuccess(sample);
            return result;
        } catch (Exception e) {
            recordFailure(sample, e);
            throw new EventTrackingException("Failed to track event", e);
        }
    }

    protected abstract TrackingResult doTrack(AnalyticsEvent event);

    // Common retry logic
    protected <T> T withRetry(Supplier<T> operation) {
        return Retry.decorateSupplier(retry, operation).get();
    }
}
```

## Service Layer

```java
@Service
@RequiredArgsConstructor
public class AnalyticsService {

    private final List<AnalyticsProvider> providers;
    private final AnalyticsEventRepository eventRepository;

    @Async("analyticsExecutor")
    public CompletableFuture<Void> track(String eventName,
                                          String userId,
                                          Map<String, Object> properties) {

        AnalyticsEvent event = AnalyticsEvent.builder()
            .eventName(eventName)
            .userId(userId)
            .properties(properties)
            .timestamp(Instant.now())
            .build();

        // Persist locally
        eventRepository.save(event);

        // Fan-out to all enabled providers
        List<CompletableFuture<TrackingResult>> futures = providers.stream()
            .filter(AnalyticsProvider::isEnabled)
            .map(provider -> CompletableFuture.supplyAsync(
                () -> provider.track(event)))
            .toList();

        return CompletableFuture.allOf(futures.toArray(new CompletableFuture[0]));
    }

    public void identify(String userId, Map<String, Object> traits) {
        IdentifyRequest request = new IdentifyRequest(userId, traits);
        providers.forEach(p -> p.identify(request));
    }
}
```

## Funnel Service

```java
@Service
public class FunnelService {

    private final FunnelRepository funnelRepository;
    private final FunnelConversionRepository conversionRepository;

    public FunnelAnalysis analyzeFunnel(UUID funnelId,
                                         Instant startDate,
                                         Instant endDate) {

        Funnel funnel = funnelRepository.findById(funnelId)
            .orElseThrow(() -> new FunnelNotFoundException(funnelId));

        List<FunnelStep> steps = funnel.getSteps();
        List<StepAnalysis> analysis = new ArrayList<>();

        long previousCount = 0;
        for (FunnelStep step : steps) {
            long count = conversionRepository.countByFunnelAndStep(
                funnelId, step.getOrder(), startDate, endDate);

            double conversionRate = previousCount > 0
                ? (double) count / previousCount * 100
                : 100.0;

            analysis.add(new StepAnalysis(step, count, conversionRate));
            previousCount = count;
        }

        return new FunnelAnalysis(funnel, analysis);
    }
}
```

## Cohort Service

```java
@Service
public class CohortService {

    public RetentionMatrix calculateRetention(UUID cohortId,
                                               TemporalUnit period,
                                               int periods) {

        Cohort cohort = cohortRepository.findById(cohortId)
            .orElseThrow(() -> new CohortNotFoundException(cohortId));

        List<CohortMembership> members = membershipRepository
            .findByCohortId(cohortId);

        double[][] matrix = new double[periods][periods];

        for (int i = 0; i < periods; i++) {
            Instant periodStart = cohort.getCreatedAt().plus(i, period);
            Instant periodEnd = periodStart.plus(1, period);

            long cohortSize = members.stream()
                .filter(m -> m.getJoinedAt().isBefore(periodEnd))
                .count();

            for (int j = i; j < periods; j++) {
                long activeCount = countActiveUsers(members,
                    periodStart.plus(j - i, period));
                matrix[i][j] = cohortSize > 0
                    ? (double) activeCount / cohortSize * 100
                    : 0;
            }
        }

        return new RetentionMatrix(cohort, matrix, period);
    }
}
```

## Domain Entities

```java
@Entity
@Table(name = "analytics_events")
public class AnalyticsEvent {
    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(nullable = false)
    private String eventName;

    private String userId;
    private String anonymousId;
    private String sessionId;

    @Type(JsonType.class)
    @Column(columnDefinition = "jsonb")
    private Map<String, Object> properties;

    @Column(nullable = false)
    private Instant timestamp;

    @Enumerated(EnumType.STRING)
    private TrackingStatus status = TrackingStatus.PENDING;
}

@Entity
@Table(name = "funnels")
public class Funnel {
    @Id
    private UUID id;
    private String name;

    @OneToMany(cascade = CascadeType.ALL, orphanRemoval = true)
    @OrderBy("stepOrder")
    private List<FunnelStep> steps;
}
```

## Auto Configuration

```java
@AutoConfiguration
@ConditionalOnProperty(prefix = "apigen.analytics", name = "enabled", havingValue = "true")
@EnableConfigurationProperties(AnalyticsProperties.class)
public class AnalyticsAutoConfiguration {

    @Bean
    @ConditionalOnProperty(prefix = "apigen.analytics.providers.google-analytics",
                           name = "enabled", havingValue = "true")
    public GoogleAnalyticsProvider googleAnalyticsProvider(
            AnalyticsProperties props, RestClient.Builder builder) {
        return new GoogleAnalyticsProvider(
            props.getProviders().getGoogleAnalytics(), builder);
    }

    @Bean
    @ConditionalOnProperty(prefix = "apigen.analytics.providers.mixpanel",
                           name = "enabled", havingValue = "true")
    public MixpanelProvider mixpanelProvider(
            AnalyticsProperties props, RestClient.Builder builder) {
        return new MixpanelProvider(
            props.getProviders().getMixpanel(), builder);
    }

    @Bean
    public AnalyticsService analyticsService(
            List<AnalyticsProvider> providers,
            AnalyticsEventRepository repository) {
        return new AnalyticsService(providers, repository);
    }
}
```

## Testing

```java
@SpringBootTest
@Testcontainers
class AnalyticsServiceIT {

    @Container
    @ServiceConnection
    static PostgreSQLContainer<?> postgres =
        new PostgreSQLContainer<>("postgres:16-alpine");

    @MockBean
    private MixpanelProvider mixpanelProvider;

    @Autowired
    private AnalyticsService analyticsService;

    @Test
    void shouldTrackEventToAllProviders() {
        when(mixpanelProvider.track(any()))
            .thenReturn(new TrackingResult(true, "ok"));

        analyticsService.track("user_signed_up", "user-123",
            Map.of("plan", "premium")).join();

        verify(mixpanelProvider).track(argThat(event ->
            event.getEventName().equals("user_signed_up") &&
            event.getUserId().equals("user-123")
        ));
    }
}
```

## Related Skills

- `analytics-concepts`: General analytics concepts
- `spring-boot-4`: Spring Boot 4.0 patterns
- `testcontainers`: Integration testing


