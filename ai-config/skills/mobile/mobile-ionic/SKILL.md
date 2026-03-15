---
name: mobile-ionic
description: >
  Cross-platform mobile development with Ionic 8, Capacitor 6, and offline-first SQLite patterns.
  Trigger: Ionic, Capacitor, mobile app, React Native alternative, SQLite mobile, offline sync, push notifications
tools:
  - Read
  - Write
  - Bash
  - Grep
metadata:
  author: plataforma-industrial
  version: "2.0"
  tags: [ionic, capacitor, mobile, react, sqlite, offline-first]
  updated: "2026-02"
---

# Mobile Development with Ionic

Cross-platform mobile apps with Ionic 8, Capacitor 6, and offline-first architecture.

## Stack

```json
{
  "@ionic/react": "8.0.1",
  "@ionic/react-router": "8.0.1",
  "react": "18.2.0",
  "@capacitor/core": "6.0.0",
  "@capacitor/camera": "6.0.0",
  "@capacitor/filesystem": "6.0.0",
  "@capacitor/network": "6.0.0",
  "@capacitor/preferences": "6.0.0",
  "@capacitor/push-notifications": "6.0.0",
  "@capacitor-community/sqlite": "6.0.0",
  "@tanstack/react-query": "5.28.4",
  "zustand": "4.5.2",
  "zod": "3.22.4"
}
```

## Capacitor Config

```typescript
// capacitor.config.ts
import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.example.app',
  appName: 'My App',
  webDir: 'dist',
  server: { androidScheme: 'https' },
  plugins: {
    SplashScreen: {
      launchShowDuration: 2000,
      backgroundColor: '#1890ff',
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

```typescript
// src/App.tsx
import { useEffect } from 'react';
import { IonApp, setupIonicReact } from '@ionic/react';
import { IonReactRouter } from '@ionic/react-router';
import { Capacitor } from '@capacitor/core';
import { StatusBar, Style } from '@capacitor/status-bar';
import { SplashScreen } from '@capacitor/splash-screen';
import { Routes } from './routes';
import { initDatabase } from '@lib/db/database';

setupIonicReact({ mode: 'ios' });

export function App() {
  useEffect(() => {
    const initApp = async () => {
      await initDatabase();

      if (Capacitor.isNativePlatform()) {
        await StatusBar.setStyle({ style: Style.Light });
        await SplashScreen.hide();
      }
    };
    initApp();
  }, []);

  return (
    <IonApp>
      <IonReactRouter>
        <Routes />
      </IonReactRouter>
    </IonApp>
  );
}
```

## SQLite Database

```typescript
// src/lib/db/database.ts
import { CapacitorSQLite, SQLiteConnection, SQLiteDBConnection } from '@capacitor-community/sqlite';
import { Capacitor } from '@capacitor/core';

const DB_NAME = 'app_db';
let db: SQLiteDBConnection | null = null;
const sqlite = new SQLiteConnection(CapacitorSQLite);

export async function initDatabase(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;

  const isConn = (await sqlite.isConnection(DB_NAME, false)).result;

  if (isConn) {
    db = await sqlite.retrieveConnection(DB_NAME, false);
  } else {
    db = await sqlite.createConnection(DB_NAME, false, 'no-encryption', 1, false);
  }

  await db.open();
  await runMigrations(db);
}

export function getDatabase(): SQLiteDBConnection {
  if (!db) throw new Error('Database not initialized');
  return db;
}

async function runMigrations(db: SQLiteDBConnection): Promise<void> {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS items (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      status TEXT DEFAULT 'active',
      synced_at TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS sync_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      operation TEXT NOT NULL,
      payload TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);
}
```

## Repository Pattern

```typescript
// src/lib/db/repositories/itemRepo.ts
import { getDatabase } from '../database';
import type { Item } from '@lib/types/item';

export const itemRepo = {
  async getAll(): Promise<Item[]> {
    const db = getDatabase();
    const result = await db.query('SELECT * FROM items ORDER BY created_at DESC');
    return (result.values || []).map(mapRowToItem);
  },

  async upsert(item: Item): Promise<void> {
    const db = getDatabase();
    await db.run(
      `INSERT OR REPLACE INTO items (id, name, status, synced_at)
       VALUES (?, ?, ?, ?)`,
      [item.id, item.name, item.status, new Date().toISOString()]
    );
  },

  async getUnsynced(): Promise<Item[]> {
    const db = getDatabase();
    const result = await db.query(
      'SELECT * FROM items WHERE synced_at IS NULL'
    );
    return (result.values || []).map(mapRowToItem);
  },
};

function mapRowToItem(row: Record<string, unknown>): Item {
  return {
    id: row.id as string,
    name: row.name as string,
    status: row.status as string,
    createdAt: row.created_at as string,
  };
}
```

## Offline Sync Hook

```typescript
// src/lib/hooks/useOfflineSync.ts
import { useEffect, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Network } from '@capacitor/network';
import { useOfflineStore } from '@lib/stores/offlineStore';
import { itemRepo } from '@lib/db/repositories/itemRepo';
import { itemsApi } from '@lib/api/items';

export function useOfflineSync() {
  const queryClient = useQueryClient();
  const { isOnline, setOnline, pendingSync, clearPendingSync } = useOfflineStore();

  useEffect(() => {
    Network.getStatus().then((s) => setOnline(s.connected));

    const listener = Network.addListener('networkStatusChange', (status) => {
      setOnline(status.connected);
    });

    return () => { listener.remove(); };
  }, [setOnline]);

  useEffect(() => {
    if (isOnline && pendingSync.length > 0) {
      syncPendingChanges();
    }
  }, [isOnline]);

  const syncPendingChanges = useCallback(async () => {
    // Sync pending changes to server
    for (const item of pendingSync) {
      await itemsApi.sync(item);
    }
    clearPendingSync();

    // Pull latest from server
    const items = await itemsApi.list();
    for (const item of items.data) {
      await itemRepo.upsert(item);
    }

    queryClient.invalidateQueries({ queryKey: ['items'] });
  }, [queryClient, pendingSync, clearPendingSync]);

  return { isOnline, syncNow: syncPendingChanges };
}
```

## Camera Hook

```typescript
// src/lib/hooks/useCamera.ts
import { useState, useCallback } from 'react';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import { Filesystem, Directory } from '@capacitor/filesystem';

export function useCamera() {
  const [isLoading, setIsLoading] = useState(false);

  const takePhoto = useCallback(async (): Promise<string | null> => {
    setIsLoading(true);
    try {
      const photo = await Camera.getPhoto({
        quality: 80,
        resultType: CameraResultType.Base64,
        source: CameraSource.Camera,
        width: 1200,
      });

      const fileName = `photo_${Date.now()}.${photo.format}`;
      const savedFile = await Filesystem.writeFile({
        path: fileName,
        data: photo.base64String!,
        directory: Directory.Data,
      });

      return savedFile.uri;
    } catch {
      return null;
    } finally {
      setIsLoading(false);
    }
  }, []);

  return { takePhoto, isLoading };
}
```

## Page Pattern

```typescript
// src/pages/ItemsPage.tsx
import {
  IonContent,
  IonHeader,
  IonPage,
  IonTitle,
  IonToolbar,
  IonRefresher,
  IonRefresherContent,
  IonList,
  IonSpinner,
  RefresherEventDetail,
} from '@ionic/react';
import { useItems } from '@lib/hooks/useItems';
import { ItemCard } from '@components/items/ItemCard';
import { NetworkStatus } from '@components/common/NetworkStatus';

export function ItemsPage() {
  const { data: items, isLoading, refetch } = useItems();

  const handleRefresh = async (event: CustomEvent<RefresherEventDetail>) => {
    await refetch();
    event.detail.complete();
  };

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonTitle>Items</IonTitle>
        </IonToolbar>
      </IonHeader>

      <IonContent fullscreen>
        <NetworkStatus />

        <IonRefresher slot="fixed" onIonRefresh={handleRefresh}>
          <IonRefresherContent />
        </IonRefresher>

        {isLoading && (
          <div className="ion-text-center ion-padding">
            <IonSpinner />
          </div>
        )}

        {items && (
          <IonList>
            {items.map((item) => (
              <ItemCard key={item.id} item={item} />
            ))}
          </IonList>
        )}
      </IonContent>
    </IonPage>
  );
}
```

## Tab Routes

```typescript
// src/routes/index.tsx
import { IonRouterOutlet, IonTabs, IonTabBar, IonTabButton, IonIcon, IonLabel } from '@ionic/react';
import { Route, Redirect } from 'react-router-dom';
import { home, list, settings } from 'ionicons/icons';

export function Routes() {
  return (
    <IonTabs>
      <IonRouterOutlet>
        <Route exact path="/home" component={HomePage} />
        <Route exact path="/items" component={ItemsPage} />
        <Route exact path="/items/:id" component={ItemDetailPage} />
        <Route exact path="/settings" component={SettingsPage} />
        <Route exact path="/">
          <Redirect to="/home" />
        </Route>
      </IonRouterOutlet>

      <IonTabBar slot="bottom">
        <IonTabButton tab="home" href="/home">
          <IonIcon icon={home} />
          <IonLabel>Home</IonLabel>
        </IonTabButton>
        <IonTabButton tab="items" href="/items">
          <IonIcon icon={list} />
          <IonLabel>Items</IonLabel>
        </IonTabButton>
        <IonTabButton tab="settings" href="/settings">
          <IonIcon icon={settings} />
          <IonLabel>Settings</IonLabel>
        </IonTabButton>
      </IonTabBar>
    </IonTabs>
  );
}
```

## Push Notifications

```typescript
// src/lib/services/pushService.ts
import { PushNotifications, Token } from '@capacitor/push-notifications';
import { Capacitor } from '@capacitor/core';
import { authApi } from '@lib/api/auth';

export async function setupPushNotifications(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;

  const permStatus = await PushNotifications.checkPermissions();
  if (permStatus.receive !== 'granted') {
    const result = await PushNotifications.requestPermissions();
    if (result.receive !== 'granted') return;
  }

  await PushNotifications.register();

  PushNotifications.addListener('registration', async (token: Token) => {
    await authApi.registerPushToken(token.value);
  });

  PushNotifications.addListener('pushNotificationReceived', (notification) => {
    console.log('Push received:', notification);
  });

  PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
    const { data } = action.notification;
    if (data?.route) {
      window.location.href = data.route;
    }
  });
}
```

## Conventions

| Element | Convention | Example |
|---------|------------|---------|
| Pages | PascalCase + Page | `ItemsPage.tsx` |
| Components | PascalCase | `ItemCard.tsx` |
| Hooks | camelCase, `use` prefix | `useOfflineSync.ts` |
| Services | camelCase + Service | `pushService.ts` |
| Repositories | camelCase + Repo | `itemRepo.ts` |
| Stores | camelCase + Store | `useOfflineStore` |

## Related Skills

- `ionic-capacitor`: Native plugin patterns
- `sqlite-embedded`: Offline data storage
- `tanstack-query`: Data synchronization
- `playwright-e2e`: Mobile E2E testing
