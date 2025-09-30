import { ai } from '@/ai/genkit';
import { z } from 'zod';

export const ExtractJobInfoInputSchema = z.object({
  jobDescription: z.string().describe('The job description text to extract information from'),
});

export const ExtractJobInfoOutputSchema = z.object({
  jobRole: z.string().nullable().describe('The job role/title extracted from the job description, or null if not found'),
  summary: z.string().describe('A concise 100-word summary of the job description highlighting key requirements, responsibilities, and qualifications'),
});

export type ExtractJobInfoInput = z.infer<typeof ExtractJobInfoInputSchema>;
export type ExtractJobInfoOutput = z.infer<typeof ExtractJobInfoOutputSchema>;

export async function extractJobInfo(input: ExtractJobInfoInput): Promise<ExtractJobInfoOutput> {
  return extractJobInfoFlow(input);
}

const prompt = ai.definePrompt({
  name: 'extractJobInfoPrompt',
  input: { schema: ExtractJobInfoInputSchema },
  output: { schema: ExtractJobInfoOutputSchema },
  prompt: `You are an expert at extracting job information from job descriptions.
Extract the job role/title and create a concise summary from the following job description.

Requirements:
1. Extract the most prominent job role or title. If no clear role is identifiable, return null.
2. Create a brief, informative summary that captures:
   - Key role and responsibilities
   - Essential qualifications and requirements
   - Important skills and experience needed
   - Company/team context if relevant
3. Keep the summary exactly 100 words and make it easy to understand at a glance.

Job Description:
{{{jobDescription}}}

Provide the output in the specified JSON format.`,
});

export const extractJobInfoFlow = ai.defineFlow(
  {
    name: 'extractJobInfoFlow',
    inputSchema: ExtractJobInfoInputSchema,
    outputSchema: ExtractJobInfoOutputSchema,
  },
  async (input: ExtractJobInfoInput) => {
    const { output } = await prompt(input);
    return output!;
  }
);
