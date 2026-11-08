import type { FastifyInstance } from 'fastify'
import { Prisma } from '@prisma/client'

export class HttpError extends Error {
  constructor(public readonly statusCode: number, public readonly code: string, message: string) {
    super(message)
  }
}

export function registerErrorHandling(app: FastifyInstance): void {
  app.setNotFoundHandler((request, reply) => {
    return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Route not found', requestId: request.id } })
  })
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      const mapped: Record<string, [number, string, string]> = {
        P2002: [409, 'UNIQUE_CONFLICT', 'A unique value or active job already exists'],
        P2003: [409, 'RELATION_CONFLICT', 'A related record is missing or still referenced'],
        P2004: [409, 'CONSTRAINT_CONFLICT', 'The operation violates a database constraint'],
        P2025: [404, 'NOT_FOUND', 'Resource not found'],
        P2034: [409, 'CONCURRENT_UPDATE', 'A concurrent update occurred; retry the request'],
        P1001: [503, 'DATABASE_UNAVAILABLE', 'Database is unavailable'],
        P1002: [503, 'DATABASE_UNAVAILABLE', 'Database is unavailable'],
        P2024: [503, 'DATABASE_UNAVAILABLE', 'Database is temporarily unavailable'],
      }
      const result = mapped[error.code]
      if (result) return reply.code(result[0]).send({ error: { code: result[1], message: result[2], requestId: request.id } })
    }
    if (error instanceof Prisma.PrismaClientValidationError) return reply.code(422).send({ error: { code: 'VALIDATION_ERROR', message: 'The request contains an invalid database value', requestId: request.id } })
    if (error instanceof Prisma.PrismaClientInitializationError) return reply.code(503).send({ error: { code: 'DATABASE_UNAVAILABLE', message: 'Database is unavailable', requestId: request.id } })
    if (error instanceof HttpError && error.statusCode >= 400 && error.statusCode < 600) {
      return reply.code(error.statusCode).send({ error: { code: error.code, message: error.message, requestId: request.id } })
    }
    const candidate = error as { statusCode?: number; validation?: { instancePath: string; message?: string }[] }
    if (candidate.statusCode === 429) return reply.code(429).send({ error: { code: 'RATE_LIMITED', message: 'Too many requests; try again later', requestId: request.id } })
    if (candidate.statusCode && candidate.statusCode >= 400 && candidate.statusCode < 500) {
      const fields = candidate.validation ? Object.fromEntries(candidate.validation.map(item => [item.instancePath.replace(/^\//, '').replaceAll('/', '.') || 'request', item.message ?? 'Invalid value'])) : undefined
      return reply.code(candidate.statusCode).send({ error: { code: candidate.validation ? 'VALIDATION_ERROR' : 'INVALID_REQUEST', message: 'The request is invalid', requestId: request.id, ...(fields ? { fields } : {}) } })
    }
    request.log.error({ err: error }, 'Unhandled request error')
    return reply.code(500).send({ error: { code: 'INTERNAL_ERROR', message: 'An unexpected server error occurred', requestId: request.id } })
  })
}
