---
name: zod-validation
description: >
  Zod schema validation for TypeScript with runtime type checking, form validation, and API contracts.
  Trigger: zod, validation, schema, typescript types, form validation, api contracts
tools:
  - Read
  - Write
  - Grep
metadata:
  author: plataforma-industrial
  version: "2.0"
  tags: [zod, validation, typescript, schemas, forms]
  updated: "2026-02"
---

# Zod Schema Validation

## Stack
```json
{ "zod": "3.22.x" }
```

## Primitive Types

```typescript
import { z } from 'zod';

// Strings
const name = z.string().min(1, 'Required').max(100);
const email = z.string().email('Invalid email');
const uuid = z.string().uuid('Invalid ID');

// Numbers
const port = z.number().int().min(1).max(65535);
const percentage = z.number().min(0).max(100);

// Dates
const date = z.coerce.date();             // Converts strings to Date
const isoDate = z.string().datetime();    // Validates ISO format

// Enums
const status = z.enum(['active', 'inactive', 'pending']);
const role = z.enum(['admin', 'user', 'guest']);

// Boolean with default
const enabled = z.boolean().default(true);

// Nullable & Optional
const optionalStr = z.string().optional();   // string | undefined
const nullableStr = z.string().nullable();   // string | null
const nullishStr = z.string().nullish();     // string | null | undefined
```

## Domain Schema Example

```typescript
// lib/schemas/item.ts
import { z } from 'zod';

export const ItemTypeSchema = z.enum(['typeA', 'typeB', 'typeC']);
export const ItemStatusSchema = z.enum(['active', 'inactive', 'pending']);

export const ItemSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(100),
  type: ItemTypeSchema,
  status: ItemStatusSchema,
  value: z.number().nullable(),
  minValue: z.number(),
  maxValue: z.number(),
  parentId: z.string().uuid(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
}).refine(
  (data) => data.minValue < data.maxValue,
  { message: 'minValue must be less than maxValue', path: ['minValue'] }
);

export type Item = z.infer<typeof ItemSchema>;
export type ItemType = z.infer<typeof ItemTypeSchema>;
export type ItemStatus = z.infer<typeof ItemStatusSchema>;

// Create schema (omit auto-generated fields)
export const CreateItemSchema = ItemSchema.omit({
  id: true,
  status: true,
  value: true,
  createdAt: true,
  updatedAt: true,
});

export type CreateItemInput = z.infer<typeof CreateItemSchema>;

// Update schema (all optional)
export const UpdateItemSchema = CreateItemSchema.partial();
export type UpdateItemInput = z.infer<typeof UpdateItemSchema>;
```

## User/Auth Schemas

```typescript
export const LoginSchema = z.object({
  email: z.string().email('Invalid email'),
  password: z.string().min(8, 'Minimum 8 characters'),
});

export const RegisterSchema = z.object({
  email: z.string().email('Invalid email'),
  password: z.string()
    .min(8, 'Minimum 8 characters')
    .regex(/[A-Z]/, 'Must contain uppercase')
    .regex(/[a-z]/, 'Must contain lowercase')
    .regex(/[0-9]/, 'Must contain number'),
  confirmPassword: z.string(),
  name: z.string().min(2, 'Name required'),
}).refine(
  (data) => data.password === data.confirmPassword,
  { message: 'Passwords do not match', path: ['confirmPassword'] }
);

export type LoginInput = z.infer<typeof LoginSchema>;
export type RegisterInput = z.infer<typeof RegisterSchema>;
```

## API Response Schemas

```typescript
// Generic response wrapper
export function createDataResponse<T extends z.ZodTypeAny>(dataSchema: T) {
  return z.object({ data: dataSchema });
}

// Paginated response
export function createPaginatedResponse<T extends z.ZodTypeAny>(dataSchema: T) {
  return z.object({
    data: z.array(dataSchema),
    meta: z.object({
      total: z.number(),
      page: z.number(),
      limit: z.number(),
      totalPages: z.number(),
    }),
  });
}

// Error response
export const ApiErrorSchema = z.object({
  error: z.string(),
  code: z.string().optional(),
  details: z.record(z.string(), z.string()).optional(),
});

// Usage
const ItemResponseSchema = createDataResponse(ItemSchema);
const ItemsListResponseSchema = createPaginatedResponse(ItemSchema);
```

## Filter/Query Schemas

```typescript
export const PaginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const SortSchema = z.object({
  sortBy: z.string().optional(),
  sortOrder: z.enum(['asc', 'desc']).default('asc'),
});

export const ItemFiltersSchema = PaginationSchema.merge(SortSchema).extend({
  status: ItemStatusSchema.optional(),
  type: ItemTypeSchema.optional(),
  parentId: z.string().uuid().optional(),
  search: z.string().max(100).optional(),
});

export type ItemFilters = z.infer<typeof ItemFiltersSchema>;

// Date range with validation
export const DateRangeSchema = z.object({
  from: z.coerce.date(),
  to: z.coerce.date(),
}).refine(
  (data) => data.from <= data.to,
  { message: 'from must be before or equal to to', path: ['from'] }
);
```

## Form Integration (Mantine)

```tsx
import { useForm, zodResolver } from '@mantine/form';
import { CreateItemSchema, type CreateItemInput } from '@/lib/schemas/item';

export function ItemForm() {
  const form = useForm<CreateItemInput>({
    validate: zodResolver(CreateItemSchema),
    initialValues: {
      name: '',
      type: 'typeA',
      minValue: 0,
      maxValue: 100,
      parentId: '',
    },
  });

  return (
    <form onSubmit={form.onSubmit(handleSubmit)}>
      <TextInput label="Name" {...form.getInputProps('name')} />
      {/* more fields */}
    </form>
  );
}
```

## Runtime Validation

```typescript
// API client with validation
export const itemsApi = {
  list: async (filters?: ItemFilters) => {
    const response = await api.get('items', { searchParams: filters }).json();
    return ItemsListResponseSchema.parse(response);
  },

  get: async (id: string) => {
    const response = await api.get(`items/${id}`).json();
    return createDataResponse(ItemSchema).parse(response).data;
  },

  create: async (input: CreateItemInput) => {
    const validated = CreateItemSchema.parse(input);  // Validate before sending
    const response = await api.post('items', { json: validated }).json();
    return createDataResponse(ItemSchema).parse(response).data;
  },
};

// Safe parse (no throw)
const result = ItemSchema.safeParse(data);
if (result.success) {
  console.log(result.data.name);
} else {
  console.error(result.error.issues);
}
```

## Advanced Patterns

### Discriminated Unions
```typescript
const EmailNotification = z.object({
  type: z.literal('email'),
  to: z.string().email(),
  subject: z.string(),
  body: z.string(),
});

const SmsNotification = z.object({
  type: z.literal('sms'),
  phone: z.string().regex(/^\+?[1-9]\d{1,14}$/),
  message: z.string().max(160),
});

export const NotificationSchema = z.discriminatedUnion('type', [
  EmailNotification,
  SmsNotification,
]);

export type Notification = z.infer<typeof NotificationSchema>;
```

### Recursive Types
```typescript
interface TreeNode {
  id: string;
  name: string;
  children?: TreeNode[];
}

const TreeNodeSchema: z.ZodType<TreeNode> = z.lazy(() =>
  z.object({
    id: z.string().uuid(),
    name: z.string(),
    children: z.array(TreeNodeSchema).optional(),
  })
);
```

### Branded Types
```typescript
const ItemId = z.string().uuid().brand<'ItemId'>();
const UserId = z.string().uuid().brand<'UserId'>();

type ItemId = z.infer<typeof ItemId>;
type UserId = z.infer<typeof UserId>;

// Now ItemId and UserId are distinct types
function getItem(id: ItemId) { /* ... */ }
// getItem(userId) // Type error!
```

### Preprocessing
```typescript
// Clean data before validation
const SearchQuery = z.preprocess(
  (val) => typeof val === 'string' ? val.trim().toLowerCase() : val,
  z.string().min(2).max(100)
);

// Convert empty string to undefined
const OptionalString = z.preprocess(
  (val) => (val === '' ? undefined : val),
  z.string().optional()
);
```

### Transformations
```typescript
const CreateItemForm = z.object({
  name: z.string().min(1).transform(s => s.trim()),
  address: z.string().transform((val, ctx) => {
    const num = parseInt(val, 10);
    if (isNaN(num)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Must be a number' });
      return z.NEVER;
    }
    return num;
  }),
});
```

### Extending & Composing
```typescript
const BaseItem = z.object({ name: z.string(), type: ItemTypeSchema });
const FullItem = BaseItem.extend({
  id: z.string().uuid(),
  createdAt: z.string().datetime(),
});

// Pick & Omit
const ItemSummary = ItemSchema.pick({ id: true, name: true, status: true });
const ItemPublic = ItemSchema.omit({ internalField: true });
```

## Environment Variables

```typescript
// lib/env.ts
const EnvSchema = z.object({
  DATABASE_URL: z.string().url(),
  JWT_SECRET: z.string().min(32),
  API_URL: z.string().url(),
  PORT: z.coerce.number().default(3000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  SENTRY_DSN: z.string().url().optional(),
});

export type Env = z.infer<typeof EnvSchema>;

export function validateEnv(): Env {
  const result = EnvSchema.safeParse(process.env);
  if (!result.success) {
    console.error('Invalid environment variables:', result.error.flatten().fieldErrors);
    process.exit(1);
  }
  return result.data;
}

export const env = validateEnv();
```

## Error Formatting

```typescript
import { ZodError } from 'zod';

export function formatZodError(error: ZodError): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const issue of error.issues) {
    const path = issue.path.join('.');
    if (!errors[path]) errors[path] = issue.message;
  }
  return errors;
}

// API route error handling
export const POST: APIRoute = async ({ request }) => {
  const body = await request.json();
  const result = CreateItemSchema.safeParse(body);

  if (!result.success) {
    return new Response(JSON.stringify({
      error: 'Validation failed',
      details: result.error.flatten().fieldErrors,
    }), { status: 400 });
  }

  // Continue with result.data...
};
```

## Best Practices

1. **Schemas near usage**: Keep schema in same file as type
2. **Derive from base**: `CreateSchema = Schema.omit({...})`, `UpdateSchema = CreateSchema.partial()`
3. **Validate at boundaries**: API responses, user input, env vars, query params
4. **Use safeParse for expected errors**: Form validation, user input
5. **Use parse for unexpected errors**: Trusted internal data

## Related Skills

- `tanstack-query`: API response validation
- `mantine-ui`: Form validation integration
- `fastapi`: Pydantic-like validation patterns
- `jwt-auth`: Token payload validation
