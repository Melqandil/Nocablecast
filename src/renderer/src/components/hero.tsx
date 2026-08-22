import { Select, ListBox, ListBoxItem, Modal, Tooltip } from '@heroui/react'
import type { ReactNode } from 'react'

/**
 * HeroUI-backed widgets.
 *
 * These are the pieces where doing it by hand means reimplementing keyboard
 * navigation, focus trapping, and screen-reader semantics -- so HeroUI (and
 * React Aria underneath it) does the behaviour, while the brutalist theme
 * tokens in styles.css plus the classes here do the look.
 */

export interface Option {
  key: string
  label: string
}

export function BrutalSelect({
  options, value, onChange, disabled, ariaLabel,
}: {
  options: Option[]
  value: string
  onChange: (key: string) => void
  disabled?: boolean
  ariaLabel: string
}) {
  const selected = options.find((o) => o.key === value)
  return (
    <Select
      aria-label={ariaLabel}
      selectedKey={value}
      isDisabled={disabled}
      onSelectionChange={(k) => k != null && onChange(String(k))}
      className="w-full"
    >
      <Select.Trigger
        className={[
          'flex w-full items-center justify-between gap-2',
          'border-3 border-ink bg-white px-2 py-1.5',
          'text-[12px] font-bold text-ink',
          'shadow-brutal-sm press-brutal cursor-pointer',
          'disabled:cursor-not-allowed disabled:opacity-40 disabled:bg-[#ddd8c9]',
        ].join(' ')}
      >
        <span className="truncate text-left">
          {selected?.label ?? <span className="opacity-50">— none —</span>}
        </span>
        <span aria-hidden className="font-black">▼</span>
      </Select.Trigger>
      <Select.Popover className="border-3 border-ink bg-panel shadow-brutal p-0 min-w-[var(--trigger-width)]">
        <ListBox className="max-h-72 overflow-auto p-0">
          {options.map((o) => (
            <ListBoxItem
              key={o.key}
              id={o.key}
              textValue={o.label}
              className={[
                'cursor-pointer border-b-3 border-ink px-2 py-1.5 last:border-b-0',
                'text-[12px] font-bold text-ink',
                'data-[hovered]:bg-blaze data-[hovered]:text-white',
                'data-[focused]:bg-blaze data-[focused]:text-white',
                'data-[selected]:bg-ink data-[selected]:text-panel',
              ].join(' ')}
            >
              {o.label}
            </ListBoxItem>
          ))}
        </ListBox>
      </Select.Popover>
    </Select>
  )
}

export function HelpModal({
  title, trigger, children,
}: { title: string; trigger: ReactNode; children: ReactNode }) {
  return (
    <Modal>
      <Modal.Trigger>{trigger}</Modal.Trigger>
      <Modal.Backdrop className="bg-black/60 backdrop-blur-none">
        <Modal.Container placement="center">
          <Modal.Dialog className="border-3 border-ink bg-panel shadow-brutal-lg max-w-2xl w-[min(90vw,42rem)] p-0">
            <Modal.Header className="flex items-center justify-between border-b-3 border-ink bg-ink px-4 py-2">
              <Modal.Heading className="text-[12px] font-black uppercase tracking-[0.18em] text-panel">
                {title}
              </Modal.Heading>
              <Modal.CloseTrigger className="border-3 border-panel bg-ink px-2 py-0.5 text-[11px] font-black text-panel hover:bg-blaze hover:border-blaze cursor-pointer" />
            </Modal.Header>
            <Modal.Body className="max-h-[62vh] overflow-auto px-4 py-3 text-[12px] leading-relaxed text-ink">
              {children}
            </Modal.Body>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  )
}

export function Hint({ text, children }: { text: string; children: ReactNode }) {
  return (
    <Tooltip delay={200}>
      <Tooltip.Trigger>{children}</Tooltip.Trigger>
      <Tooltip.Content className="border-3 border-ink bg-ink px-2 py-1 text-[11px] font-bold text-panel max-w-xs">
        {text}
      </Tooltip.Content>
    </Tooltip>
  )
}
