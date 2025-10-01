

'use server';

import {
  rankResumes as rankResumesFlow,
  RankResumesInput,
  RankResumesOutput,
} from '@/ai/flows/rank-resumes';
import {
  parseResumeSkills as parseResumeSkillsFlow,
  ParseResumeSkillsInput,
  ParseResumeSkillsOutput,
} from '@/ai/flows/parse-resume-skills';
import {
  matchKeywordsToResume as matchKeywordsToResumeFlow,
  MatchKeywordsToResumeInput,
  MatchKeywordsToResumeOutput,
} from '@/ai/flows/match-keywords-to-resume';
import {
  extractCandidateName as extractCandidateNameFlow,
  ExtractCandidateNameInput,
  ExtractCandidateNameOutput,
} from '@/ai/flows/extract-candidate-name';
import {
  extractJobInfo as extractJobInfoFlow,
  ExtractJobInfoInput,
  ExtractJobInfoOutput,
} from '@/ai/flows/extract-job-info';
import {db, storage} from '@/lib/firebase';
import {
  collection,
  addDoc,
  serverTimestamp,
  getDocs,
  query,
  orderBy,
  limit,
  doc,
  updateDoc,
  writeBatch,
  getDoc,
  deleteDoc,
  arrayUnion,
  setDoc,
} from 'firebase/firestore';
import {ref, uploadBytes, getDownloadURL, deleteObject, listAll} from 'firebase/storage';

import type {
  Resume,
  MetricWeights,
  CandidateStatus,
  AnalysisDetails,
} from '@/lib/types';
import type { Report } from '@/app/page';

export type {
  RankResumesOutput,
  ParseResumeSkillsOutput,
  MatchKeywordsToResumeOutput,
  Report
};

async function retry<T>(fn: () => Promise<T>): Promise<T> {
  let lastError: Error | undefined;
  for (let i = 0; i < 5; i++) {
    try {
      return await fn();
    } catch (e: any) {
      lastError = e;
      if (e.message?.includes('429') || e.message?.includes('503')) {
         if (i < 4) { 
          const delay = 2000 * Math.pow(2, i);
          console.log(`Attempt ${i + 1} failed with ${e.message}. Retrying in ${delay}ms...`);
          await new Promise(res => setTimeout(res, delay));
        }
      } else {
        throw e;
      }
    }
  }
  throw lastError;
}


export async function analyzeSingleResumeAction(
  jobDescription: string,
  resume: Resume, // must contain filename (+ content if your flows need text)
  weights: MetricWeights,
  userId: string,
  file: { filename: string; data: ArrayBuffer },
  opts?: { reportId?: string; jobDescriptionFile?: { filename: string; data: ArrayBuffer } } // optional existing report to append and JD file
): Promise<ReadableStream<any>> {
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (obj: object) => controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n'));

      try {
        // ---- validations
        if (!userId) throw new Error('Unauthenticated');
        if (!jobDescription?.trim()) throw new Error('Job description cannot be empty.');
        if (!resume?.filename) throw new Error('Invalid resume payload.');
        if (!file?.data || !file?.filename) throw new Error('Resume file is missing.');

        send({ type: 'status', message: 'Initializing report...' });

        // ---- extract job role and summary from job description
        send({ type: 'status', message: 'Extracting job information...' });
        const jobInfoResult = await retry(() =>
          extractJobInfoFlow({ jobDescription })
        );

        // ---- ensure a report (create if not provided)
        let reportRef;
        let jobDescriptionFileUrl: string | undefined;
        
        if (opts?.reportId) {
          reportRef = doc(db, 'users', userId, 'analysisReports', opts.reportId);
          const snap = await getDoc(reportRef);
          if (!snap.exists()) throw new Error('Report not found for given reportId.');
        } else {
          // Create report first to get the ID
          const initial = {
            jobDescription,
            jobRole: jobInfoResult.jobRole,
            jobDescriptionSummary: jobInfoResult.summary,
            rankedResumes: [],
            statuses: {},
            createdAt: serverTimestamp(),
            resumes: [] as Array<{ filename: string; url: string }>
          };
          reportRef = await addDoc(collection(db, 'users', userId, 'analysisReports'), initial);
          send({ type: 'reportId', id: reportRef.id });
          
          // Upload JD file if provided (after we have the report ID)
          if (opts?.jobDescriptionFile) {
            send({ type: 'status', message: 'Uploading job description file...' });
            const jdStorageRef = ref(storage, `resumehire/${userId}/${reportRef.id}/jd/${opts.jobDescriptionFile.filename}`);
            await uploadBytes(jdStorageRef, opts.jobDescriptionFile.data);
            jobDescriptionFileUrl = await getDownloadURL(jdStorageRef);
            
            console.log('JD file uploaded:', {
              filename: opts.jobDescriptionFile.filename,
              url: jobDescriptionFileUrl,
              reportId: reportRef.id
            });
            
            // Update the report with JD file info
            await updateDoc(reportRef, {
              jobDescriptionFile: {
                filename: opts.jobDescriptionFile.filename,
                url: jobDescriptionFileUrl
              }
            });
            
            console.log('JD file info saved to report');
          }
        }
        console.log(weights)
        // ---- upload ONLY this resume file
        send({ type: 'status', message: `Uploading ${file.filename}...` });
        const storageRef = ref(storage, `resumehire/${userId}/${reportRef.id}/resume/${file.filename}`);
        await uploadBytes(storageRef, file.data);
        const downloadURL = await getDownloadURL(storageRef);

        // ---- upsert this resume entry into report.resumes
        const reportSnap1 = await getDoc(reportRef);
        const current = reportSnap1.data() || {};
        const existingResumes: Array<{ filename: string; url: string }> = current.resumes ?? [];
        const withoutThis = existingResumes.filter(r => r.filename !== file.filename);
        const finalResumes = [...withoutThis, { filename: file.filename, url: downloadURL }];
        await updateDoc(reportRef, { resumes: finalResumes });
        send({ type: 'resumes', resumes: finalResumes });

        // ---- analysis (skills + keywords + candidate name) for THIS resume only
        send({ type: 'status', message: `Parsing skills for ${resume.filename}...` });
        const skills = await retry(() =>
          parseResumeSkillsFlow({ resumeText: resume.content }) // if your flow takes text
        );

        send({ type: 'status', message: `Matching keywords for ${resume.filename}...` });
        const keywords = await retry(() =>
          matchKeywordsToResumeFlow({ resumeText: resume.content, jobDescription })
        );

        send({ type: 'status', message: `Extracting candidate name for ${resume.filename}...` });
        const nameResult = await retry(() =>
          extractCandidateNameFlow({ resumeText: resume.content })
        );

        // ---- write details/<filename>
        send({ type: 'status', message: 'Saving analysis details...' });
        const batch = writeBatch(db);
        const detailRef = doc(db, 'users', userId, 'analysisReports', reportRef.id, 'details', resume.filename);
        const detailData = { 
          skills, 
          keywords, 
          candidateName: nameResult.candidateName || undefined
        } satisfies AnalysisDetails[string];
        batch.set(detailRef, detailData);
        await batch.commit();

        send({ type: 'detail', filename: resume.filename, detail: detailData });

        // ---- score/rank this single resume (call your existing rank flow with single-element array)
        send({ type: 'status', message: 'Scoring resume...' });
        const rankedSingle = await retry(() =>
          rankResumesFlow({
            resumes: [resume],
            jobDescription,
            weights:weights
          })
        );
        const singleResult = rankedSingle[0]; // score for this resume

        // ---- merge into report.rankedResumes and statuses; keep sorted desc by score
        const reportSnap2 = await getDoc(reportRef);
        const rdata = reportSnap2.data() || {};
        const prevRanked: Array<{ filename: string; score: number; [k: string]: any }> = rdata.rankedResumes ?? [];
        const filtered = prevRanked.filter(r => r.filename !== resume.filename);
        const merged = [...filtered, singleResult].sort((a, b) => b.score - a.score);

        // statuses: add default for new resume, keep existing others
        const prevStatuses: Record<string, CandidateStatus> = rdata.statuses ?? {};
        const statuses = { ...prevStatuses, [resume.filename]: prevStatuses[resume.filename] ?? 'none' };

        await updateDoc(reportRef, {
          rankedResumes: merged,
          statuses
        });

        send({ type: 'rank', filename: resume.filename, score: singleResult.score });

        // ---- finalize (return a light final snapshot so UI can refresh)
        const finalSnap = await getDoc(reportRef);
        const fd = finalSnap.data();

        // Step 1: Get all existing details from the subcollection
        const detailsCollectionRef = collection(db, 'users', userId, 'analysisReports', reportRef.id, 'details');
        const detailsSnapshot = await getDocs(detailsCollectionRef);
        const existingDetails = detailsSnapshot.docs.reduce((acc, detailDoc) => {
          acc[detailDoc.id] = detailDoc.data() as AnalysisDetails[string];
          return acc;
        }, {} as AnalysisDetails);

        // Step 2: Merge current resume's details with existing details
        const allDetails = {
          ...existingDetails,
          [resume.filename]: detailData
        };

        const finalReport: Report = {
          id: reportRef.id,
          jobDescription: fd?.jobDescription ?? jobDescription,
          jobRole: fd?.jobRole ?? jobInfoResult.jobRole,
          jobDescriptionSummary: fd?.jobDescriptionSummary ?? jobInfoResult.summary,
          jobDescriptionFile: fd?.jobDescriptionFile, // Include JD file info
          rankedResumes: fd?.rankedResumes ?? merged,
          resumes: (fd?.resumes ?? finalResumes).map((r:any) => ({
            ...r, 
            content: resume.filename === r.filename ? resume.content : '',
            candidateName: allDetails[r.filename]?.candidateName
          })),
          details: allDetails, // Include all details from subcollection
          statuses: fd?.statuses ?? statuses,
          createdAt: (fd?.createdAt?.toDate?.() ?? new Date()).toISOString(),
        };

        send({ type: 'done', report: finalReport });
        controller.close();

      } catch (e: any) {
        console.error('Error in analyzeSingleResumeAction stream:', e);
        const msg = e?.message || 'Unexpected error during single-resume analysis.';
        try { send({ type: 'error', error: msg }); } finally { controller.close(); }
      }
    }
  });

  return stream;
}

export async function updateAndReanalyzeReport(
  userId: string,
  reportId: string,
  newResumes: Resume[],
  newFiles: { filename: string; data: ArrayBuffer }[],
  weights: MetricWeights
): Promise<ReadableStream<any>> {
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const enqueue = (data: object) => {
        controller.enqueue(encoder.encode(JSON.stringify(data) + '\n'));
      };

      try {
        enqueue({ type: 'status', message: 'Loading existing report...' });
        const reportRef = doc(db, 'users', userId, 'analysisReports', reportId);
        const reportSnapshot = await getDoc(reportRef);
        if (!reportSnapshot.exists()) {
          throw new Error('Analysis report not found.');
        }
        const reportData = reportSnapshot.data();
        const jobDescription = reportData.jobDescription;

        // Extract job role and summary if not already stored
        let jobRole = reportData.jobRole;
        let jobDescriptionSummary = reportData.jobDescriptionSummary;
        
        if (!jobRole || !jobDescriptionSummary) {
          enqueue({ type: 'status', message: 'Extracting job information...' });
          const jobInfoResult = await retry(() =>
            extractJobInfoFlow({ jobDescription })
          );
          
          // Update missing fields
          const updateData: any = {};
          if (!jobRole) {
            jobRole = jobInfoResult.jobRole;
            updateData.jobRole = jobRole;
          }
          if (!jobDescriptionSummary) {
            jobDescriptionSummary = jobInfoResult.summary;
            updateData.jobDescriptionSummary = jobDescriptionSummary;
          }
          
          // Update the report with the extracted information
          if (Object.keys(updateData).length > 0) {
            await updateDoc(reportRef, updateData);
          }
        }
        
        // --- Single Source of Truth for Resumes ---
        const allResumesMap = new Map<string, { filename: string, url?: string, content?: string }>();
        // Load existing resumes
        if (reportData.resumes) {
          for (const resume of reportData.resumes) {
            allResumesMap.set(resume.filename, resume);
          }
        }
        // Add/overwrite with new resumes
        for (const resume of newResumes) {
            allResumesMap.set(resume.filename, { ...allResumesMap.get(resume.filename), ...resume });
        }
        
        enqueue({ type: 'status', message: 'Uploading new resume files...' });
        for (const file of newFiles) {
            const storageRef = ref(storage, `resumehire/${userId}/${reportId}/resume/${file.filename}`);
            await uploadBytes(storageRef, file.data);
            const downloadURL = await getDownloadURL(storageRef);
            allResumesMap.set(file.filename, { ...allResumesMap.get(file.filename)!, url: downloadURL });
        }
        
        const detailsCollectionRef = collection(db, 'users', userId, 'analysisReports', reportId, 'details');
        const detailsSnapshot = await getDocs(detailsCollectionRef);
        const allDetails: AnalysisDetails = detailsSnapshot.docs.reduce((acc, detailDoc) => {
          acc[detailDoc.id] = detailDoc.data() as AnalysisDetails[string];
          return acc;
        }, {} as AnalysisDetails);

        const resumesToAnalyze = Array.from(allResumesMap.values()).filter(r => !allDetails[r.filename] && r.content);

        if(resumesToAnalyze.length > 0) {
            enqueue({ type: 'status', message: `Analyzing ${resumesToAnalyze.length} new resume(s)...` });
            for (const resume of resumesToAnalyze) {
                enqueue({ type: 'status', message: `Analyzing new resume: ${resume.filename}...` });
                const skillsPromise = retry(() => parseResumeSkillsFlow({ resumeText: resume.content! }));
                const keywordsPromise = retry(() => matchKeywordsToResumeFlow({ resumeText: resume.content!, jobDescription }));
                const namePromise = retry(() => extractCandidateNameFlow({ resumeText: resume.content! }));
                const [skills, keywords, nameResult] = await Promise.all([skillsPromise, keywordsPromise, namePromise]);
                
                const detailData = { 
                  skills, 
                  keywords, 
                  candidateName: nameResult.candidateName || undefined
                };
                allDetails[resume.filename] = detailData;

                const detailRef = doc(db, 'users', userId, 'analysisReports', reportId, 'details', resume.filename);
                await setDoc(detailRef, detailData);
                enqueue({ type: 'detail', filename: resume.filename, detail: detailData });
            }
        }
        
        const allResumesForRanking = Array.from(allResumesMap.values()).map(r => ({
            filename: r.filename,
            content: r.content || '' // Ranker needs content; this will be empty for old resumes but that's ok
        }));

        enqueue({ type: 'status', message: 'Ranking all candidates...' });
        const rankResumesInput: RankResumesInput = {
            resumes: allResumesForRanking.filter(r => r.content),
            jobDescription: jobDescription,
            weights: weights,
        };
        const rankedResumes = await retry(() => rankResumesFlow(rankResumesInput));
        
        const existingRanked = reportData.rankedResumes || [];
        const rankedMap = new Map(existingRanked.map((r: any) => [r.filename, r]));
        rankedResumes.forEach(r => rankedMap.set(r.filename, r));
        
        const sortedRankedResumes = Array.from(rankedMap.values()).sort((a: any, b: any) => b.score - a.score);
        
        const allResumesForDb = Array.from(allResumesMap.values()).map(({ content, ...rest }) => rest); // Remove content before DB write
        
        const finalStatuses = { ...reportData.statuses };
        for (const resume of allResumesForDb) {
            if (!finalStatuses[resume.filename]) {
                finalStatuses[resume.filename] = 'none';
            }
        }
        
        await updateDoc(reportRef, { 
          resumes: allResumesForDb,
          rankedResumes: sortedRankedResumes, 
          statuses: finalStatuses
        });

        enqueue({ type: 'status', message: 'Finalizing updated report...' });
        const finalDocSnapshot = await getDoc(reportRef);
        const finalDocData = finalDocSnapshot.data();

         const finalReport: Report = {
            id: reportRef.id,
            jobDescription,
            jobRole: finalDocData?.jobRole || jobRole,
            jobDescriptionSummary: finalDocData?.jobDescriptionSummary || jobDescriptionSummary,
            jobDescriptionFile: finalDocData?.jobDescriptionFile, // Include JD file info
            rankedResumes: finalDocData?.rankedResumes || [],
            resumes: finalDocData?.resumes.map((r:any) => ({
              ...r, 
              content: allResumesMap.get(r.filename)?.content || '',
              candidateName: allDetails[r.filename]?.candidateName
            })) || [],
            details: allDetails,
            statuses: finalDocData?.statuses || {},
            createdAt: (finalDocData?.createdAt?.toDate() ?? new Date()).toISOString(),
        };

        enqueue({ type: 'done', report: finalReport });
        controller.close();
      } catch (e: any) {
        console.error('Error in updateAndReanalyzeReport stream:', e);
        enqueue({ type: 'error', error: e.message || 'An unexpected error occurred during re-analysis.' });
        controller.close();
      }
    },
  });
  return stream;
}

export async function updateAnalysisReportStatus(
  userId: string,
  reportId: string,
  statuses: Record<string, CandidateStatus>
): Promise<void> {
  try {
    if (!userId || !reportId) {
      throw new Error('Authentication error or invalid report ID.');
    }
    const reportRef = doc(db, 'users', userId, 'analysisReports', reportId);
    await updateDoc(reportRef, {statuses});
  } catch (e: any) {
    console.error('Error updating report statuses:', e);
    throw new Error('Failed to update candidate statuses.');
  }
}

export async function getAnalysisReports(
  userId: string
): Promise<Report[]> {
  try {
    if (!userId) {
      throw new Error('User not authenticated');
    }

    const reportsRef = collection(db, 'users', userId, 'analysisReports');
    const q = query(reportsRef, orderBy('createdAt', 'desc'), limit(20));
    const querySnapshot = await getDocs(q);

    const reportsPromises = querySnapshot.docs.map(async docSnapshot => {
      const data = docSnapshot.data();
      const reportId = docSnapshot.id;

      const detailsCollectionRef = collection(db, 'users', userId, 'analysisReports', reportId, 'details');
      const detailsSnapshot = await getDocs(detailsCollectionRef);
      const details = detailsSnapshot.docs.reduce((acc, detailDoc) => {
        acc[detailDoc.id] = detailDoc.data() as AnalysisDetails[string];
        return acc;
      }, {} as AnalysisDetails);

      const rankedResumes = data.rankedResumes || [];
      const statuses = data.statuses || rankedResumes.reduce((acc: Record<string, CandidateStatus>, r: any) => {
          acc[r.filename] = 'none';
          return acc;
        }, {});

      const report = {
        id: reportId,
        jobDescription: data.jobDescription,
        jobRole: data.jobRole,
        jobDescriptionSummary: data.jobDescriptionSummary,
        jobDescriptionFile: data.jobDescriptionFile,
        rankedResumes: rankedResumes,
        resumes: (data.resumes || []).map((r: any) => ({
          ...r,
          candidateName: details[r.filename]?.candidateName
        })),
        details: details,
        statuses: statuses,
        createdAt: (data.createdAt?.toDate() ?? new Date()).toISOString(),
      } as Report;
      
      console.log('Report loaded:', {
        id: reportId,
        hasJobDescriptionFile: !!data.jobDescriptionFile,
        jobDescriptionFile: data.jobDescriptionFile
      });
      
      return report;
    });

    const reports = await Promise.all(reportsPromises);
    return reports;
  } catch (e: any) {
    console.error('Error fetching analysis reports:', e);
    throw new Error('Failed to fetch past analysis reports.');
  }
}

export async function deleteAnalysisReport(
  userId: string,
  reportId: string
): Promise<void> {
  try {
    if (!userId || !reportId) {
      throw new Error('Authentication error or invalid report ID.');
    }
    const reportRef = doc(db, 'users', userId, 'analysisReports', reportId);

    // Delete subcollection 'details'
    const detailsCollectionRef = collection(reportRef, 'details');
    const detailsSnapshot = await getDocs(detailsCollectionRef);
    const deleteDetailsBatch = writeBatch(db);
    detailsSnapshot.forEach(doc => {
      deleteDetailsBatch.delete(doc.ref);
    });
    await deleteDetailsBatch.commit();

    // Delete files from storage
    const storageFolderRef = ref(storage, `resumehire/${userId}/${reportId}`);
    const fileList = await listAll(storageFolderRef);
    const deleteFilePromises = fileList.items.map(itemRef => deleteObject(itemRef));
    await Promise.all(deleteFilePromises);

    // Delete main report document
    await deleteDoc(reportRef);

  } catch (e: any) {
    console.error('Error deleting report:', e);
    throw new Error('Failed to delete the analysis report.');
  }
}
