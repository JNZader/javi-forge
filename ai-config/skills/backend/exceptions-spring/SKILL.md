---
name: exceptions-spring
description: >
  Spring Boot exception handling. @ControllerAdvice, ProblemDetail, GlobalExceptionHandler.
  Trigger: apigen-exceptions, GlobalExceptionHandler, @ControllerAdvice, ProblemDetail
tools:
  - Read
  - Write
  - Edit
  - Bash
  - Grep
metadata:
  author: apigen-team
  version: "1.0"
  tags: [exceptions, spring-boot, error-handling, java]
  scope: ["apigen-exceptions/**", "apigen-core/**/exception/**"]
---

# Exceptions Spring Boot (apigen-exceptions)

## Configuration

```yaml
apigen:
  exceptions:
    include-stack-trace: ${DEBUG:false}
    include-message: always
    log-full-details: true
    problem-base-uri: https://api.example.com/errors
```

## Base Exception Hierarchy

```java
public abstract class ApiException extends RuntimeException {

    private final String errorCode;
    private final HttpStatus status;
    private final Map<String, Object> context;

    protected ApiException(String message, String errorCode,
                           HttpStatus status, Map<String, Object> context) {
        super(message);
        this.errorCode = errorCode;
        this.status = status;
        this.context = context != null ? context : Map.of();
    }

    public ProblemDetail toProblemDetail(String baseUri) {
        ProblemDetail problem = ProblemDetail.forStatus(status);
        problem.setType(URI.create(baseUri + "/" + errorCode));
        problem.setTitle(getTitle());
        problem.setDetail(getMessage());
        problem.setProperty("code", errorCode);
        context.forEach(problem::setProperty);
        return problem;
    }

    protected abstract String getTitle();
}
```

## Specific Exception Types

```java
// Validation exceptions
public class ValidationException extends ApiException {
    private final List<FieldError> fieldErrors;

    public ValidationException(List<FieldError> errors) {
        super("Validation failed", "VAL-001", HttpStatus.BAD_REQUEST,
              Map.of("errors", errors));
        this.fieldErrors = errors;
    }

    @Override
    protected String getTitle() {
        return "Validation Error";
    }
}

// Resource exceptions
public class ResourceNotFoundException extends ApiException {
    public ResourceNotFoundException(String resourceType, Object id) {
        super(String.format("%s with id '%s' not found", resourceType, id),
              "RES-404", HttpStatus.NOT_FOUND,
              Map.of("resourceType", resourceType, "resourceId", id));
    }

    @Override
    protected String getTitle() {
        return "Resource Not Found";
    }
}

// Business rule exceptions
public class BusinessRuleException extends ApiException {
    public BusinessRuleException(String message, String code,
                                  Map<String, Object> context) {
        super(message, code, HttpStatus.UNPROCESSABLE_ENTITY, context);
    }

    @Override
    protected String getTitle() {
        return "Business Rule Violation";
    }
}

// Conflict exceptions
public class ConflictException extends ApiException {
    public ConflictException(String message, String field, Object value) {
        super(message, "CONFLICT-409", HttpStatus.CONFLICT,
              Map.of("field", field, "value", value));
    }

    @Override
    protected String getTitle() {
        return "Resource Conflict";
    }
}
```

## Global Exception Handler

```java
@RestControllerAdvice
@Order(Ordered.HIGHEST_PRECEDENCE)
public class GlobalExceptionHandler {

    private final ExceptionProperties properties;
    private final MessageSource messageSource;

    @ExceptionHandler(ApiException.class)
    public ProblemDetail handleApiException(ApiException ex,
                                             HttpServletRequest request) {
        log.warn("API Exception: {} - {}", ex.getErrorCode(), ex.getMessage());

        ProblemDetail problem = ex.toProblemDetail(properties.getProblemBaseUri());
        problem.setInstance(URI.create(request.getRequestURI()));
        return problem;
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ProblemDetail handleValidation(MethodArgumentNotValidException ex,
                                           HttpServletRequest request) {
        List<FieldError> errors = ex.getBindingResult().getFieldErrors()
            .stream()
            .map(fe -> new FieldError(fe.getField(),
                                       fe.getDefaultMessage(),
                                       fe.getRejectedValue()))
            .toList();

        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.BAD_REQUEST);
        problem.setType(URI.create(properties.getProblemBaseUri() + "/validation"));
        problem.setTitle("Validation Error");
        problem.setDetail(errors.size() + " validation errors");
        problem.setProperty("errors", errors);
        problem.setInstance(URI.create(request.getRequestURI()));
        return problem;
    }

    @ExceptionHandler(ConstraintViolationException.class)
    public ProblemDetail handleConstraintViolation(
            ConstraintViolationException ex,
            HttpServletRequest request) {

        List<FieldError> errors = ex.getConstraintViolations().stream()
            .map(cv -> new FieldError(
                getPropertyPath(cv),
                cv.getMessage(),
                cv.getInvalidValue()))
            .toList();

        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.BAD_REQUEST);
        problem.setType(URI.create(properties.getProblemBaseUri() + "/validation"));
        problem.setTitle("Constraint Violation");
        problem.setProperty("errors", errors);
        return problem;
    }

    @ExceptionHandler(DataIntegrityViolationException.class)
    public ProblemDetail handleDataIntegrity(DataIntegrityViolationException ex) {
        log.error("Data integrity violation", ex);

        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.CONFLICT);
        problem.setTitle("Data Conflict");
        problem.setDetail("A data integrity constraint was violated");
        // Don't expose DB details
        return problem;
    }

    @ExceptionHandler(OptimisticLockingFailureException.class)
    public ProblemDetail handleOptimisticLock(
            OptimisticLockingFailureException ex) {

        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.CONFLICT);
        problem.setTitle("Concurrent Modification");
        problem.setDetail("Resource was modified by another request");
        problem.setProperty("code", "OPT-LOCK-001");
        return problem;
    }

    @ExceptionHandler(Exception.class)
    public ProblemDetail handleGeneric(Exception ex, HttpServletRequest request) {
        String requestId = UUID.randomUUID().toString();
        log.error("Unhandled exception [requestId={}]", requestId, ex);

        ProblemDetail problem = ProblemDetail.forStatus(
            HttpStatus.INTERNAL_SERVER_ERROR);
        problem.setTitle("Internal Server Error");
        problem.setDetail("An unexpected error occurred");
        problem.setProperty("requestId", requestId);

        if (properties.isIncludeStackTrace()) {
            problem.setProperty("stackTrace", getStackTrace(ex));
        }

        return problem;
    }
}
```

## Field Error Record

```java
public record FieldError(
    String field,
    String message,
    @JsonInclude(JsonInclude.Include.NON_NULL)
    Object rejectedValue
) {}
```

## Exception Auto Configuration

```java
@AutoConfiguration
@ConditionalOnWebApplication(type = ConditionalOnWebApplication.Type.SERVLET)
@EnableConfigurationProperties(ExceptionProperties.class)
public class ExceptionAutoConfiguration {

    @Bean
    @ConditionalOnMissingBean
    public GlobalExceptionHandler globalExceptionHandler(
            ExceptionProperties properties,
            @Autowired(required = false) MessageSource messageSource) {
        return new GlobalExceptionHandler(properties, messageSource);
    }

    @Bean
    public ProblemDetailExceptionHandler problemDetailHandler() {
        return new ProblemDetailExceptionHandler();
    }
}
```

## Custom Problem Detail Extensions

```java
public class ExtendedProblemDetail extends ProblemDetail {

    private String code;
    private Instant timestamp;
    private String traceId;

    public static ExtendedProblemDetail forStatusAndCode(
            HttpStatus status, String code) {

        ExtendedProblemDetail problem = new ExtendedProblemDetail();
        problem.setStatus(status.value());
        problem.setCode(code);
        problem.setTimestamp(Instant.now());
        problem.setTraceId(MDC.get("traceId"));
        return problem;
    }
}
```

## Testing Exceptions

```java
@WebMvcTest(UserController.class)
class UserControllerExceptionTest {

    @Autowired
    private MockMvc mockMvc;

    @MockBean
    private UserService userService;

    @Test
    void shouldReturnProblemDetailForNotFound() throws Exception {
        when(userService.findById(any()))
            .thenThrow(new ResourceNotFoundException("User", "123"));

        mockMvc.perform(get("/api/users/123"))
            .andExpect(status().isNotFound())
            .andExpect(content().contentType(MediaType.APPLICATION_PROBLEM_JSON))
            .andExpect(jsonPath("$.type").value(containsString("RES-404")))
            .andExpect(jsonPath("$.title").value("Resource Not Found"))
            .andExpect(jsonPath("$.resourceType").value("User"));
    }

    @Test
    void shouldReturnValidationErrors() throws Exception {
        String invalidJson = """
            {"email": "not-an-email", "name": ""}
            """;

        mockMvc.perform(post("/api/users")
                .contentType(MediaType.APPLICATION_JSON)
                .content(invalidJson))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.errors").isArray())
            .andExpect(jsonPath("$.errors.length()").value(2));
    }
}
```

## Related Skills

- `error-handling`: Error handling concepts
- `spring-boot-4`: Spring Boot 4.0 patterns