/**
 * SQL Migration for Resume Jobs and Resumes tables
 * Run this migration to set up the necessary tables for resume generation
 */

-- Create resume_jobs table
CREATE TABLE IF NOT EXISTS resume_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  job_description TEXT NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'cancelled')),
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_user_id FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Create resumes table
CREATE TABLE IF NOT EXISTS resumes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL,
  user_id UUID NOT NULL,
  file_path VARCHAR(500) NOT NULL,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_job_id FOREIGN KEY (job_id) REFERENCES resume_jobs(id) ON DELETE CASCADE,
  CONSTRAINT fk_user_id FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_resume_jobs_user_id ON resume_jobs(user_id);
CREATE INDEX IF NOT EXISTS idx_resume_jobs_status ON resume_jobs(status);
CREATE INDEX IF NOT EXISTS idx_resume_jobs_created_at ON resume_jobs(created_at);
CREATE INDEX IF NOT EXISTS idx_resumes_user_id ON resumes(user_id);
CREATE INDEX IF NOT EXISTS idx_resumes_job_id ON resumes(job_id);
CREATE INDEX IF NOT EXISTS idx_resumes_created_at ON resumes(created_at);

-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_resume_jobs_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION update_resumes_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create triggers for updated_at
DROP TRIGGER IF EXISTS trigger_update_resume_jobs_updated_at ON resume_jobs;
CREATE TRIGGER trigger_update_resume_jobs_updated_at
BEFORE UPDATE ON resume_jobs
FOR EACH ROW
EXECUTE FUNCTION update_resume_jobs_updated_at();

DROP TRIGGER IF EXISTS trigger_update_resumes_updated_at ON resumes;
CREATE TRIGGER trigger_update_resumes_updated_at
BEFORE UPDATE ON resumes
FOR EACH ROW
EXECUTE FUNCTION update_resumes_updated_at();
