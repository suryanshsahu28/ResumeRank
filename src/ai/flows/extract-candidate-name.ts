import { ai } from '@/ai/genkit';
import { z } from 'zod';

export const ExtractCandidateNameInputSchema = z.object({
  resumeText: z.string().describe('The resume text content to extract the candidate name from'),
});

export const ExtractCandidateNameOutputSchema = z.object({
  candidateName: z.string().nullable().describe('The candidate\'s full name extracted from the resume, or null if not found'),
});

export type ExtractCandidateNameInput = z.infer<typeof ExtractCandidateNameInputSchema>;
export type ExtractCandidateNameOutput = z.infer<typeof ExtractCandidateNameOutputSchema>;

export async function extractCandidateName(input: ExtractCandidateNameInput): Promise<ExtractCandidateNameOutput> {
  return extractCandidateNameFlow(input);
}

const prompt = ai.definePrompt({
  name: 'extractCandidateNamePrompt',
  input: { schema: ExtractCandidateNameInputSchema },
  output: { schema: ExtractCandidateNameOutputSchema },
  prompt: `You are an expert at extracting candidate names from resume text.

Analyze the following resume text and extract the candidate's full name.

Rules:
1. Look for the candidate's name at the beginning of the resume (usually in the header section)
2. The name is typically the largest text or prominently displayed
3. Return the full name (first name + last name) if found
4. If no clear name is found, return null
5. Do not include titles like "Mr.", "Ms.", "Dr." etc.
6. Do not include job titles or company names
7. Return only the name, nothing else

Resume Text:
{{{resumeText}}}

Extract the candidate's name:`,
});

const extractCandidateNameFlow = ai.defineFlow(
  {
    name: 'extractCandidateNameFlow',
    inputSchema: ExtractCandidateNameInputSchema,
    outputSchema: ExtractCandidateNameOutputSchema,
  },
  async (input: ExtractCandidateNameInput) => {
    const { output } = await prompt(input);
    return {
        candidateName: output?.candidateName ? output.candidateName.toUpperCase() : null
    };
  }
);
