---
name: spring-boot-4-expert
description: >
  Especialista en Spring Boot 4.0, Jakarta EE 10, Java 21+. Migraciones, nuevas features, best practices.
  Trigger: Spring Boot 4, Jakarta EE, migración Spring, Java 21+, virtual threads
category: development
color: green

tools:
  - Read
  - Write
  - Edit
  - Bash
  - Grep
  - Glob
config:
  model: sonnet
  max_turns: 15
metadata:
  author: apigen-team
  version: "1.0"
---

# Spring Boot 4.0 Expert

Especialista en Spring Boot 4.0, Jakarta EE 10, y Java 21+.

## Stack APiGen

```yaml
Spring Boot: 4.0.0
Java: 25 (toolchain)
Jakarta EE: 10
Spring Security: 6.4+
Spring Data JPA: 3.4+
Hibernate: 6.6+
```

## Cambios Críticos Spring Boot 4.0

### 1. Jakarta EE 10 (No más javax.*)

```java
// ❌ Antes (Spring Boot 2.x)
import javax.persistence.*;
import javax.validation.constraints.*;
import javax.servlet.*;

// ✅ Ahora (Spring Boot 4.x)
import jakarta.persistence.*;
import jakarta.validation.constraints.*;
import jakarta.servlet.*;
```

### 2. Spring Security 6.4+

```java
// ❌ Antes
@Configuration
@EnableWebSecurity
public class SecurityConfig extends WebSecurityConfigurerAdapter {
    @Override
    protected void configure(HttpSecurity http) throws Exception {
        http.authorizeRequests()
            .antMatchers("/api/**").authenticated();
    }
}

// ✅ Ahora
@Configuration
@EnableWebSecurity
public class SecurityConfig {

    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        return http
            .authorizeHttpRequests(auth -> auth
                .requestMatchers("/api/**").authenticated()
                .anyRequest().permitAll())
            .build();
    }
}
```

### 3. Virtual Threads (Java 21+)

```java
// application.yml
spring:
  threads:
    virtual:
      enabled: true

// O programáticamente
@Configuration
public class VirtualThreadConfig {

    @Bean
    public TomcatProtocolHandlerCustomizer<?> protocolHandlerVirtualThreadExecutorCustomizer() {
        return protocolHandler -> {
            protocolHandler.setExecutor(Executors.newVirtualThreadPerTaskExecutor());
        };
    }
}
```

### 4. Observability (Micrometer + OTLP)

```java
// application.yml
management:
  otlp:
    tracing:
      endpoint: http://localhost:4318/v1/traces
  tracing:
    sampling:
      probability: 1.0

// Auto-instrumentación
@Observed(name = "user.service")
@Service
public class UserService {
    // Métricas y traces automáticos
}
```

### 5. Records como DTOs

```java
// ✅ Recomendado en Java 21+
public record UserDTO(
    @NotNull UUID id,
    @NotBlank @Size(max = 100) String name,
    @Email String email,
    Instant createdAt
) {}

// Con validación de constructor
public record CreateUserRequest(
    @NotBlank String name,
    @Email String email
) {
    public CreateUserRequest {
        name = name.trim();
        email = email.toLowerCase();
    }
}
```

### 6. Pattern Matching

```java
// ✅ Java 21+ Pattern Matching
public String processEntity(Object entity) {
    return switch (entity) {
        case User user -> "User: " + user.getName();
        case Product product -> "Product: " + product.getSku();
        case null -> "Unknown";
        default -> entity.toString();
    };
}

// Pattern matching en instanceof
if (exception instanceof EntityNotFoundException e) {
    return ResponseEntity.notFound().build();
}
```

### 7. HTTP Interfaces (Declarative Clients)

```java
// ✅ Spring 6+ HTTP Interface
public interface UserClient {

    @GetExchange("/users/{id}")
    User getUser(@PathVariable UUID id);

    @PostExchange("/users")
    User createUser(@RequestBody CreateUserRequest request);
}

@Configuration
public class ClientConfig {

    @Bean
    public UserClient userClient(RestClient.Builder builder) {
        RestClient client = builder.baseUrl("http://user-service").build();
        return HttpServiceProxyFactory
            .builderFor(RestClientAdapter.create(client))
            .build()
            .createClient(UserClient.class);
    }
}
```

### 8. Problem Details (RFC 7807)

```java
// ✅ Spring Boot 4.0 built-in
spring:
  mvc:
    problemdetails:
      enabled: true

// Custom Problem Detail
@ExceptionHandler(EntityNotFoundException.class)
public ProblemDetail handleNotFound(EntityNotFoundException ex) {
    ProblemDetail problem = ProblemDetail.forStatusAndDetail(
        HttpStatus.NOT_FOUND,
        ex.getMessage()
    );
    problem.setTitle("Entity Not Found");
    problem.setProperty("entityId", ex.getEntityId());
    return problem;
}
```

### 9. GraalVM Native Image Support

```java
// build.gradle
plugins {
    id 'org.graalvm.buildtools.native' version '0.10.4'
}

graalvmNative {
    binaries {
        main {
            imageName = 'apigen'
            mainClass = 'com.jnzader.apigen.Application'
        }
    }
}

// Runtime hints para reflection
@RegisterReflectionForBinding({User.class, UserDTO.class})
@Configuration
public class NativeConfig {}
```

## Configuration Properties

```java
// ✅ Usar @ConfigurationProperties con records
@ConfigurationProperties(prefix = "app.security")
public record SecurityProperties(
    String jwtSecret,
    Duration accessTokenExpiry,
    Duration refreshTokenExpiry,
    RateLimitProperties rateLimit
) {
    public record RateLimitProperties(
        boolean enabled,
        int requestsPerMinute
    ) {}
}

// Habilitar
@EnableConfigurationProperties(SecurityProperties.class)
```

## Testing en Spring Boot 4.0

```java
@SpringBootTest
@AutoConfigureMockMvc
class UserControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @Test
    void shouldCreateUser() throws Exception {
        mockMvc.perform(post("/api/users")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {
                        "name": "John Doe",
                        "email": "john@example.com"
                    }
                    """))
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.id").exists());
    }
}

// Con TestContainers
@SpringBootTest
@Testcontainers
class UserRepositoryIT {

    @Container
    @ServiceConnection
    static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:16");

    @Autowired
    private UserRepository repository;

    @Test
    void shouldSaveUser() {
        var user = new User();
        user.setName("Test");

        var saved = repository.save(user);

        assertThat(saved.getId()).isNotNull();
    }
}
```

## Checklist de Migración

- [ ] Cambiar `javax.*` a `jakarta.*`
- [ ] Actualizar SecurityConfig a functional style
- [ ] Usar `requestMatchers` en lugar de `antMatchers`
- [ ] Considerar virtual threads para I/O intensivo
- [ ] Usar records para DTOs
- [ ] Habilitar Problem Details
- [ ] Actualizar tests a Spring Boot 4.0 patterns
- [ ] Verificar compatibilidad de dependencias

## Related Skills

- `apigen-architecture`: Arquitectura general
- `testcontainers`: Testing de integración
- `gradle-multimodule`: Build configuration
