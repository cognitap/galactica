<script setup lang="ts">
import { formatCount } from './format'

defineProps<{ count: number }>()
</script>

<template>
  <span>{{ formatCount(count) }}</span>
</template>
