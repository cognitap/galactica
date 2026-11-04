import { z } from 'zod'
import { sum } from '@/lib/math'
import { format } from 'lib/format'
import { settings } from '~config'

export const schema = z.number()
export const total: string = format(sum(settings.values))
