import { Select, ListBox, ListBoxItem, Modal, Tooltip } from '@heroui/react'
import type { ReactNode } from 'react'

/**
 * HeroUI-backed widgets.
 *
 * These are the pieces where doing it by hand means reimplementing keyboard
 * navigation, focus trapping, and screen-reader semantics -- so HeroUI (and
 * React Aria underneath it) does the behaviour, while the skeuomorphic theme
 * makes those accessible primitives read as physical controls.
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
      <Select.Trigger className="skeuo-select-trigger flex w-full items-center justify-between gap-2 disabled:cursor-not-allowed">
        <span className="truncate text-left">
          {selected?.label ?? <span className="opacity-50">— none —</span>}
        </span>
        <span aria-hidden className="select-chevron">▼</span>
      </Select.Trigger>
      <Select.Popover className="skeuo-select-popover">
        <ListBox className="skeuo-listbox">
          {options.map((o) => (
            <ListBoxItem
              key={o.key}
              id={o.key}
              textValue={o.label}
              className="skeuo-listbox-item"
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
      <Modal.Backdrop className="skeuo-modal-backdrop">
        <Modal.Container placement="center">
          <Modal.Dialog className="skeuo-modal">
            <Modal.Header className="skeuo-modal-header">
              <Modal.Heading className="skeuo-modal-title">
                {title}
              </Modal.Heading>
              <Modal.CloseTrigger className="skeuo-modal-close" />
            </Modal.Header>
            <Modal.Body className="skeuo-modal-body">
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
      <Tooltip.Content className="skeuo-tooltip">
        {text}
      </Tooltip.Content>
    </Tooltip>
  )
}
