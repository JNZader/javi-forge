---
name: testcontainers
description: >
  Testing con TestContainers en APiGen. PostgreSQL, Redis, integración Spring Boot.
  Trigger: testcontainers, integration test, PostgreSQL test, container test
tools:
  - Read
  - Write
  - Edit
  - Bash
  - Grep
metadata:
  author: apigen-team
  version: "1.0"
  tags: [testing, testcontainers, integration]
  scope: ["**/src/test/**"]
---

# TestContainers

## Dependencias

```groovy
testImplementation 'org.springframework.boot:spring-boot-testcontainers'
testImplementation 'org.testcontainers:junit-jupiter'
testImplementation 'org.testcontainers:postgresql'
testImplementation 'org.testcontainers:rabbitmq'  // si aplica
```

## @ServiceConnection (Spring Boot 3.1+)

```java
@SpringBootTest
@Testcontainers
class UserRepositoryIT {

    @Container
    @ServiceConnection
    static PostgreSQLContainer<?> postgres =
        new PostgreSQLContainer<>("postgres:16-alpine");

    @Autowired
    private UserRepository userRepository;

    @Test
    void shouldSaveAndFindUser() {
        var user = User.builder()
            .name("Test User")
            .email("test@example.com")
            .build();

        var saved = userRepository.save(user);

        assertThat(saved.getId()).isNotNull();
        assertThat(userRepository.findById(saved.getId()))
            .isPresent()
            .hasValueSatisfying(u -> assertThat(u.getName()).isEqualTo("Test User"));
    }
}
```

## Container Singleton (Reusable)

```java
public abstract class AbstractContainerIT {

    @Container
    @ServiceConnection
    protected static final PostgreSQLContainer<?> POSTGRES =
        new PostgreSQLContainer<>("postgres:16-alpine")
            .withDatabaseName("testdb")
            .withUsername("test")
            .withPassword("test")
            .withReuse(true);  // Reuse entre tests

    static {
        POSTGRES.start();
    }
}

// Heredar en tests
@SpringBootTest
class UserServiceIT extends AbstractContainerIT {
    // ...
}
```

## Multiple Containers

```java
@SpringBootTest
@Testcontainers
class FullStackIT {

    @Container
    @ServiceConnection
    static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:16");

    @Container
    @ServiceConnection
    static GenericContainer<?> redis = new GenericContainer<>("redis:7-alpine")
        .withExposedPorts(6379);

    @DynamicPropertySource
    static void redisProperties(DynamicPropertyRegistry registry) {
        registry.add("spring.data.redis.host", redis::getHost);
        registry.add("spring.data.redis.port", () -> redis.getMappedPort(6379));
    }

    @Autowired
    private UserService userService;

    @Autowired
    private RedisTemplate<String, Object> redisTemplate;

    @Test
    void shouldCacheUserInRedis() {
        var user = userService.create(new CreateUserDTO("Test", "test@test.com"));

        // First call - from DB
        userService.findById(user.getId());

        // Second call - from cache
        var cached = redisTemplate.opsForValue().get("users::" + user.getId());
        assertThat(cached).isNotNull();
    }
}
```

## Test Profile (application-test.yml)

```yaml
# src/test/resources/application-test.yml
spring:
  jpa:
    hibernate:
      ddl-auto: create-drop
    show-sql: true
  flyway:
    enabled: false  # TestContainers crea schema

logging:
  level:
    org.hibernate.SQL: DEBUG
    org.testcontainers: INFO
```

## Controller Integration Test

```java
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@Testcontainers
@ActiveProfiles("test")
class UserControllerIT {

    @Container
    @ServiceConnection
    static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:16");

    @Autowired
    private TestRestTemplate restTemplate;

    @Autowired
    private UserRepository userRepository;

    @BeforeEach
    void setUp() {
        userRepository.deleteAll();
    }

    @Test
    void shouldCreateUser() {
        var request = new CreateUserRequest("John Doe", "john@example.com");

        var response = restTemplate.postForEntity(
            "/api/users",
            request,
            UserDTO.class
        );

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.CREATED);
        assertThat(response.getBody()).isNotNull();
        assertThat(response.getBody().name()).isEqualTo("John Doe");
    }

    @Test
    void shouldReturnNotFoundForInvalidId() {
        var response = restTemplate.getForEntity(
            "/api/users/{id}",
            ProblemDetail.class,
            UUID.randomUUID()
        );

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
    }
}
```

## WebTestClient (WebFlux style)

```java
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@Testcontainers
class UserControllerWebClientIT {

    @Container
    @ServiceConnection
    static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:16");

    @Autowired
    private WebTestClient webClient;

    @Test
    void shouldListUsers() {
        webClient.get()
            .uri("/api/users")
            .exchange()
            .expectStatus().isOk()
            .expectBodyList(UserDTO.class)
            .hasSize(0);
    }

    @Test
    void shouldCreateUser() {
        webClient.post()
            .uri("/api/users")
            .bodyValue(new CreateUserRequest("Test", "test@test.com"))
            .exchange()
            .expectStatus().isCreated()
            .expectBody()
            .jsonPath("$.id").exists()
            .jsonPath("$.name").isEqualTo("Test");
    }
}
```

## Compilar Proyecto Generado (apigen-server)

```java
@SpringBootTest
@Testcontainers
@Tag("slow")
class GeneratedProjectCompilationIT {

    @Container
    @ServiceConnection
    static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:16");

    @Autowired
    private GenerationService generationService;

    @TempDir
    Path tempDir;

    @Test
    @EnabledIfEnvironmentVariable(named = "CI_COMPILE_GENERATED_PROJECT", matches = "true")
    void generatedJavaProjectShouldCompile() throws Exception {
        var request = GenerationRequest.builder()
            .projectName("test-project")
            .basePackage("com.test")
            .language("java")
            .framework("spring-boot")
            .schema("CREATE TABLE users (id UUID PRIMARY KEY, name VARCHAR(100));")
            .build();

        byte[] zipBytes = generationService.generate(request);

        // Extract ZIP
        Path projectDir = extractZip(zipBytes, tempDir);

        // Compile
        ProcessBuilder pb = new ProcessBuilder("./gradlew", "compileJava", "--no-daemon");
        pb.directory(projectDir.toFile());
        pb.inheritIO();

        int exitCode = pb.start().waitFor();

        assertThat(exitCode)
            .withFailMessage("Generated project failed to compile")
            .isZero();
    }
}
```

## Best Practices

1. **Use @ServiceConnection** - Auto-configura datasource
2. **Singleton containers** - `withReuse(true)` para velocidad
3. **@ActiveProfiles("test")** - Config específica de test
4. **@TempDir** - Para archivos temporales
5. **@Tag("slow")** - Marcar tests lentos
6. **@EnabledIf** - Condicionar ejecución en CI

## Related Skills

- `spring-boot-4`: Spring Boot testing
- `apigen-architecture`: Estructura de tests


