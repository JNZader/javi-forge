---
name: playwright-e2e
description: >
  End-to-end testing with Playwright for web applications using Page Object Model and authentication fixtures.
  Trigger: e2e testing, playwright, browser testing, visual regression, integration tests
tools:
  - Read
  - Write
  - Bash
  - Grep
metadata:
  author: plataforma-industrial
  version: "2.0"
  tags: [testing, e2e, playwright, automation]
  updated: "2026-02"
---

# Playwright E2E Testing

## Configuration

```typescript
// playwright.config.ts
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [
    ['html', { outputFolder: 'playwright-report' }],
    ['junit', { outputFile: 'results.xml' }],
  ],
  use: {
    baseURL: process.env.BASE_URL || 'http://localhost:4321',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    { name: 'setup', testMatch: /.*\.setup\.ts/ },
    { name: 'chromium', use: { ...devices['Desktop Chrome'] }, dependencies: ['setup'] },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] }, dependencies: ['setup'] },
    { name: 'Mobile Chrome', use: { ...devices['Pixel 5'] }, dependencies: ['setup'] },
  ],
  webServer: {
    command: 'npm run preview',
    url: 'http://localhost:4321',
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
});
```

## Project Structure

```
e2e/
├── auth.setup.ts           # Authentication setup
├── fixtures/
│   ├── auth.fixture.ts     # Auth fixture
│   └── api.fixture.ts      # API fixture
├── pages/
│   ├── BasePage.ts         # Base POM
│   ├── LoginPage.ts        # Login POM
│   └── DashboardPage.ts    # Dashboard POM
├── tests/
│   ├── auth.spec.ts        # Auth tests
│   └── dashboard.spec.ts   # Feature tests
└── utils/
    ├── test-data.ts        # Test data factories
    └── helpers.ts          # Helper functions
```

## Authentication Setup

```typescript
// e2e/auth.setup.ts
import { test as setup, expect } from '@playwright/test';

const authFile = 'playwright/.auth/user.json';

setup('authenticate', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill('user@example.com');
  await page.getByLabel('Password').fill('password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL('/dashboard');
  await page.context().storageState({ path: authFile });
});
```

## Page Object Model

```typescript
// e2e/pages/BasePage.ts
import { Page, Locator, expect } from '@playwright/test';

export abstract class BasePage {
  protected page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  get navbar(): Locator {
    return this.page.getByRole('navigation');
  }

  async logout(): Promise<void> {
    await this.page.getByTestId('user-menu').click();
    await this.page.getByRole('menuitem', { name: 'Logout' }).click();
  }

  async expectToast(message: string): Promise<void> {
    await expect(this.page.getByRole('alert').filter({ hasText: message })).toBeVisible();
  }

  async waitForLoader(): Promise<void> {
    const loader = this.page.getByTestId('loader');
    if (await loader.isVisible()) {
      await loader.waitFor({ state: 'hidden' });
    }
  }
}

// e2e/pages/LoginPage.ts
export class LoginPage extends BasePage {
  readonly emailInput: Locator;
  readonly passwordInput: Locator;
  readonly submitButton: Locator;

  constructor(page: Page) {
    super(page);
    this.emailInput = page.getByLabel('Email');
    this.passwordInput = page.getByLabel('Password');
    this.submitButton = page.getByRole('button', { name: 'Sign in' });
  }

  async goto(): Promise<void> {
    await this.page.goto('/login');
  }

  async login(email: string, password: string): Promise<void> {
    await this.emailInput.fill(email);
    await this.passwordInput.fill(password);
    await this.submitButton.click();
  }
}
```

## Test Examples

```typescript
// e2e/tests/auth.spec.ts
import { test, expect } from '@playwright/test';
import { LoginPage } from '../pages/LoginPage';

test.describe('Authentication', () => {
  test('successful login redirects to dashboard', async ({ page }) => {
    const loginPage = new LoginPage(page);
    await loginPage.goto();
    await loginPage.login('user@example.com', 'password');
    await expect(page).toHaveURL('/dashboard');
  });

  test('invalid credentials show error', async ({ page }) => {
    const loginPage = new LoginPage(page);
    await loginPage.goto();
    await loginPage.login('wrong@email.com', 'wrongpassword');
    await expect(page.getByRole('alert')).toContainText('Invalid');
  });
});

// Using stored auth state
test.describe('Dashboard', () => {
  test.use({ storageState: 'playwright/.auth/user.json' });

  test('displays data', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page.getByTestId('sensor-grid')).toBeVisible();
  });
});
```

## API Testing

```typescript
// e2e/fixtures/api.fixture.ts
import { test as base, APIRequestContext } from '@playwright/test';

export const test = base.extend<{ api: APIRequestContext }>({
  api: async ({ playwright }, use) => {
    const context = await playwright.request.newContext({
      baseURL: process.env.API_URL || 'http://localhost:8080',
      extraHTTPHeaders: {
        'Authorization': `Bearer ${process.env.TEST_API_TOKEN}`,
      },
    });
    await use(context);
    await context.dispose();
  },
});

// API test example
test('GET /api/v1/items returns list', async ({ api }) => {
  const response = await api.get('/api/v1/items');
  expect(response.ok()).toBeTruthy();
  const data = await response.json();
  expect(Array.isArray(data.data)).toBe(true);
});
```

## Visual Regression

```typescript
test('dashboard matches snapshot', async ({ page }) => {
  await page.goto('/dashboard');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(500); // Wait for animations

  await expect(page).toHaveScreenshot('dashboard.png', {
    maxDiffPixels: 100,
  });
});
```

## CI Integration

```yaml
# .github/workflows/e2e.yml
name: E2E Tests
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  e2e:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - run: npx playwright install --with-deps
      - run: npm run build
      - run: npm run e2e
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: playwright-report
          path: playwright-report/
```

## Scripts

```json
{
  "scripts": {
    "e2e": "playwright test",
    "e2e:ui": "playwright test --ui",
    "e2e:headed": "playwright test --headed",
    "e2e:debug": "playwright test --debug",
    "e2e:report": "playwright show-report",
    "e2e:codegen": "playwright codegen localhost:4321"
  }
}
```

## Best Practices

1. **Use Page Object Model** - Encapsulate page interactions
2. **Wait for network idle** - `await page.waitForLoadState('networkidle')`
3. **Test isolation** - Each test independent, use `beforeEach`
4. **Prefer role locators** - `getByRole`, `getByLabel`, `getByText`
5. **Parameterized tests** - Use loops for multiple scenarios

## Related Skills

- `vitest-testing`: Unit/integration tests
- `frontend-web`: Frontend patterns to test
- `mobile-ionic`: Mobile app testing
- `devops-infra`: CI test automation
