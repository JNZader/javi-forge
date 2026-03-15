---
name: tanstack-query
description: >
  TanStack Query v5 for data fetching, caching, mutations, and server state management.
  Trigger: tanstack query, react query, data fetching, cache, mutations, prefetch
tools:
  - Read
  - Write
  - Grep
metadata:
  author: plataforma-industrial
  version: "2.0"
  tags: [tanstack, react-query, data-fetching, cache, state]
  updated: "2026-02"
---

# TanStack Query v5

## Stack
```json
{
  "@tanstack/react-query": "5.x",
  "@tanstack/react-query-devtools": "5.x",
  "ky": "1.x"
}
```

## Setup

```tsx
// lib/query/client.ts
import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5,      // 5 minutes
      gcTime: 1000 * 60 * 30,        // 30 minutes (formerly cacheTime)
      retry: 3,
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 30000),
      refetchOnWindowFocus: false,
      refetchOnReconnect: true,
    },
    mutations: { retry: 1 },
  },
});
```

```tsx
// Provider
import { QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';

export function QueryProvider({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      {children}
      <ReactQueryDevtools initialIsOpen={false} />
    </QueryClientProvider>
  );
}
```

## API Client (ky)

```typescript
// lib/api/client.ts
import ky from 'ky';
import { useAuthStore } from '@/stores/auth';

export const api = ky.create({
  prefixUrl: import.meta.env.PUBLIC_API_URL,
  timeout: 30000,
  hooks: {
    beforeRequest: [
      (request) => {
        const token = useAuthStore.getState().token;
        if (token) request.headers.set('Authorization', `Bearer ${token}`);
      },
    ],
    afterResponse: [
      async (_, __, response) => {
        if (response.status === 401) {
          useAuthStore.getState().logout();
          window.location.href = '/login';
        }
        return response;
      },
    ],
  },
});
```

## Query Keys Factory

```typescript
// lib/query/keys.ts
export const queryKeys = {
  items: {
    all: ['items'] as const,
    lists: () => [...queryKeys.items.all, 'list'] as const,
    list: (filters: ItemFilters) => [...queryKeys.items.lists(), filters] as const,
    details: () => [...queryKeys.items.all, 'detail'] as const,
    detail: (id: string) => [...queryKeys.items.details(), id] as const,
  },
  users: {
    all: ['users'] as const,
    current: () => [...queryKeys.users.all, 'current'] as const,
    detail: (id: string) => [...queryKeys.users.all, 'detail', id] as const,
  },
} as const;
```

## Query Hooks

```typescript
// Basic query
export function useItems(filters: ItemFilters = {}) {
  return useQuery({
    queryKey: queryKeys.items.list(filters),
    queryFn: async () => {
      const response = await api.get('items', { searchParams: filters }).json();
      return ItemsResponseSchema.parse(response);
    },
  });
}

// Query with ID
export function useItem(id: string) {
  return useQuery({
    queryKey: queryKeys.items.detail(id),
    queryFn: async () => {
      const response = await api.get(`items/${id}`).json();
      return ItemSchema.parse(response.data);
    },
    enabled: !!id,  // Only run if id exists
  });
}

// Dependent query
export function useItemDetails(itemId: string) {
  const { data: item } = useItem(itemId);

  return useQuery({
    queryKey: [...queryKeys.items.detail(itemId), 'details'],
    queryFn: () => api.get(`items/${itemId}/details`).json(),
    enabled: !!item,  // Only run after item is loaded
    staleTime: 1000 * 30,  // 30 seconds for real-time data
  });
}
```

## Infinite Query (Pagination)

```typescript
import { useInfiniteQuery } from '@tanstack/react-query';

export function useItemsInfinite(filters: ItemFilters = {}) {
  return useInfiniteQuery({
    queryKey: queryKeys.items.list(filters),
    queryFn: async ({ pageParam = 1 }) => {
      const response = await api.get('items', {
        searchParams: { ...filters, page: pageParam, limit: 20 },
      }).json();
      return ItemsResponseSchema.parse(response);
    },
    initialPageParam: 1,
    getNextPageParam: (lastPage) => {
      const { page, limit, total } = lastPage.meta;
      return page * limit < total ? page + 1 : undefined;
    },
  });
}

// Usage
function ItemList() {
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage } = useItemsInfinite();
  const items = data?.pages.flatMap(page => page.data) ?? [];

  return (
    <div>
      {items.map(item => <ItemCard key={item.id} item={item} />)}
      {hasNextPage && (
        <Button onClick={() => fetchNextPage()} loading={isFetchingNextPage}>
          Load More
        </Button>
      )}
    </div>
  );
}
```

## Mutations

```typescript
// Basic mutation
export function useCreateItem() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: CreateItemInput) => {
      const response = await api.post('items', { json: input }).json();
      return ItemSchema.parse(response.data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.items.lists() });
    },
  });
}

// Optimistic update mutation
export function useUpdateItem() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, ...input }: UpdateItemInput & { id: string }) => {
      const response = await api.put(`items/${id}`, { json: input }).json();
      return ItemSchema.parse(response.data);
    },
    onMutate: async ({ id, ...input }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.items.detail(id) });

      const previousItem = queryClient.getQueryData<Item>(queryKeys.items.detail(id));

      if (previousItem) {
        queryClient.setQueryData(queryKeys.items.detail(id), { ...previousItem, ...input });
      }

      return { previousItem };
    },
    onError: (err, { id }, context) => {
      if (context?.previousItem) {
        queryClient.setQueryData(queryKeys.items.detail(id), context.previousItem);
      }
    },
    onSettled: (_, __, { id }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.items.detail(id) });
      queryClient.invalidateQueries({ queryKey: queryKeys.items.lists() });
    },
  });
}

// Delete with optimistic update
export function useDeleteItem() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => api.delete(`items/${id}`),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.items.lists() });

      const previousData = queryClient.getQueriesData({ queryKey: queryKeys.items.lists() });

      queryClient.setQueriesData({ queryKey: queryKeys.items.lists() }, (old: any) => {
        if (!old) return old;
        return { ...old, data: old.data.filter((item: Item) => item.id !== id) };
      });

      return { previousData };
    },
    onError: (_, __, context) => {
      context?.previousData.forEach(([key, data]) => {
        queryClient.setQueryData(key, data);
      });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.items.lists() });
    },
  });
}
```

## Prefetching

```tsx
// Prefetch on hover
function ItemRow({ item }: { item: Item }) {
  const queryClient = useQueryClient();

  const prefetch = () => {
    queryClient.prefetchQuery({
      queryKey: queryKeys.items.detail(item.id),
      queryFn: () => api.get(`items/${item.id}`).json(),
      staleTime: 1000 * 60,
    });
  };

  return (
    <Link to={`/items/${item.id}`} onMouseEnter={prefetch} onFocus={prefetch}>
      {item.name}
    </Link>
  );
}

// Route loader prefetch
export async function itemLoader({ params }: { params: { id: string } }) {
  await queryClient.ensureQueryData({
    queryKey: queryKeys.items.detail(params.id),
    queryFn: () => api.get(`items/${params.id}`).json(),
  });
  return null;
}
```

## Polling

```typescript
// Auto-refresh every 5 seconds
export function useItemRealtime(id: string) {
  return useQuery({
    queryKey: queryKeys.items.detail(id),
    queryFn: () => api.get(`items/${id}`).json(),
    refetchInterval: 5000,
    refetchIntervalInBackground: false,  // Pause when tab inactive
  });
}

// Conditional polling
export function useAlertsPolling(enabled: boolean) {
  return useQuery({
    queryKey: ['alerts', 'unread'],
    queryFn: () => api.get('alerts/unread').json(),
    refetchInterval: enabled ? 10000 : false,
  });
}
```

## Suspense

```tsx
import { useSuspenseQuery } from '@tanstack/react-query';

function ItemDetail({ id }: { id: string }) {
  // Data is guaranteed to exist (no undefined check needed)
  const { data: item } = useSuspenseQuery({
    queryKey: queryKeys.items.detail(id),
    queryFn: () => api.get(`items/${id}`).json(),
  });

  return <div>{item.name}</div>;
}

// Parent with Suspense boundary
function ItemPage({ id }: { id: string }) {
  return (
    <Suspense fallback={<LoadingSpinner />}>
      <ItemDetail id={id} />
    </Suspense>
  );
}
```

## Parallel Queries

```typescript
import { useQueries } from '@tanstack/react-query';

export function useDashboardData(id: string) {
  return useQueries({
    queries: [
      {
        queryKey: queryKeys.items.list({ parentId: id }),
        queryFn: () => api.get('items', { searchParams: { parentId: id } }).json(),
      },
      {
        queryKey: ['alerts', { parentId: id }],
        queryFn: () => api.get('alerts', { searchParams: { parentId: id } }).json(),
      },
      {
        queryKey: ['stats', id],
        queryFn: () => api.get(`stats/${id}`).json(),
      },
    ],
    combine: (results) => ({
      items: results[0].data?.data ?? [],
      alerts: results[1].data?.data ?? [],
      stats: results[2].data?.data ?? null,
      isLoading: results.some(r => r.isLoading),
      isError: results.some(r => r.isError),
    }),
  });
}
```

## Select & Transform

```typescript
// Transform data in hook
export function useItemNames() {
  return useQuery({
    queryKey: queryKeys.items.lists(),
    queryFn: () => api.get('items').json(),
    select: (data) => data.data.map(item => ({ id: item.id, name: item.name })),
  });
}

// Filter with select
export function useActiveItems() {
  return useQuery({
    queryKey: queryKeys.items.lists(),
    queryFn: () => api.get('items').json(),
    select: (data) => data.data.filter(item => item.status === 'active'),
  });
}
```

## Error Handling

```typescript
// Global error handler
import { QueryCache, MutationCache } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error, query) => {
      if (query.meta?.errorBoundary) return;
      notify.error(`Error: ${error.message}`);
    },
  }),
  mutationCache: new MutationCache({
    onError: (error) => notify.error(`Error: ${error.message}`),
  }),
});
```

## Best Practices

1. **Always use queryKeys factory**: `queryKeys.items.detail(id)` not `['items', id]`
2. **Validate responses with Zod**: `return Schema.parse(response)`
3. **Configure staleTime**: 5min for slow-changing, 10sec for real-time data
4. **Use enabled for conditional queries**: `enabled: !!userId && isActive`
5. **Invalidate related queries**: Update lists when detail changes

## Related Skills

- `frontend-web`: Full frontend integration
- `mantine-ui`: UI components with queries
- `zod-validation`: Response validation
- `fastapi`: Backend API patterns
