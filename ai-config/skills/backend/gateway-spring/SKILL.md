---
name: gateway-spring
description: >
  Spring Cloud Gateway. Routes, filters, predicates, rate limiting, circuit breaker.
  Trigger: apigen-gateway, Spring Cloud Gateway, RouteLocator, GatewayFilter
tools:
  - Read
  - Write
  - Edit
  - Bash
  - Grep
metadata:
  author: apigen-team
  version: "1.0"
  tags: [gateway, spring-boot, routing, java]
  scope: ["apigen-gateway/**"]
---

# Gateway Spring Boot (apigen-gateway)

## Configuration

```yaml
spring:
  cloud:
    gateway:
      default-filters:
        - DedupeResponseHeader=Access-Control-Allow-Origin
        - AddResponseHeader=X-Request-Id, ${random.uuid}

      routes:
        - id: user-service
          uri: lb://user-service
          predicates:
            - Path=/api/users/**
          filters:
            - StripPrefix=1
            - name: CircuitBreaker
              args:
                name: userServiceCB
                fallbackUri: forward:/fallback/users

        - id: order-service
          uri: lb://order-service
          predicates:
            - Path=/api/orders/**
          filters:
            - StripPrefix=1
            - name: RequestRateLimiter
              args:
                redis-rate-limiter.replenishRate: 10
                redis-rate-limiter.burstCapacity: 20

      globalcors:
        cors-configurations:
          '[/**]':
            allowedOrigins: "*"
            allowedMethods:
              - GET
              - POST
              - PUT
              - DELETE
            allowedHeaders: "*"

apigen:
  gateway:
    enabled: true
    rate-limit:
      enabled: true
      default-limit: 100
```

## Java Configuration

```java
@Configuration
public class GatewayConfiguration {

    @Bean
    public RouteLocator customRouteLocator(RouteLocatorBuilder builder) {
        return builder.routes()
            // User service
            .route("user-service", r -> r
                .path("/api/users/**")
                .filters(f -> f
                    .stripPrefix(1)
                    .addRequestHeader("X-Gateway-Source", "apigen")
                    .circuitBreaker(c -> c
                        .setName("userServiceCB")
                        .setFallbackUri("forward:/fallback/users"))
                    .retry(retryConfig -> retryConfig
                        .setRetries(3)
                        .setStatuses(HttpStatus.SERVICE_UNAVAILABLE)
                        .setBackoff(Duration.ofMillis(100), Duration.ofSeconds(1), 2, true)))
                .uri("lb://user-service"))

            // Order service with rate limiting
            .route("order-service", r -> r
                .path("/api/orders/**")
                .filters(f -> f
                    .stripPrefix(1)
                    .requestRateLimiter(c -> c
                        .setRateLimiter(redisRateLimiter())
                        .setKeyResolver(userKeyResolver())))
                .uri("lb://order-service"))

            // Rewrite path
            .route("product-service", r -> r
                .path("/products/**")
                .filters(f -> f
                    .rewritePath("/products/(?<segment>.*)", "/api/v1/products/${segment}"))
                .uri("lb://product-service"))

            .build();
    }

    @Bean
    public RedisRateLimiter redisRateLimiter() {
        return new RedisRateLimiter(10, 20, 1);
    }

    @Bean
    public KeyResolver userKeyResolver() {
        return exchange -> Mono.just(
            exchange.getRequest().getHeaders()
                .getFirst("X-User-Id"));
    }
}
```

## Custom Filter

```java
@Component
public class AuthenticationGatewayFilter implements GatewayFilter, Ordered {

    private final JwtService jwtService;

    @Override
    public Mono<Void> filter(ServerWebExchange exchange, GatewayFilterChain chain) {
        String token = extractToken(exchange.getRequest());

        if (token == null) {
            exchange.getResponse().setStatusCode(HttpStatus.UNAUTHORIZED);
            return exchange.getResponse().setComplete();
        }

        try {
            Claims claims = jwtService.validateToken(token);

            // Add user info to headers for downstream services
            ServerHttpRequest mutatedRequest = exchange.getRequest().mutate()
                .header("X-User-Id", claims.getSubject())
                .header("X-User-Roles", String.join(",", claims.get("roles", List.class)))
                .build();

            return chain.filter(exchange.mutate().request(mutatedRequest).build());

        } catch (JwtException e) {
            exchange.getResponse().setStatusCode(HttpStatus.UNAUTHORIZED);
            return exchange.getResponse().setComplete();
        }
    }

    private String extractToken(ServerHttpRequest request) {
        String auth = request.getHeaders().getFirst(HttpHeaders.AUTHORIZATION);
        if (auth != null && auth.startsWith("Bearer ")) {
            return auth.substring(7);
        }
        return null;
    }

    @Override
    public int getOrder() {
        return -100; // High priority
    }
}

// Register as named filter
@Component
public class AuthenticationGatewayFilterFactory
        extends AbstractGatewayFilterFactory<Object> {

    private final AuthenticationGatewayFilter filter;

    @Override
    public GatewayFilter apply(Object config) {
        return filter;
    }
}
```

## Global Filter

```java
@Component
@Slf4j
public class LoggingGlobalFilter implements GlobalFilter, Ordered {

    @Override
    public Mono<Void> filter(ServerWebExchange exchange, GatewayFilterChain chain) {
        String requestId = UUID.randomUUID().toString();
        long startTime = System.currentTimeMillis();

        ServerHttpRequest request = exchange.getRequest().mutate()
            .header("X-Request-Id", requestId)
            .build();

        log.info("Gateway Request: {} {} [{}]",
            request.getMethod(),
            request.getPath(),
            requestId);

        return chain.filter(exchange.mutate().request(request).build())
            .then(Mono.fromRunnable(() -> {
                long duration = System.currentTimeMillis() - startTime;
                log.info("Gateway Response: {} {} {} {}ms [{}]",
                    request.getMethod(),
                    request.getPath(),
                    exchange.getResponse().getStatusCode(),
                    duration,
                    requestId);
            }));
    }

    @Override
    public int getOrder() {
        return -1;
    }
}
```

## Circuit Breaker Configuration

```java
@Configuration
public class CircuitBreakerConfiguration {

    @Bean
    public Customizer<ReactiveResilience4JCircuitBreakerFactory> defaultCustomizer() {
        return factory -> factory.configureDefault(id ->
            new Resilience4JConfigBuilder(id)
                .circuitBreakerConfig(CircuitBreakerConfig.custom()
                    .slidingWindowSize(10)
                    .failureRateThreshold(50)
                    .waitDurationInOpenState(Duration.ofSeconds(30))
                    .permittedNumberOfCallsInHalfOpenState(5)
                    .build())
                .timeLimiterConfig(TimeLimiterConfig.custom()
                    .timeoutDuration(Duration.ofSeconds(3))
                    .build())
                .build());
    }
}
```

## Fallback Controller

```java
@RestController
@RequestMapping("/fallback")
public class FallbackController {

    @GetMapping("/users")
    public ResponseEntity<Map<String, String>> usersFallback() {
        return ResponseEntity
            .status(HttpStatus.SERVICE_UNAVAILABLE)
            .body(Map.of(
                "error", "User service temporarily unavailable",
                "fallback", "true"
            ));
    }

    @GetMapping("/orders")
    public ResponseEntity<Map<String, String>> ordersFallback() {
        return ResponseEntity
            .status(HttpStatus.SERVICE_UNAVAILABLE)
            .body(Map.of(
                "error", "Order service temporarily unavailable",
                "fallback", "true"
            ));
    }
}
```

## Service Discovery Integration

```yaml
spring:
  cloud:
    gateway:
      discovery:
        locator:
          enabled: true
          lower-case-service-id: true
          predicates:
            - name: Path
              args:
                pattern: "'/api/' + serviceId + '/**'"
          filters:
            - name: StripPrefix
              args:
                parts: 2

eureka:
  client:
    service-url:
      defaultZone: http://localhost:8761/eureka/
```

## Rate Limiting with Redis

```java
@Configuration
public class RateLimitConfiguration {

    @Bean
    public KeyResolver apiKeyResolver() {
        return exchange -> {
            String apiKey = exchange.getRequest().getHeaders()
                .getFirst("X-API-Key");
            return Mono.just(apiKey != null ? apiKey : "anonymous");
        };
    }

    @Bean
    public KeyResolver ipKeyResolver() {
        return exchange -> Mono.just(
            Objects.requireNonNull(exchange.getRequest().getRemoteAddress())
                .getAddress().getHostAddress());
    }

    @Bean
    public RedisRateLimiter customRateLimiter() {
        // 100 requests per second, burst of 200
        return new RedisRateLimiter(100, 200, 1);
    }
}
```

## Testing

```java
@SpringBootTest(webEnvironment = WebEnvironment.RANDOM_PORT)
@AutoConfigureWebTestClient
class GatewayTest {

    @Autowired
    private WebTestClient webClient;

    @Test
    void shouldRouteToUserService() {
        webClient.get()
            .uri("/api/users/123")
            .header("Authorization", "Bearer valid-token")
            .exchange()
            .expectStatus().isOk()
            .expectHeader().exists("X-Request-Id");
    }

    @Test
    void shouldReturn401WithoutToken() {
        webClient.get()
            .uri("/api/users/123")
            .exchange()
            .expectStatus().isUnauthorized();
    }

    @Test
    void shouldReturnFallbackOnCircuitOpen() {
        // Trigger circuit breaker
        IntStream.range(0, 10).forEach(i ->
            webClient.get()
                .uri("/api/users/123")
                .exchange());

        webClient.get()
            .uri("/api/users/123")
            .exchange()
            .expectStatus().isEqualTo(HttpStatus.SERVICE_UNAVAILABLE)
            .expectBody()
            .jsonPath("$.fallback").isEqualTo("true");
    }
}
```

## Related Skills

- `api-gateway`: API Gateway concepts
- `spring-boot-4`: Spring Boot 4.0 patterns
