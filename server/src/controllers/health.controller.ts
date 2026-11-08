import { getHealth } from '../services/health.service.js'

export async function healthController() {
  return getHealth()
}
