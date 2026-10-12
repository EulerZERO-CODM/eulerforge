'use client';

/**
 * Composition root for the browser application.
 *
 * Services are constructed once per tab (lazily, inside `useState`) and shared through context.
 * Components consume them with hooks — they never construct a repository, catalogue or store
 * themselves, which is what keeps `src/components/**` free of persistence imports (enforced by an
 * ESLint rule as well as by review).
 */

import { createContext, useContext, useState, type ReactNode } from 'react';

import { createAssetCatalog, type AssetCatalog } from '../core/assets/catalog';
import { createPlatformEventBus, type PlatformEventBus } from '../core/events/event-bus';
import type { DocumentRepository } from '../core/persistence/document-repository';
import { LocalDocumentRepository } from '../core/persistence/document-repository';
import { BrowserLocalStorage, type KeyValueStorage } from '../core/persistence/storage';
import { LocalPreferencesRepository } from '../core/preferences/repository';
import { env } from '../config/env';
import { DocumentsStore } from './documents-store';
import { LearningProgressStore } from './learning-progress-store';
import { PreferencesStore } from './preferences-store';
import { ToastStore } from './toast-store';

export type ForgeServices = {
  readonly bus: PlatformEventBus;
  readonly storage: KeyValueStorage;
  readonly documents: DocumentsStore;
  readonly documentRepository: DocumentRepository;
  readonly catalog: AssetCatalog;
  readonly preferences: PreferencesStore;
  readonly learning: LearningProgressStore;
  readonly toasts: ToastStore;
};

export function createForgeServices(): ForgeServices {
  const bus = createPlatformEventBus();
  const storage = BrowserLocalStorage.create();
  const documentRepository = new LocalDocumentRepository(storage);
  const documents = new DocumentsStore({ repository: documentRepository, bus });
  const preferences = new PreferencesStore(new LocalPreferencesRepository(storage));
  const learning = new LearningProgressStore(storage);
  const toasts = new ToastStore();
  const catalog = createAssetCatalog(env.catalogSource);

  return {
    bus,
    storage,
    documents,
    documentRepository,
    catalog,
    preferences,
    learning,
    toasts,
  };
}

const ForgeContext = createContext<ForgeServices | null>(null);

export function ForgeProvider({
  children,
  services,
}: {
  children: ReactNode;
  /** Test seam: inject pre-built services instead of constructing browser-backed ones. */
  services?: ForgeServices;
}) {
  const [created] = useState<ForgeServices>(() => services ?? createForgeServices());
  return <ForgeContext.Provider value={created}>{children}</ForgeContext.Provider>;
}

export function useForgeServices(): ForgeServices {
  const services = useContext(ForgeContext);
  if (!services) {
    throw new Error('useForgeServices must be used inside <ForgeProvider>.');
  }
  return services;
}
