---
name: search-concepts
description: >
  Search engine concepts. Full-text search, indexing, relevance, facets, autocomplete.
  Trigger: search, Elasticsearch, Meilisearch, Algolia, full-text, indexing
tools:
  - Read
  - Write
  - Edit
  - Grep
metadata:
  author: apigen-team
  version: "1.0"
  tags: [search, elasticsearch, full-text, indexing]
  scope: ["**/search/**"]
---

# Search Engine Concepts

## Core Concepts

### Indexing
```
Document: Unit of data (product, article, user)
Field: Attribute within document (title, description)
Index: Collection of documents with same structure
Mapping: Schema defining field types and analyzers

Process:
1. Extract text content
2. Tokenize (split into terms)
3. Normalize (lowercase, stemming)
4. Build inverted index
5. Store for retrieval
```

### Inverted Index
```
Forward index:
  Doc1 → ["quick", "brown", "fox"]
  Doc2 → ["lazy", "brown", "dog"]

Inverted index:
  "brown" → [Doc1, Doc2]
  "quick" → [Doc1]
  "fox"   → [Doc1]
  "lazy"  → [Doc2]
  "dog"   → [Doc2]

Enables O(1) term lookup
```

### Text Analysis
```
Analyzer pipeline:
  Input → Character Filter → Tokenizer → Token Filter → Tokens

Character filters:
- Strip HTML tags
- Replace patterns

Tokenizers:
- Standard (split on whitespace/punctuation)
- Whitespace (split on whitespace only)
- N-gram (sliding window)

Token filters:
- Lowercase
- Stemming (running → run)
- Synonyms (couch → sofa)
- Stop words removal
```

## Search Types

### Full-Text Search
```
Query: "quick brown fox"

Match:
- Documents containing any term
- Scored by relevance

Phrase match:
- Documents with exact phrase
- Term order matters

Multi-match:
- Search across multiple fields
- Weighted by field importance
```

### Fuzzy Search
```
Query: "qiuck" (typo)
Match: "quick" (edit distance 1)

Edit distance:
- Insert: quic → quick
- Delete: quiick → quick
- Replace: quack → quick
- Transpose: qiuck → quick

Useful for typo tolerance
```

### Semantic Search
```
Traditional: Keyword matching
Semantic: Meaning understanding

Uses embeddings (vectors):
1. Convert query to embedding
2. Find similar document embeddings
3. Return nearest neighbors

Requires ML model (BERT, etc.)
```

## Relevance Scoring

### TF-IDF
```
TF (Term Frequency):
  How often term appears in document
  tf(t,d) = count(t in d) / count(all terms in d)

IDF (Inverse Document Frequency):
  How rare term is across all documents
  idf(t) = log(N / df(t))
  N = total documents
  df(t) = documents containing term

Score = TF × IDF
```

### BM25
```
Improved TF-IDF:
- Saturation: diminishing returns for high TF
- Document length normalization

BM25(t,d) = IDF(t) × (TF(t,d) × (k1 + 1)) /
            (TF(t,d) + k1 × (1 - b + b × |d|/avgdl))

k1, b: tuning parameters
|d|: document length
avgdl: average document length
```

### Boosting
```
Field boosting:
  title^3 description^1
  (title matches worth 3x)

Query boosting:
  "laptop"^2 OR "computer"
  (laptop matches worth 2x)

Function scoring:
  base_score * popularity_boost * recency_boost
```

## Search Features

### Faceted Search
```
Facets = aggregations for filtering

Example (e-commerce):
  Category: Electronics (150), Clothing (89)
  Price: $0-50 (45), $50-100 (78), $100+ (116)
  Brand: Apple (34), Samsung (28), Sony (21)
  Rating: 4+ stars (89), 3+ stars (156)

User clicks "Electronics" → refines results
```

### Autocomplete
```
Types:
- Prefix matching: "app" → "apple", "application"
- Fuzzy prefix: "apl" → "apple"
- Query suggestions: based on popular searches
- Completion: "new york" → "new york city"

Implementation:
- Edge n-grams at index time
- Completion suggester
- Separate autocomplete index
```

### Highlighting
```
Query: "quick brown fox"

Result with highlighting:
  "The <em>quick</em> <em>brown</em> <em>fox</em> jumps..."

Options:
- Fragment size
- Number of fragments
- Pre/post tags
```

### Pagination
```
Offset-based:
  from=0, size=10 (page 1)
  from=10, size=10 (page 2)
  Problem: deep pagination expensive

Search-after (cursor):
  Use sort values from last result
  Better for deep pagination

Scroll:
  For large exports
  Not for real-time search
```

## Search Provider Comparison

```
| Feature | Elasticsearch | Meilisearch | Algolia | Typesense |
|---------|--------------|-------------|---------|-----------|
| Hosting | Self/Cloud | Self/Cloud | SaaS | Self/Cloud |
| Speed | Fast | Very fast | Very fast | Very fast |
| Typo tolerance | Config | Built-in | Built-in | Built-in |
| Facets | Yes | Yes | Yes | Yes |
| Vectors | Yes (8.x) | Yes | No | Yes |
| Pricing | Open source | Open source | Per search | Open source |
```

## Best Practices

```
Indexing:
✅ Define explicit mappings
✅ Use appropriate analyzers per field
✅ Denormalize for search performance
✅ Index only searchable fields

Querying:
✅ Use filters for exact matches (cached)
✅ Limit returned fields
✅ Implement pagination properly
✅ Track search analytics

Operations:
✅ Monitor index size
✅ Plan for reindexing
✅ Set up aliases for zero-downtime
✅ Test relevance with query sets
```

## Related Skills

- `search-spring`: Spring Boot search implementation
- `apigen-architecture`: Overall system architecture


