import Ajv from 'ajv'
import addFormats from 'ajv-formats'
import schema from './resume-payload.schema.json'
import logger from './logger'

const ajv = new Ajv({ allErrors: true, removeAdditional: false })
addFormats(ajv)
const validate = ajv.compile(schema as any)

export function validatePayload(payload: any): {
  valid: boolean
  errors?: any
} {
  const valid = validate(payload)
  if (!valid) {
    logger.error({ errors: validate.errors }, 'Payload validation failed')
    return { valid: false, errors: validate.errors }
  }
  return { valid: true }
}

export default validatePayload
