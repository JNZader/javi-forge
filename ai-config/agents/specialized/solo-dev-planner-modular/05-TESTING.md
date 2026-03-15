---
name: solo-dev-planner-testing
description: "Módulo 5: Testing robusto con Testcontainers"
---

# 🧪 Solo Dev Planner - Testing Strategy

> Módulo 5 de 6: Testing robusto con Testcontainers

## 📚 Relacionado con:
- 01-CORE.md (CI/CD integration)
- 02-SELF-CORRECTION.md (Auto-fix tests)
- 06-OPERATIONS.md (Mise tasks, DB para tests)

---

## 🧪 Testing Strategy Completa

### Pirámide de Testing

```
        /\
       /E2E\     ← 10% (costosos, lentos, frágiles)
      /------\
     /Integr.\   ← 20% (medios, con DB/API)
    /----------\
   /   Unit     \ ← 70% (rápidos, baratos, aislados)
  /--------------\

Regla de oro: Mientras más bajo en la pirámide, mejor ROI
```

---

## 📊 Unit Tests (70% de cobertura)

### TypeScript con Bun

```typescript
// tests/unit/user.test.ts
import { test, expect, describe, beforeEach } from 'bun:test';
import { User } from '@/models/User';
import { hash } from '@/utils/crypto';

describe('User Model', () => {
  describe('validation', () => {
    test('rejects invalid email', () => {
      expect(() => User.create({ 
        email: 'invalid',
        password: 'pass123' 
      })).toThrow('Invalid email format');
    });
    
    test('requires password min length', () => {
      expect(() => User.create({
        email: 'test@example.com',
        password: '123'
      })).toThrow('Password must be at least 8 characters');
    });
    
    test('accepts valid user data', () => {
      const user = User.create({
        email: 'test@example.com',
        password: 'validpass123'
      });
      
      expect(user.email).toBe('test@example.com');
      expect(user.password).not.toBe('validpass123'); // Should be hashed
    });
  });
  
  describe('authentication', () => {
    test('verifies correct password', async () => {
      const user = await User.create({
        email: 'test@example.com',
        password: 'secret123'
      });
      
      const isValid = await user.verifyPassword('secret123');
      expect(isValid).toBe(true);
    });
    
    test('rejects incorrect password', async () => {
      const user = await User.create({
        email: 'test@example.com',
        password: 'secret123'
      });
      
      const isValid = await user.verifyPassword('wrong');
      expect(isValid).toBe(false);
    });
  });
});
```

### Python con pytest

```python
# tests/unit/test_user.py
import pytest
from app.models.user import User
from app.exceptions import ValidationError

class TestUserModel:
    """Test suite for User model"""
    
    def test_rejects_invalid_email(self):
        with pytest.raises(ValidationError, match="Invalid email"):
            User.create(email="invalid", password="pass123")
    
    def test_requires_password_min_length(self):
        with pytest.raises(ValidationError, match="at least 8 characters"):
            User.create(email="test@example.com", password="123")
    
    def test_accepts_valid_user_data(self):
        user = User.create(
            email="test@example.com",
            password="validpass123"
        )
        
        assert user.email == "test@example.com"
        assert user.password != "validpass123"  # Should be hashed
    
    @pytest.mark.asyncio
    async def test_verifies_correct_password(self):
        user = await User.create(
            email="test@example.com",
            password="secret123"
        )
        
        is_valid = await user.verify_password("secret123")
        assert is_valid is True
    
    @pytest.mark.asyncio
    async def test_rejects_incorrect_password(self):
        user = await User.create(
            email="test@example.com",
            password="secret123"
        )
        
        is_valid = await user.verify_password("wrong")
        assert is_valid is False


# Fixtures en conftest.py
# tests/conftest.py
import pytest
from app.database import engine, SessionLocal
from app.models import Base

@pytest.fixture(scope="function")
async def db_session():
    """Create a fresh database for each test"""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.drop_all)
```

### Go con testify

```go
// internal/models/user_test.go
package models

import (
    "testing"
    "github.com/stretchr/testify/assert"
    "github.com/stretchr/testify/require"
)

func TestUser_Create_ValidatesEmail(t *testing.T) {
    tests := []struct {
        name    string
        email   string
        wantErr bool
    }{
        {
            name:    "valid email",
            email:   "test@example.com",
            wantErr: false,
        },
        {
            name:    "invalid email - no @",
            email:   "invalid",
            wantErr: true,
        },
        {
            name:    "invalid email - no domain",
            email:   "test@",
            wantErr: true,
        },
    }
    
    for _, tt := range tests {
        t.Run(tt.name, func(t *testing.T) {
            user, err := NewUser(tt.email, "password123")
            
            if tt.wantErr {
                assert.Error(t, err)
                assert.Nil(t, user)
            } else {
                assert.NoError(t, err)
                assert.NotNil(t, user)
                assert.Equal(t, tt.email, user.Email)
            }
        })
    }
}

func TestUser_VerifyPassword(t *testing.T) {
    user, err := NewUser("test@example.com", "secret123")
    require.NoError(t, err)
    
    t.Run("correct password", func(t *testing.T) {
        valid := user.VerifyPassword("secret123")
        assert.True(t, valid)
    })
    
    t.Run("incorrect password", func(t *testing.T) {
        valid := user.VerifyPassword("wrong")
        assert.False(t, valid)
    })
}
```

### Test Data Factories (TypeScript)

```typescript
// tests/factories/user.factory.ts
import { faker } from '@faker-js/faker';
import { db } from '@/db';

export const UserFactory = {
  /**
   * Build user data without saving to DB
   */
  build: (overrides: Partial<User> = {}) => ({
    email: faker.internet.email(),
    name: faker.person.fullName(),
    password: faker.internet.password({ length: 12 }),
    role: 'user',
    createdAt: new Date(),
    ...overrides,
  }),
  
  /**
   * Create user in database
   */
  create: async (overrides: Partial<User> = {}) => {
    const data = UserFactory.build(overrides);
    return await db.user.create({ data });
  },
  
  /**
   * Create multiple users
   */
  createMany: async (count: number, overrides: Partial<User> = {}) => {
    return Promise.all(
      Array.from({ length: count }, () => UserFactory.create(overrides))
    );
  },
};

// Uso en tests
test('can list users', async () => {
  await UserFactory.createMany(5);
  
  const users = await User.findAll();
  expect(users).toHaveLength(5);
});

test('can create admin user', async () => {
  const admin = await UserFactory.create({ role: 'admin' });
  expect(admin.role).toBe('admin');
});
```

---

## 🔗 Integration Tests (20%)

### API Integration Tests (TypeScript + Hono)

```typescript
// tests/integration/auth.test.ts
import { test, expect, beforeAll, afterAll } from 'bun:test';
import { app } from '@/index';
import { db } from '@/db';
import { UserFactory } from '../factories/user.factory';

// Setup test database
beforeAll(async () => {
  await db.migrate.latest();
});

afterAll(async () => {
  await db.migrate.rollback();
  await db.destroy();
});

test('POST /auth/register creates user', async () => {
  const res = await app.request('/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'newuser@example.com',
      password: 'password123',
      name: 'New User',
    }),
  });
  
  expect(res.status).toBe(201);
  
  const json = await res.json();
  expect(json.user.email).toBe('newuser@example.com');
  expect(json.token).toBeDefined();
  
  // Verify user in database
  const user = await db.user.findUnique({
    where: { email: 'newuser@example.com' },
  });
  expect(user).toBeDefined();
  expect(user!.name).toBe('New User');
});

test('POST /auth/login returns token for valid credentials', async () => {
  // Arrange: Create user
  const password = 'secret123';
  const user = await UserFactory.create({ password });
  
  // Act: Login
  const res = await app.request('/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: user.email,
      password,
    }),
  });
  
  // Assert
  expect(res.status).toBe(200);
  
  const json = await res.json();
  expect(json.token).toBeDefined();
  expect(json.user.id).toBe(user.id);
});

test('protected routes require authentication', async () => {
  const res = await app.request('/api/profile', {
    method: 'GET',
  });
  
  expect(res.status).toBe(401);
});

test('protected routes accept valid token', async () => {
  // Create user and get token
  const user = await UserFactory.create();
  const token = await generateToken(user);
  
  const res = await app.request('/api/profile', {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`,
    },
  });
  
  expect(res.status).toBe(200);
  
  const json = await res.json();
  expect(json.email).toBe(user.email);
});
```

### Database Integration Tests (Python)

```python
# tests/integration/test_user_repository.py
import pytest
from app.repositories.user_repository import UserRepository
from app.models.user import User

@pytest.mark.asyncio
class TestUserRepository:
    async def test_create_and_find_user(self, db_session):
        repo = UserRepository(db_session)
        
        # Create user
        user = await repo.create(
            email="test@example.com",
            password="password123"
        )
        
        assert user.id is not None
        assert user.email == "test@example.com"
        
        # Find user
        found = await repo.find_by_email("test@example.com")
        assert found is not None
        assert found.id == user.id
    
    async def test_update_user(self, db_session):
        repo = UserRepository(db_session)
        
        user = await repo.create(
            email="test@example.com",
            password="password123"
        )
        
        # Update
        updated = await repo.update(
            user.id,
            name="Updated Name"
        )
        
        assert updated.name == "Updated Name"
        assert updated.email == "test@example.com"
    
    async def test_delete_user(self, db_session):
        repo = UserRepository(db_session)
        
        user = await repo.create(
            email="test@example.com",
            password="password123"
        )
        
        # Delete
        await repo.delete(user.id)
        
        # Verify deleted
        found = await repo.find_by_id(user.id)
        assert found is None
```

---

## 🌐 E2E Tests (10%)

### Playwright Setup

```typescript
// playwright.config.ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  
  webServer: {
    command: 'mise run dev',
    port: 3000,
    reuseExistingServer: !process.env.CI,
  },
});
```

### E2E Test Examples

```typescript
// tests/e2e/auth-flow.spec.ts
import { test, expect } from '@playwright/test';

test.describe('Complete Authentication Flow', () => {
  test('user can register, login, and access protected pages', async ({ page }) => {
    // Register
    await page.goto('/register');
    await page.fill('[name="email"]', 'user@test.com');
    await page.fill('[name="password"]', 'password123');
    await page.fill('[name="name"]', 'Test User');
    await page.click('button[type="submit"]');
    
    // Should redirect to dashboard
    await expect(page).toHaveURL('/dashboard');
    await expect(page.locator('h1')).toContainText('Welcome, Test User');
    
    // Logout
    await page.click('[data-testid="logout-button"]');
    await expect(page).toHaveURL('/login');
    
    // Login again
    await page.fill('[name="email"]', 'user@test.com');
    await page.fill('[name="password"]', 'password123');
    await page.click('button[type="submit"]');
    
    // Should be logged in
    await expect(page).toHaveURL('/dashboard');
  });
  
  test('shows error for invalid credentials', async ({ page }) => {
    await page.goto('/login');
    await page.fill('[name="email"]', 'wrong@test.com');
    await page.fill('[name="password"]', 'wrongpass');
    await page.click('button[type="submit"]');
    
    await expect(page.locator('[role="alert"]'))
      .toContainText('Invalid credentials');
  });
});

// tests/e2e/task-management.spec.ts
test.describe('Task Management', () => {
  test.beforeEach(async ({ page }) => {
    // Login before each test
    await page.goto('/login');
    await page.fill('[name="email"]', 'user@test.com');
    await page.fill('[name="password"]', 'password123');
    await page.click('button[type="submit"]');
  });
  
  test('can create, edit, and delete task', async ({ page }) => {
    // Create task
    await page.goto('/tasks');
    await page.click('[data-testid="new-task"]');
    await page.fill('[name="title"]', 'My New Task');
    await page.fill('[name="description"]', 'Task description');
    await page.click('button[type="submit"]');
    
    await expect(page.locator('[data-testid="task-item"]'))
      .toContainText('My New Task');
    
    // Edit task
    await page.click('[data-testid="edit-task"]');
    await page.fill('[name="title"]', 'Updated Task');
    await page.click('button[type="submit"]');
    
    await expect(page.locator('[data-testid="task-item"]'))
      .toContainText('Updated Task');
    
    // Delete task
    await page.click('[data-testid="delete-task"]');
    await page.click('[data-testid="confirm-delete"]');
    
    await expect(page.locator('[data-testid="task-item"]'))
      .not.toBeVisible();
  });
});
```

---

## 🎯 Mise Tasks para Testing

```toml
# .mise.toml

[tasks."test:unit"]
description = "Run unit tests"
run = """
#!/usr/bin/env bash
if mise current node &> /dev/null; then
  bun test tests/unit/
elif mise current python &> /dev/null; then
  pytest tests/unit/ -v
elif mise current go &> /dev/null; then
  go test ./... -short
fi
"""
alias = "tu"

[tasks."test:integration"]
description = "Run integration tests (requires DB)"
run = """
#!/usr/bin/env bash

# Start test database
docker compose -f docker-compose.test.yml up -d
echo "⏳ Waiting for database..."
sleep 5

# Run migrations
mise run db:migrate

# Run tests
if mise current node &> /dev/null; then
  bun test tests/integration/
elif mise current python &> /dev/null; then
  pytest tests/integration/ -v
elif mise current go &> /dev/null; then
  go test ./... -run Integration
fi

# Cleanup
docker compose -f docker-compose.test.yml down
"""
alias = "ti"

[tasks."test:e2e"]
description = "Run E2E tests with Playwright"
run = """
#!/usr/bin/env bash
# Start app in background
mise run dev &
APP_PID=$!

# Wait for app to be ready
sleep 5

# Run E2E tests
playwright test

# Cleanup
kill $APP_PID
"""
alias = "te"

[tasks."test:watch"]
description = "Run tests in watch mode"
run = """
#!/usr/bin/env bash
if mise current node &> /dev/null; then
  bun test --watch
elif mise current python &> /dev/null; then
  ptw tests/ --
elif mise current go &> /dev/null; then
  gotestsum --watch
fi
"""
alias = "tw"

[tasks."test:coverage"]
description = "Run tests with coverage report"
run = """
#!/usr/bin/env bash
if mise current node &> /dev/null; then
  bun test --coverage
elif mise current python &> /dev/null; then
  pytest --cov=app --cov-report=html --cov-report=term
elif mise current go &> /dev/null; then
  go test -coverprofile=coverage.out ./...
  go tool cover -html=coverage.out -o coverage.html
fi

echo "✅ Coverage report generated"
"""
alias = "tc"

[tasks.test]
description = "Run all tests (unit + integration)"
run = """
mise run test:unit
mise run test:integration
"""
alias = "t"
```

### Docker Compose para Tests

```yaml
# docker-compose.test.yml
version: '3.8'

services:
  db-test:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: testdb
      POSTGRES_USER: testuser
      POSTGRES_PASSWORD: testpass
    ports:
      - "5433:5432"
    tmpfs:
      - /var/lib/postgresql/data  # Usar RAM para tests (más rápido)
  
  redis-test:
    image: redis:7-alpine
    ports:
      - "6380:6379"
```

---

## 📊 Coverage Configuration

### TypeScript (Bun)

```json
// package.json
{
  "scripts": {
    "test:coverage": "bun test --coverage"
  }
}
```

### Python (pytest)

```ini
# pytest.ini
[pytest]
testpaths = tests
python_files = test_*.py
python_classes = Test*
python_functions = test_*

addopts =
    -v
    --strict-markers
    --cov=app
    --cov-report=html
    --cov-report=term-missing
    --cov-fail-under=80

markers =
    slow: marks tests as slow
    integration: marks tests as integration tests
    e2e: marks tests as end-to-end tests
```

### Go

```bash
# Makefile o mise task
go test -coverprofile=coverage.out ./...
go tool cover -func=coverage.out
go tool cover -html=coverage.out -o coverage.html
```

---

## 🎯 Best Practices

### 1. Test Naming Conventions

```typescript
// ❌ Bad
test('test1', () => {});

// ✅ Good
test('UserService.create rejects invalid email', () => {});
test('POST /users returns 201 for valid data', () => {});
```

### 2. Arrange-Act-Assert Pattern

```typescript
test('user can update profile', async () => {
  // Arrange
  const user = await UserFactory.create();
  const token = await generateToken(user);
  
  // Act
  const res = await app.request('/api/profile', {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ name: 'New Name' }),
  });
  
  // Assert
  expect(res.status).toBe(200);
  const updated = await res.json();
  expect(updated.name).toBe('New Name');
});
```

### 3. Test Isolation

```typescript
// ❌ Bad: Tests depend on each other
let userId: string;

test('create user', async () => {
  const res = await createUser();
  userId = res.id; // Shared state!
});

test('update user', async () => {
  await updateUser(userId); // Depends on previous test
});

// ✅ Good: Each test is independent
test('can update user', async () => {
  const user = await UserFactory.create(); // Fresh user
  await updateUser(user.id);
});
```

### 4. Mock External Services

```typescript
// tests/mocks/email.mock.ts
export const emailService = {
  send: vi.fn().mockResolvedValue({ success: true }),
};

// In test
test('sends welcome email on registration', async () => {
  await registerUser({ email: 'test@example.com' });
  
  expect(emailService.send).toHaveBeenCalledWith({
    to: 'test@example.com',
    template: 'welcome',
  });
});
```

---

## 🧪 Testcontainers (Tests Reales sin Mocks)

### Filosofía: Tests Reales > Mocks Frágiles

**Problema con Mocks:**
```typescript
❌ Frágiles - Se rompen al cambiar implementación
❌ No prueban queries SQL reales
❌ Mantenimiento costoso (mock de cada método)
❌ Falsa sensación de seguridad
```

**Con Testcontainers:**
```typescript
✅ Prueban contra base de datos REAL
✅ Queries SQL ejecutados realmente
✅ Menos código de test (no mockear)
✅ Mayor confianza en tests
❌ Más lentos (pero cacheables)
```

### Cuándo Usar Cada Enfoque

```
Unit Tests (70%):
✅ Lógica de negocio pura
✅ Funciones sin side effects
✅ Validaciones
→ NO necesitan DB ni mocks

Integration Tests (20%):
✅ Repository layer
✅ Queries complejas
✅ Transactions
→ Testcontainers

E2E Tests (10%):
✅ User flows completos
→ Playwright + Testcontainers
```

---

## TypeScript + Bun + Testcontainers

### Setup

```bash
# Instalar
bun add -d @testcontainers/postgresql
```

### Test Setup

```typescript
// tests/integration/setup.ts
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '@/db/schema';

let container: StartedPostgreSqlContainer;
let db: ReturnType<typeof drizzle>;

export async function setupTestDB() {
  // Iniciar container (reutilizable entre tests)
  container = await new PostgreSqlContainer('postgres:16-alpine')
    .withDatabase('testdb')
    .withUsername('test')
    .withPassword('test')
    .withReuse() // ← IMPORTANTE: Reutilizar = más rápido
    .start();
  
  // Conectar
  const connectionString = container.getConnectionUri();
  const client = postgres(connectionString);
  db = drizzle(client, { schema });
  
  // Aplicar migraciones
  await runMigrations(db);
  
  return { db, connectionString };
}

export async function teardownTestDB() {
  await container.stop();
}

export async function resetTestDB() {
  // Limpiar todas las tablas entre tests
  await db.delete(schema.users);
  await db.delete(schema.tasks);
}
```

### Tests de Integración

```typescript
// tests/integration/user-repository.test.ts
import { test, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import { setupTestDB, teardownTestDB, resetTestDB } from './setup';
import { UserRepository } from '@/repositories/UserRepository';

let db: any;
let userRepo: UserRepository;

beforeAll(async () => {
  const setup = await setupTestDB();
  db = setup.db;
  userRepo = new UserRepository(db);
});

afterAll(async () => {
  await teardownTestDB();
});

beforeEach(async () => {
  await resetTestDB(); // Fresh DB para cada test
});

test('UserRepository.create inserts into real database', async () => {
  // Arrange
  const userData = {
    email: 'test@example.com',
    name: 'Test User',
    password: 'hashed_password',
  };
  
  // Act
  const user = await userRepo.create(userData);
  
  // Assert
  expect(user.id).toBeDefined();
  expect(user.email).toBe('test@example.com');
  
  // Verificar en DB REAL (no mock)
  const found = await userRepo.findById(user.id);
  expect(found).toBeDefined();
  expect(found!.name).toBe('Test User');
});

test('complex query with joins works correctly', async () => {
  // Arrange
  const user = await userRepo.create({ 
    email: 'test@example.com',
    name: 'Test',
    password: 'pass'
  });
  
  const task = await taskRepo.create({
    userId: user.id,
    title: 'Test Task',
    completed: false,
  });
  
  // Act - Query complejo con JOIN
  const userWithTasks = await userRepo.findWithTasks(user.id);
  
  // Assert - Verifica query SQL real
  expect(userWithTasks.tasks).toHaveLength(1);
  expect(userWithTasks.tasks[0].title).toBe('Test Task');
});
```

---

## Python + pytest + Testcontainers

### Setup

```bash
# Instalar
uv add --dev testcontainers
```

### Test Setup

```python
# tests/integration/conftest.py
import pytest
from testcontainers.postgres import PostgresContainer
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from app.models import Base

@pytest.fixture(scope="session")
def postgres_container():
    """PostgreSQL container (reutilizado en toda la sesión)"""
    with PostgresContainer("postgres:16-alpine") as postgres:
        yield postgres

@pytest.fixture(scope="session")
def engine(postgres_container):
    """SQLAlchemy engine"""
    engine = create_engine(postgres_container.get_connection_url())
    Base.metadata.create_all(engine)
    return engine

@pytest.fixture(scope="function")
def db_session(engine):
    """Fresh database session para cada test"""
    Session = sessionmaker(bind=engine)
    session = Session()
    
    try:
        yield session
    finally:
        session.rollback()
        session.close()
        
        # Limpiar tablas
        for table in reversed(Base.metadata.sorted_tables):
            engine.execute(table.delete())
```

### Tests de Integración

```python
# tests/integration/test_user_repository.py
import pytest
from app.repositories.user_repository import UserRepository

class TestUserRepository:
    def test_create_inserts_into_real_database(self, db_session):
        # Arrange
        repo = UserRepository(db_session)
        user_data = {
            "email": "test@example.com",
            "name": "Test User",
            "password": "hashed"
        }
        
        # Act
        user = repo.create(**user_data)
        db_session.commit()
        
        # Assert
        assert user.id is not None
        
        # Verificar en DB real
        found = repo.find_by_id(user.id)
        assert found.email == "test@example.com"
    
    def test_complex_query_with_joins(self, db_session):
        repo = UserRepository(db_session)
        task_repo = TaskRepository(db_session)
        
        # Create user y tasks
        user = repo.create(email="test@example.com", name="Test", password="pass")
        task = task_repo.create(user_id=user.id, title="Task 1")
        db_session.commit()
        
        # Query con JOIN
        user_with_tasks = repo.find_with_tasks(user.id)
        
        # Assert SQL real ejecutado
        assert len(user_with_tasks.tasks) == 1
        assert user_with_tasks.tasks[0].title == "Task 1"
```

---

## Go + testcontainers-go

### Setup

```bash
go get github.com/testcontainers/testcontainers-go
go get github.com/testcontainers/testcontainers-go/modules/postgres
```

### Test Setup

```go
// internal/repository/setup_test.go
package repository

import (
    "context"
    "database/sql"
    "testing"
    
    "github.com/testcontainers/testcontainers-go/modules/postgres"
)

var testDB *sql.DB

func setupTestDB(t *testing.T) *sql.DB {
    ctx := context.Background()
    
    // Start container
    pgContainer, err := postgres.RunContainer(ctx,
        testcontainers.WithImage("postgres:16-alpine"),
        postgres.WithDatabase("testdb"),
        postgres.WithUsername("test"),
        postgres.WithPassword("test"),
    )
    if err != nil {
        t.Fatal(err)
    }
    
    t.Cleanup(func() {
        pgContainer.Terminate(ctx)
    })
    
    // Connect
    connStr, _ := pgContainer.ConnectionString(ctx, "sslmode=disable")
    db, err := sql.Open("postgres", connStr)
    if err != nil {
        t.Fatal(err)
    }
    
    // Run migrations
    runMigrations(db)
    
    return db
}

func resetDB(t *testing.T, db *sql.DB) {
    _, err := db.Exec("TRUNCATE users, tasks CASCADE")
    if err != nil {
        t.Fatal(err)
    }
}
```

### Tests

```go
// internal/repository/user_repository_test.go
func TestUserRepository_Create(t *testing.T) {
    db := setupTestDB(t)
    defer db.Close()
    resetDB(t, db)
    
    repo := NewUserRepository(db)
    
    // Arrange
    user := &User{
        Email:    "test@example.com",
        Name:     "Test User",
        Password: "hashed",
    }
    
    // Act
    err := repo.Create(context.Background(), user)
    
    // Assert
    assert.NoError(t, err)
    assert.NotZero(t, user.ID)
    
    // Verify en DB real
    found, err := repo.FindByID(context.Background(), user.ID)
    require.NoError(t, err)
    assert.Equal(t, "test@example.com", found.Email)
}
```

---

## Performance Tips

### 1. Reutilizar Containers

```typescript
// ❌ Lento (inicia container por cada test suite)
const container = await new PostgreSqlContainer().start();

// ✅ Rápido (reutiliza container)
const container = await new PostgreSqlContainer()
  .withReuse() // ← IMPORTANTE
  .start();

// Mejora: 5-10s → 1-2s por suite
```

### 2. Usar tmpfs para Datos

```yaml
# docker-compose.test.yml
services:
  test-db:
    image: postgres:16-alpine
    tmpfs:
      - /var/lib/postgresql/data  # RAM disk = más rápido

# Mejora: 30-50% más rápido
```

### 3. Parallel Tests con Múltiples Containers

```typescript
// Cada worker de test obtiene su propio container
test.concurrent('test 1', async () => {
  const container = await getOrCreateContainer();
  // ...
});
```

---

## Mise Tasks para Testcontainers

```toml
# .mise.toml

[tasks."test:integration"]
description = "Run integration tests with Testcontainers"
run = """
#!/usr/bin/env bash

# Verificar Docker
if ! docker info > /dev/null 2>&1; then
  echo "❌ Docker no está corriendo"
  echo "Inicia Docker y vuelve a intentar"
  exit 1
fi

echo "🐳 Starting Testcontainers..."

if [ -f "package.json" ]; then
  bun test tests/integration/
elif [ -f "pyproject.toml" ]; then
  pytest tests/integration/ -v
elif [ -f "go.mod" ]; then
  go test ./internal/... -tags=integration
fi

echo "✅ Integration tests completed"
"""

[tasks."test:integration:watch"]
description = "Watch mode for integration tests"
run = """
if [ -f "package.json" ]; then
  bun test --watch tests/integration/
elif [ -f "pyproject.toml" ]; then
  ptw tests/integration/
fi
"""
```

---

## Comparación: Mocks vs Testcontainers

| Aspecto | Mocks | Testcontainers |
|---------|-------|----------------|
| **Velocidad** | ⚡ 1-2ms | 🐢 100-500ms (con cache: 10-50ms) |
| **Confianza** | 🟡 Media | ✅ Alta |
| **Mantenimiento** | ❌ Alto | ✅ Bajo |
| **Queries reales** | ❌ No | ✅ Sí |
| **Setup** | 🟡 Medio | ✅ Simple |
| **CI/CD** | ✅ Rápido | 🟡 Necesita Docker |

### Recomendación

```
Unit tests (70%):        Sin DB, sin mocks
Integration tests (20%): Testcontainers
E2E tests (10%):        Testcontainers + Playwright
```

---

## 🧪 Testcontainers - Tests Reales Sin Mocks

### Filosofía: Tests Reales > Mocks Frágiles

**Problema con Mocks:**
```typescript
❌ Frágiles - Se rompen con cambios de implementación
❌ No prueban queries SQL reales
❌ Mantenimiento costoso (mock hell)
❌ Falsa sensación de seguridad
❌ Diferencias entre mock y DB real
```

**Con Testcontainers:**
```typescript
✅ Prueban contra DB real en Docker
✅ Queries SQL reales ejecutadas
✅ Menos mantenimiento a largo plazo
✅ Mayor confianza en producción
✅ Detecta problemas de performance
⚠️  Más lentos (pero con cache ~2 segundos)
```

### Cuándo Usar Cada Estrategia

```
Unit Tests (70%):
  ✅ Lógica de negocio pura
  ✅ Funciones sin side effects
  ✅ Validaciones
  → NO mocks, NO DB, SOLO lógica

Integration Tests (20%):
  ✅ Repository layer
  ✅ Database queries
  ✅ API endpoints completos
  → TESTCONTAINERS (DB real)

E2E Tests (10%):
  ✅ User flows completos
  ✅ UI + API + DB
  → Playwright + Testcontainers
```

---

## TypeScript + Bun + PostgreSQL + Testcontainers

### Instalación

```bash
bun add -d @testcontainers/postgresql testcontainers
```

### Setup de Tests Integrados

```typescript
// tests/integration/setup.ts
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '@/db/schema';

let container: StartedPostgreSqlContainer;
let db: ReturnType<typeof drizzle>;

export async function setupTestDB() {
  console.log('🐳 Starting PostgreSQL container...');
  
  // Iniciar container (con reuse para speed)
  container = await new PostgreSqlContainer('postgres:16-alpine')
    .withDatabase('testdb')
    .withUsername('test')
    .withPassword('test')
    .withReuse() // ← IMPORTANTE: Reutiliza container entre test suites
    .start();
  
  console.log('✅ PostgreSQL container started');
  
  // Conectar a la DB
  const connectionString = container.getConnectionUri();
  const client = postgres(connectionString);
  db = drizzle(client, { schema });
  
  // Aplicar migraciones
  console.log('🔄 Applying migrations...');
  await runMigrations(db);
  console.log('✅ Migrations applied');
  
  return { db, connectionString };
}

export async function teardownTestDB() {
  console.log('🛑 Stopping PostgreSQL container...');
  await container.stop();
  console.log('✅ Container stopped');
}

export async function resetTestDB() {
  // Limpiar todas las tablas para cada test
  await db.delete(schema.users);
  await db.delete(schema.tasks);
  await db.delete(schema.sessions);
}

async function runMigrations(db: any) {
  // Aplicar migraciones desde carpeta migrations/
  const { migrate } = await import('drizzle-orm/postgres-js/migrator');
  await migrate(db, { migrationsFolder: './migrations' });
}
```

### Ejemplo de Test con DB Real

```typescript
// tests/integration/user-repository.test.ts
import { test, expect, beforeAll, afterAll, beforeEach, describe } from 'bun:test';
import { setupTestDB, teardownTestDB, resetTestDB } from './setup';
import { UserRepository } from '@/repositories/UserRepository';

let db: any;
let userRepo: UserRepository;

beforeAll(async () => {
  const setup = await setupTestDB();
  db = setup.db;
  userRepo = new UserRepository(db);
}, 30000); // Timeout más alto para container startup

afterAll(async () => {
  await teardownTestDB();
});

beforeEach(async () => {
  await resetTestDB(); // Fresh DB para cada test
});

describe('UserRepository', () => {
  test('create inserts user into database', async () => {
    // Arrange
    const userData = {
      email: 'test@example.com',
      name: 'Test User',
      password: 'hashed_password_here',
    };
    
    // Act
    const user = await userRepo.create(userData);
    
    // Assert
    expect(user.id).toBeDefined();
    expect(user.email).toBe('test@example.com');
    expect(user.name).toBe('Test User');
    
    // Verify en DB REAL (no mock!)
    const found = await userRepo.findById(user.id);
    expect(found).toBeDefined();
    expect(found!.email).toBe('test@example.com');
  });
  
  test('findByEmail returns null for non-existent user', async () => {
    const user = await userRepo.findByEmail('notfound@example.com');
    expect(user).toBeNull();
  });
  
  test('findByEmail returns user when exists', async () => {
    // Arrange - Crear usuario primero
    await userRepo.create({
      email: 'exists@example.com',
      name: 'Exists',
      password: 'hashed',
    });
    
    // Act
    const found = await userRepo.findByEmail('exists@example.com');
    
    // Assert
    expect(found).toBeDefined();
    expect(found!.name).toBe('Exists');
  });
  
  test('update modifies user data', async () => {
    // Arrange
    const user = await userRepo.create({
      email: 'test@example.com',
      name: 'Original Name',
      password: 'pass',
    });
    
    // Act
    const updated = await userRepo.update(user.id, {
      name: 'Updated Name',
    });
    
    // Assert
    expect(updated.name).toBe('Updated Name');
    expect(updated.email).toBe('test@example.com'); // No cambió
    
    // Verify en DB
    const verified = await userRepo.findById(user.id);
    expect(verified!.name).toBe('Updated Name');
  });
  
  test('delete removes user from database', async () => {
    // Arrange
    const user = await userRepo.create({
      email: 'delete@example.com',
      name: 'To Delete',
      password: 'pass',
    });
    
    // Act
    await userRepo.delete(user.id);
    
    // Assert
    const found = await userRepo.findById(user.id);
    expect(found).toBeNull();
  });
  
  test('query performance is acceptable', async () => {
    // Arrange - Crear 100 usuarios
    const users = await Promise.all(
      Array.from({ length: 100 }, (_, i) =>
        userRepo.create({
          email: `user${i}@example.com`,
          name: `User ${i}`,
          password: 'pass',
        })
      )
    );
    
    // Act - Buscar todos
    const start = Date.now();
    const allUsers = await userRepo.findAll();
    const duration = Date.now() - start;
    
    // Assert
    expect(allUsers.length).toBe(100);
    expect(duration).toBeLessThan(100); // Menos de 100ms
  });
});
```

---

## Python + pytest + PostgreSQL + Testcontainers

### Instalación

```bash
uv add --dev testcontainers pytest-asyncio
```

### Setup

```python
# tests/integration/conftest.py
import pytest
from testcontainers.postgres import PostgresContainer
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from app.models import Base

@pytest.fixture(scope="session")
def postgres_container():
    """
    Start PostgreSQL container (reused across all tests in session)
    """
    with PostgresContainer("postgres:16-alpine") as postgres:
        yield postgres

@pytest.fixture(scope="session")
def engine(postgres_container):
    """
    Create SQLAlchemy engine
    """
    engine = create_engine(postgres_container.get_connection_url())
    
    # Create all tables
    Base.metadata.create_all(engine)
    
    return engine

@pytest.fixture(scope="function")
def db_session(engine):
    """
    Fresh database session for each test
    """
    Session = sessionmaker(bind=engine)
    session = Session()
    
    try:
        yield session
    finally:
        session.rollback()
        session.close()
        
        # Limpiar todas las tablas para next test
        for table in reversed(Base.metadata.sorted_tables):
            engine.execute(table.delete())
```

### Ejemplo de Test

```python
# tests/integration/test_user_repository.py
import pytest
from app.repositories.user_repository import UserRepository
from app.models.user import User

class TestUserRepository:
    """Integration tests para UserRepository con DB real"""
    
    def test_create_inserts_user_into_database(self, db_session):
        # Arrange
        repo = UserRepository(db_session)
        user_data = {
            "email": "test@example.com",
            "name": "Test User",
            "password": "hashed_password"
        }
        
        # Act
        user = repo.create(**user_data)
        db_session.commit()
        
        # Assert
        assert user.id is not None
        assert user.email == "test@example.com"
        
        # Verify en DB REAL
        found = repo.find_by_id(user.id)
        assert found is not None
        assert found.name == "Test User"
    
    def test_find_by_email_returns_none_for_nonexistent(self, db_session):
        repo = UserRepository(db_session)
        user = repo.find_by_email("notfound@example.com")
        assert user is None
    
    def test_find_by_email_returns_user_when_exists(self, db_session):
        # Arrange
        repo = UserRepository(db_session)
        created = repo.create(
            email="exists@example.com",
            name="Exists",
            password="hashed"
        )
        db_session.commit()
        
        # Act
        found = repo.find_by_email("exists@example.com")
        
        # Assert
        assert found is not None
        assert found.id == created.id
        assert found.name == "Exists"
    
    def test_update_modifies_user_data(self, db_session):
        # Arrange
        repo = UserRepository(db_session)
        user = repo.create(
            email="test@example.com",
            name="Original",
            password="pass"
        )
        db_session.commit()
        
        # Act
        updated = repo.update(user.id, name="Updated")
        db_session.commit()
        
        # Assert
        assert updated.name == "Updated"
        assert updated.email == "test@example.com"
    
    @pytest.mark.parametrize("count", [10, 50, 100])
    def test_bulk_operations_performance(self, db_session, count):
        """Test performance con diferentes volúmenes"""
        import time
        
        repo = UserRepository(db_session)
        
        # Arrange - Crear múltiples usuarios
        start = time.time()
        users = [
            repo.create(
                email=f"user{i}@example.com",
                name=f"User {i}",
                password="pass"
            )
            for i in range(count)
        ]
        db_session.commit()
        duration = time.time() - start
        
        # Assert
        assert len(users) == count
        assert duration < (count * 0.01)  # < 10ms por usuario
```

---

## Go + testcontainers-go

### Instalación

```bash
go get github.com/testcontainers/testcontainers-go
go get github.com/testcontainers/testcontainers-go/modules/postgres
```

### Setup

```go
// internal/repository/repository_test.go
package repository

import (
    "context"
    "database/sql"
    "testing"
    "time"
    
    "github.com/stretchr/testify/assert"
    "github.com/stretchr/testify/require"
    "github.com/testcontainers/testcontainers-go"
    "github.com/testcontainers/testcontainers-go/modules/postgres"
    "github.com/testcontainers/testcontainers-go/wait"
)

var (
    testDB *sql.DB
    repo   *UserRepository
)

func TestMain(m *testing.M) {
    ctx := context.Background()
    
    // Start PostgreSQL container
    pgContainer, err := postgres.RunContainer(ctx,
        testcontainers.WithImage("postgres:16-alpine"),
        postgres.WithDatabase("testdb"),
        postgres.WithUsername("test"),
        postgres.WithPassword("test"),
        testcontainers.WithWaitStrategy(
            wait.ForLog("database system is ready to accept connections").
                WithOccurrence(2).
                WithStartupTimeout(5*time.Second),
        ),
    )
    if err != nil {
        panic(err)
    }
    defer pgContainer.Terminate(ctx)
    
    // Connect to database
    connStr, err := pgContainer.ConnectionString(ctx, "sslmode=disable")
    if err != nil {
        panic(err)
    }
    
    testDB, err = sql.Open("postgres", connStr)
    if err != nil {
        panic(err)
    }
    
    // Run migrations
    if err := runMigrations(testDB); err != nil {
        panic(err)
    }
    
    // Initialize repository
    repo = NewUserRepository(testDB)
    
    // Run tests
    code := m.Run()
    
    // Cleanup
    testDB.Close()
    os.Exit(code)
}

func resetDB(t *testing.T) {
    _, err := testDB.Exec("TRUNCATE users, tasks CASCADE")
    require.NoError(t, err)
}
```

### Ejemplo de Test

```go
// internal/repository/user_repository_test.go
package repository

import (
    "context"
    "testing"
    
    "github.com/stretchr/testify/assert"
    "github.com/stretchr/testify/require"
)

func TestUserRepository_Create(t *testing.T) {
    resetDB(t)
    ctx := context.Background()
    
    // Arrange
    user := &User{
        Email:    "test@example.com",
        Name:     "Test User",
        Password: "hashed_password",
    }
    
    // Act
    err := repo.Create(ctx, user)
    
    // Assert
    assert.NoError(t, err)
    assert.NotZero(t, user.ID)
    
    // Verify en DB REAL
    found, err := repo.FindByID(ctx, user.ID)
    require.NoError(t, err)
    assert.Equal(t, "test@example.com", found.Email)
    assert.Equal(t, "Test User", found.Name)
}

func TestUserRepository_FindByEmail(t *testing.T) {
    resetDB(t)
    ctx := context.Background()
    
    t.Run("returns nil for non-existent user", func(t *testing.T) {
        user, err := repo.FindByEmail(ctx, "notfound@example.com")
        assert.NoError(t, err)
        assert.Nil(t, user)
    })
    
    t.Run("returns user when exists", func(t *testing.T) {
        // Arrange
        created := &User{
            Email:    "exists@example.com",
            Name:     "Exists",
            Password: "pass",
        }
        require.NoError(t, repo.Create(ctx, created))
        
        // Act
        found, err := repo.FindByEmail(ctx, "exists@example.com")
        
        // Assert
        assert.NoError(t, err)
        assert.NotNil(t, found)
        assert.Equal(t, created.ID, found.ID)
    })
}

func BenchmarkUserRepository_Create(b *testing.B) {
    resetDB(&testing.T{})
    ctx := context.Background()
    
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        user := &User{
            Email:    fmt.Sprintf("bench%d@example.com", i),
            Name:     "Bench User",
            Password: "pass",
        }
        _ = repo.Create(ctx, user)
    }
}
```

---

## 🎯 Mise Tasks para Testcontainers

```toml
# .mise.toml

[tasks."test:integration:tc"]
description = "Run integration tests with Testcontainers"
run = """
#!/usr/bin/env bash

# Verificar que Docker está corriendo
if ! docker info > /dev/null 2>&1; then
  echo "❌ Docker no está corriendo"
  echo "Por favor inicia Docker Desktop"
  exit 1
fi

echo "🐳 Running integration tests with Testcontainers..."
echo "(This may take 5-10 seconds on first run to download images)"
echo ""

if [ -f "package.json" ]; then
  bun test tests/integration/
elif [ -f "pyproject.toml" ]; then
  pytest tests/integration/ -v --tb=short
elif [ -f "go.mod" ]; then
  go test ./internal/... -tags=integration -v
fi

echo ""
echo "✅ Integration tests with Testcontainers completed"
"""

[tasks."test:integration:tc:watch"]
description = "Watch mode for integration tests"
run = """
if [ -f "package.json" ]; then
  bun test --watch tests/integration/
elif [ -f "pyproject.toml" ]; then
  ptw tests/integration/ -- -v
fi
"""
```

---

## ⚡ Performance Tips

### 1. Reuse Containers (MÁS IMPORTANTE)

```typescript
// ✅ CON REUSE: ~1-2 segundos por test suite
const container = await new PostgreSqlContainer()
  .withReuse()  // ← CRÍTICO
  .start();

// ❌ SIN REUSE: ~5-10 segundos por test suite
```

### 2. Use tmpfs para DB en RAM

```typescript
const container = await new PostgreSqlContainer()
  .withTmpFs({ '/var/lib/postgresql/data': 'rw' })  // RAM disk
  .start();

// 2-3x más rápido para tests
```

### 3. Parallel Test Execution

```bash
# Bun (paralelo por defecto)
bun test --concurrent

# Pytest
pytest -n auto  # Usa todos los cores

# Go
go test -parallel 4 ./...
```

### 4. Cleanup Eficiente

```typescript
// ✅ Mejor: Truncar tablas (rápido)
beforeEach(async () => {
  await db.delete(schema.users);
  await db.delete(schema.tasks);
});

// ❌ Lento: Recrear DB entera
beforeEach(async () => {
  await dropDatabase();
  await createDatabase();
  await runMigrations();
});
```

---

## 📊 Benchmarks Reales

```
Setup (primera vez):
  Download image:     ~30 segundos
  Start container:    ~3 segundos
  Apply migrations:   ~1 segundo
  Total:              ~34 segundos (solo primera vez)

Subsequent runs (con reuse):
  Start container:    ~1 segundo
  Apply migrations:   ~0.5 segundos
  Per test:           ~50-100ms
  Total suite (50):   ~5 segundos

Sin Testcontainers (mocks):
  Setup:              0 segundos
  Per test:           ~5ms
  Total suite (50):   ~250ms

Trade-off:
  ✅ 20x más lento pero 100x más confianza
  ✅ Detecta bugs reales que mocks no detectan
  ✅ Menos mantenimiento a largo plazo
```

---

## 🗄️ Database Migrations Strategy

### Filosofía de Migraciones

```
✅ DO:
- Migraciones son código (versión controlada)
- Siempre hacia adelante (no editar migraciones existentes)
- Rollback strategy clara
- Probar en staging primero

❌ DON'T:
- Editar migraciones después de merge
- Rollback manual en producción
- Migrations que dependen de datos
```

---

## TypeScript: Drizzle ORM (Recomendado)

### Setup

```bash
# Instalar
bun add drizzle-orm postgres
bun add -d drizzle-kit
```

```typescript
// drizzle.config.ts
import type { Config } from 'drizzle-kit';

export default {
  schema: './src/db/schema.ts',
  out: './migrations',
  driver: 'pg',
  dbCredentials: {
    connectionString: process.env.DATABASE_URL!,
  },
} satisfies Config;
```

### Schema Definition

```typescript
// src/db/schema.ts
import { pgTable, serial, text, timestamp, boolean, integer } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  email: text('email').notNull().unique(),
  name: text('name'),
  password: text('password').notNull(),
  emailVerified: boolean('email_verified').default(false),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const tasks = pgTable('tasks', {
  id: serial('id').primaryKey(),
  title: text('title').notNull(),
  description: text('description'),
  completed: boolean('completed').default(false),
  userId: integer('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

// Type inference
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Task = typeof tasks.$inferSelect;
export type NewTask = typeof tasks.$inferInsert;
```

### Client Setup

```typescript
// src/db/index.ts
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

const connectionString = process.env.DATABASE_URL!;

// Para queries
const queryClient = postgres(connectionString);
export const db = drizzle(queryClient, { schema });

// Para migrations
export const migrationClient = postgres(connectionString, { max: 1 });
```

### Workflow de Migraciones

```bash
# 1. Cambiar schema.ts (agregar columna, tabla, etc.)

# 2. Generar migration
mise run db:generate

# 3. Revisar SQL generado en migrations/
# migrations/0001_add_email_verified.sql

# 4. Aplicar migration
mise run db:migrate

# 5. Rollback si algo falla (manual)
# Editar migration SQL o crear nueva para revertir
```

### Migrations con Datos

```typescript
// migrations/0002_seed_default_roles.ts
import { db } from '../src/db';
import { roles } from '../src/db/schema';

export async function up() {
  await db.insert(roles).values([
    { name: 'admin', permissions: ['all'] },
    { name: 'user', permissions: ['read', 'write'] },
    { name: 'guest', permissions: ['read'] },
  ]);
}

export async function down() {
  await db.delete(roles);
}
```

---

## Python: Alembic (con SQLAlchemy)

### Setup

```bash
# Instalar
uv add alembic sqlalchemy psycopg2-binary

# Inicializar
alembic init migrations
```

### Configuration

```python
# alembic.ini
[alembic]
script_location = migrations
sqlalchemy.url = driver://user:pass@localhost/dbname

# Use env variable
# sqlalchemy.url = 

# migrations/env.py
from logging.config import fileConfig
from sqlalchemy import engine_from_config, pool
from alembic import context
import os

# Import your models
from app.models import Base

config = context.config

# Override sqlalchemy.url from environment
config.set_main_option(
    'sqlalchemy.url',
    os.getenv('DATABASE_URL')
)

target_metadata = Base.metadata

def run_migrations_online():
    connectable = engine_from_config(
        config.get_section(config.config_ini_section),
        prefix='sqlalchemy.',
        poolclass=pool.NullPool,
    )

    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata
        )

        with context.begin_transaction():
            context.run_migrations()

run_migrations_online()
```

### Models Definition

```python
# app/models/user.py
from sqlalchemy import Column, Integer, String, Boolean, DateTime
from sqlalchemy.sql import func
from app.database import Base

class User(Base):
    __tablename__ = "users"
    
    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, unique=True, index=True, nullable=False)
    name = Column(String)
    password = Column(String, nullable=False)
    email_verified = Column(Boolean, default=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
    
    # Relationships
    tasks = relationship("Task", back_populates="user", cascade="all, delete-orphan")
```

### Workflow de Migraciones

```bash
# 1. Modificar models en app/models/

# 2. Generar migration automática
alembic revision --autogenerate -m "add email_verified column"

# 3. Revisar migration generada
# migrations/versions/xxxx_add_email_verified.py

# 4. Aplicar migration
alembic upgrade head

# 5. Rollback si es necesario
alembic downgrade -1
```

### Migration Example

```python
# migrations/versions/0001_create_users_table.py
"""create users table

Revision ID: 0001
Revises: 
Create Date: 2025-12-23
"""
from alembic import op
import sqlalchemy as sa

revision = '0001'
down_revision = None
branch_labels = None
depends_on = None

def upgrade():
    op.create_table(
        'users',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('email', sa.String(), nullable=False),
        sa.Column('name', sa.String()),
        sa.Column('password', sa.String(), nullable=False),
        sa.Column('email_verified', sa.Boolean(), server_default='false'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()')),
        sa.Column('updated_at', sa.DateTime(timezone=True)),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_users_email', 'users', ['email'], unique=True)

def downgrade():
    op.drop_index('ix_users_email', table_name='users')
    op.drop_table('users')
```

---

## Go: golang-migrate

### Setup

```bash
# Instalar CLI
brew install golang-migrate

# O como Go tool
go install -tags 'postgres' github.com/golang-migrate/migrate/v4/cmd/migrate@latest
```

### Estructura

```
migrations/
├── 000001_create_users_table.up.sql
├── 000001_create_users_table.down.sql
├── 000002_create_tasks_table.up.sql
└── 000002_create_tasks_table.down.sql
```

### Migration Files

```sql
-- migrations/000001_create_users_table.up.sql
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) NOT NULL UNIQUE,
    name VARCHAR(255),
    password VARCHAR(255) NOT NULL,
    email_verified BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_users_email ON users(email);

-- migrations/000001_create_users_table.down.sql
DROP INDEX IF EXISTS idx_users_email;
DROP TABLE IF EXISTS users;
```

```sql
-- migrations/000002_create_tasks_table.up.sql
CREATE TABLE IF NOT EXISTS tasks (
    id SERIAL PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    completed BOOLEAN DEFAULT FALSE,
    user_id INTEGER NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX idx_tasks_user_id ON tasks(user_id);

-- migrations/000002_create_tasks_table.down.sql
DROP INDEX IF EXISTS idx_tasks_user_id;
DROP TABLE IF EXISTS tasks;
```

### Programmatic Usage

```go
// internal/database/migrate.go
package database

import (
    "database/sql"
    "github.com/golang-migrate/migrate/v4"
    "github.com/golang-migrate/migrate/v4/database/postgres"
    _ "github.com/golang-migrate/migrate/v4/source/file"
)

func RunMigrations(db *sql.DB) error {
    driver, err := postgres.WithInstance(db, &postgres.Config{})
    if err != nil {
        return err
    }
    
    m, err := migrate.NewWithDatabaseInstance(
        "file://migrations",
        "postgres",
        driver,
    )
    if err != nil {
        return err
    }
    
    if err := m.Up(); err != nil && err != migrate.ErrNoChange {
        return err
    }
    
    return nil
}
```

### Workflow

```bash
# Crear nueva migration
migrate create -ext sql -dir migrations -seq create_tasks_table

# Aplicar migrations
migrate -path migrations -database "$DATABASE_URL" up

# Rollback
migrate -path migrations -database "$DATABASE_URL" down 1

# Ver estado
migrate -path migrations -database "$DATABASE_URL" version
```

---

## Java/Kotlin: Flyway

### Setup (Gradle)

```kotlin
// build.gradle.kts
plugins {
    id("org.flywaydb.flyway") version "10.4.1"
}

dependencies {
    implementation("org.flywaydb:flyway-core:10.4.1")
    implementation("org.flywaydb:flyway-database-postgresql:10.4.1")
}

flyway {
    url = "jdbc:postgresql://localhost:5432/mydb"
    user = "postgres"
    password = "postgres"
    locations = arrayOf("classpath:db/migration")
}
```

### Migration Files

```
src/main/resources/db/migration/
├── V1__create_users_table.sql
├── V2__create_tasks_table.sql
└── V3__add_email_verified.sql
```

```sql
-- V1__create_users_table.sql
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) NOT NULL UNIQUE,
    name VARCHAR(255),
    password VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_users_email ON users(email);
```

### Programmatic Usage

```kotlin
// src/main/kotlin/com/example/config/DatabaseConfig.kt
import org.flywaydb.core.Flyway
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import javax.sql.DataSource

@Configuration
class DatabaseConfig {
    
    @Bean
    fun flyway(dataSource: DataSource): Flyway {
        val flyway = Flyway.configure()
            .dataSource(dataSource)
            .locations("classpath:db/migration")
            .load()
        
        flyway.migrate()
        return flyway
    }
}
```

---

## 🎯 Mise Tasks Universales para Migraciones

```toml
# .mise.toml

[tasks."db:generate"]
description = "Generate new migration"
run = """
#!/usr/bin/env bash
set -e

if [ -f "drizzle.config.ts" ]; then
  # TypeScript + Drizzle
  echo "📝 Generating Drizzle migration..."
  bun drizzle-kit generate:pg
  
elif [ -f "alembic.ini" ]; then
  # Python + Alembic
  echo "📝 Generating Alembic migration..."
  read -p "Migration message: " message
  alembic revision --autogenerate -m "$message"
  
elif [ -f "go.mod" ]; then
  # Go + golang-migrate
  echo "📝 Creating golang-migrate migration..."
  read -p "Migration name: " name
  migrate create -ext sql -dir migrations -seq "$name"
  
elif [ -f "build.gradle.kts" ]; then
  # Java + Flyway
  echo "📝 Creating Flyway migration..."
  read -p "Migration name: " name
  touch "src/main/resources/db/migration/V$(date +%Y%m%d%H%M%S)__${name}.sql"
fi

echo "✅ Migration generated. Review before applying!"
"""

[tasks."db:migrate"]
description = "Apply pending migrations"
run = """
#!/usr/bin/env bash
set -e

if [ -f "drizzle.config.ts" ]; then
  echo "🚀 Applying Drizzle migrations..."
  bun drizzle-kit push:pg
  
elif [ -f "alembic.ini" ]; then
  echo "🚀 Applying Alembic migrations..."
  alembic upgrade head
  
elif [ -f "go.mod" ]; then
  echo "🚀 Applying golang-migrate migrations..."
  migrate -path migrations -database "$DATABASE_URL" up
  
elif [ -f "build.gradle.kts" ]; then
  echo "🚀 Applying Flyway migrations..."
  ./gradlew flywayMigrate
fi

echo "✅ Migrations applied successfully!"
"""

[tasks."db:rollback"]
description = "Rollback last migration"
run = """
#!/usr/bin/env bash
set -e

echo "⚠️  Rolling back last migration..."

if [ -f "alembic.ini" ]; then
  alembic downgrade -1
  
elif [ -f "go.mod" ]; then
  migrate -path migrations -database "$DATABASE_URL" down 1
  
elif [ -f "build.gradle.kts" ]; then
  ./gradlew flywayUndo
  
else
  echo "❌ Rollback not supported for this stack"
  echo "💡 Consider creating a new migration to revert changes"
  exit 1
fi

echo "✅ Rollback complete"
"""

[tasks."db:status"]
description = "Show migration status"
run = """
#!/usr/bin/env bash

if [ -f "alembic.ini" ]; then
  alembic current
  alembic history
  
elif [ -f "go.mod" ]; then
  migrate -path migrations -database "$DATABASE_URL" version
  
elif [ -f "build.gradle.kts" ]; then
  ./gradlew flywayInfo
fi
"""

[tasks."db:reset"]
description = "Drop all tables and re-run migrations (DEV ONLY)"
run = """
#!/usr/bin/env bash
set -e

if [ "$NODE_ENV" = "production" ]; then
  echo "❌ Cannot reset database in production!"
  exit 1
fi

echo "⚠️  This will DELETE ALL DATA. Are you sure? (yes/no)"
read -r confirm

if [ "$confirm" != "yes" ]; then
  echo "Cancelled"
  exit 0
fi

# Drop database
psql "$DATABASE_URL" -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"

# Re-run migrations
mise run db:migrate

echo "✅ Database reset complete"
"""
```

---

## 🔐 Secrets Management

### Niveles de Secrets

```
Level 1: Local Dev     → .env (not committed)
Level 2: Team Shared   → Doppler/Infisical
Level 3: CI/CD         → GitHub Secrets
Level 4: Production    → AWS Secrets Manager / Vault
```

---

## 🏠 Local Development

### Opción 1: .env Simple (Para empezar)

```bash
# .env.example (COMMITTED al repo)
# Copiar y renombrar a .env
DATABASE_URL=postgresql://localhost:5432/mydb
REDIS_URL=redis://localhost:6379
JWT_SECRET=change-me-in-development
API_KEY=

# Production services (dejar vacío en local)
STRIPE_SECRET_KEY=
SENDGRID_API_KEY=
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
```

```bash
# .env (NOT COMMITTED - en .gitignore)
DATABASE_URL=postgresql://localhost:5432/mydb
REDIS_URL=redis://localhost:6379
JWT_SECRET=local-dev-secret-key-123
API_KEY=sk-test-1234567890

# Real API keys para testing
STRIPE_SECRET_KEY=sk_test_real_key_here
SENDGRID_API_KEY=SG.real_key_here
```

```bash
