import type { ReactNode } from 'react'

export interface ButtonProps {
  readonly children: ReactNode
}

/** The primary action. Use one per screen. */
export default function Button({ children }: ButtonProps) {
  return <button type="button">{children}</button>
}
