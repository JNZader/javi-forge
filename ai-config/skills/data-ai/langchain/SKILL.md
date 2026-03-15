---
name: langchain
description: >
  Build LLM applications with chains, agents, and RAG using LangChain and LangGraph.
  Trigger: langchain, llm app, agent, rag, chains, langgraph
tools:
  - Read
  - Write
  - Bash
  - Grep
metadata:
  author: plataforma-industrial
  version: "2.0"
  tags: [langchain, llm, agents, rag, ai]
  updated: "2026-02"
---

# LangChain Skill

Build LLM-powered applications with chains, agents, RAG, and streaming.

## Stack

```yaml
langchain: 0.1+
langchain-openai: 0.0.8+
langchain-community: 0.0.20+
langgraph: 0.0.26+
langsmith: 0.1+
```

## Project Structure

```
src/
├── agents/          # LangGraph agents
├── chains/          # LCEL chains
├── prompts/         # Prompt templates
├── tools/           # Custom tools
└── vectorstore/     # RAG components
```

## Basic Chain with Structured Output

```python
from langchain_openai import ChatOpenAI
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.output_parsers import PydanticOutputParser
from pydantic import BaseModel, Field

class Analysis(BaseModel):
    status: str = Field(description="Status: normal, warning, critical")
    findings: list[str] = Field(description="Key findings")
    confidence: float = Field(description="Confidence 0-1")

def create_analysis_chain():
    llm = ChatOpenAI(model="gpt-4-turbo-preview", temperature=0)
    parser = PydanticOutputParser(pydantic_object=Analysis)

    prompt = ChatPromptTemplate.from_messages([
        ("system", "Analyze data.\n{format_instructions}"),
        ("human", "{input}")
    ])

    chain = prompt | llm | parser
    return chain

# Usage
result = await chain.ainvoke({
    "input": data,
    "format_instructions": parser.get_format_instructions()
})
```

## Custom Tools

```python
from langchain_core.tools import tool
import httpx

@tool
async def fetch_data(resource_id: str, hours: int = 24) -> str:
    """Fetch data for a resource.

    Args:
        resource_id: The resource UUID
        hours: Hours to look back (default 24)
    """
    async with httpx.AsyncClient() as client:
        response = await client.get(
            f"http://api:8080/resources/{resource_id}",
            params={"hours": hours}
        )
        return response.text

@tool
async def update_status(resource_id: str, status: str) -> str:
    """Update resource status."""
    async with httpx.AsyncClient() as client:
        response = await client.patch(
            f"http://api:8080/resources/{resource_id}",
            json={"status": status}
        )
        return "Updated" if response.status_code == 200 else f"Failed: {response.text}"
```

## LangGraph Agent

```python
from typing import TypedDict, Annotated, Sequence
from langchain_core.messages import BaseMessage, HumanMessage
from langgraph.graph import StateGraph, END
from langgraph.prebuilt import ToolNode
import operator

class AgentState(TypedDict):
    messages: Annotated[Sequence[BaseMessage], operator.add]
    context: dict

def create_agent(tools: list):
    llm = ChatOpenAI(model="gpt-4-turbo-preview", temperature=0)
    llm_with_tools = llm.bind_tools(tools)

    def agent_node(state: AgentState):
        system_message = f"Context: {state['context']}"
        response = llm_with_tools.invoke([
            {"role": "system", "content": system_message},
            *state["messages"]
        ])
        return {"messages": [response]}

    def should_continue(state: AgentState):
        last_message = state["messages"][-1]
        if hasattr(last_message, "tool_calls") and last_message.tool_calls:
            return "tools"
        return END

    workflow = StateGraph(AgentState)
    workflow.add_node("agent", agent_node)
    workflow.add_node("tools", ToolNode(tools))
    workflow.set_entry_point("agent")
    workflow.add_conditional_edges("agent", should_continue, {"tools": "tools", END: END})
    workflow.add_edge("tools", "agent")

    return workflow.compile()

# Usage
agent = create_agent([fetch_data, update_status])
result = await agent.ainvoke({
    "messages": [HumanMessage(content="Check resource status")],
    "context": {"user_id": "123"}
})
```

## RAG Chain

```python
from langchain_openai import OpenAIEmbeddings
from langchain_community.vectorstores import Chroma
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_core.runnables import RunnablePassthrough

def create_rag_chain(vectorstore):
    llm = ChatOpenAI(model="gpt-4-turbo-preview", temperature=0)
    retriever = vectorstore.as_retriever(search_type="mmr", search_kwargs={"k": 5})

    prompt = ChatPromptTemplate.from_messages([
        ("system", "Answer using context:\n{context}"),
        ("human", "{question}")
    ])

    def format_docs(docs):
        return "\n\n".join(doc.page_content for doc in docs)

    chain = (
        {"context": retriever | format_docs, "question": RunnablePassthrough()}
        | prompt
        | llm
    )
    return chain
```

## Streaming Response (FastAPI)

```python
from fastapi import APIRouter
from fastapi.responses import StreamingResponse

router = APIRouter()

@router.post("/chat/stream")
async def chat_stream(request: ChatRequest):
    llm = ChatOpenAI(model="gpt-4-turbo-preview", streaming=True)
    prompt = ChatPromptTemplate.from_messages([
        ("system", "You are a helpful assistant."),
        ("human", "{message}")
    ])
    chain = prompt | llm

    async def generate():
        async for chunk in chain.astream({"message": request.message}):
            if chunk.content:
                yield f"data: {chunk.content}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(generate(), media_type="text/event-stream")
```

## LangSmith Tracing

```python
import os
from langsmith import Client

def setup_langsmith():
    os.environ["LANGCHAIN_TRACING_V2"] = "true"
    os.environ["LANGCHAIN_PROJECT"] = "my-project"
    os.environ["LANGCHAIN_API_KEY"] = os.getenv("LANGSMITH_API_KEY")

# Add feedback
async def log_feedback(run_id: str, score: float):
    Client().create_feedback(run_id=run_id, key="user-rating", score=score)
```

## Best Practices

1. **Use structured outputs** - PydanticOutputParser for reliable parsing
2. **Async operations** - Always use `ainvoke`, `astream` for I/O
3. **Error handling** - Use RunnableConfig with retries and timeouts
4. **Cache embeddings** - CacheBackedEmbeddings for repeated queries
5. **Tracing** - Enable LangSmith for debugging and monitoring

## Related Skills

- `ai-ml`: Full AI/ML patterns
- `vector-db`: RAG with vector stores
- `fastapi`: API integration
- `redis-cache`: LLM response caching
