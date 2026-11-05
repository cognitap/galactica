import Worker from './worker?worker'
import workerUrl from './worker.ts?worker&url'
import logo from './logo.svg?raw'
import missing from './missing?raw'

export const assets: readonly unknown[] = [Worker, workerUrl, logo, missing]
