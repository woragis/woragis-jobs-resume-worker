import { assemblePayload } from '../src/payload-assembler'

describe('payload assembler', () => {
  it('truncates and maps fields', () => {
    const job: any = {
      userName: 'Alice',
      userEmail: 'alice@example.com',
      jobDescription: 'x'.repeat(5000),
      metadata: { note: 'y'.repeat(2000) },
    }

    const enriched = {
      experiences: [{ title: 'Eng', desc: 'd'.repeat(2000) }],
      projects: [{ name: 'P', summary: 's'.repeat(2000) }],
    }

    const out = assemblePayload(job, enriched, { name: 'Alice' })

    expect(out.jobDescription.length).toBeLessThanOrEqual(2000)
    expect(out.experiences[0].desc.length).toBeLessThanOrEqual(800)
    expect(out.projects[0].summary.length).toBeLessThanOrEqual(800)
    expect(out.metadata.note.length).toBeLessThanOrEqual(1000)
  })
})
