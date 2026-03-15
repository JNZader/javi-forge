---
name: zustand-state
description: >
  Zustand state management patterns with immer, persist middleware, and React integration.
  Trigger: Zustand, state management, store, React state, immer, persist, global state
tools:
  - Read
  - Write
  - Grep
metadata:
  author: plataforma-industrial
  version: "2.0"
  tags: [zustand, state-management, react, immer, typescript]
  updated: "2026-02"
---

# Zustand State Management

Modern state management patterns with Zustand 4.5+.

## Stack

```json
{
  "zustand": "4.5.2",
  "immer": "10.0.3"
}
```

## Basic Store

```typescript
// src/stores/ui.ts
import { create } from 'zustand';

interface UIState {
  sidebarOpen: boolean;
  theme: 'light' | 'dark' | 'auto';
  toggleSidebar: () => void;
  setTheme: (theme: 'light' | 'dark' | 'auto') => void;
}

export const useUIStore = create<UIState>((set) => ({
  sidebarOpen: true,
  theme: 'auto',
  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
  setTheme: (theme) => set({ theme }),
}));
```

## Auth Store with Persist

```typescript
// src/stores/auth.ts
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

interface User {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'user';
}

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
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        user: state.user,
        token: state.token,
        isAuthenticated: state.isAuthenticated,
      }),
    }
  )
);
```

## Complex Store with Immer

```typescript
// src/stores/items.ts
import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { subscribeWithSelector } from 'zustand/middleware';

interface Item {
  id: string;
  name: string;
  value: number;
  status: 'active' | 'inactive';
}

interface ItemsState {
  items: Record<string, Item>;
  selectedId: string | null;
  filters: { status?: string; search?: string };

  setItems: (items: Item[]) => void;
  updateItem: (id: string, updates: Partial<Item>) => void;
  selectItem: (id: string | null) => void;
  setFilters: (filters: Partial<ItemsState['filters']>) => void;
}

export const useItemsStore = create<ItemsState>()(
  subscribeWithSelector(
    immer((set) => ({
      items: {},
      selectedId: null,
      filters: {},

      setItems: (items) =>
        set((state) => {
          state.items = items.reduce((acc, item) => {
            acc[item.id] = item;
            return acc;
          }, {} as Record<string, Item>);
        }),

      updateItem: (id, updates) =>
        set((state) => {
          if (state.items[id]) {
            Object.assign(state.items[id], updates);
          }
        }),

      selectItem: (id) =>
        set((state) => {
          state.selectedId = id;
        }),

      setFilters: (filters) =>
        set((state) => {
          Object.assign(state.filters, filters);
        }),
    }))
  )
);

// Selectors
export const selectItemsList = (state: ItemsState) => Object.values(state.items);

export const selectFilteredItems = (state: ItemsState) => {
  const items = Object.values(state.items);
  const { status, search } = state.filters;

  return items.filter((item) => {
    if (status && item.status !== status) return false;
    if (search && !item.name.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });
};
```

## Alerts Store

```typescript
// src/stores/alerts.ts
import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';

interface Alert {
  id: string;
  type: 'warning' | 'error' | 'info';
  message: string;
  acknowledged: boolean;
}

interface AlertsState {
  alerts: Alert[];
  unreadCount: number;
  addAlert: (alert: Alert) => void;
  acknowledgeAlert: (id: string) => void;
  acknowledgeAll: () => void;
}

export const useAlertsStore = create<AlertsState>()(
  immer((set) => ({
    alerts: [],
    unreadCount: 0,

    addAlert: (alert) =>
      set((state) => {
        state.alerts.unshift(alert);
        if (!alert.acknowledged) state.unreadCount++;
      }),

    acknowledgeAlert: (id) =>
      set((state) => {
        const alert = state.alerts.find((a) => a.id === id);
        if (alert && !alert.acknowledged) {
          alert.acknowledged = true;
          state.unreadCount = Math.max(0, state.unreadCount - 1);
        }
      }),

    acknowledgeAll: () =>
      set((state) => {
        state.alerts.forEach((a) => (a.acknowledged = true));
        state.unreadCount = 0;
      }),
  }))
);
```

## React Patterns

### Selector Hook

```typescript
export function useItemById(id: string) {
  return useItemsStore(useCallback((state) => state.items[id], [id]));
}
```

### Shallow Compare

```typescript
import { shallow } from 'zustand/shallow';

function ItemFilters() {
  const { filters, setFilters } = useItemsStore(
    (state) => ({
      filters: state.filters,
      setFilters: state.setFilters,
    }),
    shallow
  );
}
```

### Actions Outside Components

```typescript
// Access store outside React
const currentUser = useAuthStore.getState().user;

// Execute action outside React
useAlertsStore.getState().addAlert(newAlert);
```

### Subscribe to Changes

```typescript
const unsubscribe = useItemsStore.subscribe(
  (state) => state.selectedId,
  (selectedId) => {
    console.log('Selected:', selectedId);
  }
);
```

## Slice Pattern (Large Apps)

```typescript
// src/stores/slices/userSlice.ts
import { StateCreator } from 'zustand';

export interface UserSlice {
  user: User | null;
  setUser: (user: User | null) => void;
}

export const createUserSlice: StateCreator<UserSlice & OtherSlice, [], [], UserSlice> = (
  set
) => ({
  user: null,
  setUser: (user) => set({ user }),
});
```

```typescript
// src/stores/index.ts
import { create } from 'zustand';
import { createUserSlice, UserSlice } from './slices/userSlice';
import { createItemSlice, ItemSlice } from './slices/itemSlice';

type AppStore = UserSlice & ItemSlice;

export const useAppStore = create<AppStore>()((...a) => ({
  ...createUserSlice(...a),
  ...createItemSlice(...a),
}));
```

## DevTools

```typescript
import { devtools } from 'zustand/middleware';

export const useItemsStore = create<ItemsState>()(
  devtools(
    immer((set) => ({
      // ...
    })),
    { name: 'items-store' }
  )
);
```

## Testing

```typescript
import { useAuthStore } from '../auth';

describe('AuthStore', () => {
  beforeEach(() => {
    useAuthStore.setState({ user: null, token: null, isAuthenticated: false });
  });

  it('should login user', () => {
    const user = { id: '1', email: 'test@test.com', name: 'Test', role: 'user' };

    useAuthStore.getState().login(user, 'token');

    expect(useAuthStore.getState().user).toEqual(user);
    expect(useAuthStore.getState().isAuthenticated).toBe(true);
  });
});
```

## Best Practices

1. **One store per domain** - Separate stores for auth, items, alerts, UI
2. **Specific selectors** - `state.user?.name` not entire state
3. **Actions in store** - Logic inside store, not components
4. **Use immer for complex updates** - Direct mutation syntax
5. **Shallow compare for objects** - Prevent unnecessary re-renders

## Related Skills

- `frontend-web`: Full frontend integration
- `tanstack-query`: Server state complement
- `mantine-ui`: UI state binding
