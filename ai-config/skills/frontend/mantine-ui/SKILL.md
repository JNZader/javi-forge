---
name: mantine-ui
description: >
  Mantine 7.x UI components, theming, forms, charts, and hooks for React applications.
  Trigger: mantine, ui components, forms, notifications, charts, data table
tools:
  - Read
  - Write
  - Grep
metadata:
  author: plataforma-industrial
  version: "2.0"
  tags: [mantine, react, ui, components, forms]
  updated: "2026-02"
---

# Mantine 7.x UI Components

## Stack
```json
{
  "@mantine/core": "7.6.x",
  "@mantine/hooks": "7.6.x",
  "@mantine/form": "7.6.x",
  "@mantine/notifications": "7.6.x",
  "@mantine/dates": "7.6.x",
  "@mantine/charts": "7.6.x"
}
```

## Theme Configuration

```tsx
// lib/theme/index.ts
import { createTheme, MantineColorsTuple } from '@mantine/core';

const brand: MantineColorsTuple = [
  '#e5f4ff', '#cde2ff', '#9bc2ff', '#64a0ff', '#3984fe',
  '#1d72fe', '#0969ff', '#0058e4', '#004ecc', '#0043b5'
];

export const theme = createTheme({
  primaryColor: 'brand',
  colors: { brand },
  fontFamily: 'Inter, system-ui, sans-serif',
  defaultRadius: 'md',
  components: {
    Button: { defaultProps: { size: 'sm' } },
    TextInput: { defaultProps: { size: 'sm' } },
    Select: { defaultProps: { size: 'sm' } },
  },
});
```

```tsx
// Provider setup
import { MantineProvider, ColorSchemeScript } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import '@mantine/core/styles.css';
import '@mantine/notifications/styles.css';

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <>
      <ColorSchemeScript defaultColorScheme="auto" />
      <MantineProvider theme={theme} defaultColorScheme="auto">
        <Notifications position="top-right" />
        {children}
      </MantineProvider>
    </>
  );
}
```

## Forms with @mantine/form + Zod

```tsx
import { useForm, zodResolver } from '@mantine/form';
import { TextInput, NumberInput, Select, Button, Stack } from '@mantine/core';
import { z } from 'zod';

const schema = z.object({
  name: z.string().min(1, 'Required'),
  type: z.enum(['option1', 'option2']),
  value: z.number().min(0),
});

type FormValues = z.infer<typeof schema>;

export function MyForm({ onSubmit, loading }: { onSubmit: (v: FormValues) => void; loading?: boolean }) {
  const form = useForm<FormValues>({
    validate: zodResolver(schema),
    initialValues: { name: '', type: 'option1', value: 0 },
  });

  return (
    <form onSubmit={form.onSubmit(onSubmit)}>
      <Stack gap="md">
        <TextInput label="Name" withAsterisk {...form.getInputProps('name')} />
        <Select
          label="Type"
          data={[
            { value: 'option1', label: 'Option 1' },
            { value: 'option2', label: 'Option 2' },
          ]}
          {...form.getInputProps('type')}
        />
        <NumberInput label="Value" {...form.getInputProps('value')} />
        <Button type="submit" loading={loading}>Submit</Button>
      </Stack>
    </form>
  );
}
```

## Dynamic List Fields

```tsx
import { useForm } from '@mantine/form';
import { Paper, Group, ActionIcon, Button } from '@mantine/core';
import { IconPlus, IconTrash } from '@tabler/icons-react';

function DynamicForm() {
  const form = useForm({
    initialValues: {
      items: [{ key: '', value: 0 }],
    },
  });

  return (
    <form onSubmit={form.onSubmit(console.log)}>
      {form.values.items.map((_, index) => (
        <Paper key={index} p="md" withBorder mb="sm">
          <Group align="flex-end">
            <TextInput label="Key" {...form.getInputProps(`items.${index}.key`)} />
            <NumberInput label="Value" {...form.getInputProps(`items.${index}.value`)} />
            <ActionIcon
              color="red"
              variant="light"
              onClick={() => form.removeListItem('items', index)}
              disabled={form.values.items.length === 1}
            >
              <IconTrash size={16} />
            </ActionIcon>
          </Group>
        </Paper>
      ))}
      <Button variant="light" leftSection={<IconPlus size={16} />}
        onClick={() => form.insertListItem('items', { key: '', value: 0 })}>
        Add Item
      </Button>
    </form>
  );
}
```

## Data Table Pattern

```tsx
import { Table, Checkbox, ActionIcon, Menu, ScrollArea } from '@mantine/core';
import { IconDotsVertical, IconEdit, IconTrash } from '@tabler/icons-react';

interface Column<T> {
  key: keyof T;
  title: string;
  render?: (value: T[keyof T], row: T) => React.ReactNode;
}

interface DataTableProps<T extends { id: string }> {
  data: T[];
  columns: Column<T>[];
  onEdit?: (item: T) => void;
  onDelete?: (item: T) => void;
}

export function DataTable<T extends { id: string }>({ data, columns, onEdit, onDelete }: DataTableProps<T>) {
  return (
    <ScrollArea>
      <Table striped highlightOnHover>
        <Table.Thead>
          <Table.Tr>
            {columns.map(col => <Table.Th key={String(col.key)}>{col.title}</Table.Th>)}
            {(onEdit || onDelete) && <Table.Th w={60} />}
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {data.map(row => (
            <Table.Tr key={row.id}>
              {columns.map(col => (
                <Table.Td key={String(col.key)}>
                  {col.render ? col.render(row[col.key], row) : String(row[col.key])}
                </Table.Td>
              ))}
              {(onEdit || onDelete) && (
                <Table.Td>
                  <Menu shadow="md" width={200}>
                    <Menu.Target>
                      <ActionIcon variant="subtle"><IconDotsVertical size={16} /></ActionIcon>
                    </Menu.Target>
                    <Menu.Dropdown>
                      {onEdit && <Menu.Item leftSection={<IconEdit size={14} />} onClick={() => onEdit(row)}>Edit</Menu.Item>}
                      {onDelete && <Menu.Item color="red" leftSection={<IconTrash size={14} />} onClick={() => onDelete(row)}>Delete</Menu.Item>}
                    </Menu.Dropdown>
                  </Menu>
                </Table.Td>
              )}
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </ScrollArea>
  );
}
```

## Charts (AreaChart, BarChart)

```tsx
import { AreaChart, BarChart } from '@mantine/charts';
import { Card, Text } from '@mantine/core';

// Time series
export function TimeSeriesChart({ data, title }: { data: { timestamp: string; value: number }[]; title: string }) {
  return (
    <Card shadow="sm" padding="lg" withBorder>
      <Text fw={500} mb="md">{title}</Text>
      <AreaChart
        h={300}
        data={data}
        dataKey="timestamp"
        series={[{ name: 'value', color: 'blue' }]}
        curveType="natural"
        withDots={false}
      />
    </Card>
  );
}

// Bar comparison
export function ComparisonChart({ data }: { data: { label: string; actual: number; target: number }[] }) {
  return (
    <BarChart
      h={300}
      data={data}
      dataKey="label"
      series={[
        { name: 'actual', color: 'teal', label: 'Actual' },
        { name: 'target', color: 'gray.5', label: 'Target' },
      ]}
    />
  );
}
```

## Essential Hooks

```tsx
import {
  useDisclosure,      // Modal/drawer state
  useMediaQuery,      // Responsive breakpoints
  useLocalStorage,    // Persisted state
  useDebouncedValue,  // Debounced search
  useHotkeys,         // Keyboard shortcuts
} from '@mantine/hooks';

// Modal state
const [opened, { open, close }] = useDisclosure(false);

// Responsive
const isMobile = useMediaQuery('(max-width: 768px)');

// Persistent storage
const [value, setValue] = useLocalStorage({ key: 'setting', defaultValue: 'default' });

// Debounced search
const [search, setSearch] = useState('');
const [debounced] = useDebouncedValue(search, 300);

// Keyboard shortcuts
useHotkeys([
  ['ctrl+K', () => openSpotlight()],
  ['ctrl+S', () => save()],
]);
```

## Notifications Helper

```tsx
import { notifications } from '@mantine/notifications';
import { IconCheck, IconX, IconAlertTriangle } from '@tabler/icons-react';

export const notify = {
  success: (message: string, title = 'Success') => {
    notifications.show({ title, message, color: 'green', icon: <IconCheck size={18} /> });
  },
  error: (message: string, title = 'Error') => {
    notifications.show({ title, message, color: 'red', icon: <IconX size={18} /> });
  },
  warning: (message: string, title = 'Warning') => {
    notifications.show({ title, message, color: 'yellow', icon: <IconAlertTriangle size={18} /> });
  },
  loading: (id: string, message: string) => {
    notifications.show({ id, loading: true, title: 'Processing', message, autoClose: false, withCloseButton: false });
  },
  updateSuccess: (id: string, message: string) => {
    notifications.update({ id, loading: false, title: 'Success', message, color: 'green', icon: <IconCheck size={18} />, autoClose: 3000 });
  },
};
```

## AppShell Layout

```tsx
import { AppShell, Burger, Group, NavLink, ScrollArea } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';

const navItems = [
  { icon: IconDashboard, label: 'Dashboard', href: '/' },
  { icon: IconSettings, label: 'Settings', href: '/settings' },
];

export function AppLayout({ children }: { children: React.ReactNode }) {
  const [opened, { toggle }] = useDisclosure();

  return (
    <AppShell
      header={{ height: 60 }}
      navbar={{ width: 250, breakpoint: 'sm', collapsed: { mobile: !opened } }}
      padding="md"
    >
      <AppShell.Header>
        <Group h="100%" px="md">
          <Burger opened={opened} onClick={toggle} hiddenFrom="sm" size="sm" />
          <Text fw={700}>App Name</Text>
        </Group>
      </AppShell.Header>
      <AppShell.Navbar p="md">
        <ScrollArea>
          {navItems.map((item) => (
            <NavLink key={item.href} href={item.href} label={item.label} leftSection={<item.icon size={18} />} />
          ))}
        </ScrollArea>
      </AppShell.Navbar>
      <AppShell.Main>{children}</AppShell.Main>
    </AppShell>
  );
}
```

## Confirm Modal Pattern

```tsx
import { Modal, Text, Group, Button } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';

interface ConfirmModalProps {
  opened: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  loading?: boolean;
}

export function ConfirmModal({ opened, onClose, onConfirm, title, message, loading }: ConfirmModalProps) {
  return (
    <Modal opened={opened} onClose={onClose} title={title} centered>
      <Text mb="lg">{message}</Text>
      <Group justify="flex-end">
        <Button variant="default" onClick={onClose}>Cancel</Button>
        <Button color="red" onClick={onConfirm} loading={loading}>Confirm</Button>
      </Group>
    </Modal>
  );
}

// Usage
const [opened, { open, close }] = useDisclosure(false);
<Button color="red" onClick={open}>Delete</Button>
<ConfirmModal opened={opened} onClose={close} onConfirm={handleDelete} title="Delete" message="Are you sure?" />
```

## Best Practices

1. **Sizing**: Use `size="sm"` as default, `size="xs"` for secondary, `size="md"` for CTAs
2. **Colors**: `green` (success), `red` (error/delete), `yellow` (warning), `blue` (info/action)
3. **Spacing**: Use `Stack gap="md"` as default, `gap="xs"` for tight, `gap="xl"` for loose
4. **Loading**: Always show loading state on async actions with `loading={isSubmitting}`
5. **Skeletons**: Use `<Skeleton height={200} visible={isLoading} />` for content loading

## Related Skills

- `frontend-web`: Astro/React integration patterns
- `tanstack-query`: Server state management
- `zod-validation`: Form validation schemas
- `vitest-testing`: Component testing
