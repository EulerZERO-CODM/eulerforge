import type { ReactNode } from 'react';

/** Keyboard key chip. Used in the palette, tooltips and shortcut hints. */
export function Kbd({ children }: { readonly children: ReactNode }) {
  return (
    <kbd className="forge-numeric border-line bg-ink-850 text-2xs text-fg-subtle inline-flex h-5 min-w-5 items-center justify-center rounded-xs border px-1">
      {children}
    </kbd>
  );
}

/**
 * Renders a shortcut string such as "Cmd/Ctrl + K" as key chips.
 * Whitespace and the `+` separator are preserved so the text stays copy-friendly.
 */
export function ShortcutHint({ keys }: { readonly keys: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      {keys.split(/\s*\+\s*/).map((part, index) => (
        <span key={`${part}-${String(index)}`} className="inline-flex items-center gap-1">
          {index > 0 ? <span className="text-2xs text-fg-subtle">+</span> : null}
          <Kbd>{part}</Kbd>
        </span>
      ))}
    </span>
  );
}
