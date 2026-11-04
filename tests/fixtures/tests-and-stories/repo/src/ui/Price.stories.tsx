import type { Meta, StoryObj } from '@storybook/react'
import { Price } from './Price'

const meta: Meta<typeof Price> = { component: Price }
export default meta

export const Primary: StoryObj<typeof Price> = { args: { value: 1 } }
