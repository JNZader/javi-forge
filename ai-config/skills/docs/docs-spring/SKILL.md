---
name: docs-spring
description: >
  Spring Boot API documentation. SpringDoc, Swagger UI, Redoc, custom themes.
  Trigger: apigen-docs, SpringDoc, Swagger, OpenAPI, @Operation, @Schema
tools:
  - Read
  - Write
  - Edit
  - Bash
  - Grep
metadata:
  author: apigen-team
  version: "1.0"
  tags: [documentation, spring-boot, springdoc, java]
  scope: ["apigen-docs/**"]
---

# API Documentation Spring Boot (apigen-docs)

## Configuration

```yaml
apigen:
  docs:
    enabled: true

    openapi:
      title: ${spring.application.name}
      version: ${app.version:1.0.0}
      description: API Documentation
      contact:
        name: API Support
        email: support@example.com
      license:
        name: Apache 2.0
        url: https://www.apache.org/licenses/LICENSE-2.0

    swagger-ui:
      enabled: true
      path: /swagger-ui
      theme: dark  # default, dark, feeling-blue
      try-it-out: true

    redoc:
      enabled: true
      path: /redoc

    graphql-playground:
      enabled: true
      path: /graphql-playground

springdoc:
  api-docs:
    path: /api-docs
  show-actuator: false
  packages-to-scan: com.example.api
```

## OpenAPI Configuration

```java
@Configuration
@EnableConfigurationProperties(DocsProperties.class)
public class OpenApiConfiguration {

    @Bean
    public OpenAPI customOpenAPI(DocsProperties props) {
        return new OpenAPI()
            .info(new Info()
                .title(props.getOpenapi().getTitle())
                .version(props.getOpenapi().getVersion())
                .description(props.getOpenapi().getDescription())
                .contact(new Contact()
                    .name(props.getOpenapi().getContact().getName())
                    .email(props.getOpenapi().getContact().getEmail()))
                .license(new License()
                    .name(props.getOpenapi().getLicense().getName())
                    .url(props.getOpenapi().getLicense().getUrl())))
            .externalDocs(new ExternalDocumentation()
                .description("API Guide")
                .url("https://docs.example.com"))
            .components(new Components()
                .addSecuritySchemes("bearerAuth", securityScheme()))
            .security(List.of(new SecurityRequirement().addList("bearerAuth")));
    }

    private SecurityScheme securityScheme() {
        return new SecurityScheme()
            .type(SecurityScheme.Type.HTTP)
            .scheme("bearer")
            .bearerFormat("JWT")
            .description("JWT token from /auth/login endpoint");
    }

    @Bean
    public GroupedOpenApi publicApi() {
        return GroupedOpenApi.builder()
            .group("public")
            .pathsToMatch("/api/**")
            .pathsToExclude("/api/admin/**")
            .build();
    }

    @Bean
    public GroupedOpenApi adminApi() {
        return GroupedOpenApi.builder()
            .group("admin")
            .pathsToMatch("/api/admin/**")
            .build();
    }
}
```

## Controller Annotations

```java
@RestController
@RequestMapping("/api/users")
@Tag(name = "Users", description = "User management operations")
@SecurityRequirement(name = "bearerAuth")
public class UserController {

    @Operation(
        summary = "Get user by ID",
        description = "Retrieves a user by their unique identifier",
        responses = {
            @ApiResponse(
                responseCode = "200",
                description = "User found",
                content = @Content(schema = @Schema(implementation = UserDTO.class))),
            @ApiResponse(
                responseCode = "404",
                description = "User not found",
                content = @Content(schema = @Schema(implementation = ProblemDetail.class)))
        }
    )
    @GetMapping("/{id}")
    public UserDTO getUser(
            @Parameter(description = "User ID", example = "123e4567-e89b-12d3-a456-426614174000")
            @PathVariable UUID id) {
        return userService.findById(id);
    }

    @Operation(
        summary = "Create user",
        description = "Creates a new user account"
    )
    @ApiResponse(responseCode = "201", description = "User created")
    @ApiResponse(responseCode = "400", description = "Invalid input")
    @ApiResponse(responseCode = "409", description = "Email already exists")
    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public UserDTO createUser(
            @RequestBody @Valid
            @io.swagger.v3.oas.annotations.parameters.RequestBody(
                description = "User to create",
                required = true,
                content = @Content(
                    examples = @ExampleObject(
                        name = "Example user",
                        value = """
                            {
                              "email": "john@example.com",
                              "name": "John Doe",
                              "password": "SecurePass123!"
                            }
                            """
                    )
                )
            )
            CreateUserRequest request) {
        return userService.create(request);
    }

    @Operation(
        summary = "List users",
        description = "Returns a paginated list of users"
    )
    @GetMapping
    public Page<UserDTO> listUsers(
            @Parameter(description = "Page number (0-indexed)")
            @RequestParam(defaultValue = "0") int page,

            @Parameter(description = "Page size")
            @RequestParam(defaultValue = "20") int size,

            @Parameter(description = "Filter by status")
            @RequestParam(required = false) UserStatus status) {
        return userService.findAll(PageRequest.of(page, size), status);
    }
}
```

## Schema Annotations

```java
@Schema(description = "User data transfer object")
public record UserDTO(
    @Schema(description = "Unique user identifier",
            example = "123e4567-e89b-12d3-a456-426614174000",
            accessMode = Schema.AccessMode.READ_ONLY)
    UUID id,

    @Schema(description = "User email address",
            example = "john@example.com",
            requiredMode = Schema.RequiredMode.REQUIRED)
    String email,

    @Schema(description = "User display name",
            example = "John Doe",
            maxLength = 100)
    String name,

    @Schema(description = "User account status",
            defaultValue = "ACTIVE")
    UserStatus status,

    @Schema(description = "Account creation timestamp",
            accessMode = Schema.AccessMode.READ_ONLY)
    Instant createdAt
) {}

@Schema(description = "Request to create a new user")
public record CreateUserRequest(
    @Schema(description = "Email address", example = "john@example.com")
    @Email @NotBlank
    String email,

    @Schema(description = "Display name", example = "John Doe")
    @NotBlank @Size(max = 100)
    String name,

    @Schema(description = "Password (min 8 chars, must contain uppercase, lowercase, digit)",
            example = "SecurePass123!",
            minLength = 8)
    @NotBlank @Size(min = 8)
    String password
) {}
```

## Custom Swagger UI Theme

```java
@Bean
public SwaggerUiConfigProperties swaggerUiConfig() {
    SwaggerUiConfigProperties props = new SwaggerUiConfigProperties();
    props.setPath("/swagger-ui");
    props.setTryItOutEnabled(true);
    props.setFilter(true);
    props.setShowExtensions(true);
    props.setPersistAuthorization(true);
    return props;
}

// Custom CSS for dark theme
@Bean
public WebMvcConfigurer swaggerUiCustomizer() {
    return new WebMvcConfigurer() {
        @Override
        public void addResourceHandlers(ResourceHandlerRegistry registry) {
            registry.addResourceHandler("/swagger-ui/custom.css")
                .addResourceLocations("classpath:/static/swagger/");
        }
    };
}
```

## Redoc Configuration

```java
@Controller
@ConditionalOnProperty(prefix = "apigen.docs.redoc", name = "enabled", havingValue = "true")
public class RedocController {

    @GetMapping("/redoc")
    public String redoc(Model model) {
        model.addAttribute("specUrl", "/api-docs");
        model.addAttribute("options", Map.of(
            "hideDownloadButton", false,
            "hideHostname", false,
            "expandResponses", "200,201",
            "theme", Map.of(
                "colors", Map.of(
                    "primary", Map.of("main", "#1976d2")
                )
            )
        ));
        return "redoc";
    }
}
```

```html
<!-- templates/redoc.html -->
<!DOCTYPE html>
<html>
<head>
    <title>API Documentation</title>
    <link href="https://fonts.googleapis.com/css?family=Montserrat:300,400,700" rel="stylesheet">
    <style>body { margin: 0; padding: 0; }</style>
</head>
<body>
    <redoc spec-url="/api-docs" th:attr="spec-url=${specUrl}"></redoc>
    <script src="https://cdn.redoc.ly/redoc/latest/bundles/redoc.standalone.js"></script>
</body>
</html>
```

## OpenAPI Customizer

```java
@Component
public class ApiDocsCustomizer implements OpenApiCustomizer {

    @Override
    public void customise(OpenAPI openApi) {
        // Add common headers
        openApi.getPaths().values().forEach(pathItem ->
            pathItem.readOperations().forEach(operation -> {
                if (operation.getParameters() == null) {
                    operation.setParameters(new ArrayList<>());
                }
                operation.getParameters().add(new Parameter()
                    .name("X-Request-ID")
                    .in("header")
                    .description("Request correlation ID")
                    .schema(new StringSchema().format("uuid")));
            })
        );

        // Add server list
        openApi.setServers(List.of(
            new Server().url("https://api.example.com").description("Production"),
            new Server().url("https://staging.api.example.com").description("Staging"),
            new Server().url("http://localhost:8080").description("Local")
        ));
    }
}
```

## REST Controller for Docs

```java
@RestController
@RequestMapping("/api/docs")
public class DocsController {

    private final ResourceLoader resourceLoader;

    @GetMapping("/openapi.yaml")
    public ResponseEntity<Resource> getOpenApiYaml() {
        Resource resource = resourceLoader.getResource("classpath:openapi/api.yaml");
        return ResponseEntity.ok()
            .contentType(MediaType.parseMediaType("application/x-yaml"))
            .body(resource);
    }

    @GetMapping("/changelog")
    public ResponseEntity<String> getChangelog() throws IOException {
        Resource resource = resourceLoader.getResource("classpath:docs/CHANGELOG.md");
        String content = StreamUtils.copyToString(
            resource.getInputStream(), StandardCharsets.UTF_8);
        return ResponseEntity.ok()
            .contentType(MediaType.TEXT_MARKDOWN)
            .body(content);
    }
}
```

## Related Skills

- `api-documentation`: API documentation concepts
- `spring-boot-4`: Spring Boot 4.0 patterns
- `apigen-architecture`: Overall system architecture


