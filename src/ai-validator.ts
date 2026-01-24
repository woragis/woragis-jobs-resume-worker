import logger from './logger'

export type LanguageCode = 'en' | 'pt-BR' | 'es' | 'fr'

export interface ValidationRules {
  minLength?: number
  maxLength?: number
  requiredFormat?: 'bullet' | 'prose'
  bulletPointCount?: { min: number; max: number }
  forbiddenPhrases?: string[]
  requiredKeywords?: string[]
  language?: LanguageCode
}

export interface ValidationError {
  code:
    | 'TOO_SHORT'
    | 'TOO_LONG'
    | 'WRONG_FORMAT'
    | 'FORBIDDEN_PHRASE'
    | 'MISSING_BULLETS'
    | 'QUALITY_ISSUE'
  message: string
  field?: string
  severity: 'error' | 'warning'
  suggestion?: string
}

export interface ValidationResult {
  isValid: boolean
  errors: ValidationError[]
  warnings: string[]
  metadata: {
    length: number
    bulletPoints: number
    format: 'bullet' | 'prose' | 'mixed'
    estimatedReadingTime: number // seconds
  }
}

const DEFAULT_FORBIDDEN_PHRASES = {
  en: [
    "i don't know",
    'error',
    'unable to',
    '[placeholder]',
    'todo',
    'wip',
    'tbd',
  ],
  'pt-BR': [
    'não sei',
    'erro',
    'incapaz de',
    '[placeholder]',
    'todo',
    'wip',
    'tbd',
  ],
  es: ['no sé', 'error', 'incapaz', '[placeholder]', 'todo', 'wip', 'tbd'],
  fr: [
    'ne sais pas',
    'erreur',
    'incapable',
    '[placeholder]',
    'todo',
    'wip',
    'tbd',
  ],
}

export class AIValidator {
  /**
   * Validate AI-generated response against rules
   */
  validate(content: string, rules: ValidationRules): ValidationResult {
    const errors: ValidationError[] = []
    const warnings: ValidationError[] = []

    if (!content || typeof content !== 'string') {
      errors.push({
        code: 'QUALITY_ISSUE',
        message: 'Response is empty or not a string',
        severity: 'error',
      })
      return {
        isValid: false,
        errors,
        warnings: [],
        metadata: this._getMetadata(content),
      }
    }

    const trimmed = content.trim()
    const length = trimmed.length
    const language = rules.language || 'en'

    // Check length constraints
    if (rules.minLength && length < rules.minLength) {
      errors.push({
        code: 'TOO_SHORT',
        message: `Content too short: ${length} chars (min: ${rules.minLength})`,
        severity: 'error',
        suggestion: `Expand the response to at least ${rules.minLength} characters`,
      })
    }

    if (rules.maxLength && length > rules.maxLength) {
      errors.push({
        code: 'TOO_LONG',
        message: `Content too long: ${length} chars (max: ${rules.maxLength})`,
        severity: 'error',
        suggestion: `Reduce the response to ${rules.maxLength} characters or less`,
      })
    }

    // Check for forbidden phrases
    const forbiddenList =
      rules.forbiddenPhrases || DEFAULT_FORBIDDEN_PHRASES[language] || []
    for (const phrase of forbiddenList) {
      if (trimmed.toLowerCase().includes(phrase.toLowerCase())) {
        errors.push({
          code: 'FORBIDDEN_PHRASE',
          message: `Contains forbidden phrase: "${phrase}"`,
          severity: 'error',
        })
      }
    }

    // Check format
    const bulletCount = this._countBullets(trimmed)
    const metadata = this._getMetadata(trimmed)

    if (rules.requiredFormat) {
      const detectedFormat = this._detectFormat(trimmed)
      if (rules.requiredFormat === 'bullet' && detectedFormat !== 'bullet') {
        if (bulletCount === 0) {
          errors.push({
            code: 'WRONG_FORMAT',
            message: 'Expected bullet-point format but received prose',
            severity: 'error',
            suggestion: 'Format response as bullet points starting with • or -',
          })
        }
      }
      if (rules.requiredFormat === 'prose' && detectedFormat === 'bullet') {
        warnings.push({
          code: 'WRONG_FORMAT',
          message: 'Expected prose format but received bullet points',
          severity: 'warning',
          suggestion:
            'Format response as continuous prose without bullet points',
        })
      }
    }

    // Check bullet point count if specified
    if (rules.bulletPointCount) {
      const { min, max } = rules.bulletPointCount
      if (bulletCount < min || bulletCount > max) {
        errors.push({
          code: 'MISSING_BULLETS',
          message: `Expected ${min}-${max} bullet points but got ${bulletCount}`,
          severity: 'error',
          suggestion: `Add or remove bullet points to meet the requirement`,
        })
      }
    }

    // Check for required keywords
    if (rules.requiredKeywords && rules.requiredKeywords.length > 0) {
      const missing = rules.requiredKeywords.filter(
        (keyword) => !trimmed.toLowerCase().includes(keyword.toLowerCase()),
      )
      if (missing.length > 0) {
        warnings.push({
          code: 'QUALITY_ISSUE',
          message: `Missing keywords: ${missing.join(', ')}`,
          severity: 'warning',
        })
      }
    }

    const isValid = errors.length === 0

    logger.debug(
      {
        isValid,
        errors: errors.length,
        warnings: warnings.length,
        length,
        bulletPoints: bulletCount,
      },
      'AI validation result',
    )

    return {
      isValid,
      errors,
      warnings: warnings.map((w) => w.message),
      metadata,
    }
  }

  /**
   * Detect if content is bullet-point or prose format
   */
  private _detectFormat(content: string): 'bullet' | 'prose' | 'mixed' {
    const lines = content.split('\n').filter((l) => l.trim().length > 0)
    const bulletLines = lines.filter((l) => /^[\s]*[•\-\*]/.test(l))
    const bulletRatio = bulletLines.length / Math.max(lines.length, 1)

    if (bulletRatio > 0.7) return 'bullet'
    if (bulletRatio > 0.3) return 'mixed'
    return 'prose'
  }

  /**
   * Count bullet points in content
   */
  private _countBullets(content: string): number {
    const bulletRegex = /^[\s]*[•\-\*]/gm
    const matches = content.match(bulletRegex)
    return matches ? matches.length : 0
  }

  /**
   * Extract metadata about the content
   */
  private _getMetadata(content: string): ValidationResult['metadata'] {
    const bulletCount = this._countBullets(content)
    const format = this._detectFormat(content)
    const length = content.trim().length
    // Rough estimate: 200 chars per minute reading time
    const estimatedReadingTime = Math.ceil(length / 200)

    return {
      length,
      bulletPoints: bulletCount,
      format,
      estimatedReadingTime,
    }
  }

  /**
   * Get validation rules for a specific section and language
   */
  static getRulesForSection(
    section: 'experience' | 'project' | 'post' | 'profile' | 'publication',
    language: LanguageCode = 'en',
  ): ValidationRules {
    const rules: Record<string, ValidationRules> = {
      experience: {
        minLength: 100,
        maxLength: 300,
        requiredFormat: 'bullet',
        bulletPointCount: { min: 2, max: 4 },
        forbiddenPhrases: DEFAULT_FORBIDDEN_PHRASES[language],
      },
      project: {
        minLength: 80,
        maxLength: 250,
        requiredFormat: 'bullet',
        bulletPointCount: { min: 1, max: 3 },
        forbiddenPhrases: DEFAULT_FORBIDDEN_PHRASES[language],
      },
      post: {
        minLength: 40,
        maxLength: 150,
        requiredFormat: 'prose',
        forbiddenPhrases: DEFAULT_FORBIDDEN_PHRASES[language],
      },
      profile: {
        minLength: 80,
        maxLength: 350,
        requiredFormat: 'prose',
        forbiddenPhrases: [
          ...(DEFAULT_FORBIDDEN_PHRASES[language] || []),
          'i am',
          'i have',
          'i think',
        ],
      },
      publication: {
        minLength: 50,
        maxLength: 200,
        requiredFormat: 'prose',
        forbiddenPhrases: DEFAULT_FORBIDDEN_PHRASES[language],
      },
    }

    return rules[section] || {}
  }
}

export default AIValidator
