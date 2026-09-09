import '@testing-library/jest-dom/vitest';

// Bun ships its own native `localStorage` (file-backed, disabled without
// --localstorage-file) as a configurable global getter that returns
// `undefined`. It shadows jsdom's window.localStorage before vitest's jsdom
// environment can populate the test global, so every `localStorage.clear()`
// in a test's `beforeEach` throws. Replace it with a plain in-memory Storage
// so tests get deterministic, isolated storage regardless of runtime.
function createMemoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (key: string) => (data.has(key) ? data.get(key)! : null),
    key: (index: number) => Array.from(data.keys())[index] ?? null,
    removeItem: (key: string) => {
      data.delete(key);
    },
    setItem: (key: string, value: string) => {
      data.set(key, String(value));
    },
  };
}

for (const target of [globalThis, globalThis.window] as const) {
  if (!target) continue;
  Object.defineProperty(target, 'localStorage', {
    value: createMemoryStorage(),
    writable: true,
    configurable: true,
  });
  Object.defineProperty(target, 'sessionStorage', {
    value: createMemoryStorage(),
    writable: true,
    configurable: true,
  });
}
