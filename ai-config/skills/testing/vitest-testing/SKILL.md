---
name: vitest-testing
description: >
  Frontend testing patterns with Vitest, Testing Library, and MSW for React applications.
  Trigger: Vitest, testing library, MSW, frontend testing, React testing, unit test, component test
tools:
  - Read
  - Write
  - Bash
  - Grep
metadata:
  author: plataforma-industrial
  version: "2.0"
  tags: [vitest, testing, react, msw, testing-library, frontend]
  updated: "2026-02"
---

# Frontend Testing with Vitest

Comprehensive testing patterns for React applications with Vitest, Testing Library, and MSW.

## Stack

```yaml
Vitest: 1.3+
@testing-library/react: 14.2+
@testing-library/user-event: 14.5+
MSW: 2.2+
happy-dom: 13.3+
```

## Configuration

### vitest.config.ts

```typescript
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'happy-dom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      thresholds: {
        global: { branches: 80, functions: 80, lines: 80, statements: 80 },
      },
    },
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
    },
  },
});
```

### Setup File

```typescript
// src/test/setup.ts
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeAll, afterAll, vi } from 'vitest';
import { server } from '@/mocks/server';

// Mock matchMedia
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query) => ({
    matches: false,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })),
});

// MSW Server
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  cleanup();
  server.resetHandlers();
});
afterAll(() => server.close());
```

## Component Testing

```typescript
// src/components/Card/Card.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Card } from './Card';

const mockItem = {
  id: 'item-1',
  name: 'Test Item',
  status: 'active',
};

describe('Card', () => {
  it('renders item information', () => {
    render(<Card item={mockItem} />);

    expect(screen.getByText('Test Item')).toBeInTheDocument();
    expect(screen.getByText('active')).toBeInTheDocument();
  });

  it('calls onClick when clicked', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();

    render(<Card item={mockItem} onClick={onClick} />);
    await user.click(screen.getByRole('article'));

    expect(onClick).toHaveBeenCalledWith(mockItem.id);
  });

  it('shows alert status when flagged', () => {
    const alertItem = { ...mockItem, status: 'alert' };
    render(<Card item={alertItem} />);

    expect(screen.getByRole('alert')).toBeInTheDocument();
  });
});
```

## Hook Testing

```typescript
// src/hooks/useData.test.ts
import { describe, it, expect } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useData } from './useData';

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
};

describe('useData', () => {
  it('fetches data successfully', async () => {
    const { result } = renderHook(() => useData('item-1'), {
      wrapper: createWrapper(),
    });

    expect(result.current.isLoading).toBe(true);

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data).toEqual(
      expect.objectContaining({ id: 'item-1' })
    );
  });

  it('handles error state', async () => {
    const { result } = renderHook(() => useData('non-existent'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
  });
});
```

## Store Testing (Zustand)

```typescript
// src/stores/store.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useStore } from './store';

describe('Store', () => {
  beforeEach(() => {
    useStore.setState({ items: [], selectedId: null });
  });

  it('adds item to store', () => {
    const { addItem } = useStore.getState();

    addItem({ id: 'item-1', name: 'Test' });

    expect(useStore.getState().items).toHaveLength(1);
  });

  it('selects item', () => {
    const { selectItem } = useStore.getState();

    selectItem('item-1');

    expect(useStore.getState().selectedId).toBe('item-1');
  });
});
```

## MSW Setup

### Server

```typescript
// src/mocks/server.ts
import { setupServer } from 'msw/node';
import { handlers } from './handlers';

export const server = setupServer(...handlers);
```

### Handlers

```typescript
// src/mocks/handlers.ts
import { http, HttpResponse, delay } from 'msw';

const API_URL = 'http://localhost:8080/api/v1';

const items = [
  { id: 'item-1', name: 'Item A', status: 'active' },
  { id: 'item-2', name: 'Item B', status: 'inactive' },
];

export const handlers = [
  http.get(`${API_URL}/items`, async () => {
    await delay(100);
    return HttpResponse.json({ data: items });
  }),

  http.get(`${API_URL}/items/:id`, async ({ params }) => {
    const item = items.find((i) => i.id === params.id);
    if (!item) return new HttpResponse(null, { status: 404 });
    return HttpResponse.json(item);
  }),

  http.post(`${API_URL}/items`, async ({ request }) => {
    const body = await request.json();
    return HttpResponse.json({ id: crypto.randomUUID(), ...body });
  }),
];
```

### Override in Tests

```typescript
import { server } from '@/mocks/server';
import { http, HttpResponse } from 'msw';

it('handles server error gracefully', async () => {
  server.use(
    http.get('http://localhost:8080/api/v1/items', () => {
      return new HttpResponse(null, { status: 500 });
    })
  );

  render(<ItemList />);

  await waitFor(() => {
    expect(screen.getByText(/error loading/i)).toBeInTheDocument();
  });
});
```

## Testing with Providers

```typescript
// src/test/utils.tsx
import { MantineProvider } from '@mantine/core';
import { render, RenderOptions } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

export function AllProviders({ children }: { children: React.ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return (
    <QueryClientProvider client={queryClient}>
      <MantineProvider>{children}</MantineProvider>
    </QueryClientProvider>
  );
}

export function renderWithProviders(
  ui: React.ReactElement,
  options?: Omit<RenderOptions, 'wrapper'>
) {
  return render(ui, { wrapper: AllProviders, ...options });
}

export * from '@testing-library/react';
export { renderWithProviders as render };
```

## Form Testing

```typescript
// src/components/Form/Form.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@/test/utils';
import userEvent from '@testing-library/user-event';
import { Form } from './Form';

describe('Form', () => {
  it('submits form with valid data', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();

    render(<Form onSubmit={onSubmit} />);

    await user.type(screen.getByLabelText(/name/i), 'Test Name');
    await user.selectOptions(screen.getByLabelText(/type/i), 'option1');
    await user.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({ name: 'Test Name', type: 'option1' });
    });
  });

  it('shows validation errors', async () => {
    const user = userEvent.setup();

    render(<Form onSubmit={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => {
      expect(screen.getByText(/name is required/i)).toBeInTheDocument();
    });
  });
});
```

## Scripts

```json
{
  "scripts": {
    "test": "vitest",
    "test:run": "vitest run",
    "test:ui": "vitest --ui",
    "test:coverage": "vitest run --coverage"
  }
}
```

## Best Practices

1. **Test behavior, not implementation** - Test what user sees
2. **Use user-event over fireEvent** - More realistic
3. **Query by role/label first** - Accessible queries
4. **Use findBy for async** - `await screen.findByRole('alert')`
5. **Avoid testing library internals** - Test hook outputs

```typescript
// Good - Accessible queries
screen.getByRole('button', { name: /submit/i });
screen.getByLabelText(/email/i);

// Avoid - Implementation detail
screen.getByTestId('submit-btn');
```

## Related Skills

- `playwright-e2e`: E2E test complement
- `tanstack-query`: Query testing patterns
- `mantine-ui`: Component testing
- `zod-validation`: Schema testing
