import { objectSchema } from './resources.js'
const email = { type: 'string', format: 'email', minLength: 3, maxLength: 254 }
const password = { type: 'string', minLength: 15, maxLength: 128 }
const currentPassword = { type: 'string', minLength: 1, maxLength: 128 }
const displayName = { type: 'string', minLength: 1, maxLength: 120, pattern: '\\S' }
export const registerSchema = objectSchema({ email, password, displayName }, ['email', 'password', 'displayName'])
export const loginSchema = objectSchema({ email, password: currentPassword }, ['email', 'password'])
export const profileSchema = { ...objectSchema({ email, displayName, currentPassword }), anyOf: [{ required: ['email'] }, { required: ['displayName'] }] }
export const passwordSchema = objectSchema({ currentPassword, newPassword: password }, ['currentPassword', 'newPassword'])
