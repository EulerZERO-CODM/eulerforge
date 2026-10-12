/**
 * Test support: a fully wired service graph backed by in-memory storage.
 *
 * Component tests use this through `<ForgeProvider services={…}>` so they exercise the real stores,
 * repositories and catalogue adapter instead of mocks — the point of those tests is to prove the
 * wiring works.
 */

import { createAssetCatalog, type CatalogSourceId } from '../core/assets/catalog';
import { createPlatformEventBus } from '../core/events/event-bus';
import { LocalDocumentRepository } from '../core/persistence/document-repository';
import { MemoryStorage } from '../core/persistence/storage';
import { LocalPreferencesRepository } from '../core/preferences/repository';
import { DocumentsStore } from '../state/documents-store';
import { LearningProgressStore } from '../state/learning-progress-store';
import { PreferencesStore } from '../state/preferences-store';
import { ToastStore } from '../state/toast-store';
import type { ForgeServices } from '../state/forge-provider';

export type TestServicesOptions = {
  readonly catalogSource?: CatalogSourceId;
  readonly now?: () => Date;
  readonly generateId?: () => string;
};

/** `ForgeServices` type is not exported from the provider for components, but tests may build one. */
export type TestForgeServices = ForgeServices;

export function createTestServices(options: TestServicesOptions = {}): TestForgeServices {
  const bus = createPlatformEventBus();
  const storage = new MemoryStorage();
  const documentRepository = new LocalDocumentRepository(storage);
  const documents = new DocumentsStore({
    repository: documentRepository,
    bus,
    ...(options.now === undefined ? {} : { now: options.now }),
    ...(options.generateId === undefined ? {} : { generateId: options.generateId }),
  });
  const preferences = new PreferencesStore(new LocalPreferencesRepository(storage));
  const learning = new LearningProgressStore(
    storage,
    options.now ?? (() => new Date('2026-04-01T00:00:00.000Z')),
  );
  const toasts = new ToastStore();

  return {
    bus,
    storage,
    documents,
    documentRepository,
    catalog: createAssetCatalog(options.catalogSource ?? 'sample'),
    preferences,
    learning,
    toasts,
  };
}
