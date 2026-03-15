---
name: ai-ml
description: >
  AI/ML patterns with FastAPI, LangChain, OpenAI/Anthropic, ONNX export, and model training pipelines.
  Trigger: AI, ML, LangChain, OpenAI, Anthropic, ONNX, transformers, model training, LLM, agents, embeddings
tools:
  - Read
  - Write
  - Bash
  - Grep
metadata:
  author: plataforma-industrial
  version: "2.0"
  tags: [ai, ml, fastapi, langchain, onnx, openai, anthropic, python]
  updated: "2026-02"
---

# AI/ML Development

AI service patterns with FastAPI, LangChain, and ONNX export.

## Stack

```toml
[project]
requires-python = ">=3.11"
dependencies = [
    "fastapi==0.110.0",
    "uvicorn[standard]==0.28.0",
    "pydantic==2.6.3",
    "pydantic-settings==2.2.1",
    "openai==1.13.3",
    "anthropic==0.18.1",
    "langchain==0.1.11",
    "langchain-openai==0.0.8",
    "langchain-anthropic==0.1.4",
    "sentence-transformers==2.5.1",
    "torch==2.2.1",
    "transformers==4.38.2",
    "onnx==1.15.0",
    "onnxruntime==1.17.1",
    "structlog==24.1.0",
]
```

## Project Structure

```
ai-service/
├── pyproject.toml
├── src/
│   └── ai_service/
│       ├── main.py
│       ├── config.py
│       ├── api/
│       │   ├── router.py
│       │   └── endpoints/
│       ├── agents/
│       │   ├── base.py
│       │   └── sql_agent.py
│       ├── chains/
│       │   └── intent_chain.py
│       ├── models/
│       │   └── chat.py
│       ├── services/
│       │   ├── llm_service.py
│       │   └── embedding_service.py
│       └── tools/
│           └── sql_tool.py
└── tests/
```

## FastAPI Setup

```python
# src/ai_service/main.py
from contextlib import asynccontextmanager
from fastapi import FastAPI
import structlog

from ai_service.config import settings
from ai_service.api.router import api_router
from ai_service.services.llm_service import LLMService

logger = structlog.get_logger()

@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.llm_service = LLMService()
    yield

def create_app() -> FastAPI:
    app = FastAPI(
        title="AI Service",
        version=settings.version,
        lifespan=lifespan,
    )
    app.include_router(api_router, prefix="/api/v1")
    return app

app = create_app()
```

## LLM Service Pattern

```python
# src/ai_service/services/llm_service.py
from abc import ABC, abstractmethod
from openai import AsyncOpenAI
from anthropic import AsyncAnthropic
from ai_service.config import settings

class BaseLLM(ABC):
    @abstractmethod
    async def generate(self, messages: list[dict], temperature: float = 0.7) -> str:
        pass

class OpenAILLM(BaseLLM):
    def __init__(self):
        self.client = AsyncOpenAI(api_key=settings.openai_api_key)
        self.model = settings.openai_model

    async def generate(self, messages: list[dict], temperature: float = 0.7) -> str:
        response = await self.client.chat.completions.create(
            model=self.model,
            messages=messages,
            temperature=temperature,
        )
        return response.choices[0].message.content or ""

class AnthropicLLM(BaseLLM):
    def __init__(self):
        self.client = AsyncAnthropic(api_key=settings.anthropic_api_key)
        self.model = settings.anthropic_model

    async def generate(self, messages: list[dict], temperature: float = 0.7) -> str:
        system = ""
        user_messages = []
        for msg in messages:
            if msg["role"] == "system":
                system = msg["content"]
            else:
                user_messages.append(msg)

        response = await self.client.messages.create(
            model=self.model,
            max_tokens=1000,
            system=system,
            messages=user_messages,
            temperature=temperature,
        )
        return response.content[0].text

class LLMService:
    def __init__(self):
        self._llms: dict[str, BaseLLM] = {}

    def _get_llm(self, provider: str = "openai") -> BaseLLM:
        if provider not in self._llms:
            self._llms[provider] = OpenAILLM() if provider == "openai" else AnthropicLLM()
        return self._llms[provider]

    async def generate(self, messages: list[dict], provider: str = "openai") -> str:
        return await self._get_llm(provider).generate(messages)
```

## LangChain SQL Agent

```python
# src/ai_service/agents/sql_agent.py
from langchain.agents import AgentExecutor, create_openai_tools_agent
from langchain_openai import ChatOpenAI
from langchain.prompts import ChatPromptTemplate, MessagesPlaceholder
from ai_service.tools.sql_tool import SQLQueryTool

SQL_SYSTEM_PROMPT = """You are an AI that queries a database.
Generate SELECT queries only. Never modify data."""

class SQLAgent:
    def __init__(self, db_url: str):
        self.llm = ChatOpenAI(model="gpt-4-turbo-preview", temperature=0)
        self.sql_tool = SQLQueryTool(db_url)
        self.agent = self._create_agent()

    def _create_agent(self) -> AgentExecutor:
        prompt = ChatPromptTemplate.from_messages([
            ("system", SQL_SYSTEM_PROMPT),
            MessagesPlaceholder(variable_name="chat_history", optional=True),
            ("human", "{input}"),
            MessagesPlaceholder(variable_name="agent_scratchpad"),
        ])

        agent = create_openai_tools_agent(
            llm=self.llm,
            tools=[self.sql_tool],
            prompt=prompt,
        )

        return AgentExecutor(agent=agent, tools=[self.sql_tool], max_iterations=3)

    async def query(self, question: str) -> dict:
        result = await self.agent.ainvoke({"input": question})
        return {"answer": result["output"]}
```

## LangChain Tool

```python
# src/ai_service/tools/sql_tool.py
from typing import Type
from langchain.tools import BaseTool
from pydantic import BaseModel, Field
from sqlalchemy import create_engine, text

class SQLQueryInput(BaseModel):
    query: str = Field(description="SELECT query to execute")

class SQLQueryTool(BaseTool):
    name: str = "sql_query"
    description: str = "Execute read-only SQL queries"
    args_schema: Type[BaseModel] = SQLQueryInput
    db_url: str

    def __init__(self, db_url: str):
        super().__init__(db_url=db_url)
        self._engine = create_engine(db_url)

    def _run(self, query: str) -> str:
        if not query.strip().upper().startswith("SELECT"):
            return "Error: Only SELECT allowed"

        forbidden = ["INSERT", "UPDATE", "DELETE", "DROP", "ALTER"]
        if any(kw in query.upper() for kw in forbidden):
            return "Error: Forbidden operation"

        with self._engine.connect() as conn:
            result = conn.execute(text(query))
            rows = result.fetchall()[:50]
            return str([dict(zip(result.keys(), row)) for row in rows])
```

## Chat Endpoint

```python
# src/ai_service/api/endpoints/chat.py
import time
from uuid import uuid4
from fastapi import APIRouter, Depends
from ai_service.models.chat import ChatRequest, ChatResponse
from ai_service.services.llm_service import LLMService

router = APIRouter()

@router.post("/chat", response_model=ChatResponse)
async def chat(request: ChatRequest, llm_service: LLMService = Depends()):
    start_time = time.time()
    conversation_id = request.conversation_id or str(uuid4())

    messages = [
        {"role": "system", "content": "You are a helpful assistant."},
        {"role": "user", "content": request.message},
    ]

    response = await llm_service.generate(messages)

    return ChatResponse(
        message=response,
        conversation_id=conversation_id,
        processing_time_ms=int((time.time() - start_time) * 1000),
    )
```

## ONNX Export

```python
# scripts/export_onnx.py
from pathlib import Path
from transformers import AutoTokenizer, AutoModelForSequenceClassification
from optimum.onnxruntime import ORTModelForSequenceClassification

def export_model(model_path: str, output_path: str, quantize: bool = True):
    tokenizer = AutoTokenizer.from_pretrained(model_path)

    ort_model = ORTModelForSequenceClassification.from_pretrained(
        model_path, export=True
    )

    output_dir = Path(output_path)
    output_dir.mkdir(parents=True, exist_ok=True)

    ort_model.save_pretrained(output_dir)
    tokenizer.save_pretrained(output_dir)

    if quantize:
        from optimum.onnxruntime import ORTQuantizer
        from optimum.onnxruntime.configuration import AutoQuantizationConfig

        quantizer = ORTQuantizer.from_pretrained(output_dir)
        qconfig = AutoQuantizationConfig.avx512_vnni(is_static=False)
        quantizer.quantize(save_dir=output_dir / "quantized", quantization_config=qconfig)
```

## Training Pipeline

```python
# src/ai_training/trainer.py
from transformers import (
    AutoTokenizer,
    AutoModelForSequenceClassification,
    TrainingArguments,
    Trainer,
)
from datasets import load_dataset

class IntentClassifierTrainer:
    def __init__(self, model_name: str = "distilbert-base-uncased", num_labels: int = 7):
        self.tokenizer = AutoTokenizer.from_pretrained(model_name)
        self.model = AutoModelForSequenceClassification.from_pretrained(
            model_name, num_labels=num_labels
        )

    def prepare_dataset(self, data_path: str):
        dataset = load_dataset("json", data_files={
            "train": f"{data_path}/train.json",
            "validation": f"{data_path}/validation.json",
        })

        def tokenize(examples):
            return self.tokenizer(
                examples["text"],
                padding="max_length",
                truncation=True,
                max_length=128,
            )

        return dataset.map(tokenize, batched=True)

    def train(self, dataset, output_dir: str):
        args = TrainingArguments(
            output_dir=output_dir,
            num_train_epochs=10,
            per_device_train_batch_size=32,
            learning_rate=2e-5,
            evaluation_strategy="epoch",
            save_strategy="epoch",
            load_best_model_at_end=True,
        )

        trainer = Trainer(
            model=self.model,
            args=args,
            train_dataset=dataset["train"],
            eval_dataset=dataset["validation"],
        )

        trainer.train()
        trainer.save_model()
        self.tokenizer.save_pretrained(output_dir)
```

## Pydantic Models

```python
# src/ai_service/models/chat.py
from pydantic import BaseModel, Field

class ChatRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=4000)
    conversation_id: str | None = None
    context: dict | None = None

class ChatResponse(BaseModel):
    message: str
    conversation_id: str
    intent: str | None = None
    processing_time_ms: int
```

## Configuration

```python
# src/ai_service/config.py
from functools import lru_cache
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    version: str = "0.1.0"
    openai_api_key: str = ""
    openai_model: str = "gpt-4-turbo-preview"
    anthropic_api_key: str = ""
    anthropic_model: str = "claude-3-sonnet-20240229"
    database_url: str = "postgresql://user:pass@localhost/db"
    redis_url: str = "redis://localhost:6379"

    class Config:
        env_file = ".env"

@lru_cache
def get_settings() -> Settings:
    return Settings()

settings = get_settings()
```

## Conventions

| Element | Convention | Example |
|---------|------------|---------|
| Modules | snake_case | `llm_service.py` |
| Classes | PascalCase | `LLMService`, `SQLAgent` |
| Functions | snake_case | `generate()` |
| Constants | SCREAMING_SNAKE | `SQL_SYSTEM_PROMPT` |
| Pydantic models | PascalCase | `ChatRequest` |
| Test files | test_ prefix | `test_chat.py` |

## Related Skills

- `fastapi`: API serving patterns
- `langchain`: LLM chains and agents
- `onnx-inference`: Model deployment
- `pytorch`: Deep learning training
- `mlflow`: Experiment tracking
- `vector-db`: Embeddings storage
