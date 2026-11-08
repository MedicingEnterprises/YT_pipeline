export const healthSchema = {
  response: {
    200: {
      type: 'object',
      additionalProperties: false,
      required: ['status', 'service', 'timestamp'],
      properties: {
        status: { type: 'string', const: 'ok' },
        service: { type: 'string' },
        timestamp: { type: 'string', format: 'date-time' },
      },
    },
  },
} as const
