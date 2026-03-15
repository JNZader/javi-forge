---
name: ionic-capacitor
description: >
  Mobile app development with Ionic 8, Capacitor 6, and React for cross-platform iOS/Android applications.
  Trigger: ionic, capacitor, mobile app, ios, android, hybrid app, offline-first
tools:
  - Read
  - Write
  - Bash
  - Grep
metadata:
  author: plataforma-industrial
  version: "2.0"
  tags: [ionic, capacitor, mobile, react, offline-first]
  updated: "2026-02"
---

# Ionic + Capacitor Mobile Development

## Stack

```json
{
  "@ionic/react": "8.0.0",
  "@ionic/react-router": "8.0.0",
  "@capacitor/core": "6.0.0",
  "@capacitor/ios": "6.0.0",
  "@capacitor/android": "6.0.0",
  "@capacitor/camera": "6.0.0",
  "@capacitor/push-notifications": "6.0.0",
  "@capacitor/network": "6.0.0",
  "@capacitor-community/sqlite": "6.0.0"
}
```

## Project Structure

```
apps/mobile/
├── capacitor.config.ts
├── ionic.config.json
├── src/
│   ├── App.tsx
│   ├── main.tsx
│   ├── theme/variables.css
│   ├── pages/
│   │   ├── Dashboard.tsx
│   │   └── Settings.tsx
│   ├── components/
│   │   ├── OfflineIndicator.tsx
│   │   └── SensorCard.tsx
│   ├── hooks/
│   │   ├── useOfflineData.ts
│   │   ├── useCamera.ts
│   │   └── usePushNotifications.ts
│   ├── services/
│   │   ├── api.ts
│   │   ├── database.ts
│   │   └── sync.ts
│   └── stores/
├── ios/
├── android/
└── resources/
```

## Capacitor Configuration

```typescript
// capacitor.config.ts
import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.example.app',
  appName: 'My App',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
    iosScheme: 'https',
  },
  plugins: {
    SplashScreen: {
      launchAutoHide: false,
      splashFullScreen: true,
    },
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
    CapacitorSQLite: {
      iosDatabaseLocation: 'Library/CapacitorDatabase',
    },
  },
};

export default config;
```

## App Setup

```tsx
// src/App.tsx
import { IonApp, IonRouterOutlet, IonSplitPane, setupIonicReact } from '@ionic/react';
import { IonReactRouter } from '@ionic/react-router';
import { Route, Redirect } from 'react-router-dom';

import '@ionic/react/css/core.css';
import '@ionic/react/css/normalize.css';
import '@ionic/react/css/structure.css';
import './theme/variables.css';

setupIonicReact({ mode: 'ios' });

export function App() {
  return (
    <IonApp>
      <IonReactRouter>
        <IonSplitPane contentId="main">
          <Menu />
          <IonRouterOutlet id="main">
            <Route exact path="/dashboard" component={Dashboard} />
            <Route exact path="/settings" component={Settings} />
            <Route exact path="/"><Redirect to="/dashboard" /></Route>
          </IonRouterOutlet>
        </IonSplitPane>
      </IonReactRouter>
    </IonApp>
  );
}
```

## Theme Variables

```css
/* src/theme/variables.css */
:root {
  --ion-color-primary: #0969ff;
  --ion-color-primary-contrast: #ffffff;
  --ion-color-secondary: #3dc2ff;
  --ion-color-success: #2dd36f;
  --ion-color-warning: #ffc409;
  --ion-color-danger: #eb445a;
  --ion-font-family: 'Inter', -apple-system, sans-serif;
}

@media (prefers-color-scheme: dark) {
  body {
    --ion-background-color: #121212;
    --ion-text-color: #ffffff;
  }
}
```

## Page Example

```tsx
// src/pages/Dashboard.tsx
import {
  IonContent, IonHeader, IonPage, IonTitle, IonToolbar,
  IonRefresher, IonRefresherContent, IonGrid, IonRow, IonCol,
  RefresherEventDetail,
} from '@ionic/react';

export function Dashboard() {
  const { data: items, refetch } = useItems();

  const handleRefresh = async (event: CustomEvent<RefresherEventDetail>) => {
    await refetch();
    event.detail.complete();
  };

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonTitle>Dashboard</IonTitle>
          <OfflineIndicator slot="end" />
        </IonToolbar>
      </IonHeader>

      <IonContent fullscreen>
        <IonRefresher slot="fixed" onIonRefresh={handleRefresh}>
          <IonRefresherContent />
        </IonRefresher>

        <IonGrid>
          <IonRow>
            {items?.map((item) => (
              <IonCol size="12" sizeMd="6" key={item.id}>
                <ItemCard item={item} />
              </IonCol>
            ))}
          </IonRow>
        </IonGrid>
      </IonContent>
    </IonPage>
  );
}
```

## Capacitor Plugins

### Camera

```typescript
// src/hooks/useCamera.ts
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';

export function useCamera() {
  const takePhoto = async (): Promise<string | null> => {
    try {
      const photo = await Camera.getPhoto({
        resultType: CameraResultType.Base64,
        source: CameraSource.Camera,
        quality: 80,
        width: 1024,
      });
      return photo.base64String ?? null;
    } catch (error) {
      console.error('Camera error:', error);
      return null;
    }
  };

  return { takePhoto };
}
```

### Push Notifications

```typescript
// src/hooks/usePushNotifications.ts
import { useEffect } from 'react';
import { PushNotifications } from '@capacitor/push-notifications';
import { Capacitor } from '@capacitor/core';

export function usePushNotifications() {
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    const setup = async () => {
      const perm = await PushNotifications.requestPermissions();
      if (perm.receive !== 'granted') return;

      await PushNotifications.register();

      PushNotifications.addListener('registration', (token) => {
        console.log('Push token:', token.value);
        // Send to backend
      });

      PushNotifications.addListener('pushNotificationReceived', (notification) => {
        console.log('Notification:', notification);
      });

      PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
        const data = action.notification.data;
        if (data.type === 'alert') {
          window.location.href = `/alerts/${data.alertId}`;
        }
      });
    };

    setup();
    return () => { PushNotifications.removeAllListeners(); };
  }, []);
}
```

### Network Status

```typescript
// src/hooks/useNetwork.ts
import { useEffect, useState } from 'react';
import { Network, ConnectionStatus } from '@capacitor/network';

export function useNetwork() {
  const [status, setStatus] = useState<ConnectionStatus>({ connected: true, connectionType: 'unknown' });

  useEffect(() => {
    const handler = Network.addListener('networkStatusChange', setStatus);
    Network.getStatus().then(setStatus);
    return () => { handler.remove(); };
  }, []);

  return { isOnline: status.connected, connectionType: status.connectionType };
}
```

## SQLite Offline Storage

```typescript
// src/services/database.ts
import { CapacitorSQLite, SQLiteConnection } from '@capacitor-community/sqlite';

class DatabaseService {
  private sqlite = new SQLiteConnection(CapacitorSQLite);
  private db = null;

  async init() {
    this.db = await this.sqlite.createConnection('appdb', false, 'no-encryption', 1, false);
    await this.db.open();
    await this.runMigrations();
  }

  private async runMigrations() {
    await this.db.execute(`
      CREATE TABLE IF NOT EXISTS items (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        value REAL,
        updated_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS sync_queue (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        operation TEXT NOT NULL,
        payload TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
    `);
  }

  async getItems() {
    const result = await this.db.query('SELECT * FROM items ORDER BY name');
    return result.values ?? [];
  }

  async saveItem(item) {
    await this.db.run(
      `INSERT OR REPLACE INTO items (id, name, value, updated_at) VALUES (?, ?, ?, ?)`,
      [item.id, item.name, item.value, Date.now()]
    );
  }

  async addToSyncQueue(entityType, entityId, operation, payload) {
    await this.db.run(
      `INSERT INTO sync_queue (entity_type, entity_id, operation, payload, created_at) VALUES (?, ?, ?, ?, ?)`,
      [entityType, entityId, operation, JSON.stringify(payload), Date.now()]
    );
  }
}

export const database = new DatabaseService();
```

## Sync Service

```typescript
// src/services/sync.ts
import { database } from './database';
import { api } from './api';
import { Network } from '@capacitor/network';

class SyncService {
  private syncing = false;

  async start() {
    Network.addListener('networkStatusChange', async (status) => {
      if (status.connected) await this.sync();
    });
    setInterval(() => this.sync(), 5 * 60 * 1000);
    await this.sync();
  }

  async sync() {
    if (this.syncing) return;
    const status = await Network.getStatus();
    if (!status.connected) return;

    this.syncing = true;
    try {
      await this.pullData();
      await this.pushData();
    } finally {
      this.syncing = false;
    }
  }

  private async pullData() {
    const items = await api.items.list();
    for (const item of items) {
      await database.saveItem(item);
    }
  }

  private async pushData() {
    const pending = await database.getPendingSyncItems();
    for (const item of pending) {
      await api.generic[item.operation](item.entityType, item.payload);
      await database.markSynced(item.id);
    }
  }
}

export const syncService = new SyncService();
```

## Offline-First Hook

```typescript
// src/hooks/useOfflineData.ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { database } from '../services/database';
import { api } from '../services/api';
import { useNetwork } from './useNetwork';

export function useOfflineItems() {
  const { isOnline } = useNetwork();

  return useQuery({
    queryKey: ['items'],
    queryFn: async () => {
      if (isOnline) {
        const items = await api.items.list();
        for (const item of items) await database.saveItem(item);
        return items;
      }
      return database.getItems();
    },
  });
}

export function useOfflineCreate() {
  const { isOnline } = useNetwork();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data) => {
      if (isOnline) return api.items.create(data);

      const localId = crypto.randomUUID();
      await database.saveItem({ ...data, id: localId });
      await database.addToSyncQueue('item', localId, 'create', data);
      return { ...data, id: localId };
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['items'] }),
  });
}
```

## Offline Indicator Component

```tsx
// src/components/OfflineIndicator.tsx
import { IonBadge, IonIcon } from '@ionic/react';
import { cloudOfflineOutline, syncOutline } from 'ionicons/icons';
import { useNetwork } from '../hooks/useNetwork';

export function OfflineIndicator({ slot }: { slot?: string }) {
  const { isOnline } = useNetwork();
  const { pendingCount } = useSyncStatus();

  if (isOnline && pendingCount === 0) return null;

  return (
    <IonBadge slot={slot} color={isOnline ? 'warning' : 'danger'}>
      <IonIcon icon={isOnline ? syncOutline : cloudOfflineOutline} />
      {pendingCount > 0 && ` ${pendingCount}`}
    </IonBadge>
  );
}
```

## Best Practices

1. **Offline-First** - Always check network before API calls
```typescript
const { isOnline } = useNetwork();
if (isOnline) await api.fetch(); else await database.get();
```

2. **Use Ionic Components** - Native look and feel
```tsx
// Good
<IonButton>Click</IonButton>
<IonCard>Content</IonCard>

// Avoid raw HTML in pages
<button>Click</button>
```

3. **Pull to Refresh** - On all list pages
```tsx
<IonRefresher slot="fixed" onIonRefresh={handleRefresh}>
  <IonRefresherContent />
</IonRefresher>
```

4. **Loading States** - Show spinners
```tsx
if (isLoading) return <IonContent><IonSpinner /></IonContent>;
```

5. **Platform Detection** - For native-only features
```typescript
import { Capacitor } from '@capacitor/core';
if (Capacitor.isNativePlatform()) { /* native code */ }
```

## Related Skills

- `mobile-ionic`: Full mobile patterns
- `sqlite-embedded`: Local database
- `jwt-auth`: Mobile authentication
