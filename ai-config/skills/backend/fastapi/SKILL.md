---
name: fastapi
description: >
  FastAPI development patterns with Pydantic v2, async services, and dependency injection.
  Trigger: fastapi, python api, async python, pydantic, uvicorn
tools:
  - Read
  - Write
  - Bash
  - Grep
metadata:
  author: plataforma-industrial
  version: "2.0"
  tags: [python, fastapi, async, api]
  updated: "2026-02"
---

# FastAPI Development Skill

## Stack

```txt
fastapi==0.110.0
uvicorn[standard]==0.28.0
pydantic==2.6.3
pydantic-settings==2.2.1
python-jose[cryptography]==3.3.0
httpx==0.27.0
redis==5.0.2
sqlalchemy==2.0.28
asyncpg==0.29.0
```

## Project Structure

```
src/
└── app_name/
    ├── __init__.py
    ├── main.py
    ├── config.py
    ├── api/
    │   ├── deps.py
    │   └── routes/
    ├── core/
    │   ├── security.py
    │   └── exceptions.py
    ├── models/
    ├── services/
    └── agents/
```

## Main Application Pattern

```python
# main.py
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    app.state.cache = CacheService()
    await app.state.cache.connect()
    yield
    # Shutdown
    await app.state.cache.disconnect()

app = FastAPI(
    title="Service Name",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router, tags=["health"])
app.include_router(api.router, prefix="/api/v1", tags=["api"])
```

## Configuration with Pydantic Settings

```python
# config.py
from pydantic_settings import BaseSettings
from functools import lru_cache

class Settings(BaseSettings):
    debug: bool = False
    cors_origins: list[str] = ["*"]
    database_url: str = "postgresql+asyncpg://user:pass@localhost/db"
    redis_url: str = "redis://localhost:6379"
    jwt_secret: str
    jwt_algorithm: str = "HS256"

    class Config:
        env_file = ".env"
        case_sensitive = False

@lru_cache
def get_settings() -> Settings:
    return Settings()

settings = get_settings()
```

## Pydantic Models (v2)

```python
from pydantic import BaseModel, Field
from datetime import datetime
from typing import Literal

class MessageRequest(BaseModel):
    content: str = Field(..., min_length=1, max_length=4000)
    context: dict | None = None

class MessageResponse(BaseModel):
    message: str
    timestamp: datetime = Field(default_factory=datetime.utcnow)

class StreamChunk(BaseModel):
    content: str
    done: bool = False
```

## Dependency Injection

```python
# api/deps.py
from typing import Annotated
from fastapi import Depends, HTTPException, Header, status
from jose import jwt, JWTError

async def get_cache(request: Request) -> CacheService:
    return request.app.state.cache

async def verify_token(authorization: Annotated[str, Header()]) -> dict:
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED)

    token = authorization[7:]
    try:
        return jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
    except JWTError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED)

async def get_tenant_id(token: Annotated[dict, Depends(verify_token)]) -> str:
    tenant_id = token.get("tenant_id")
    if not tenant_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN)
    return tenant_id

# Type aliases
TokenDep = Annotated[dict, Depends(verify_token)]
TenantDep = Annotated[str, Depends(get_tenant_id)]
CacheDep = Annotated[CacheService, Depends(get_cache)]
```

## Routes

```python
# api/routes/items.py
from fastapi import APIRouter
from fastapi.responses import StreamingResponse

router = APIRouter()

@router.post("", response_model=ItemResponse)
async def create_item(
    request: ItemRequest,
    tenant_id: TenantDep,
    service: ServiceDep,
):
    return await service.create(request, tenant_id)

@router.post("/stream")
async def stream_response(request: Request, service: ServiceDep):
    async def generate():
        async for chunk in service.stream():
            yield f"data: {chunk.model_dump_json()}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(generate(), media_type="text/event-stream")
```

## Async Service Pattern

```python
class ItemService:
    def __init__(self, cache: CacheService):
        self.cache = cache

    async def create(self, request: ItemRequest, tenant_id: str) -> ItemResponse:
        # Business logic here
        result = await self._process(request)
        await self.cache.set(f"item:{result.id}", result.model_dump())
        return result

    async def stream(self) -> AsyncIterator[StreamChunk]:
        async for chunk in self._generate():
            yield StreamChunk(content=chunk)
        yield StreamChunk(content="", done=True)
```

## Redis Cache Service

```python
import redis.asyncio as redis
import json

class CacheService:
    def __init__(self):
        self.redis: redis.Redis | None = None

    async def connect(self):
        self.redis = await redis.from_url(settings.redis_url)

    async def disconnect(self):
        if self.redis:
            await self.redis.close()

    async def get(self, key: str) -> Any | None:
        data = await self.redis.get(key)
        return json.loads(data) if data else None

    async def set(self, key: str, value: Any, ttl: int = 3600):
        await self.redis.setex(key, ttl, json.dumps(value))
```

## Custom Exceptions

```python
from fastapi import HTTPException, status

class ServiceException(HTTPException):
    def __init__(self, detail: str):
        super().__init__(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=detail)

class RateLimitException(HTTPException):
    def __init__(self):
        super().__init__(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail="Rate limit exceeded")
```

## Testing

```python
import pytest
from httpx import AsyncClient
from app.main import app

@pytest.fixture
async def client():
    async with AsyncClient(app=app, base_url="http://test") as ac:
        yield ac

@pytest.mark.asyncio
async def test_create_item(client: AsyncClient, auth_token: str):
    response = await client.post(
        "/api/v1/items",
        json={"content": "test"},
        headers={"Authorization": f"Bearer {auth_token}"},
    )
    assert response.status_code == 200
    assert "message" in response.json()
```

## Dockerfile

```dockerfile
FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY src/ ./src/
ENV PYTHONPATH=/app/src
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

## Best Practices

1. **Use Pydantic v2**: `BaseModel`, `Field`, `model_dump()`, `model_validate_json()`
2. **Async everywhere**: Never block the event loop with sync operations
3. **Dependency injection**: Use `Annotated[Type, Depends(fn)]` pattern
4. **Type hints**: Full typing for all functions and returns
5. **Lifespan context**: Manage startup/shutdown with `asynccontextmanager`

## Related Skills

- `jwt-auth`: Authentication patterns
- `redis-cache`: Response caching
- `langchain`: LLM integration
- `opentelemetry`: Observability
- `docker-containers`: Deployment
