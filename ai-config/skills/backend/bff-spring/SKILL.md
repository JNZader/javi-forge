---
name: bff-spring
description: >
  Spring Boot BFF implementation. Client detection, response tailoring, service composition.
  Trigger: apigen-bff, BaseBffController, ClientType, TailorForClient, aggregation
tools:
  - Read
  - Write
  - Edit
  - Bash
  - Grep
metadata:
  author: apigen-team
  version: "1.0"
  tags: [bff, spring-boot, aggregation, java]
  scope: ["apigen-bff/**"]
---

# BFF Spring Boot (apigen-bff)

## Configuration

```yaml
apigen:
  bff:
    enabled: true

    client-detection:
      header: X-Client-Type
      fallback: WEB

    rate-limits:
      web:
        requests-per-minute: 1000
      mobile:
        requests-per-minute: 500
      iot:
        requests-per-minute: 100

    response-tailoring:
      enabled: true
      compress-mobile: true

    composition:
      timeout: 5s
      parallel-enabled: true
```

## Client Type Detection

```java
public enum ClientType {
    WEB("web"),
    MOBILE_IOS("ios"),
    MOBILE_ANDROID("android"),
    TABLET("tablet"),
    TV("tv"),
    IOT("iot"),
    PARTNER("partner");

    public boolean isMobile() {
        return this == MOBILE_IOS || this == MOBILE_ANDROID;
    }

    public boolean requiresCompression() {
        return isMobile() || this == IOT;
    }
}
```

## Annotations

```java
@Target(ElementType.METHOD)
@Retention(RetentionPolicy.RUNTIME)
public @interface BffEndpoint {
    ClientType[] clients() default {};
    String[] include() default {};
    boolean aggregate() default false;
}

@Target(ElementType.METHOD)
@Retention(RetentionPolicy.RUNTIME)
public @interface TailorForClient {
    ClientType value();
    String[] fields() default {};
    boolean compress() default false;
}
```

## Base BFF Controller

```java
@RestController
@RequestMapping("/bff")
public abstract class BaseBffController {

    protected final QueryCompositionService compositionService;
    protected final ResponseTailoringService tailoringService;
    protected final CombinedRateLimitService rateLimitService;

    protected ClientType detectClient(HttpServletRequest request) {
        String clientHeader = request.getHeader("X-Client-Type");
        if (clientHeader != null) {
            return ClientType.fromValue(clientHeader);
        }

        String userAgent = request.getHeader("User-Agent");
        return ClientTypeDetector.fromUserAgent(userAgent);
    }

    protected <T> T tailorResponse(T response, ClientType clientType) {
        return tailoringService.tailor(response, clientType);
    }
}
```

## Query Composition Service

```java
@Service
public class QueryCompositionServiceImpl implements QueryCompositionService {

    private final List<ServiceRequest> serviceRequests;
    private final ExecutorService executor;

    @Override
    public AggregatedResponse compose(List<String> includes,
                                       Map<String, Object> params) {

        List<CompletableFuture<ServiceResult>> futures = includes.stream()
            .map(include -> findServiceRequest(include))
            .map(sr -> CompletableFuture.supplyAsync(
                () -> executeService(sr, params), executor)
                .exceptionally(this::handleFailure))
            .toList();

        CompletableFuture.allOf(futures.toArray(new CompletableFuture[0]))
            .orTimeout(5, TimeUnit.SECONDS)
            .join();

        return aggregateResults(futures);
    }

    private ServiceResult handleFailure(Throwable ex) {
        log.warn("Service call failed: {}", ex.getMessage());
        return ServiceResult.failure(ex.getMessage());
    }
}
```

## Response Tailoring Service

```java
@Service
public class ResponseTailoringServiceImpl implements ResponseTailoringService {

    private final ObjectMapper objectMapper;
    private final Map<ClientType, Set<String>> fieldMappings;

    @Override
    @SuppressWarnings("unchecked")
    public <T> T tailor(T response, ClientType clientType) {
        if (response == null) return null;

        Set<String> allowedFields = fieldMappings.get(clientType);
        if (allowedFields == null || allowedFields.isEmpty()) {
            return response;
        }

        // Convert to map, filter fields, convert back
        Map<String, Object> map = objectMapper.convertValue(response, Map.class);
        Map<String, Object> filtered = filterFields(map, allowedFields);

        return (T) objectMapper.convertValue(filtered, response.getClass());
    }

    private Map<String, Object> filterFields(Map<String, Object> source,
                                              Set<String> allowed) {
        return source.entrySet().stream()
            .filter(e -> allowed.contains(e.getKey()))
            .collect(Collectors.toMap(Map.Entry::getKey, Map.Entry::getValue));
    }
}
```

## Aggregated Response Model

```java
public record AggregatedResponse(
    Map<String, Object> data,
    Map<String, ErrorInfo> errors,
    ResponseMetadata metadata
) {
    public boolean hasErrors() {
        return errors != null && !errors.isEmpty();
    }

    public static Builder builder() {
        return new Builder();
    }

    public static class Builder {
        private final Map<String, Object> data = new HashMap<>();
        private final Map<String, ErrorInfo> errors = new HashMap<>();

        public Builder addData(String key, Object value) {
            data.put(key, value);
            return this;
        }

        public Builder addError(String key, String message) {
            errors.put(key, new ErrorInfo(message, null));
            return this;
        }

        public AggregatedResponse build() {
            return new AggregatedResponse(data, errors,
                new ResponseMetadata(Instant.now()));
        }
    }
}
```

## BFF Endpoint Aspect

```java
@Aspect
@Component
public class BffEndpointAspect {

    private final CombinedRateLimitService rateLimitService;

    @Around("@annotation(bffEndpoint)")
    public Object handleBffEndpoint(ProceedingJoinPoint joinPoint,
                                     BffEndpoint bffEndpoint) throws Throwable {

        HttpServletRequest request = getCurrentRequest();
        ClientType clientType = detectClient(request);

        // Check client type restriction
        if (bffEndpoint.clients().length > 0 &&
            !Arrays.asList(bffEndpoint.clients()).contains(clientType)) {
            throw new ClientTypeNotAllowedException(clientType);
        }

        // Apply rate limiting
        rateLimitService.checkLimit(clientType, request);

        return joinPoint.proceed();
    }
}
```

## Example BFF Controller

```java
@RestController
@RequestMapping("/bff/v1")
public class DashboardBffController extends BaseBffController {

    private final UserService userService;
    private final OrderService orderService;
    private final NotificationService notificationService;

    @GetMapping("/dashboard")
    @BffEndpoint(aggregate = true)
    public AggregatedResponse getDashboard(
            @RequestParam(defaultValue = "profile,notifications") String include,
            HttpServletRequest request) {

        ClientType client = detectClient(request);
        List<String> includes = Arrays.asList(include.split(","));

        AggregatedResponse.Builder builder = AggregatedResponse.builder();

        if (includes.contains("profile")) {
            UserDTO profile = userService.getCurrentUser();
            builder.addData("profile", tailorResponse(profile, client));
        }

        if (includes.contains("notifications")) {
            int limit = client.isMobile() ? 5 : 20;
            List<NotificationDTO> notifications =
                notificationService.getRecent(limit);
            builder.addData("notifications", notifications);
        }

        if (includes.contains("orders")) {
            List<OrderDTO> orders = orderService.getRecentOrders();
            builder.addData("orders", tailorResponse(orders, client));
        }

        return builder.build();
    }

    @GetMapping("/dashboard")
    @TailorForClient(value = ClientType.MOBILE_IOS,
                     fields = {"id", "name", "avatarThumb"})
    public MobileDashboardResponse getMobileDashboard() {
        // iOS-specific optimized response
    }
}
```

## Rate Limiting Service

```java
@Service
public class CombinedRateLimitServiceImpl implements CombinedRateLimitService {

    private final Map<ClientType, Bucket> buckets = new ConcurrentHashMap<>();
    private final BffProperties properties;

    @Override
    public void checkLimit(ClientType clientType, HttpServletRequest request) {
        Bucket bucket = buckets.computeIfAbsent(clientType, this::createBucket);

        if (!bucket.tryConsume(1)) {
            throw new RateLimitExceededException(
                "Rate limit exceeded for client type: " + clientType);
        }
    }

    private Bucket createBucket(ClientType clientType) {
        int rpm = properties.getRateLimits()
            .getOrDefault(clientType, 100);

        return Bucket.builder()
            .addLimit(Bandwidth.simple(rpm, Duration.ofMinutes(1)))
            .build();
    }
}
```

## Testing

```java
@WebMvcTest(DashboardBffController.class)
class DashboardBffControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @MockBean
    private UserService userService;

    @Test
    void shouldTailorResponseForMobile() throws Exception {
        when(userService.getCurrentUser()).thenReturn(fullUserDto());

        mockMvc.perform(get("/bff/v1/dashboard")
                .header("X-Client-Type", "ios"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data.profile.email").doesNotExist())
            .andExpect(jsonPath("$.data.profile.id").exists());
    }
}
```

## Related Skills

- `bff-concepts`: BFF pattern concepts
- `spring-boot-4`: Spring Boot 4.0 patterns
