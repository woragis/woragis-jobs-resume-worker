function truncate(str: any, max: number): string {
  if (str === null || str === undefined) return ''
  const s = String(str)
  if (s.length <= max) return s
  return s.slice(0, max)
}

function mapEntries(entries: any[], maxPerEntry: number, maxEntries = 50) {
  if (!Array.isArray(entries)) return []
  return entries.slice(0, maxEntries).map((e) => {
    if (typeof e === 'string') return truncate(e, maxPerEntry)
    const obj: any = {}
    for (const k of Object.keys(e)) {
      const v = e[k]
      if (typeof v === 'string') obj[k] = truncate(v, maxPerEntry)
      else obj[k] = v
    }
    return obj
  })
}

/**
 * Choose between AI-enhanced and raw content
 * Prefer enhanced version if validated and successful
 */
function selectOptimalContent(item: any, fieldName: string): string {
  const optimizedField = `${fieldName}_optimized`

  // If AI-enhanced version exists and was validated successfully, use it
  if (
    item._ai?.validated &&
    item._ai?.status === 'success' &&
    item[optimizedField]
  ) {
    return truncate(
      item[optimizedField],
      fieldName === 'description' ? 800 : 500,
    )
  }

  // Otherwise use original
  return truncate(
    item[fieldName] || '',
    fieldName === 'description' ? 800 : 500,
  )
}

export function assemblePayload(
  job: any,
  enrichedData: any,
  userProfile?: any,
) {
  const payload: any = {}

  payload.profile = {
    name: truncate(
      (userProfile && userProfile.name) || job.userName || '',
      200,
    ),
    email: truncate(
      (userProfile && userProfile.email) || job.userEmail || '',
      200,
    ),
    phone: truncate((userProfile && userProfile.phone) || '', 50),
    location: truncate((userProfile && userProfile.location) || '', 100),
  }

  // sanitize email to satisfy JSON schema "format: email"
  try {
    const emailVal = payload.profile && payload.profile.email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailVal || !emailRegex.test(String(emailVal))) {
      payload.profile.email = 'no-reply@example.com'
    }
  } catch (e) {
    payload.profile.email = 'no-reply@example.com'
  }

  payload.jobDescription = truncate(job.jobDescription || '', 2000)

  // Experiences, projects, posts, writings, designs
  // Use AI-enhanced content if available and validated, otherwise use raw
  payload.experiences = ((enrichedData && enrichedData.experiences) || []).map(
    (e: any) => ({
      ...e,
      description: selectOptimalContent(e, 'description'),
      _aiEnhanced: e._ai?.validated && e._ai?.status === 'success',
      _ai: undefined, // Don't include validation metadata in payload
    }),
  )

  payload.projects = ((enrichedData && enrichedData.projects) || []).map(
    (p: any) => ({
      ...p,
      description: selectOptimalContent(p, 'description'),
      _aiEnhanced: p._ai?.validated && p._ai?.status === 'success',
      _ai: undefined,
    }),
  )

  payload.posts = ((enrichedData && enrichedData.posts) || []).map(
    (post: any) => ({
      ...post,
      excerpt: selectOptimalContent(post, 'excerpt'),
      _aiEnhanced: post._ai?.validated && post._ai?.status === 'success',
      _ai: undefined,
    }),
  )

  payload.technicalWritings = (
    (enrichedData && enrichedData.technicalWritings) ||
    []
  ).map((w: any) => ({
    ...w,
    description: selectOptimalContent(w, 'description'),
    _aiEnhanced: w._ai?.validated && w._ai?.status === 'success',
    _ai: undefined,
  }))

  payload.systemDesigns = (
    (enrichedData && enrichedData.systemDesigns) ||
    []
  ).map((d: any) => ({
    ...d,
    description: selectOptimalContent(d, 'description'),
    _aiEnhanced: d._ai?.validated && d._ai?.status === 'success',
    _ai: undefined,
  }))

  // Allow arbitrary metadata but truncate string values
  const meta: any = {}
  if (job.metadata && typeof job.metadata === 'object') {
    for (const k of Object.keys(job.metadata)) {
      const v = job.metadata[k]
      meta[k] = typeof v === 'string' ? truncate(v, 1000) : v
    }
  }

  // Add AI enrichment metadata
  if (enrichedData && enrichedData.enhancementStats) {
    meta.ai_enriched_sections =
      enrichedData.enhancementStats.aiSectionsEnabled || []
    meta.ai_tokens_used = enrichedData.enhancementStats.totalTokensUsed || 0
    meta.ai_enhancement_duration_ms =
      enrichedData.enhancementStats.enhancementDuration || 0
  }

  payload.metadata = meta

  return payload
}

export default assemblePayload
