---
name: graphql-spring
description: >
  Spring Boot GraphQL. Spring for GraphQL, resolvers, DataLoader, subscriptions.
  Trigger: apigen-graphql, @QueryMapping, @MutationMapping, DataLoader, GraphQL Java
tools:
  - Read
  - Write
  - Edit
  - Bash
  - Grep
metadata:
  author: apigen-team
  version: "1.0"
  tags: [graphql, spring-boot, resolvers, java]
  scope: ["apigen-graphql/**"]
---

# GraphQL Spring Boot (apigen-graphql)

## Configuration

```yaml
spring:
  graphql:
    graphiql:
      enabled: true
      path: /graphiql
    schema:
      locations: classpath:graphql/
      printer:
        enabled: true
    websocket:
      path: /graphql

apigen:
  graphql:
    enabled: true
    max-depth: 10
    max-complexity: 200
    introspection-enabled: ${DEBUG:false}
```

## Schema Definition

```graphql
# src/main/resources/graphql/schema.graphqls

type Query {
  user(id: ID!): User
  users(page: Int = 0, size: Int = 20): UserConnection!
  searchUsers(query: String!): [User!]!
}

type Mutation {
  createUser(input: CreateUserInput!): User!
  updateUser(id: ID!, input: UpdateUserInput!): User!
  deleteUser(id: ID!): Boolean!
}

type Subscription {
  userCreated: User!
  userUpdated(id: ID!): User!
}

type User {
  id: ID!
  email: String!
  name: String
  posts(first: Int, after: String): PostConnection!
  createdAt: DateTime!
}

type Post {
  id: ID!
  title: String!
  author: User!
}

type UserConnection {
  edges: [UserEdge!]!
  pageInfo: PageInfo!
  totalCount: Int!
}

type UserEdge {
  cursor: String!
  node: User!
}

type PageInfo {
  hasNextPage: Boolean!
  hasPreviousPage: Boolean!
  startCursor: String
  endCursor: String
}

input CreateUserInput {
  email: String!
  name: String
  password: String!
}

input UpdateUserInput {
  name: String
  email: String
}

scalar DateTime
```

## Query Controller

```java
@Controller
public class UserGraphQLController {

    private final UserService userService;

    @QueryMapping
    public User user(@Argument UUID id) {
        return userService.findById(id)
            .orElse(null);
    }

    @QueryMapping
    public Connection<User> users(
            @Argument int page,
            @Argument int size) {
        Page<User> userPage = userService.findAll(PageRequest.of(page, size));
        return toConnection(userPage);
    }

    @QueryMapping
    public List<User> searchUsers(@Argument String query) {
        return userService.search(query);
    }

    // Nested field resolver
    @SchemaMapping(typeName = "User", field = "posts")
    public Connection<Post> posts(
            User user,
            @Argument Integer first,
            @Argument String after) {
        return postService.findByAuthorId(user.getId(), first, after);
    }
}
```

## Mutation Controller

```java
@Controller
public class UserMutationController {

    private final UserService userService;
    private final ApplicationEventPublisher eventPublisher;

    @MutationMapping
    public User createUser(@Argument("input") @Valid CreateUserInput input) {
        User user = userService.create(input);
        eventPublisher.publishEvent(new UserCreatedEvent(user));
        return user;
    }

    @MutationMapping
    public User updateUser(
            @Argument UUID id,
            @Argument("input") @Valid UpdateUserInput input) {
        return userService.update(id, input);
    }

    @MutationMapping
    public boolean deleteUser(@Argument UUID id) {
        userService.delete(id);
        return true;
    }
}
```

## Subscription Controller

```java
@Controller
public class UserSubscriptionController {

    private final Sinks.Many<User> userCreatedSink =
        Sinks.many().multicast().onBackpressureBuffer();

    @SubscriptionMapping
    public Flux<User> userCreated() {
        return userCreatedSink.asFlux();
    }

    @SubscriptionMapping
    public Flux<User> userUpdated(@Argument UUID id) {
        return userUpdatedSink.asFlux()
            .filter(user -> user.getId().equals(id));
    }

    @EventListener
    public void onUserCreated(UserCreatedEvent event) {
        userCreatedSink.tryEmitNext(event.getUser());
    }
}
```

## DataLoader Configuration

```java
@Configuration
public class DataLoaderConfiguration {

    @Bean
    public BatchLoaderRegistry batchLoaderRegistry(
            UserRepository userRepository,
            PostRepository postRepository) {

        return BatchLoaderRegistry.create()
            .registerMappedBatchLoader(
                "usersById",
                (Set<UUID> ids, BatchLoaderEnvironment env) ->
                    Mono.fromCallable(() ->
                        userRepository.findAllById(ids).stream()
                            .collect(Collectors.toMap(User::getId, Function.identity()))
                    )
            )
            .registerMappedBatchLoader(
                "postsByAuthorId",
                (Set<UUID> authorIds, BatchLoaderEnvironment env) ->
                    Mono.fromCallable(() ->
                        postRepository.findByAuthorIdIn(authorIds).stream()
                            .collect(Collectors.groupingBy(Post::getAuthorId))
                    )
            );
    }
}

// Using DataLoader in resolver
@Controller
public class PostGraphQLController {

    @SchemaMapping(typeName = "Post", field = "author")
    public CompletableFuture<User> author(
            Post post,
            DataLoader<UUID, User> usersById) {
        return usersById.load(post.getAuthorId());
    }
}
```

## Custom Scalar

```java
@Configuration
public class ScalarConfiguration {

    @Bean
    public RuntimeWiringConfigurer runtimeWiringConfigurer() {
        return wiringBuilder -> wiringBuilder
            .scalar(ExtendedScalars.DateTime)
            .scalar(ExtendedScalars.UUID)
            .scalar(ExtendedScalars.JSON);
    }
}
```

## Exception Handling

```java
@ControllerAdvice
public class GraphQLExceptionHandler {

    @GraphQlExceptionHandler
    public GraphQLError handleNotFoundException(ResourceNotFoundException ex) {
        return GraphQLError.newError()
            .errorType(ErrorType.NOT_FOUND)
            .message(ex.getMessage())
            .build();
    }

    @GraphQlExceptionHandler
    public GraphQLError handleValidation(ConstraintViolationException ex) {
        return GraphQLError.newError()
            .errorType(ErrorType.BAD_REQUEST)
            .message("Validation failed")
            .extensions(Map.of(
                "errors", ex.getConstraintViolations().stream()
                    .map(cv -> Map.of(
                        "field", cv.getPropertyPath().toString(),
                        "message", cv.getMessage()
                    ))
                    .toList()
            ))
            .build();
    }
}
```

## Query Complexity

```java
@Configuration
public class GraphQLSecurityConfiguration {

    @Bean
    public Instrumentation maxQueryDepthInstrumentation() {
        return new MaxQueryDepthInstrumentation(10);
    }

    @Bean
    public Instrumentation maxQueryComplexityInstrumentation() {
        return new MaxQueryComplexityInstrumentation(200);
    }
}
```

## Authorization

```java
@Controller
public class SecuredGraphQLController {

    @QueryMapping
    @PreAuthorize("hasRole('USER')")
    public User me(@AuthenticationPrincipal UserDetails user) {
        return userService.findByEmail(user.getUsername())
            .orElseThrow();
    }

    @MutationMapping
    @PreAuthorize("hasRole('ADMIN')")
    public boolean deleteUser(@Argument UUID id) {
        userService.delete(id);
        return true;
    }

    // Field-level authorization
    @SchemaMapping(typeName = "User", field = "email")
    @PreAuthorize("hasRole('ADMIN') or #user.id == authentication.principal.id")
    public String email(User user) {
        return user.getEmail();
    }
}
```

## Testing

```java
@GraphQlTest(UserGraphQLController.class)
class UserGraphQLControllerTest {

    @Autowired
    private GraphQlTester graphQlTester;

    @MockBean
    private UserService userService;

    @Test
    void shouldGetUser() {
        User user = new User(UUID.randomUUID(), "test@example.com", "Test");
        when(userService.findById(user.getId())).thenReturn(Optional.of(user));

        graphQlTester.documentName("getUser")
            .variable("id", user.getId())
            .execute()
            .path("user.email").entity(String.class).isEqualTo("test@example.com")
            .path("user.name").entity(String.class).isEqualTo("Test");
    }

    @Test
    void shouldCreateUser() {
        graphQlTester.document("""
                mutation CreateUser($input: CreateUserInput!) {
                  createUser(input: $input) {
                    id
                    email
                  }
                }
                """)
            .variable("input", Map.of(
                "email", "new@example.com",
                "name", "New User",
                "password", "SecurePass123"
            ))
            .execute()
            .path("createUser.email").entity(String.class).isEqualTo("new@example.com");
    }
}
```

## Related Skills

- `graphql-concepts`: GraphQL concepts
- `spring-boot-4`: Spring Boot 4.0 patterns
- `apigen-architecture`: Overall system architecture


