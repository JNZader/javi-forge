---
name: graph-spring
description: >
  Spring Boot graph database integration. Neo4j, Neptune, ArangoDB with Spring Data.
  Trigger: apigen-graph, Neo4jRepository, GraphService, Spring Data Neo4j
tools:
  - Read
  - Write
  - Edit
  - Bash
  - Grep
metadata:
  author: apigen-team
  version: "1.0"
  tags: [graph, spring-boot, neo4j, java]
  scope: ["apigen-graph/**"]
---

# Graph Spring Boot (apigen-graph)

## Configuration

```yaml
apigen:
  graph:
    enabled: true
    provider: neo4j  # neo4j, neptune, arangodb

    neo4j:
      uri: bolt://localhost:7687
      username: neo4j
      password: ${NEO4J_PASSWORD}
      database: neo4j
      connection-pool-size: 50

    neptune:
      endpoint: ${NEPTUNE_ENDPOINT}
      port: 8182
      region: us-east-1
      iam-auth: true

    arangodb:
      host: localhost
      port: 8529
      database: apigen
      username: root
      password: ${ARANGO_PASSWORD}
```

## Neo4j Entity Mapping

```java
@Node("User")
public class UserNode {

    @Id
    @GeneratedValue
    private Long id;

    @Property("externalId")
    private UUID externalId;

    private String name;
    private String email;
    private Instant createdAt;

    @Relationship(type = "FOLLOWS", direction = Direction.OUTGOING)
    private Set<UserNode> following = new HashSet<>();

    @Relationship(type = "FOLLOWS", direction = Direction.INCOMING)
    private Set<UserNode> followers = new HashSet<>();

    @Relationship(type = "PURCHASED")
    private List<PurchaseRelationship> purchases = new ArrayList<>();
}

@RelationshipProperties
public class PurchaseRelationship {

    @Id
    @GeneratedValue
    private Long id;

    @TargetNode
    private ProductNode product;

    private Instant purchasedAt;
    private BigDecimal amount;
    private Integer quantity;
}

@Node("Product")
public class ProductNode {
    @Id @GeneratedValue
    private Long id;

    private String sku;
    private String name;
    private String category;

    @Relationship(type = "SIMILAR_TO")
    private List<ProductNode> similarProducts;
}
```

## Repository Layer

```java
public interface UserNodeRepository extends Neo4jRepository<UserNode, Long> {

    Optional<UserNode> findByExternalId(UUID externalId);

    @Query("MATCH (u:User {externalId: $userId})-[:FOLLOWS]->(f:User) RETURN f")
    List<UserNode> findFollowing(UUID userId);

    @Query("MATCH (u:User {externalId: $userId})<-[:FOLLOWS]-(f:User) RETURN f")
    List<UserNode> findFollowers(UUID userId);

    @Query("""
        MATCH (u:User {externalId: $userId})-[:FOLLOWS*2]->(fof:User)
        WHERE fof.externalId <> $userId
        RETURN DISTINCT fof
        LIMIT $limit
        """)
    List<UserNode> findFriendsOfFriends(UUID userId, int limit);

    @Query("""
        MATCH path = shortestPath(
          (a:User {externalId: $fromId})-[:FOLLOWS*1..6]-(b:User {externalId: $toId})
        )
        RETURN path
        """)
    List<UserNode> findShortestPath(UUID fromId, UUID toId);
}
```

## Graph Service

```java
@Service
@RequiredArgsConstructor
public class GraphService {

    private final UserNodeRepository userRepository;
    private final ProductNodeRepository productRepository;
    private final Neo4jClient neo4jClient;

    @Transactional
    public void createFollowRelationship(UUID followerId, UUID followeeId) {
        UserNode follower = userRepository.findByExternalId(followerId)
            .orElseThrow(() -> new NodeNotFoundException("User", followerId));
        UserNode followee = userRepository.findByExternalId(followeeId)
            .orElseThrow(() -> new NodeNotFoundException("User", followeeId));

        follower.getFollowing().add(followee);
        userRepository.save(follower);
    }

    @Transactional(readOnly = true)
    public List<UserDTO> getRecommendedConnections(UUID userId, int limit) {
        // Friends of friends who aren't already friends
        return neo4jClient.query("""
            MATCH (u:User {externalId: $userId})-[:FOLLOWS]->()-[:FOLLOWS]->(rec:User)
            WHERE NOT (u)-[:FOLLOWS]->(rec) AND rec <> u
            WITH rec, count(*) as mutualFriends
            ORDER BY mutualFriends DESC
            LIMIT $limit
            RETURN rec, mutualFriends
            """)
            .bind(userId).to("userId")
            .bind(limit).to("limit")
            .fetchAs(UserDTO.class)
            .mappedBy((typeSystem, record) -> new UserDTO(
                record.get("rec").get("externalId").asString(),
                record.get("rec").get("name").asString(),
                record.get("mutualFriends").asInt()
            ))
            .all();
    }

    @Transactional(readOnly = true)
    public List<ProductNode> getProductRecommendations(UUID userId, int limit) {
        // Products purchased by users who purchased similar products
        return neo4jClient.query("""
            MATCH (u:User {externalId: $userId})-[:PURCHASED]->(p:Product)
                  <-[:PURCHASED]-(other:User)-[:PURCHASED]->(rec:Product)
            WHERE NOT (u)-[:PURCHASED]->(rec)
            WITH rec, count(DISTINCT other) as score
            ORDER BY score DESC
            LIMIT $limit
            RETURN rec
            """)
            .bind(userId).to("userId")
            .bind(limit).to("limit")
            .fetchAs(ProductNode.class)
            .all();
    }
}
```

## Neptune Integration (AWS)

```java
@Configuration
@ConditionalOnProperty(prefix = "apigen.graph", name = "provider", havingValue = "neptune")
public class NeptuneConfiguration {

    @Bean
    public Cluster neptuneCluster(GraphProperties props) {
        return Cluster.build()
            .addContactPoint(props.getNeptune().getEndpoint())
            .port(props.getNeptune().getPort())
            .enableSsl(true)
            .channelizer(SigV4WebSocketChannelizer.class)
            .create();
    }

    @Bean
    public GraphTraversalSource g(Cluster cluster) {
        return AnonymousTraversalSource.traversal()
            .withRemote(DriverRemoteConnection.using(cluster));
    }
}

@Service
@ConditionalOnProperty(prefix = "apigen.graph", name = "provider", havingValue = "neptune")
public class NeptuneGraphService {

    private final GraphTraversalSource g;

    public List<Map<String, Object>> findFriendsOfFriends(String userId) {
        return g.V().has("User", "userId", userId)
            .out("FOLLOWS")
            .out("FOLLOWS")
            .dedup()
            .hasNot("userId", userId)
            .valueMap("userId", "name")
            .toList();
    }
}
```

## ArangoDB Integration

```java
@Configuration
@ConditionalOnProperty(prefix = "apigen.graph", name = "provider", havingValue = "arangodb")
public class ArangoConfiguration {

    @Bean
    public ArangoDB arangoDB(GraphProperties props) {
        return new ArangoDB.Builder()
            .host(props.getArangodb().getHost(), props.getArangodb().getPort())
            .user(props.getArangodb().getUsername())
            .password(props.getArangodb().getPassword())
            .build();
    }

    @Bean
    public ArangoDatabase database(ArangoDB arangoDB, GraphProperties props) {
        return arangoDB.db(props.getArangodb().getDatabase());
    }
}

@Repository
@ConditionalOnProperty(prefix = "apigen.graph", name = "provider", havingValue = "arangodb")
public class ArangoUserRepository {

    private final ArangoDatabase db;

    public List<UserDTO> findFriendsOfFriends(String userId) {
        String aql = """
            FOR u IN users
              FILTER u._key == @userId
              FOR fof IN 2..2 OUTBOUND u follows
                FILTER fof._key != @userId
                COLLECT user = fof WITH COUNT INTO cnt
                SORT cnt DESC
                RETURN {user: user, mutualFriends: cnt}
            """;

        return db.query(aql, Map.of("userId", userId), UserDTO.class)
            .asListRemaining();
    }
}
```

## Graph Auto Configuration

```java
@AutoConfiguration
@ConditionalOnProperty(prefix = "apigen.graph", name = "enabled", havingValue = "true")
@EnableConfigurationProperties(GraphProperties.class)
public class GraphAutoConfiguration {

    @Bean
    @ConditionalOnProperty(prefix = "apigen.graph", name = "provider", havingValue = "neo4j")
    public Neo4jClient neo4jClient(Driver driver) {
        return Neo4jClient.create(driver);
    }

    @Bean
    @ConditionalOnMissingBean
    public GraphService graphService(
            @Autowired(required = false) UserNodeRepository neo4jRepo,
            @Autowired(required = false) NeptuneGraphService neptuneService,
            @Autowired(required = false) ArangoUserRepository arangoRepo) {
        // Factory based on available beans
    }
}
```

## Testing with TestContainers

```java
@SpringBootTest
@Testcontainers
class GraphServiceIT {

    @Container
    @ServiceConnection
    static Neo4jContainer<?> neo4j = new Neo4jContainer<>("neo4j:5")
        .withAdminPassword("password");

    @Autowired
    private GraphService graphService;

    @Autowired
    private UserNodeRepository userRepository;

    @BeforeEach
    void setUp() {
        userRepository.deleteAll();
    }

    @Test
    void shouldFindFriendsOfFriends() {
        // Create graph: Alice -> Bob -> Charlie
        UserNode alice = userRepository.save(new UserNode("Alice"));
        UserNode bob = userRepository.save(new UserNode("Bob"));
        UserNode charlie = userRepository.save(new UserNode("Charlie"));

        graphService.createFollowRelationship(alice.getExternalId(), bob.getExternalId());
        graphService.createFollowRelationship(bob.getExternalId(), charlie.getExternalId());

        List<UserNode> fof = userRepository.findFriendsOfFriends(
            alice.getExternalId(), 10);

        assertThat(fof).hasSize(1);
        assertThat(fof.get(0).getName()).isEqualTo("Charlie");
    }
}
```

## Related Skills

- `graph-databases`: Graph database concepts
- `spring-boot-4`: Spring Boot 4.0 patterns
- `testcontainers`: Integration testing


