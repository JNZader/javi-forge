---
name: search-spring
description: >
  Spring Boot search integration. Elasticsearch, Meilisearch, Typesense, Algolia.
  Trigger: apigen-search, SearchService, ElasticsearchRepository, indexing
tools:
  - Read
  - Write
  - Edit
  - Bash
  - Grep
metadata:
  author: apigen-team
  version: "1.0"
  tags: [search, spring-boot, elasticsearch, java]
  scope: ["apigen-search/**"]
---

# Search Spring Boot (apigen-search)

## Configuration

```yaml
apigen:
  search:
    enabled: true
    provider: elasticsearch  # elasticsearch, meilisearch, typesense, algolia

    elasticsearch:
      uris: ${ELASTICSEARCH_URIS:http://localhost:9200}
      username: ${ES_USERNAME:}
      password: ${ES_PASSWORD:}
      connection-timeout: 5s
      socket-timeout: 30s

    meilisearch:
      host: ${MEILISEARCH_HOST:http://localhost:7700}
      api-key: ${MEILISEARCH_API_KEY:}

    typesense:
      host: ${TYPESENSE_HOST:localhost}
      port: 8108
      protocol: http
      api-key: ${TYPESENSE_API_KEY:}

    algolia:
      application-id: ${ALGOLIA_APP_ID}
      api-key: ${ALGOLIA_API_KEY}
      search-key: ${ALGOLIA_SEARCH_KEY}

    indexing:
      auto-index: true
      batch-size: 100
```

## Document Mapping (Elasticsearch)

```java
@Document(indexName = "products")
@Setting(settingPath = "elasticsearch/product-settings.json")
public class ProductDocument {

    @Id
    private String id;

    @Field(type = FieldType.Text, analyzer = "standard")
    private String name;

    @Field(type = FieldType.Text, analyzer = "standard")
    private String description;

    @Field(type = FieldType.Keyword)
    private String category;

    @Field(type = FieldType.Keyword)
    private String brand;

    @Field(type = FieldType.Double)
    private BigDecimal price;

    @Field(type = FieldType.Float)
    private Float rating;

    @Field(type = FieldType.Integer)
    private Integer reviewCount;

    @Field(type = FieldType.Keyword)
    private List<String> tags;

    @Field(type = FieldType.Date, format = DateFormat.date_time)
    private Instant createdAt;

    @Field(type = FieldType.Dense_Vector, dims = 128)
    private float[] embedding;  // For semantic search
}
```

## Repository Layer

```java
public interface ProductSearchRepository
        extends ElasticsearchRepository<ProductDocument, String> {

    List<ProductDocument> findByNameContaining(String name);

    List<ProductDocument> findByCategoryAndPriceRange(
        String category, BigDecimal minPrice, BigDecimal maxPrice);

    @Query("""
        {
          "bool": {
            "must": [
              {"match": {"name": "?0"}}
            ],
            "filter": [
              {"term": {"category": "?1"}}
            ]
          }
        }
        """)
    Page<ProductDocument> searchByNameAndCategory(
        String query, String category, Pageable pageable);
}
```

## Search Service

```java
@Service
@RequiredArgsConstructor
public class SearchService {

    private final ElasticsearchOperations esOperations;
    private final ProductSearchRepository repository;
    private final MeterRegistry meterRegistry;

    public SearchResult<ProductDocument> search(SearchRequest request) {
        Timer.Sample sample = Timer.start(meterRegistry);

        try {
            NativeQuery query = buildQuery(request);
            SearchHits<ProductDocument> hits = esOperations.search(query, ProductDocument.class);

            List<ProductDocument> results = hits.getSearchHits().stream()
                .map(SearchHit::getContent)
                .toList();

            Map<String, List<FacetValue>> facets = extractFacets(hits);

            return SearchResult.<ProductDocument>builder()
                .results(results)
                .totalHits(hits.getTotalHits())
                .facets(facets)
                .took(hits.getPointInTimeId())
                .build();

        } finally {
            sample.stop(meterRegistry.timer("search.query",
                "index", "products"));
        }
    }

    private NativeQuery buildQuery(SearchRequest request) {
        BoolQuery.Builder boolQuery = new BoolQuery.Builder();

        // Full-text search
        if (StringUtils.hasText(request.getQuery())) {
            boolQuery.must(MultiMatchQuery.of(mm -> mm
                .query(request.getQuery())
                .fields("name^3", "description", "tags")
                .fuzziness("AUTO")
            )._toQuery());
        }

        // Filters
        if (request.getCategory() != null) {
            boolQuery.filter(TermQuery.of(t -> t
                .field("category")
                .value(request.getCategory())
            )._toQuery());
        }

        if (request.getMinPrice() != null || request.getMaxPrice() != null) {
            boolQuery.filter(RangeQuery.of(r -> {
                r.field("price");
                if (request.getMinPrice() != null) r.gte(JsonData.of(request.getMinPrice()));
                if (request.getMaxPrice() != null) r.lte(JsonData.of(request.getMaxPrice()));
                return r;
            })._toQuery());
        }

        // Build aggregations for facets
        return NativeQuery.builder()
            .withQuery(boolQuery.build()._toQuery())
            .withAggregation("categories", Aggregation.of(a -> a
                .terms(t -> t.field("category").size(20))))
            .withAggregation("brands", Aggregation.of(a -> a
                .terms(t -> t.field("brand").size(20))))
            .withAggregation("price_ranges", Aggregation.of(a -> a
                .range(r -> r.field("price")
                    .ranges(
                        new RangeAggregationRange.Builder().to("50").key("under_50").build(),
                        new RangeAggregationRange.Builder().from("50").to("100").key("50_to_100").build(),
                        new RangeAggregationRange.Builder().from("100").key("over_100").build()
                    ))))
            .withPageable(PageRequest.of(request.getPage(), request.getSize()))
            .withSort(buildSort(request.getSortBy()))
            .build();
    }

    public List<String> autocomplete(String prefix, int limit) {
        NativeQuery query = NativeQuery.builder()
            .withQuery(PrefixQuery.of(p -> p
                .field("name.autocomplete")
                .value(prefix.toLowerCase())
            )._toQuery())
            .withFields("name")
            .withPageable(PageRequest.of(0, limit))
            .build();

        return esOperations.search(query, ProductDocument.class)
            .getSearchHits().stream()
            .map(hit -> hit.getContent().getName())
            .distinct()
            .toList();
    }
}
```

## Meilisearch Provider

```java
@Component
@ConditionalOnProperty(prefix = "apigen.search", name = "provider", havingValue = "meilisearch")
public class MeilisearchSearchProvider implements SearchProvider {

    private final Client client;

    @Override
    public SearchResult<Map<String, Object>> search(String index, SearchRequest request) {
        Index idx = client.index(index);

        SearchRequest meilisearchRequest = new SearchRequest(request.getQuery())
            .setOffset(request.getPage() * request.getSize())
            .setLimit(request.getSize())
            .setFilter(buildFilters(request))
            .setFacets(new String[]{"category", "brand"})
            .setAttributesToHighlight(new String[]{"name", "description"});

        Searchable results = idx.search(meilisearchRequest);

        return SearchResult.builder()
            .results(results.getHits())
            .totalHits(results.getEstimatedTotalHits())
            .facets(results.getFacetDistribution())
            .build();
    }

    @Override
    public void index(String indexName, String id, Map<String, Object> document) {
        client.index(indexName).addDocuments(
            new Gson().toJson(List.of(document)), "id");
    }
}
```

## Indexing Service

```java
@Service
@RequiredArgsConstructor
public class IndexingService {

    private final ProductRepository productRepository;
    private final ElasticsearchOperations esOperations;
    private final SearchProperties props;

    @Async
    @Scheduled(cron = "${apigen.search.indexing.cron:0 0 2 * * *}")
    public void fullReindex() {
        log.info("Starting full reindex");

        String newIndex = "products_" + Instant.now().toEpochMilli();

        // Create new index
        esOperations.indexOps(ProductDocument.class).create();

        // Index in batches
        int page = 0;
        Page<Product> products;
        do {
            products = productRepository.findAll(
                PageRequest.of(page, props.getIndexing().getBatchSize()));

            List<ProductDocument> documents = products.getContent().stream()
                .map(this::toDocument)
                .toList();

            esOperations.save(documents);
            page++;
        } while (products.hasNext());

        // Switch alias
        switchAlias("products", newIndex);

        log.info("Full reindex completed: {} documents", products.getTotalElements());
    }

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void onProductChange(ProductChangedEvent event) {
        if (props.getIndexing().isAutoIndex()) {
            switch (event.getType()) {
                case CREATED, UPDATED -> indexProduct(event.getProduct());
                case DELETED -> deleteProduct(event.getProductId());
            }
        }
    }

    private void indexProduct(Product product) {
        ProductDocument document = toDocument(product);
        esOperations.save(document);
    }
}
```

## REST API

```java
@RestController
@RequestMapping("/api/search")
@RequiredArgsConstructor
public class SearchController {

    private final SearchService searchService;

    @GetMapping
    public SearchResult<ProductDTO> search(
            @RequestParam(required = false) String q,
            @RequestParam(required = false) String category,
            @RequestParam(required = false) BigDecimal minPrice,
            @RequestParam(required = false) BigDecimal maxPrice,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size,
            @RequestParam(defaultValue = "relevance") String sortBy) {

        SearchRequest request = SearchRequest.builder()
            .query(q)
            .category(category)
            .minPrice(minPrice)
            .maxPrice(maxPrice)
            .page(page)
            .size(size)
            .sortBy(sortBy)
            .build();

        return searchService.search(request)
            .map(this::toDTO);
    }

    @GetMapping("/autocomplete")
    public List<String> autocomplete(
            @RequestParam String q,
            @RequestParam(defaultValue = "10") int limit) {
        return searchService.autocomplete(q, limit);
    }
}
```

## Related Skills

- `search-concepts`: Search engine concepts
- `spring-boot-4`: Spring Boot 4.0 patterns
- `testcontainers`: Integration testing


