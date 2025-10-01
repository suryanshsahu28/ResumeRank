import type {
  RankResumesOutput,
  ParseResumeSkillsOutput,
  MatchKeywordsToResumeOutput,
} from '@/app/actions';
import type { z } from 'zod';
import type { ProcessResumeV2OutputSchema, ScorePackV2 } from '@/ai/flows/process-resume-v2';

export type Resume = {
  filename: string;
  content: string;
  url?: string;
  candidateName?: string | null;
};

export type CandidateStatus = 'none' | 'shortlisted' | 'rejected';

// Sharing types
export type ShareRole = 'view' | 'edit';

export interface Collaborator {
  role: ShareRole;
  addedBy: string;
  addedAt: string; // ISO string
  email?: string; // Email for display purposes
}

export interface SharedReport {
  ownerId: string;
  reportId: string;
  role: ShareRole;
  addedAt: string; // ISO string
  email?: string; // Email for display purposes
}

export type AnalysisDetails = {
  [key: string]: {
    skills: ParseResumeSkillsOutput;
    keywords: MatchKeywordsToResumeOutput;
    candidateName?: string | null;
  };
};

export type AnalysisResult = {
  rankedResumes: RankResumesOutput;
  resumes: Resume[];
  details: AnalysisDetails;
  statuses: Record<string, CandidateStatus>;
  jobRole?: string | null;
  jobDescriptionSummary?: string | null;
  jobDescriptionFile?: {
    filename: string;
    url: string;
  };
};

export interface MetricWeights {
  skills: number;
  experience: number;
  education: number;
}


// V2 Pipeline Types
export type BatchStatus = 'running' | 'paused' | 'cancelled' | 'complete';
export type ResumeV2Status =
  | 'pending' | 'running' | 'complete' | 'failed'
  | 'timeout' | 'cancelled' | 'paused' | 'skipped_duplicate';

export interface BatchDoc {
  id: string;
  batchId: string;
  userId: string;
  status: BatchStatus;
  jobDescription: string;
  total: number;
  completed: number;
  failed: number;
  cancelledCount: number;
  skippedDuplicates: number;
  createdAt: string; // ISO string
  updatedAt: string; // ISO string
}

export type Batch = BatchDoc; // Alias for UI components

// The full JSON output from the Gemini call
export type ResumeJSONV2 = z.infer<typeof ProcessResumeV2OutputSchema>;

export interface ResumeDoc {
  id: string;
  resumeId: string;
  batchId: string;
  fileUrl: string; // Downloadable URL (https://...)
  fileHash: string | null;
  status: ResumeV2Status;
  startTime: string | null; // ISO string
  lastUpdatedAt: string; // ISO string
  workerId: string | null;
  retryCount: number;
  maxRetries: number;
  result: {
    json: ResumeJSONV2 | null;
    description: string | null;
    scores: typeof ScorePackV2 | null;
    schemaVersion: number;
    modelVersion: string;
  } | null;
  error: { code: string; message: string } | null;
}

export type ResumeV2 = ResumeDoc; // Alias for UI components