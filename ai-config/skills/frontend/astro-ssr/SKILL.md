---
name: astro-ssr
description: >
  Astro 4.x SSR framework with React islands, API routes, middleware, and View Transitions.
  Trigger: astro, ssr, islands architecture, static site, hybrid rendering
tools:
  - Read
  - Write
  - Grep
metadata:
  author: plataforma-industrial
  version: "2.0"
  tags: [astro, ssr, islands, react, web]
  updated: "2026-02"
---

# Astro 4.x SSR Framework

## Stack
```json
{
  "astro": "4.5.x",
  "@astrojs/react": "3.1.x",
  "@astrojs/tailwind": "5.1.x",
  "@astrojs/node": "8.2.x"
}
```

## Project Structure

```
src/
├── components/
│   ├── astro/           # .astro components (static)
│   └── react/           # .tsx components (islands)
├── layouts/
│   ├── BaseLayout.astro
│   └── DashboardLayout.astro
├── pages/
│   ├── index.astro
│   ├── [slug].astro     # Dynamic route
│   ├── [...path].astro  # Catch-all route
│   └── api/             # API routes
├── lib/
│   ├── api/
│   └── types/
└── env.d.ts
```

## Configuration

```javascript
// astro.config.mjs
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import tailwind from '@astrojs/tailwind';
import node from '@astrojs/node';

export default defineConfig({
  output: 'server',  // SSR mode
  adapter: node({ mode: 'standalone' }),
  integrations: [
    react(),
    tailwind({ applyBaseStyles: false }),
  ],
  server: { port: 4321, host: true },
  vite: {
    ssr: { noExternal: ['@mantine/*'] },
  },
});
```

```json
// tsconfig.json
{
  "extends": "astro/tsconfigs/strict",
  "compilerOptions": {
    "jsx": "react-jsx",
    "jsxImportSource": "react",
    "baseUrl": ".",
    "paths": {
      "@/*": ["src/*"],
      "@components/*": ["src/components/*"],
      "@lib/*": ["src/lib/*"]
    }
  }
}
```

## Layouts

```astro
---
// src/layouts/BaseLayout.astro
import '@mantine/core/styles.css';
import '@/styles/global.css';

interface Props {
  title: string;
  description?: string;
}

const { title, description = 'App Description' } = Astro.props;
---

<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="description" content={description} />
    <title>{title} | App Name</title>
  </head>
  <body>
    <slot />
  </body>
</html>
```

```astro
---
// src/layouts/DashboardLayout.astro
import BaseLayout from './BaseLayout.astro';
import { AppShell } from '@components/react/AppShell';
import { getSession } from '@lib/auth';

interface Props { title: string; }

const { title } = Astro.props;
const session = await getSession(Astro.request);

if (!session) {
  return Astro.redirect('/login');
}
---

<BaseLayout title={title}>
  <AppShell client:load user={session.user}>
    <slot />
  </AppShell>
</BaseLayout>
```

## Client Directives (Islands)

```astro
<!-- Hydrate immediately - critical UI -->
<Dashboard client:load />

<!-- Hydrate when browser idle - secondary widgets -->
<NewsWidget client:idle />

<!-- Hydrate when visible - below-the-fold content -->
<Chart client:visible />

<!-- Hydrate on media query match - responsive components -->
<MobileMenu client:media="(max-width: 768px)" />

<!-- Client-only, no SSR - browser API dependent -->
<RealtimeChart client:only="react" />
```

## Pages

```astro
---
// src/pages/index.astro
import DashboardLayout from '@layouts/DashboardLayout.astro';
import { Overview } from '@components/react/Overview';
---

<DashboardLayout title="Dashboard">
  <Overview client:load />
</DashboardLayout>
```

```astro
---
// src/pages/items/[id].astro - Dynamic route
import DashboardLayout from '@layouts/DashboardLayout.astro';
import { ItemDetail } from '@components/react/ItemDetail';

const { id } = Astro.params;
if (!id) return Astro.redirect('/items');
---

<DashboardLayout title="Item Detail">
  <ItemDetail id={id} client:load />
</DashboardLayout>
```

```astro
---
// src/pages/404.astro
import BaseLayout from '@layouts/BaseLayout.astro';
---

<BaseLayout title="Not Found">
  <h1>404</h1>
  <a href="/">Go Home</a>
</BaseLayout>
```

## API Routes

```typescript
// src/pages/api/items/index.ts
import type { APIRoute } from 'astro';

export const GET: APIRoute = async ({ request }) => {
  const items = await getItems();
  return new Response(JSON.stringify({ data: items }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};

export const POST: APIRoute = async ({ request }) => {
  const body = await request.json();
  const item = await createItem(body);
  return new Response(JSON.stringify({ data: item }), {
    status: 201,
    headers: { 'Content-Type': 'application/json' },
  });
};
```

```typescript
// src/pages/api/items/[id].ts - Dynamic API route
import type { APIRoute } from 'astro';

export const GET: APIRoute = async ({ params }) => {
  const item = await getItemById(params.id);
  if (!item) {
    return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });
  }
  return new Response(JSON.stringify({ data: item }), { status: 200 });
};

export const PUT: APIRoute = async ({ params, request }) => {
  const body = await request.json();
  const item = await updateItem(params.id, body);
  return new Response(JSON.stringify({ data: item }), { status: 200 });
};

export const DELETE: APIRoute = async ({ params }) => {
  await deleteItem(params.id);
  return new Response(null, { status: 204 });
};
```

## Middleware

```typescript
// src/middleware.ts
import { defineMiddleware } from 'astro:middleware';
import { verifySession } from '@lib/auth';

const publicRoutes = ['/login', '/register', '/api/auth/login'];

export const onRequest = defineMiddleware(async (context, next) => {
  const { pathname } = context.url;

  // Allow public routes
  if (publicRoutes.some(route => pathname.startsWith(route))) {
    return next();
  }

  // Allow static assets
  if (pathname.startsWith('/_astro') || pathname.startsWith('/assets')) {
    return next();
  }

  const session = await verifySession(context.request);

  if (!session) {
    if (!pathname.startsWith('/api/')) {
      return context.redirect('/login');
    }
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Attach session to locals
  context.locals.session = session;
  return next();
});
```

```astro
---
// Using locals in pages
const { session } = Astro.locals;
---
<p>Welcome, {session.user.name}</p>
```

## Server-Side Data Fetching

```astro
---
// Fetch in frontmatter (server-side)
const response = await fetch(`${import.meta.env.API_URL}/items`, {
  headers: { 'Authorization': `Bearer ${Astro.cookies.get('token')?.value}` },
});
const { data: items } = await response.json();
---

<!-- Pass pre-fetched data to React island -->
<ItemList initialData={items} client:load />
```

## Astro Components

```astro
---
// src/components/astro/Card.astro
interface Props {
  title: string;
  class?: string;
}

const { title, class: className } = Astro.props;
---

<div class:list={['card', className]}>
  <div class="card-header">
    <h3>{title}</h3>
    <slot name="actions" />
  </div>
  <div class="card-body">
    <slot />
  </div>
  {Astro.slots.has('footer') && (
    <div class="card-footer">
      <slot name="footer" />
    </div>
  )}
</div>

<style>
  .card { background: white; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
  .card-header { padding: 1rem; border-bottom: 1px solid #eee; display: flex; justify-content: space-between; }
  .card-body { padding: 1rem; }
  .card-footer { padding: 1rem; border-top: 1px solid #eee; background: #f9f9f9; }
</style>

<!-- Usage -->
<Card title="My Card">
  <button slot="actions">Add</button>
  <p>Content here</p>
  <div slot="footer"><button>Save</button></div>
</Card>
```

## Environment Variables

```bash
# .env
PUBLIC_API_URL=http://localhost:8080/api  # Available client-side
API_URL=http://localhost:8080/api          # Server-only
JWT_SECRET=your-secret-key                 # Server-only
```

```typescript
// src/env.d.ts
/// <reference types="astro/client" />

interface ImportMetaEnv {
  readonly PUBLIC_API_URL: string;
  readonly API_URL: string;
  readonly JWT_SECRET: string;
}

declare namespace App {
  interface Locals {
    session?: { user: { id: string; email: string; name: string } };
  }
}
```

## View Transitions

```astro
---
import { ViewTransitions } from 'astro:transitions';
---

<html>
  <head>
    <ViewTransitions />
  </head>
  <body>
    <!-- Named elements for smooth transitions -->
    <h1 transition:name="page-title">{title}</h1>

    <!-- Persist component state across navigation -->
    <VideoPlayer transition:persist />

    <!-- Custom animation -->
    <div transition:animate="slide">Content</div>
  </body>
</html>
```

## Docker Deployment

```dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY package.json ./
ENV HOST=0.0.0.0
ENV PORT=4321
EXPOSE 4321
CMD ["node", "./dist/server/entry.mjs"]
```

## Best Practices

1. **Minimize JS**: Prefer Astro components for static content, only hydrate interactive elements
2. **Server fetch**: Fetch data in frontmatter, pass to client components as props
3. **Small islands**: Hydrate only the interactive part, not the whole page
4. **Type Props**: Always define `interface Props` for Astro components
5. **client:visible**: Use for below-the-fold content to reduce initial JS

## Related Skills

- `frontend-web`: Full frontend stack patterns
- `mantine-ui`: React component library
- `tanstack-query`: Data fetching in React islands
