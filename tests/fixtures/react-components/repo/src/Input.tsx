import { forwardRef } from 'react'

export const Input = forwardRef<HTMLInputElement>(function Input(props, ref) {
  return <input ref={ref} {...props} />
})
