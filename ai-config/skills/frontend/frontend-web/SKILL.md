---
name: frontend-web
description: >
  Modern web frontend patterns with Astro, React, Mantine UI, and TanStack Query.
  Trigger: Astro, React frontend, Mantine, TanStack Query, React Query, dashboard, web app, frontend patterns
tools:
  - Read
  - Write
  - Bash
  - Grep
metadata:
  author: plataforma-industrial
  version: "2.0"
  tags: [astro, react, mantine, tanstack-query, frontend, typescript]
  updated: "2026-02"
---

# Frontend Web Development

Modern web frontend patterns with Astro SSR and React islands.

## Stack

```json
{
  "astro": "4.5.12",
  "@astrojs/react": "3.1.0",
  "react": "18.2.0",
  "@mantine/core": "7.6.1",
  "@mantine/hooks": "7.6.1",
  "@mantine/form": "7.6.1",
  "@tanstack/react-query": "5.28.4",
  "@tanstack/react-table": "8.13.2",
  "zustand": "4.5.2",
  "zod": "3.22.4",
  "ky": "1.2.2",
  "recharts": "2.12.2",
  "dayjs": "1.11.10"
}
```

## Project Structure

```
web-dashboard/
├── astro.config.mjs
├── tsconfig.json
├── src/
│   ├── components/
│   │   ├── layout/          # AppShell, Header, Sidebar
│   │   ├── common/          # LoadingOverlay, DataTable
│   │   └── [feature]/       # Feature-specific components
│   ├── pages/
│   │   ├── index.astro
│   │   └── [feature]/
│   ├── layouts/
│   │   ├── BaseLayout.astro
│   │   └── DashboardLayout.astro
│   ├── lib/
│   │   ├── api/             # API client and services
│   │   ├── hooks/           # React Query hooks
│   │   ├── stores/          # Zustand stores
│   │   ├── types/           # Zod schemas + types
│   │   └── utils/           # Formatters, helpers
│   └── styles/
└── tests/
```

## API Client Pattern

```typescript
// src/lib/api/client.ts
import ky from 'ky';
import { useAuthStore } from '@lib/stores/authStore';

const API_URL = import.meta.env.PUBLIC_API_URL;

export const apiClient = ky.create({
  prefixUrl: `${API_URL}/api/v1`,
  timeout: 30000,
  hooks: {
    beforeRequest: [
      (request) => {
        const token = useAuthStore.getState().token;
        if (token) {
          request.headers.set('Authorization', `Bearer ${token}`);
        }
      },
    ],
    afterResponse: [
      async (_request, _options, response) => {
        if (response.status === 401) {
          useAuthStore.getState().logout();
          window.location.href = '/login';
        }
        return response;
      },
    ],
  },
});

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
}
```

## React Query Hooks

```typescript
// src/lib/hooks/useItems.ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { itemsApi } from '@lib/api/items';
import { notifications } from '@mantine/notifications';

// Query keys factory
export const itemKeys = {
  all: ['items'] as const,
  lists: () => [...itemKeys.all, 'list'] as const,
  list: (filters: Record<string, unknown>) => [...itemKeys.lists(), filters] as const,
  details: () => [...itemKeys.all, 'detail'] as const,
  detail: (id: string) => [...itemKeys.details(), id] as const,
};

export function useItems(params?: { page?: number; pageSize?: number }) {
  return useQuery({
    queryKey: itemKeys.list(params ?? {}),
    queryFn: () => itemsApi.list(params),
    staleTime: 30 * 1000,
  });
}

export function useItem(id: string) {
  return useQuery({
    queryKey: itemKeys.detail(id),
    queryFn: () => itemsApi.get(id),
    enabled: !!id,
  });
}

export function useCreateItem() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CreateItemInput) => itemsApi.create(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: itemKeys.lists() });
      notifications.show({
        title: 'Item created',
        message: 'The item has been created successfully',
        color: 'green',
      });
    },
    onError: (error: Error) => {
      notifications.show({
        title: 'Error',
        message: error.message,
        color: 'red',
      });
    },
  });
}
```

## Zustand Store

```typescript
// src/lib/stores/authStore.ts
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface AuthState {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  login: (user: User, token: string) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      token: null,
      isAuthenticated: false,
      login: (user, token) => set({ user, token, isAuthenticated: true }),
      logout: () => set({ user: null, token: null, isAuthenticated: false }),
    }),
    {
      name: 'auth-storage',
      partialize: (state) => ({
        user: state.user,
        token: state.token,
        isAuthenticated: state.isAuthenticated,
      }),
    }
  )
);
```

## Zod Types Pattern

```typescript
// src/lib/types/item.ts
import { z } from 'zod';

export const ItemSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(100),
  type: z.enum(['type_a', 'type_b', 'type_c']),
  status: z.enum(['active', 'inactive']),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const CreateItemInputSchema = ItemSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type Item = z.infer<typeof ItemSchema>;
export type CreateItemInput = z.infer<typeof CreateItemInputSchema>;
```

## Mantine Form

```typescript
// src/components/items/ItemForm.tsx
import { useForm, zodResolver } from '@mantine/form';
import { TextInput, Select, Button, Stack } from '@mantine/core';
import { CreateItemInputSchema, type CreateItemInput } from '@lib/types/item';

interface ItemFormProps {
  initialValues?: Partial<CreateItemInput>;
  onSubmit: (values: CreateItemInput) => void;
  isLoading?: boolean;
}

export function ItemForm({ initialValues, onSubmit, isLoading }: ItemFormProps) {
  const form = useForm<CreateItemInput>({
    initialValues: {
      name: '',
      type: 'type_a',
      status: 'active',
      ...initialValues,
    },
    validate: zodResolver(CreateItemInputSchema),
  });

  return (
    <form onSubmit={form.onSubmit(onSubmit)}>
      <Stack gap="md">
        <TextInput label="Name" required {...form.getInputProps('name')} />
        <Select
          label="Type"
          data={[
            { value: 'type_a', label: 'Type A' },
            { value: 'type_b', label: 'Type B' },
          ]}
          {...form.getInputProps('type')}
        />
        <Button type="submit" loading={isLoading}>
          Save
        </Button>
      </Stack>
    </form>
  );
}
```

## Astro Page Pattern

```astro
---
// src/pages/items/index.astro
import DashboardLayout from '@/layouts/DashboardLayout.astro';
import { ItemListPage } from '@components/items/ItemListPage';

const token = Astro.cookies.get('auth_token')?.value;
if (!token) {
  return Astro.redirect('/login');
}
---

<DashboardLayout title="Items">
  <ItemListPage client:load />
</DashboardLayout>
```

## DataTable Component

```typescript
// src/components/common/DataTable.tsx
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getPaginationRowModel,
  flexRender,
  type ColumnDef,
} from '@tanstack/react-table';
import { Table, Pagination, TextInput, Stack } from '@mantine/core';
import { IconSearch } from '@tabler/icons-react';

interface DataTableProps<T> {
  data: T[];
  columns: ColumnDef<T>[];
  pageSize?: number;
}

export function DataTable<T>({ data, columns, pageSize = 10 }: DataTableProps<T>) {
  const [globalFilter, setGlobalFilter] = useState('');

  const table = useReactTable({
    data,
    columns,
    state: { globalFilter },
    onGlobalFilterChange: setGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize } },
  });

  return (
    <Stack gap="md">
      <TextInput
        placeholder="Search..."
        leftSection={<IconSearch size={16} />}
        value={globalFilter}
        onChange={(e) => setGlobalFilter(e.target.value)}
        w={300}
      />
      <Table striped highlightOnHover withTableBorder>
        {/* Table implementation */}
      </Table>
      <Pagination
        total={table.getPageCount()}
        value={table.getState().pagination.pageIndex + 1}
        onChange={(page) => table.setPageIndex(page - 1)}
      />
    </Stack>
  );
}
```

## Conventions

| Element | Convention | Example |
|---------|------------|---------|
| Components | PascalCase | `ItemCard.tsx` |
| Hooks | camelCase, `use` prefix | `useItems.ts` |
| Types | PascalCase | `Item`, `CreateItemInput` |
| Zod schemas | PascalCase + Schema | `ItemSchema` |
| Query keys | camelCase + Keys | `itemKeys.list()` |
| Stores | camelCase + Store | `useAuthStore` |
| Astro pages | kebab-case | `index.astro` |

## Related Skills

- `mantine-ui`: Mantine 7.x components, theming, forms
- `astro-ssr`: Astro SSR patterns and islands architecture
- `tanstack-query`: Data fetching and cache management
- `zod-validation`: Schema validation for forms and APIs
- `playwright-e2e`: End-to-end testing for web apps
