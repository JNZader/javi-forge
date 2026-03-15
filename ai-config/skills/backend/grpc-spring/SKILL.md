---
name: grpc-spring
description: >
  Spring Boot gRPC. grpc-spring-boot-starter, service implementation, interceptors.
  Trigger: apigen-grpc, @GrpcService, GrpcServerInterceptor, Protobuf, gRPC Java
tools:
  - Read
  - Write
  - Edit
  - Bash
  - Grep
metadata:
  author: apigen-team
  version: "1.0"
  tags: [grpc, spring-boot, protobuf, java]
  scope: ["apigen-grpc/**"]
---

# gRPC Spring Boot (apigen-grpc)

## Configuration

```yaml
grpc:
  server:
    port: 9090
    in-process-name: apigen-grpc
    reflection-service-enabled: true
    max-inbound-message-size: 10MB

apigen:
  grpc:
    enabled: true
    interceptors:
      logging: true
      metrics: true
      authentication: true
```

## Gradle Configuration

```groovy
plugins {
    id 'com.google.protobuf' version '0.9.4'
}

dependencies {
    implementation 'io.grpc:grpc-netty-shaded:1.72.0'
    implementation 'io.grpc:grpc-protobuf:1.72.0'
    implementation 'io.grpc:grpc-stub:1.72.0'
    implementation 'net.devh:grpc-spring-boot-starter:3.4.0'

    // For well-known types
    implementation 'com.google.protobuf:protobuf-java-util:4.29.3'
}

protobuf {
    protoc {
        artifact = 'com.google.protobuf:protoc:4.29.3'
    }
    plugins {
        grpc {
            artifact = 'io.grpc:protoc-gen-grpc-java:1.72.0'
        }
    }
    generateProtoTasks {
        all()*.plugins {
            grpc {}
        }
    }
}
```

## Proto Definition

```protobuf
// src/main/proto/user_service.proto
syntax = "proto3";

package com.jnzader.apigen.grpc;

option java_package = "com.jnzader.apigen.grpc.proto";
option java_multiple_files = true;

import "google/protobuf/timestamp.proto";
import "google/protobuf/empty.proto";
import "google/protobuf/wrappers.proto";

service UserService {
  rpc GetUser(GetUserRequest) returns (UserResponse);
  rpc CreateUser(CreateUserRequest) returns (UserResponse);
  rpc UpdateUser(UpdateUserRequest) returns (UserResponse);
  rpc DeleteUser(DeleteUserRequest) returns (google.protobuf.Empty);
  rpc ListUsers(ListUsersRequest) returns (stream UserResponse);
  rpc BatchCreateUsers(stream CreateUserRequest) returns (BatchCreateResponse);
}

message GetUserRequest {
  string user_id = 1;
}

message CreateUserRequest {
  string email = 1;
  string name = 2;
  string password = 3;
}

message UpdateUserRequest {
  string user_id = 1;
  google.protobuf.StringValue name = 2;
  google.protobuf.StringValue email = 3;
}

message DeleteUserRequest {
  string user_id = 1;
}

message ListUsersRequest {
  int32 page_size = 1;
  string page_token = 2;
}

message UserResponse {
  string id = 1;
  string email = 2;
  string name = 3;
  UserStatus status = 4;
  google.protobuf.Timestamp created_at = 5;
}

message BatchCreateResponse {
  int32 created_count = 1;
  repeated string created_ids = 2;
  repeated CreateError errors = 3;
}

message CreateError {
  int32 index = 1;
  string message = 2;
}

enum UserStatus {
  USER_STATUS_UNSPECIFIED = 0;
  USER_STATUS_ACTIVE = 1;
  USER_STATUS_INACTIVE = 2;
}
```

## Service Implementation

```java
@GrpcService
@RequiredArgsConstructor
public class UserGrpcService extends UserServiceGrpc.UserServiceImplBase {

    private final UserService userService;
    private final UserMapper userMapper;

    @Override
    public void getUser(GetUserRequest request,
                        StreamObserver<UserResponse> responseObserver) {
        try {
            UUID userId = UUID.fromString(request.getUserId());
            User user = userService.findById(userId)
                .orElseThrow(() -> new StatusRuntimeException(
                    Status.NOT_FOUND.withDescription("User not found")));

            responseObserver.onNext(userMapper.toProto(user));
            responseObserver.onCompleted();
        } catch (IllegalArgumentException e) {
            responseObserver.onError(Status.INVALID_ARGUMENT
                .withDescription("Invalid user ID format")
                .asRuntimeException());
        }
    }

    @Override
    public void createUser(CreateUserRequest request,
                           StreamObserver<UserResponse> responseObserver) {
        try {
            CreateUserDTO dto = new CreateUserDTO(
                request.getEmail(),
                request.getName(),
                request.getPassword()
            );

            User user = userService.create(dto);
            responseObserver.onNext(userMapper.toProto(user));
            responseObserver.onCompleted();
        } catch (DuplicateEmailException e) {
            responseObserver.onError(Status.ALREADY_EXISTS
                .withDescription("Email already registered")
                .asRuntimeException());
        } catch (ValidationException e) {
            responseObserver.onError(Status.INVALID_ARGUMENT
                .withDescription(e.getMessage())
                .asRuntimeException());
        }
    }

    @Override
    public void listUsers(ListUsersRequest request,
                          StreamObserver<UserResponse> responseObserver) {
        int pageSize = request.getPageSize() > 0 ? request.getPageSize() : 20;
        String pageToken = request.getPageToken();

        userService.streamAll(pageSize, pageToken)
            .map(userMapper::toProto)
            .forEach(responseObserver::onNext);

        responseObserver.onCompleted();
    }

    @Override
    public StreamObserver<CreateUserRequest> batchCreateUsers(
            StreamObserver<BatchCreateResponse> responseObserver) {

        List<String> createdIds = new ArrayList<>();
        List<CreateError> errors = new ArrayList<>();
        AtomicInteger index = new AtomicInteger(0);

        return new StreamObserver<>() {
            @Override
            public void onNext(CreateUserRequest request) {
                int currentIndex = index.getAndIncrement();
                try {
                    CreateUserDTO dto = new CreateUserDTO(
                        request.getEmail(), request.getName(), request.getPassword());
                    User user = userService.create(dto);
                    createdIds.add(user.getId().toString());
                } catch (Exception e) {
                    errors.add(CreateError.newBuilder()
                        .setIndex(currentIndex)
                        .setMessage(e.getMessage())
                        .build());
                }
            }

            @Override
            public void onError(Throwable t) {
                responseObserver.onError(t);
            }

            @Override
            public void onCompleted() {
                responseObserver.onNext(BatchCreateResponse.newBuilder()
                    .setCreatedCount(createdIds.size())
                    .addAllCreatedIds(createdIds)
                    .addAllErrors(errors)
                    .build());
                responseObserver.onCompleted();
            }
        };
    }
}
```

## Mapper

```java
@Mapper(componentModel = "spring")
public interface UserMapper {

    @Mapping(target = "id", source = "id", qualifiedByName = "uuidToString")
    @Mapping(target = "createdAt", source = "createdAt", qualifiedByName = "instantToTimestamp")
    @Mapping(target = "status", source = "status", qualifiedByName = "statusToProto")
    UserResponse toProto(User user);

    @Named("uuidToString")
    default String uuidToString(UUID uuid) {
        return uuid != null ? uuid.toString() : "";
    }

    @Named("instantToTimestamp")
    default Timestamp instantToTimestamp(Instant instant) {
        if (instant == null) return Timestamp.getDefaultInstance();
        return Timestamp.newBuilder()
            .setSeconds(instant.getEpochSecond())
            .setNanos(instant.getNano())
            .build();
    }

    @Named("statusToProto")
    default UserStatus statusToProto(com.jnzader.apigen.domain.UserStatus status) {
        return switch (status) {
            case ACTIVE -> UserStatus.USER_STATUS_ACTIVE;
            case INACTIVE -> UserStatus.USER_STATUS_INACTIVE;
            default -> UserStatus.USER_STATUS_UNSPECIFIED;
        };
    }
}
```

## Interceptors

### Authentication Interceptor

```java
@GrpcGlobalServerInterceptor
@RequiredArgsConstructor
public class AuthenticationInterceptor implements ServerInterceptor {

    private final JwtService jwtService;
    public static final Context.Key<String> USER_ID_KEY = Context.key("userId");

    @Override
    public <ReqT, RespT> ServerCall.Listener<ReqT> interceptCall(
            ServerCall<ReqT, RespT> call,
            Metadata headers,
            ServerCallHandler<ReqT, RespT> next) {

        String token = headers.get(Metadata.Key.of("authorization", ASCII_STRING_MARSHALLER));

        if (token == null || !token.startsWith("Bearer ")) {
            call.close(Status.UNAUTHENTICATED.withDescription("Missing token"), new Metadata());
            return new ServerCall.Listener<>() {};
        }

        try {
            String userId = jwtService.validateAndGetUserId(token.substring(7));
            Context context = Context.current().withValue(USER_ID_KEY, userId);
            return Contexts.interceptCall(context, call, headers, next);
        } catch (Exception e) {
            call.close(Status.UNAUTHENTICATED.withDescription("Invalid token"), new Metadata());
            return new ServerCall.Listener<>() {};
        }
    }
}
```

### Logging Interceptor

```java
@GrpcGlobalServerInterceptor
@Slf4j
public class LoggingInterceptor implements ServerInterceptor {

    @Override
    public <ReqT, RespT> ServerCall.Listener<ReqT> interceptCall(
            ServerCall<ReqT, RespT> call,
            Metadata headers,
            ServerCallHandler<ReqT, RespT> next) {

        String methodName = call.getMethodDescriptor().getFullMethodName();
        long startTime = System.currentTimeMillis();

        log.info("gRPC request: {}", methodName);

        return new ForwardingServerCallListener.SimpleForwardingServerCallListener<>(
                next.startCall(call, headers)) {

            @Override
            public void onComplete() {
                long duration = System.currentTimeMillis() - startTime;
                log.info("gRPC response: {} completed in {}ms", methodName, duration);
                super.onComplete();
            }
        };
    }
}
```

## gRPC Client

```java
@Service
public class UserGrpcClient {

    private final UserServiceGrpc.UserServiceBlockingStub blockingStub;
    private final UserServiceGrpc.UserServiceStub asyncStub;

    public UserGrpcClient(@GrpcClient("user-service") ManagedChannel channel) {
        this.blockingStub = UserServiceGrpc.newBlockingStub(channel);
        this.asyncStub = UserServiceGrpc.newStub(channel);
    }

    public UserResponse getUser(String userId) {
        return blockingStub.getUser(GetUserRequest.newBuilder()
            .setUserId(userId)
            .build());
    }

    public void listUsersAsync(Consumer<UserResponse> consumer) {
        asyncStub.listUsers(
            ListUsersRequest.newBuilder().setPageSize(100).build(),
            new StreamObserver<>() {
                @Override
                public void onNext(UserResponse value) {
                    consumer.accept(value);
                }

                @Override
                public void onError(Throwable t) {
                    log.error("Error streaming users", t);
                }

                @Override
                public void onCompleted() {
                    log.info("User stream completed");
                }
            }
        );
    }
}
```

## Testing

```java
@SpringBootTest
@DirtiesContext
class UserGrpcServiceTest {

    @Autowired
    private UserGrpcService userGrpcService;

    @MockBean
    private UserService userService;

    @Test
    void shouldGetUser() {
        User user = new User(UUID.randomUUID(), "test@example.com", "Test");
        when(userService.findById(user.getId())).thenReturn(Optional.of(user));

        StreamRecorder<UserResponse> responseObserver = StreamRecorder.create();
        userGrpcService.getUser(
            GetUserRequest.newBuilder().setUserId(user.getId().toString()).build(),
            responseObserver
        );

        assertThat(responseObserver.getError()).isNull();
        assertThat(responseObserver.getValues()).hasSize(1);
        assertThat(responseObserver.getValues().get(0).getEmail())
            .isEqualTo("test@example.com");
    }
}
```

## Related Skills

- `grpc-concepts`: gRPC concepts
- `spring-boot-4`: Spring Boot 4.0 patterns
- `apigen-architecture`: Overall system architecture


