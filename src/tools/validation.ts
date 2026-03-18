/**
 * Simple tool argument validation against JSON Schema-style input_schema.
 * Checks required fields are present; type coercion is left to the tools themselves.
 */

export interface ValidationResult {
  valid: boolean
  error?: string
}

export function validateToolArgs(
  input: Record<string, unknown>,
  schema: Record<string, unknown>,
): ValidationResult {
  const required = (schema.required ?? []) as string[]

  for (const field of required) {
    if (!(field in input) || input[field] === undefined || input[field] === null) {
      return { valid: false, error: `Missing required field: ${field}` }
    }
  }

  return { valid: true }
}
