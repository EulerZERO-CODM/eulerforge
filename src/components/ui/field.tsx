'use client';

import * as SwitchPrimitive from '@radix-ui/react-switch';
import {
  createContext,
  useContext,
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';

import { cn } from '../../lib/cn';

const CONTROL_BASE =
  'w-full rounded-sm border border-line-strong bg-ink-950 px-2.5 text-base text-fg placeholder:text-fg-subtle ' +
  'transition-colors hover:border-ink-600 focus:border-arc-500 focus:outline-none ' +
  'disabled:cursor-not-allowed disabled:border-line disabled:bg-ink-900 disabled:text-fg-subtle';

/** Generated control id, shared between a `Field` label and the control it describes. */
const FieldControlContext = createContext<string | null>(null);

export type FieldProps = {
  readonly label: string;
  readonly hint?: ReactNode | undefined;
  readonly error?: string | null;
  readonly children: ReactNode;
  readonly className?: string;
  /** Trailing note beside the label, for example a unit or a range. */
  readonly labelSuffix?: ReactNode;
};

/**
 * Field wrapper: label, hint and error message wired together with a generated id.
 * Controls inside read the id (and the invalid state) from context, so `htmlFor`/`aria-describedby`
 * can never drift out of sync with what is rendered.
 */
export function Field({ label, hint, error, children, className, labelSuffix }: FieldProps) {
  const id = useId();
  return (
    <div className={cn('space-y-1.5', className)}>
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="text-2xs text-fg-muted font-medium tracking-wide uppercase">
          {label}
        </label>
        {labelSuffix ? (
          <span className="forge-numeric text-2xs text-fg-subtle">{labelSuffix}</span>
        ) : null}
      </div>
      <FieldControlContext.Provider value={id}>{children}</FieldControlContext.Provider>
      {error ? (
        <p className="text-xs text-rose-400" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="text-fg-subtle text-xs">{hint}</p>
      ) : null}
    </div>
  );
}

/** Id assigned by the surrounding `Field`, if any. */
export function useFieldId(): string | undefined {
  return useContext(FieldControlContext) ?? undefined;
}

export type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  readonly invalid?: boolean;
  /** Unit or suffix rendered inside the control, e.g. "px". */
  readonly suffix?: string | undefined;
};

export function Input({ className, invalid = false, suffix, ...props }: InputProps) {
  const fieldId = useContext(FieldControlContext);
  const control = (
    <input
      {...(fieldId ? { id: fieldId } : {})}
      {...(invalid ? { 'aria-invalid': true } : {})}
      className={cn(
        CONTROL_BASE,
        'h-9',
        invalid && 'border-rose-600/70',
        suffix ? 'pr-12' : null,
        className,
      )}
      {...props}
    />
  );

  if (!suffix) return control;
  return (
    <div className="relative">
      {control}
      <span className="forge-numeric text-2xs text-fg-subtle pointer-events-none absolute inset-y-0 right-2.5 flex items-center">
        {suffix}
      </span>
    </div>
  );
}

export type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  readonly invalid?: boolean;
};

export function Textarea({ className, invalid = false, ...props }: TextareaProps) {
  const fieldId = useContext(FieldControlContext);
  return (
    <textarea
      {...(fieldId ? { id: fieldId } : {})}
      {...(invalid ? { 'aria-invalid': true } : {})}
      className={cn(
        CONTROL_BASE,
        'forge-scroll min-h-20 resize-y py-2',
        invalid && 'border-rose-600/70',
        className,
      )}
      {...props}
    />
  );
}

export type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & {
  readonly options: readonly {
    readonly value: string;
    readonly label: string;
    readonly disabled?: boolean;
  }[];
};

export function Select({ className, options, ...props }: SelectProps) {
  const fieldId = useContext(FieldControlContext);
  return (
    <select
      {...(fieldId ? { id: fieldId } : {})}
      className={cn(
        CONTROL_BASE,
        'h-9 cursor-pointer appearance-none bg-no-repeat pr-8',
        className,
      )}
      style={{
        backgroundImage:
          "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12' fill='none' stroke='%23a1a6b3' stroke-width='1.5'%3E%3Cpath d='M3 4.5 6 7.5l3-3'/%3E%3C/svg%3E\")",
        backgroundPosition: 'right 8px center',
        backgroundSize: '12px',
      }}
      {...props}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value} disabled={option.disabled}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

export type CheckboxProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & {
  readonly label: ReactNode;
};

export function Checkbox({ className, label, ...props }: CheckboxProps) {
  const id = useId();
  return (
    <div className={cn('flex items-start gap-2.5', className)}>
      <input
        id={id}
        type="checkbox"
        className={cn(
          'border-line-strong bg-ink-950 mt-0.5 size-4 shrink-0 cursor-pointer appearance-none rounded-xs border',
          'checked:border-accent checked:bg-accent transition-colors',
          "checked:bg-[url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 12 12%22 fill=%22none%22 stroke=%22%230f1115%22 stroke-width=%222%22><path d=%22M2.5 6.2 4.8 8.5 9.5 3.8%22/></svg>')]",
          'checked:bg-center checked:bg-no-repeat',
        )}
        {...props}
      />
      <label htmlFor={id} className="text-fg-muted cursor-pointer text-base select-none">
        {label}
      </label>
    </div>
  );
}

export type SwitchFieldProps = {
  readonly label: string;
  readonly description?: string;
  readonly checked: boolean;
  readonly onCheckedChange: (checked: boolean) => void;
  readonly disabled?: boolean;
};

/** Labelled switch used by Settings and by inspector toggles. */
export function SwitchField({
  label,
  description,
  checked,
  onCheckedChange,
  disabled,
}: SwitchFieldProps) {
  const id = useId();
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <label htmlFor={id} className="text-fg text-base font-medium">
          {label}
        </label>
        {description ? <p className="text-fg-subtle mt-0.5 text-xs">{description}</p> : null}
      </div>
      <SwitchPrimitive.Root
        id={id}
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
        className={cn(
          'border-line-strong bg-ink-800 relative h-5 w-9 shrink-0 cursor-pointer rounded-full border transition-colors',
          'data-[state=checked]:border-accent data-[state=checked]:bg-accent',
          'disabled:cursor-not-allowed disabled:opacity-50',
        )}
      >
        <SwitchPrimitive.Thumb className="bg-ink-300 data-[state=checked]:bg-fg-inverse block size-3.5 translate-x-0.5 rounded-full transition-transform data-[state=checked]:translate-x-4" />
      </SwitchPrimitive.Root>
    </div>
  );
}
