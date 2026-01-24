import logger from './logger'
import AIValidator, { LanguageCode, ValidationRules } from './ai-validator'
import AIServiceClient, { ContentGenerationRequest } from './ai-service-client'
import { withRetry } from './retry'

export type FocusArea =
  | 'impact'
  | 'technical'
  | 'leadership'
  | 'growth'
  | 'learning'
  | 'business'
  | 'innovation'
  | 'metrics'

export interface AIEnhancerConfig {
  jobDescription: string
  targetRole?: string
  targetIndustry?: string
  yearsRequired?: number
  skillKeywords: string[]
  language: LanguageCode

  // Fallback behavior
  fallbackOnAIFailure: 'raw' | 'truncate' | 'skip'
  fallbackOnValidationFailure: 'raw' | 'truncate' | 'skip'
}

export interface SectionEnhancerConfig {
  enable: boolean
  format: 'bullet' | 'prose' | 'mixed'
  minLength: number
  maxLength: number
  focusOn: FocusArea[]
  bulletPoints?: number
  includeMetrics?: boolean
  tone?: 'formal' | 'casual' | 'technical' | 'business'
}

export interface EnhancementMetadata {
  status: 'success' | 'failed' | 'skipped'
  validated: boolean
  length_original: number
  length_optimized: number
  format: string
  focusOn: string
  tokensUsed: number
  model: string
  language: LanguageCode
  timestamp: Date
  error?: string
}

export interface EnhancedItem {
  [key: string]: any
  _ai?: EnhancementMetadata
}

/**
 * AIEnricher handles content enhancement via AI service
 */
export class AIEnricher {
  constructor(
    private aiService: AIServiceClient,
    private validator: AIValidator,
  ) {}

  /**
   * Build AI instruction prompt for a section
   */
  private buildInstruction(
    section: string,
    config: SectionEnhancerConfig,
    enhancerConfig: AIEnhancerConfig,
  ): string {
    const { targetRole, skillKeywords, language } = enhancerConfig
    const {
      format,
      minLength,
      maxLength,
      bulletPoints,
      includeMetrics,
      focusOn,
    } = config

    const focusDesc = focusOn.join(' and ')
    const skillsStr = skillKeywords.slice(0, 5).join(', ')

    const instructions: Record<LanguageCode, Record<string, string>> = {
      en: {
        experience: `Rewrite as ${bulletPoints || 2}-${bulletPoints ? bulletPoints + 1 : 3} bullet points emphasizing ${focusDesc}. Target role: ${targetRole || 'a professional position'}. Key skills: ${skillsStr}. Format: bullet points, ${minLength}-${maxLength} chars total, no "I" statements, use active verbs.${includeMetrics ? ' Include metrics/outcomes.' : ''}`,

        project: `Rewrite as ${bulletPoints || 1}-${bulletPoints ? bulletPoints + 1 : 2} bullet point(s) highlighting technical complexity, business impact, and your role. Target role: ${targetRole || 'your position'}. Format: bullet points, ${minLength}-${maxLength} chars total.${includeMetrics ? ' Include specific metrics or outcomes.' : ''}`,

        post: `Write a ${minLength}-${maxLength} character summary of this publication/post. Highlight the ${focusDesc} relevant to a ${targetRole || 'professional'}. Format: prose, no bullet points.`,

        profile: `Write a professional summary for a ${targetRole || 'resume'}. Highlight core competencies and key achievements. Focus: ${focusDesc}. Format: prose, ${minLength}-${maxLength} chars, no "I" statements, third-person or benefit-focused.`,

        publication: `Write a ${minLength}-${maxLength} character description of this work. Highlight technical insights or business value relevant to a ${targetRole || 'professional'}. Format: prose.`,
      },

      'pt-BR': {
        experience: `Reescreva como ${bulletPoints || 2}-${bulletPoints ? bulletPoints + 1 : 3} pontos destacando ${focusDesc}. Cargo alvo: ${targetRole || 'uma posição profissional'}. Competências-chave: ${skillsStr}. Formato: pontos com marcadores, ${minLength}-${maxLength} caracteres no total, sem "eu", use verbos no ativo.${includeMetrics ? ' Inclua métricas/resultados.' : ''}`,

        project: `Reescreva como ${bulletPoints || 1}-${bulletPoints ? bulletPoints + 1 : 2} ponto(s) destacando complexidade técnica, impacto nos negócios e seu papel. Cargo alvo: ${targetRole || 'sua posição'}. Formato: pontos com marcadores, ${minLength}-${maxLength} caracteres.${includeMetrics ? ' Inclua métricas ou resultados específicos.' : ''}`,

        post: `Escreva um resumo de ${minLength}-${maxLength} caracteres desta publicação/post. Destaque o ${focusDesc} relevante para um ${targetRole || 'profissional'}. Formato: prosa, sem marcadores.`,

        profile: `Escreva um resumo profissional para um ${targetRole || 'currículo'}. Destaque competências principais e realizações. Foco: ${focusDesc}. Formato: prosa, ${minLength}-${maxLength} caracteres, sem "eu", terceira pessoa ou focado em benefícios.`,

        publication: `Escreva uma descrição de ${minLength}-${maxLength} caracteres deste trabalho. Destaque insights técnicos ou valor empresarial relevante para um ${targetRole || 'profissional'}. Formato: prosa.`,
      },

      es: {
        experience: `Reescribe como ${bulletPoints || 2}-${bulletPoints ? bulletPoints + 1 : 3} puntos destacando ${focusDesc}. Rol objetivo: ${targetRole || 'una posición profesional'}. Habilidades clave: ${skillsStr}. Formato: viñetas, ${minLength}-${maxLength} caracteres en total, sin "yo", usa verbos en voz activa.${includeMetrics ? ' Incluya métricas/resultados.' : ''}`,

        project: `Reescribe como ${bulletPoints || 1}-${bulletPoints ? bulletPoints + 1 : 2} viñeta(s) destacando complejidad técnica, impacto empresarial y su rol. Rol objetivo: ${targetRole || 'su posición'}. Formato: viñetas, ${minLength}-${maxLength} caracteres.${includeMetrics ? ' Incluya métricas o resultados específicos.' : ''}`,

        post: `Escriba un resumen de ${minLength}-${maxLength} caracteres de esta publicación. Destaque el ${focusDesc} relevante para un ${targetRole || 'profesional'}. Formato: prosa, sin viñetas.`,

        profile: `Escriba un resumen profesional para un ${targetRole || 'currículum'}. Destaque competencias principales y logros. Enfoque: ${focusDesc}. Formato: prosa, ${minLength}-${maxLength} caracteres, sin "yo", tercera persona o enfocado en beneficios.`,

        publication: `Escriba una descripción de ${minLength}-${maxLength} caracteres de este trabajo. Destaque ideas técnicas o valor empresarial relevante para un ${targetRole || 'profesional'}. Formato: prosa.`,
      },

      fr: {
        experience: `Réécrivez en ${bulletPoints || 2}-${bulletPoints ? bulletPoints + 1 : 3} points mettant l'accent sur ${focusDesc}. Rôle cible: ${targetRole || 'une position professionnelle'}. Compétences clés: ${skillsStr}. Format: points à puces, ${minLength}-${maxLength} caractères au total, pas de "je", utilisez des verbes à la voix active.${includeMetrics ? ' Incluez des métriques/résultats.' : ''}`,

        project: `Réécrivez en ${bulletPoints || 1}-${bulletPoints ? bulletPoints + 1 : 2} point(s) mettant l'accent sur la complexité technique, l'impact commercial et votre rôle. Rôle cible: ${targetRole || 'votre position'}. Format: points à puces, ${minLength}-${maxLength} caractères.${includeMetrics ? ' Incluez des métriques ou résultats spécifiques.' : ''}`,

        post: `Écrivez un résumé de ${minLength}-${maxLength} caractères de cette publication. Mettez en évidence le ${focusDesc} pertinent pour un ${targetRole || 'professionnel'}. Format: prose, sans puces.`,

        profile: `Écrivez un résumé professionnel pour un ${targetRole || 'CV'}}. Mettez en évidence les compétences principales et les réalisations. Accent: ${focusDesc}. Format: prose, ${minLength}-${maxLength} caractères, pas de "je", troisième personne ou axé sur les avantages.`,

        publication: `Écrivez une description de ${minLength}-${maxLength} caractères de ce travail. Mettez en évidence les idées techniques ou la valeur commerciale pertinente pour un ${targetRole || 'professionnel'}. Format: prose.`,
      },
    }

    return (
      instructions[language]?.[section] || instructions['en'][section] || ''
    )
  }

  /**
   * Map section name to AI service content type
   */
  private mapSectionToType(
    section: string,
  ): 'profile' | 'experience' | 'skills' | 'summary' {
    const typeMap: Record<
      string,
      'profile' | 'experience' | 'skills' | 'summary'
    > = {
      experience: 'experience',
      experiences: 'experience',
      project: 'experience',
      projects: 'experience',
      post: 'summary',
      posts: 'summary',
      publication: 'summary',
      technicalWritings: 'summary',
      systemDesigns: 'summary',
      profile: 'profile',
    }
    return typeMap[section] || 'experience'
  }

  /**
   * Enhance a single item (experience, project, etc.)
   */
  async enhanceItem(
    item: any,
    content: string,
    section: string,
    config: SectionEnhancerConfig,
    enhancerConfig: AIEnhancerConfig,
  ): Promise<EnhancedItem> {
    if (!config.enable) {
      logger.debug(
        { section, itemId: item.id },
        'Section enhancement disabled, skipping',
      )
      return item
    }

    try {
      const instruction = this.buildInstruction(section, config, enhancerConfig)

      logger.debug(
        {
          section,
          itemId: item.id,
          contentLength: content.length,
          language: enhancerConfig.language,
        },
        'Requesting AI enhancement',
      )

      // Call AI service with retry
      const aiType = this.mapSectionToType(section)
      const response = await withRetry(
        () =>
          this.aiService.generateContent({
            type: aiType,
            jobDescription: enhancerConfig.jobDescription,
            userContext: {
              experience: content,
              skills: enhancerConfig.skillKeywords,
            },
          } as ContentGenerationRequest),
        `ai_enhance_${section}`,
      )

      // Validate response
      const validationRules = AIValidator.getRulesForSection(
        section as any,
        enhancerConfig.language,
      )
      validationRules.minLength = config.minLength
      validationRules.maxLength = config.maxLength
      validationRules.requiredFormat = config.format as any
      if (config.bulletPoints) {
        // Allow more flexible bullet point counts since AI may generate varying amounts
        validationRules.bulletPointCount = {
          min: 1,
          max: 50, // Very lenient upper bound to allow AI flexibility
        }
      }

      const validation = this.validator.validate(
        response.content,
        validationRules,
      )

      logger.info(
        {
          section,
          itemId: item.id,
          validated: validation.isValid,
          length: response.content.length,
          tokensUsed: response.tokens_used,
          language: enhancerConfig.language,
        },
        'AI enhancement completed',
      )

      if (validation.isValid) {
        return {
          ...item,
          [`${section === 'post' ? 'excerpt' : 'description'}_optimized`]:
            response.content,
          _ai: {
            status: 'success',
            validated: true,
            length_original: content.length,
            length_optimized: response.content.length,
            format: config.format,
            focusOn: config.focusOn.join(','),
            tokensUsed: response.tokens_used,
            model: response.model,
            language: enhancerConfig.language,
            timestamp: new Date(),
          },
        }
      } else {
        // Validation failed
        logger.warn(
          {
            section,
            itemId: item.id,
            errors: validation.errors.map((e) => e.message),
            fallback: enhancerConfig.fallbackOnValidationFailure,
          },
          'AI response validation failed',
        )

        if (enhancerConfig.fallbackOnValidationFailure === 'skip') {
          return item
        }

        // Use truncated or raw fallback
        const fallbackContent =
          enhancerConfig.fallbackOnValidationFailure === 'truncate'
            ? response.content.substring(0, config.maxLength)
            : content

        return {
          ...item,
          [`${section === 'post' ? 'excerpt' : 'description'}_optimized`]:
            fallbackContent,
          _ai: {
            status: 'failed',
            validated: false,
            length_original: content.length,
            length_optimized: fallbackContent.length,
            format: config.format,
            focusOn: config.focusOn.join(','),
            tokensUsed: response.tokens_used,
            model: response.model,
            language: enhancerConfig.language,
            timestamp: new Date(),
            error: validation.errors[0]?.message || 'Validation failed',
          },
        }
      }
    } catch (err) {
      logger.warn(
        {
          section,
          itemId: item.id,
          error: String(err),
          fallback: enhancerConfig.fallbackOnAIFailure,
        },
        'AI enhancement failed, using fallback',
      )

      return {
        ...item,
        _ai: {
          status: 'failed',
          validated: false,
          length_original: content.length,
          length_optimized: 0,
          format: config.format,
          focusOn: config.focusOn.join(','),
          tokensUsed: 0,
          model: '',
          language: enhancerConfig.language,
          timestamp: new Date(),
          error: String(err),
        },
      }
    }
  }

  /**
   * Enhance a batch of items in parallel
   */
  async enhanceItems(
    items: any[],
    contentExtractor: (item: any) => string,
    section: string,
    config: SectionEnhancerConfig,
    enhancerConfig: AIEnhancerConfig,
  ): Promise<EnhancedItem[]> {
    if (!config.enable || items.length === 0) {
      return items
    }

    logger.info(
      { section, itemCount: items.length, language: enhancerConfig.language },
      'Starting batch enhancement',
    )

    const results = await Promise.all(
      items.map((item) =>
        this.enhanceItem(
          item,
          contentExtractor(item),
          section,
          config,
          enhancerConfig,
        ),
      ),
    )

    const successCount = results.filter(
      (r) => r._ai?.status === 'success',
    ).length
    logger.info(
      {
        section,
        totalItems: items.length,
        successfulEnhancements: successCount,
      },
      'Batch enhancement completed',
    )

    return results
  }
}

export default AIEnricher
