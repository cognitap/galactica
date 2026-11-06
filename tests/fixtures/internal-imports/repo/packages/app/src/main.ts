import { add } from '../../core/src/math'
import { format } from '../../core/src/format'
import { secret } from '../../core/src/internal/secret'
import { star } from '../../core/src/icons/star'
import { slug } from '../../plain/src/text/slug'
import { pad } from '@fx/plain/src/text/pad'
import { format as aliased } from '@fx/core/src/format'
import { gone } from '@fx/core/internal/gone'
import { banner } from '../../../scripts/shared'
import { add as sum } from '@fx/core'

export const shown = [add(1, 2), format(secret), star, slug('A b'), pad('x'), aliased('y'), gone, banner, sum(3, 4)]
