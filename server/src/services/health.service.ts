export function getHealth() {
  return { status: 'ok' as const, service: 'content-hub-server', timestamp: new Date().toISOString() }
}
