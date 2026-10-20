import type { EasyPzApi } from '../shared/ipc'

declare global {
  interface Window {
    easypz: EasyPzApi
  }
}

export {}
