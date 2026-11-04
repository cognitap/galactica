import { memo, useState } from 'react'

export function Card({ title }: { title: string }) {
  return <section>{title}</section>
}

export const MemoCard = memo(Card)

export function useOpen(): boolean {
  return useState(false)[0]
}
