---
name: spring-boot-4
description: >
  Spring Boot 4.0 patterns, Jakarta EE 10, Java 21+ features, migrations.
  Trigger: Spring Boot 4, Jakarta, Java 21, virtual threads, migration
tools:
  - Read
  - Write
  - Edit
  - Grep
metadata:
  author: apigen-team
  version: "1.0"
  tags: [spring-boot, jakarta, java21]
  scope: ["**/src/main/java/**"]
---

# Spring Boot 4.0 Patterns

## Quick Reference

### Jakarta EE Migration

| Antes (javax) | Ahora (jakarta) |
|---------------|-----------------|
| `javax.persistence.*` | `jakarta.persistence.*` |
| `javax.validation.*` | `jakarta.validation.*` |
| `javax.servlet.*` | `jakarta.servlet.*` |
| `javax.annotation.*` | `jakarta.annotation.*` |

### Security Configuration

```java
// ✅ Spring Security 6.4+
@Bean
public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
    return http
        .csrf(csrf -> csrf.disable())
        .sessionManagement(session -> session
            .sessionCreationPolicy(SessionCreationPolicy.STATELESS))
        .authorizeHttpRequests(auth -> auth
            .requestMatchers("/api/public/**").permitAll()
            .requestMatchers("/api/admin/**").hasRole("ADMIN")
            .anyRequest().authenticated())
        .oauth2ResourceServer(oauth2 -> oauth2.jwt(Customizer.withDefaults()))
        .build();
}
```

### Virtual Threads

```yaml
# application.yml
spring:
  threads:
    virtual:
      enabled: true
```

### Records as DTOs

```java
public record UserDTO(
    @NotNull UUID id,
    @NotBlank String name,
    @Email String email
) {}
```

### Problem Details

```java
@ExceptionHandler(EntityNotFoundException.class)
public ProblemDetail handleNotFound(EntityNotFoundException ex) {
    ProblemDetail problem = ProblemDetail.forStatusAndDetail(
        HttpStatus.NOT_FOUND, ex.getMessage());
    problem.setTitle("Entity Not Found");
    return problem;
}
```

### HTTP Interface (Declarative Client)

```java
public interface UserClient {
    @GetExchange("/users/{id}")
    User getUser(@PathVariable UUID id);
}

@Bean
public UserClient userClient(RestClient.Builder builder) {
    return HttpServiceProxyFactory
        .builderFor(RestClientAdapter.create(builder.baseUrl("http://api").build()))
        .build()
        .createClient(UserClient.class);
}
```

### @ConfigurationProperties with Records

```java
@ConfigurationProperties(prefix = "app")
public record AppProperties(
    String name,
    Duration timeout,
    CacheProperties cache
) {
    public record CacheProperties(boolean enabled, Duration ttl) {}
}
```

### Observability

```java
@Observed(name = "user.service", contextualName = "findUser")
public User findById(UUID id) {
    return repository.findById(id).orElseThrow();
}
```

### TestContainers with @ServiceConnection

```java
@SpringBootTest
@Testcontainers
class UserRepositoryIT {

    @Container
    @ServiceConnection
    static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:16");

    // Auto-configures datasource from container
}
```

## Anti-Patterns

### ❌ WebSecurityConfigurerAdapter (deprecated)

```java
// ❌ No usar
public class Config extends WebSecurityConfigurerAdapter { }

// ✅ Usar SecurityFilterChain bean
```

### ❌ antMatchers (removed)

```java
// ❌ No existe
.antMatchers("/api/**")

// ✅ Usar
.requestMatchers("/api/**")
```

### ❌ javax imports

```java
// ❌ Ya no funciona
import javax.persistence.Entity;

// ✅ Jakarta
import jakarta.persistence.Entity;
```

## Related Skills

- `apigen-architecture`: Arquitectura APiGen
- `testcontainers`: Testing integration
- `gradle-multimodule`: Build config

