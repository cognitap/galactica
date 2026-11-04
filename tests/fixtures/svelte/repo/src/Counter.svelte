<script lang="ts">
  import { formatCount } from './format'

  let { count }: { count: number } = $props()
</script>

<span>{formatCount(count)}</span>
