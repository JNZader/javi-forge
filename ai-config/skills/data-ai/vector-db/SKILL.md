---
name: vector-db
description: >
  Vector databases for RAG and semantic search with ChromaDB and pgvector.
  Trigger: vector database, embeddings, rag, semantic search, chromadb, pgvector
tools:
  - Read
  - Write
  - Bash
  - Grep
metadata:
  author: plataforma-industrial
  version: "2.0"
  tags: [vector-db, rag, embeddings, semantic-search, chromadb, pgvector]
  updated: "2026-02"
---

# Vector Database Skill

Vector databases for RAG and semantic search.

## Stack

```yaml
# Primary
chromadb: 0.4+
pgvector: 0.6+  # PostgreSQL extension

# Alternatives
qdrant-client: 1.7+
pinecone-client: 3.0+

# Embeddings
openai: 1.12+
sentence-transformers: 2.5+
```

## ChromaDB

```python
import chromadb
from chromadb.config import Settings
from chromadb.utils import embedding_functions
import os

class ChromaVectorStore:
    def __init__(self, collection_name: str = "documents", persist_dir: str = "./chroma_db"):
        self.client = chromadb.PersistentClient(
            path=persist_dir,
            settings=Settings(anonymized_telemetry=False)
        )

        self.embedding_fn = embedding_functions.OpenAIEmbeddingFunction(
            api_key=os.getenv("OPENAI_API_KEY"),
            model_name="text-embedding-3-small"
        )

        self.collection = self.client.get_or_create_collection(
            name=collection_name,
            embedding_function=self.embedding_fn,
            metadata={"hnsw:space": "cosine"}
        )

    def add_documents(self, documents: list[str], metadatas: list[dict] = None, ids: list[str] = None):
        if ids is None:
            ids = [f"doc_{i}" for i in range(len(documents))]
        self.collection.add(documents=documents, metadatas=metadatas, ids=ids)

    def query(self, query_text: str, n_results: int = 5, where: dict = None):
        return self.collection.query(
            query_texts=[query_text],
            n_results=n_results,
            where=where,
            include=["documents", "metadatas", "distances"]
        )

    def delete(self, ids: list[str] = None, where: dict = None):
        if ids:
            self.collection.delete(ids=ids)
        elif where:
            self.collection.delete(where=where)
```

## pgvector (PostgreSQL)

### Schema

```sql
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    content TEXT NOT NULL,
    embedding vector(1536),  -- OpenAI dimension
    metadata JSONB DEFAULT '{}',
    tenant_id UUID NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- HNSW index for fast search
CREATE INDEX ON documents USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64);
CREATE INDEX idx_documents_tenant ON documents (tenant_id);
CREATE INDEX idx_documents_metadata ON documents USING gin (metadata);
```

### Python Client

```python
import asyncpg
from pgvector.asyncpg import register_vector
import numpy as np
from openai import AsyncOpenAI

class PgVectorStore:
    def __init__(self, pool: asyncpg.Pool, embedding_model: str = "text-embedding-3-small"):
        self.pool = pool
        self.openai = AsyncOpenAI()
        self.embedding_model = embedding_model

    async def setup(self):
        async with self.pool.acquire() as conn:
            await register_vector(conn)

    async def embed(self, texts: list[str]) -> list[np.ndarray]:
        response = await self.openai.embeddings.create(model=self.embedding_model, input=texts)
        return [np.array(e.embedding) for e in response.data]

    async def add_documents(self, contents: list[str], metadatas: list[dict], tenant_id: str) -> list[str]:
        embeddings = await self.embed(contents)
        ids = []
        async with self.pool.acquire() as conn:
            for content, embedding, metadata in zip(contents, embeddings, metadatas):
                row = await conn.fetchrow(
                    "INSERT INTO documents (content, embedding, metadata, tenant_id) VALUES ($1, $2, $3, $4) RETURNING id",
                    content, embedding, metadata, tenant_id
                )
                ids.append(str(row['id']))
        return ids

    async def similarity_search(self, query: str, tenant_id: str, k: int = 5, metadata_filter: dict = None):
        query_embedding = (await self.embed([query]))[0]

        sql = """
            SELECT id, content, metadata, 1 - (embedding <=> $1) AS similarity
            FROM documents WHERE tenant_id = $2
        """
        params = [query_embedding, tenant_id]

        if metadata_filter:
            sql += " AND metadata @> $3"
            params.append(metadata_filter)

        sql += f" ORDER BY embedding <=> $1 LIMIT ${len(params) + 1}"
        params.append(k)

        async with self.pool.acquire() as conn:
            rows = await conn.fetch(sql, *params)

        return [{"id": str(r['id']), "content": r['content'], "metadata": dict(r['metadata']), "similarity": float(r['similarity'])} for r in rows]

    async def hybrid_search(self, query: str, tenant_id: str, k: int = 5, keyword_weight: float = 0.3):
        query_embedding = (await self.embed([query]))[0]

        sql = """
            WITH vector_search AS (
                SELECT id, content, metadata, 1 - (embedding <=> $1) AS vector_score
                FROM documents WHERE tenant_id = $2
                ORDER BY embedding <=> $1 LIMIT $3 * 2
            ),
            keyword_search AS (
                SELECT id, ts_rank(to_tsvector('english', content), plainto_tsquery('english', $4)) AS keyword_score
                FROM documents WHERE tenant_id = $2 AND to_tsvector('english', content) @@ plainto_tsquery('english', $4)
            )
            SELECT v.id, v.content, v.metadata,
                   (1 - $5) * v.vector_score + $5 * COALESCE(k.keyword_score, 0) AS combined_score
            FROM vector_search v LEFT JOIN keyword_search k ON v.id = k.id
            ORDER BY combined_score DESC LIMIT $3
        """

        async with self.pool.acquire() as conn:
            rows = await conn.fetch(sql, query_embedding, tenant_id, k, query, keyword_weight)

        return [{"id": str(r['id']), "content": r['content'], "metadata": dict(r['metadata']), "score": float(r['combined_score'])} for r in rows]
```

## Document Chunking

```python
from langchain_text_splitters import RecursiveCharacterTextSplitter, MarkdownHeaderTextSplitter

def chunk_documents(documents: list[dict], chunk_size: int = 1000, chunk_overlap: int = 200) -> list[dict]:
    splitter = RecursiveCharacterTextSplitter(
        chunk_size=chunk_size,
        chunk_overlap=chunk_overlap,
        separators=["\n\n", "\n", ". ", " ", ""]
    )

    chunks = []
    for doc in documents:
        for i, chunk in enumerate(splitter.split_text(doc["content"])):
            chunks.append({
                "content": chunk,
                "metadata": {**doc.get("metadata", {}), "source_id": doc.get("id"), "chunk_index": i}
            })
    return chunks

def chunk_markdown(content: str, source_metadata: dict = None) -> list[dict]:
    header_splitter = MarkdownHeaderTextSplitter(
        headers_to_split_on=[("#", "h1"), ("##", "h2"), ("###", "h3")]
    )
    size_splitter = RecursiveCharacterTextSplitter(chunk_size=1000, chunk_overlap=100)

    chunks = []
    for split in header_splitter.split_text(content):
        text, metadata = split.page_content, {**(source_metadata or {}), **split.metadata}
        if len(text) > 1000:
            for i, sub_chunk in enumerate(size_splitter.split_text(text)):
                chunks.append({"content": sub_chunk, "metadata": {**metadata, "sub_chunk": i}})
        else:
            chunks.append({"content": text, "metadata": metadata})
    return chunks
```

## RAG Chain

```python
from openai import AsyncOpenAI

class RAGChain:
    def __init__(self, vector_store: PgVectorStore, model: str = "gpt-4-turbo-preview", k: int = 5):
        self.vector_store = vector_store
        self.openai = AsyncOpenAI()
        self.model = model
        self.k = k

    async def query(self, question: str, tenant_id: str, system_prompt: str = None, metadata_filter: dict = None):
        docs = await self.vector_store.similarity_search(
            query=question, tenant_id=tenant_id, k=self.k, metadata_filter=metadata_filter
        )

        context = "\n\n---\n\n".join([f"[Source: {d['metadata'].get('source', 'Unknown')}]\n{d['content']}" for d in docs])

        if system_prompt is None:
            system_prompt = "Answer based on the provided context. If not in context, say so. Cite sources."

        response = await self.openai.chat.completions.create(
            model=self.model,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": f"Context:\n{context}\n\nQuestion: {question}"}
            ],
            temperature=0
        )

        return {
            "answer": response.choices[0].message.content,
            "sources": [d['metadata'].get('source') for d in docs],
            "docs": docs
        }
```

## Indexing Pipeline

```python
class IndexingPipeline:
    def __init__(self, vector_store: PgVectorStore, chunk_size: int = 1000, batch_size: int = 100):
        self.vector_store = vector_store
        self.chunk_size = chunk_size
        self.batch_size = batch_size

    async def index_documents(self, documents: list[dict], tenant_id: str) -> int:
        chunks = chunk_documents(documents, chunk_size=self.chunk_size)
        total = 0

        for i in range(0, len(chunks), self.batch_size):
            batch = chunks[i:i + self.batch_size]
            await self.vector_store.add_documents(
                contents=[c['content'] for c in batch],
                metadatas=[c['metadata'] for c in batch],
                tenant_id=tenant_id
            )
            total += len(batch)
            print(f"Indexed {total}/{len(chunks)}")

        return total
```

## Best Practices

1. **Chunk size** - Technical docs: 1000-1500, FAQs: 300-500
2. **Include overlap** - 10-20% overlap for context continuity
3. **Use metadata** - Filter by type, source, date
4. **Hybrid search** - Combine vector + keyword for better recall
5. **Re-rank results** - Cross-encoder for precision: `cross-encoder/ms-marco-MiniLM-L-6-v2`

## Related Skills

- `langchain`: RAG implementation
- `ai-ml`: Embedding generation
- `fastapi`: Vector search API
- `redis-cache`: Hybrid search caching
