

'use client';

import * as React from 'react';
import {Report, updateAndReanalyzeReport } from '@/app/actions';
import { useToast } from '@/hooks/use-toast';
import type { AnalysisResult, Resume, MetricWeights, CandidateStatus, AnalysisDetails } from '@/lib/types';
import { useAuth } from '@/hooks/use-auth';

import Header from '@/components/layout/header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Loader2, Sparkles, ArrowLeft, Upload, FileText, X, CheckCircle, Sliders, Play, Briefcase, Calendar, Clock, Users, Eye, Replace, FileX, MoreVertical, Trash2, Check, Inbox } from 'lucide-react';
import { ComparisonModal } from './comparison-modal';
import { ResumeViewerModal } from './resume-viewer-modal';
import { WeightSliders } from './weight-sliders';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { formatDistanceToNow } from 'date-fns';
import { Checkbox } from './ui/checkbox';
import CandidateCard from './candidate-card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from './ui/tabs';
import { updateAnalysisReportStatus, analyzeSingleResumeAction } from '@/app/actions';
import type * as PdfJs from 'pdfjs-dist';

const pdfjsLibPromise = import('pdfjs-dist');
let pdfjsLib: typeof PdfJs | null = null;
pdfjsLibPromise.then(lib => {
  pdfjsLib = lib;
  if (pdfjsLib) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = `https://esm.sh/pdfjs-dist@4.3.136/build/pdf.worker.mjs`;
  }
});

const DEFAULT_WEIGHTS: MetricWeights = {
  skills: 35,
  experience: 35,
  education: 30,
};

const RESUMES_PER_PAGE = 10;

interface MainPageProps {
  onBack: () => void;
  existingResult?: Report | null;
  onAnalysisComplete: (report: Report) => void;
}

const EmptyState = ({isFiltered = false}: {isFiltered?: boolean}) => (
  <Card className="flex items-center justify-center min-h-[40vh] shadow-none border-dashed">
    <div className="text-center text-muted-foreground">
      {isFiltered ? <Inbox className="mx-auto h-12 w-12" /> : <Users className="mx-auto h-12 w-12" />}
      <h3 className="mt-4 text-lg font-semibold">{isFiltered ? "No Candidates Found" : "Ready for Analysis"}</h3>
      <p className="mt-2 text-sm max-w-xs mx-auto">
        {isFiltered ? "There are no candidates matching the current filters." : "Your ranked candidates will appear here once the analysis is complete."}
      </p>
    </div>
  </Card>
);

function chunk<T>(arr: T[], size: number): T[][] {
    return Array.from({ length: Math.ceil(arr.length / size) }, (v, i) =>
        arr.slice(i * size, i * size + size)
    );
}

export default function MainPage({ onBack, existingResult, onAnalysisComplete }: MainPageProps) {
  const [jobDescription, setJobDescription] = React.useState(existingResult?.jobDescription || '');
  const [jobDescriptionFile, setJobDescriptionFile] = React.useState<File[]>([]);
  const [resumeFiles, setResumeFiles] = React.useState<File[]>([]);
  const [weights, setWeights] = React.useState<MetricWeights>(DEFAULT_WEIGHTS);
  const [isLoading, setIsLoading] = React.useState(false);
  const [loadingStatus, setLoadingStatus] = React.useState('');
  
  const [isComparisonModalOpen, setIsComparisonModalOpen] = React.useState(false);
  const [comparisonResults, setComparisonResults] = React.useState<AnalysisResult['rankedResumes']>([]);

  const [isViewerOpen, setIsViewerOpen] = React.useState(false);
  const [viewingIndex, setViewingIndex] = React.useState(0);
  
  const [isDragOver, setIsDragOver] = React.useState(false);
  const [isJdDragOver, setIsJdDragOver] = React.useState(false);
  const resumeFileInputRef = React.useRef<HTMLInputElement>(null);
  const jdFileInputRef = React.useRef<HTMLInputElement>(null);

  const [showReanalyzeUI, setShowReanalyzeUI] = React.useState(false);
  const [abortController, setAbortController] = React.useState<AbortController | null>(null);


  const { toast } = useToast();
  const { user } = useAuth();
  
  const [selectedForCompare, setSelectedForCompare] = React.useState<Set<string>>(new Set());
  const [activeTab, setActiveTab] = React.useState<"all" | "shortlisted" | "rejected">('all');
  const [candidateStatuses, setCandidateStatuses] = React.useState<Record<string, CandidateStatus>>({});
  const [currentPage, setCurrentPage] = React.useState(1);

  const isViewingPastReport = !!existingResult;
  const analysisResult = existingResult;

  React.useEffect(() => {
    setSelectedForCompare(new Set());
    if (analysisResult) {
        setCandidateStatuses(analysisResult.statuses || {});
    }
  }, [analysisResult]);

   React.useEffect(() => {
    setCurrentPage(1);
  }, [activeTab]);
  
  const handleStatusChange = async (filename: string, status: CandidateStatus) => {
      const newStatuses = { ...candidateStatuses, [filename]: status };
      setCandidateStatuses(newStatuses);

      if (analysisResult?.id && user?.uid) {
          try {
              await updateAnalysisReportStatus(user.uid, analysisResult.id, newStatuses);
          } catch(e: any) {
              toast({ title: 'Error Saving Status', description: e.message, variant: 'destructive' });
              // Revert state if API call fails
              setCandidateStatuses(candidateStatuses);
          }
      }
  }
  
  // const fileToText = async (file: File): Promise<string> => {
  //   return new Promise((resolve, reject) => {
  //     const reader = new FileReader();
  //     reader.onload = (event) => {
  //       if (event.target && typeof event.target.result === 'string') {
  //         resolve(event.target.result);
  //       } else {
  //         reject(new Error("Couldn't read file"));
  //       }
  //     };
  //     reader.onerror = () => reject(new Error("Error reading file"));
  //     reader.readAsText(file);
  //   });
  // };

  const fileToText=async(file: File): Promise<string> =>{
    if (!pdfjsLib) {
      pdfjsLib = await pdfjsLibPromise;
      if (pdfjsLib) {
        pdfjsLib.GlobalWorkerOptions.workerSrc = `https://esm.sh/pdfjs-dist@4.3.136/build/pdf.worker.mjs`;
      }
    }
      
    if (file.type === 'application/pdf') {
      const arrayBuffer = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument(arrayBuffer).promise;
      let textContent = '';
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const text = await page.getTextContent();
        textContent += text.items.map(s => (s as any).str).join(' ');
      }
      return textContent;
    } else {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (event) => {
          if (event.target && typeof event.target.result === 'string') {
            resolve(event.target.result);
          } else {
            reject(new Error("Couldn't read file"));
          }
        };
        reader.onerror = () => reject(new Error("Error reading file"));
        reader.readAsText(file);
      });
    }

  }



  const fileToResume = async (file: File): Promise<Resume> => {
    const content = await fileToText(file);
    return { filename: file.name, content };
  };

  const processStream = async (
    stream: ReadableStream,
    options?: { signal?: AbortSignal; onEvent?: (event: any) => void }
  ) => {
    if (!stream) {
      console.error("processStream received an undefined stream.");
      throw new Error("Analysis action failed to return a stream.");
    }
  
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let finalReport: Report | null = null;
    let streamError: Error | null = null;
  
    while (true) {
      if (options?.signal?.aborted) {
        try { await reader.cancel(); } catch {}
        break;
      }
  
      const { done, value } = await reader.read();
      if (done) break;
  
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
  
      for (let rawLine of lines) {
        const line = rawLine.trim();
        if (!line) continue;
  
        // Strip SSE prefix if present
        const payloadText = line.startsWith('data:') ? line.slice(5).trim() : line;
  
        let payload: any;
        try {
          payload = JSON.parse(payloadText);
          // Handle double-encoded JSON (e.g. "\"{...}\"")
          if (typeof payload === 'string') {
            try { payload = JSON.parse(payload); } catch { /* leave as string */ }
          }
        } catch (e) {
          console.error('Failed to JSON.parse stream line:', line, e);
          continue; // wait for more data / skip bad line
        }
  
        if (options?.onEvent) options.onEvent(payload);
  
        // Status updates
        if (payload?.type === 'status' && typeof payload?.message === 'string') {
          setLoadingStatus(payload.message);
          continue;
        }
  
        // Final object
        if (payload?.type === 'done') {
          finalReport = payload.report ?? null;
          continue;
        }
  
        // Upstream error: capture and stop consuming further
        if (payload?.type === 'error') {
          streamError = new Error(payload.error || 'Unknown stream error');
          // Stop reading further chunks
          try { await reader.cancel(); } catch {}
          break;
        }
      }
  
      if (streamError) break;
    }
  
    if (streamError) throw streamError;
    if (finalReport) onAnalysisComplete(finalReport);
  };
  

const handleAnalyze = async () => {
    if (!user?.uid) {
        toast({ title: 'Authentication Required', variant: 'destructive' });
        return;
    }
    if (resumeFiles.length === 0) {
        toast({ title: 'No Resumes', description: 'Please upload at least one resume.', variant: 'destructive' });
        return;
    }

    let currentJobDescription = jobDescription;
    if (jobDescriptionFile.length > 0) {
        try {
            currentJobDescription = await fileToText(jobDescriptionFile[0]);
        } catch {
            toast({ title: 'Error Reading Job Description', variant: 'destructive' });
            return;
        }
    }
    if (!currentJobDescription.trim()) {
        toast({ title: 'No Job Description', variant: 'destructive' });
        return;
    }

    setIsLoading(true);
    setLoadingStatus('Preparing analysis...');

    try {
      const resumeMetas = await Promise.all(resumeFiles.map(fileToResume));

      // Optional: allow cancel
      const controller = new AbortController();
      setAbortController(controller);
      let reportId: string | undefined = undefined;

            // Process ONE resume at a time
      for (let i = 0; i < resumeFiles.length; i++) {
        if (controller.signal.aborted) {
            toast({ title: 'Analysis Cancelled' });
            break;
        }
        const file = resumeFiles[i];
        const meta = resumeMetas[i];
        setLoadingStatus(`Analyzing ${i + 1}/${resumeFiles.length}: ${file.name}`);
              // Prepare only this file for upload
        const singleFilePayload = {
        filename: file.name,
        data: await file.arrayBuffer(),
      };
      try {
        // Call single-resume action (append to existing report if we have reportId)
        const stream = await analyzeSingleResumeAction(
          currentJobDescription,
          meta,
          weights,
          user.uid,
          singleFilePayload,
          reportId ? { reportId } : undefined
        );
          // Read server events; capture reportId from the first call
          await processStream(stream, {
            signal: controller.signal,
            onEvent: (evt: any) => {
              if (evt?.type === 'reportId' && !reportId) {
                reportId = evt.id; // subsequent resumes append to same report
              }
              if (evt?.type === 'done') {
                  onAnalysisComplete(evt.report);
              }
            },
          });
        } catch (err: any) {
          if (err.name === 'AbortError') {
              console.log('Analysis of a file was aborted.');
              break;
          }
          console.error('Failed:', file.name, err);
          toast({
            title: `Failed: ${file.name}`,
            description: err?.message ?? 'Unexpected error',
            variant: 'destructive',
          });
          // continue with next resume
        }
      }
        if (!controller.signal.aborted) {
            setLoadingStatus('All resumes analyzed! ✔️');
            toast({ title: 'Analysis complete' });
        }
    } catch (e: any) {
        console.error("An error occurred during the analysis loop:", e);
        setLoadingStatus('Analysis failed.');
    } finally {
        setIsLoading(false);
        setLoadingStatus('');
        setAbortController(null);
    }
};


  const handleReanalyze = async () => {
    if (!user?.uid || !analysisResult?.id) {
      toast({ title: 'Authentication or Report ID missing', variant: 'destructive' });
      return;
    }
    if (resumeFiles.length === 0) {
      toast({ title: 'No New Resumes', description: 'Please upload at least one new resume.', variant: 'destructive' });
      return;
    }
  
    const jdText = (analysisResult?.jobDescription ?? '').trim();
    if (!jdText) {
      toast({ title: 'No Job Description', description: 'Report is missing job description.', variant: 'destructive' });
      return;
    }
  
    setIsLoading(true);
    setLoadingStatus('Preparing to re-analyze...');
    
    try {
      const metas = await Promise.all(resumeFiles.map(fileToResume));
      const controller = new AbortController();
      setAbortController(controller);
        for (let i = 0; i < resumeFiles.length; i++) {
            if (controller.signal.aborted) {
                toast({ title: 'Re-analysis Cancelled' });
                break;
            }
            const file = resumeFiles[i];
            const meta = metas[i];    

            setLoadingStatus(`Re-analyzing ${i + 1}/${resumeFiles.length}: ${file.name}`);
  
            const payload = {
              filename: file.name,
              data: await file.arrayBuffer(),
            };    

            try {
                const stream = await analyzeSingleResumeAction(
                  jdText,
                  meta,
                  weights,
                  user.uid,
                  payload,
                  { reportId: analysisResult.id } // append into existing report
                );

                await processStream(stream, {
                    signal: controller.signal,
                    onEvent: (evt: any) => {
                        if (evt?.type === 'status') {
                          // optionally reflect granular status
                          // setLoadingStatus(`${file.name}: ${evt.message}`);
                        }
                        if (evt?.type === 'detail') {
                          // optionally merge details in UI for evt.filename
                          // upsertDetails(evt.filename, evt.detail);
                        }
                        if (evt?.type === 'rank') {
                          // optionally update score UI
                          // updateScore(evt.filename, evt.score);
                        }
                         if (evt?.type === 'done') {
                            onAnalysisComplete?.(evt.report);
                        }
                        if (evt?.type === 'error') {
                          toast({ title: `Error: ${file.name}`, description: evt.error, variant: 'destructive' });
                        }
          
                    },
                });

            } 
            catch (err: any) {
                if (err?.name === 'AbortError') {
                  console.log('Re-analysis aborted by user.');
                }
                console.error('Failed:', file.name, err);
                toast({
                    title: `Failed: ${file.name}`,
                    description: err?.message ?? 'Unexpected error',      
                    variant: 'destructive',
                });
            }
        }
        if (!controller.signal.aborted) {
            setLoadingStatus('Re-analysis complete ✔️');
            toast({ title: 'Re-analysis complete' });
        }
    }
    catch (e: any) {
        console.error(e);
        toast({
            title: 'Re-analysis Failed',
            description: e.message || 'An unexpected error occurred.',
            variant: 'destructive',
        });
    } 
    finally {
        setIsLoading(false);
        setLoadingStatus('');
        setAbortController(null);
        setResumeFiles([]);
        setShowReanalyzeUI(false);
    }
  }

  const handleComparison = (filenames: string[]) => {
    if (!analysisResult) return;
    const selectedResults = analysisResult.rankedResumes.filter(r => filenames.includes(r.filename));
    setComparisonResults(selectedResults);
    setIsComparisonModalOpen(true);
  };
  
  const handleView = (filename: string) => {
    if (!analysisResult) return;
    const index = analysisResult.rankedResumes.findIndex(r => r.filename === filename);
    if(index !== -1) {
      setViewingIndex(index);
      setIsViewerOpen(true);
    }
  };

  const currentRankedResult = analysisResult?.rankedResumes[viewingIndex];
  const currentResume = analysisResult?.resumes.find(r => r.filename === currentRankedResult?.filename);
  const currentDetail = currentRankedResult ? analysisResult?.details[currentRankedResult.filename] : undefined;

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };
const SIZE=100;
  const handleResumeUpload = (files: FileList | null) => {
    if (!files) return;
    if (resumeFiles.length + files.length > SIZE) {
      toast({ title: 'Upload Limit Exceeded', description: `You can upload a maximum of ${SIZE} resume files.`, variant: 'destructive'});
      return;
    }
    const newFiles = Array.from(files).filter(file => {
      const allowedTypes = ['application/pdf', 'text/plain', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/msword'];
      if (!allowedTypes.includes(file.type)) {
        toast({ title: 'Invalid File Type', description: `${file.name} is not a supported file type.`, variant: 'destructive'});
        return false;
      }
      if (file.size > 3 * 1024 * 1024) {
        toast({ title: 'File Too Large', description: `${file.name} is larger than 3MB.`, variant: 'destructive'});
        return false;
      }
      return true;
    });

    setResumeFiles(prev => [...prev, ...newFiles]);
  };

  const handleJdUpload = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const file = files[0];
     const allowedTypes = ['application/pdf', 'text/plain', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/msword'];
     if (!allowedTypes.includes(file.type)) {
        toast({ title: 'Invalid File Type', description: `Only PDF, TXT, or DOC/DOCX files are allowed for the job description.`, variant: 'destructive'});
        return;
      }
      if (file.size > 3 * 1024 * 1024) {
        toast({ title: 'File Too Large', description: `Job description file must be smaller than 3MB.`, variant: 'destructive'});
        return;
      }
    setJobDescriptionFile([file]);
  };
  
  const removeResumeFile = (index: number) => {
    setResumeFiles(prev => prev.filter((_, i) => i !== index));
  };

  const removeJdFile = () => {
    setJobDescriptionFile([]);
  };

  const canAnalyze = !isLoading && resumeFiles.length > 0 && (jobDescriptionFile.length > 0 || jobDescription.trim().length > 0);
  const canReanalyze = !isLoading && resumeFiles.length > 0;
  
  const filteredResumes = React.useMemo(() => {
    if (!analysisResult) return [];
    if (activeTab === 'all') return analysisResult.rankedResumes;
    return analysisResult.rankedResumes.filter(r => candidateStatuses[r.filename] === activeTab);
  }, [analysisResult, activeTab, candidateStatuses]);

  const totalPages = Math.ceil(filteredResumes.length / RESUMES_PER_PAGE);
  const paginatedResumes = filteredResumes.slice(
    (currentPage - 1) * RESUMES_PER_PAGE,
    currentPage * RESUMES_PER_PAGE
  );

  const handleCompareSelect = (filename: string, isSelected: boolean) => {
    const newSelectionSet = new Set(selectedForCompare);
    if (isSelected) {
      if (newSelectionSet.size < 3) {
        newSelectionSet.add(filename);
      } else {
        toast({ title: 'Comparison Limit', description: 'You can only compare up to 3 candidates at a time.', variant: 'destructive'})
      }
    } else {
      newSelectionSet.delete(filename);
    }
    setSelectedForCompare(newSelectionSet);
  };
  
  const jdFile = analysisResult?.resumes.find(r => r.filename === (jobDescriptionFile[0]?.name));

  const ReanalyzeSection = () => (
    <div className="mt-8 space-y-4">
      <Card className="bg-slate-100">
        <CardHeader>
          <CardTitle>Add New Resumes</CardTitle>
          <CardDescription>Upload new resumes to add to this analysis. The original job description will be used.</CardDescription>
        </CardHeader>
        <CardContent>
          <div
            className={`border-2 border-dashed rounded-lg p-6 text-center transition-all duration-200 cursor-pointer ${
              isDragOver 
                ? 'border-blue-400 bg-blue-50' 
                : 'border-gray-300 hover:border-gray-400'
            }`}
            onDrop={(e) => { e.preventDefault(); setIsDragOver(false); handleResumeUpload(e.dataTransfer.files); }}
            onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
            onDragLeave={() => setIsDragOver(false)}
            onClick={() => resumeFileInputRef.current?.click()}
          >
            <Upload className="w-8 h-8 text-gray-400 mx-auto mb-2" />
            <p className="text-sm font-medium text-gray-700 mb-1">
              Drop new resumes here or click to browse
            </p>
             <input
                ref={resumeFileInputRef}
                type="file"
                multiple
                accept=".pdf,.txt,.doc,.docx"
                className="hidden"
                onChange={(e) => handleResumeUpload(e.target.files)}
              />
          </div>
          {resumeFiles.length > 0 && (
              <div className="space-y-2 max-h-48 overflow-y-auto p-1 mt-4">
                {resumeFiles.map((file, index) => (
                  <div key={`${file.name}-${index}`} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg text-sm">
                    <p className="font-medium text-gray-800 truncate">{file.name}</p>
                    <Button variant="ghost" size="sm" onClick={() => removeResumeFile(index)} className="h-6 w-6 p-0 text-gray-400 hover:text-red-500">
                      <X className="w-3 h-3" />
                    </Button>
                  </div>
                ))}
              </div>
          )}
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="outline" onClick={() => {setShowReanalyzeUI(false); setResumeFiles([]);}}>Cancel</Button>
            <Button onClick={handleReanalyze} disabled={!canReanalyze}>
                {isLoading ? (
                  <>
                    <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                    {loadingStatus || 'Analyzing...'}
                  </>
                ) : (
                  <>
                    <Play className="w-5 h-5 mr-3" />
                    Re-analyze
                  </>
                )}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );


  return (
    <div className="flex flex-col min-h-screen bg-slate-50">
      <Header />
      <main className="flex-1 w-full max-w-7xl mx-auto p-4 sm:p-6 md:p-8">
        
        {isViewingPastReport && analysisResult ? (
          <div className="space-y-8">
            <div className="flex justify-between items-center">
                <Button variant="ghost" onClick={onBack} className="mb-4">
                    <ArrowLeft className="mr-2 h-4 w-4" />
                    Back to Dashboard
                </Button>
                 {!showReanalyzeUI && (
                    <Button onClick={() => setShowReanalyzeUI(true)} disabled={isLoading}>
                        <Replace className="mr-2 h-4 w-4" />
                        Add or Replace Resumes
                    </Button>
                )}
            </div>

            {/* Job Role/Description Header */}
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
              <div className="flex items-start gap-3">
                <Briefcase className="w-6 h-6 text-blue-600 mt-1 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <h2 className="text-2xl font-bold text-gray-900 mb-2">
                    {analysisResult.jobRole || 'Job Analysis'}
                  </h2>
                  {analysisResult.jobDescriptionSummary && (
                    <p className="text-sm text-gray-600">
                      {analysisResult.jobDescriptionSummary}
                    </p>
                  )}
                  {!analysisResult.jobDescriptionSummary && analysisResult.jobDescription && (
                    <p className="text-sm text-gray-600 line-clamp-3">
                      {analysisResult.jobDescription}
                    </p>
                  )}
                </div>
              </div>
            </div>

            {showReanalyzeUI && <ReanalyzeSection />}
            
            <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as "all" | "shortlisted" | "rejected")}>
              <div className="flex justify-between items-center mb-4">
                  <h3 className="text-xl font-semibold text-gray-800">
                    Candidate Results ({filteredResumes.length})
                  </h3>
                  <TabsList>
                      <TabsTrigger value="all">All</TabsTrigger>
                      <TabsTrigger value="shortlisted">Shortlisted</TabsTrigger>
                      <TabsTrigger value="rejected">Rejected</TabsTrigger>
                  </TabsList>
              </div>
              <TabsContent value={activeTab}>
                {isLoading && !loadingStatus.includes('Analyzing new resume') && <p>Loading...</p>}
                {!isLoading && paginatedResumes.length === 0 && <EmptyState isFiltered />}
                {!isLoading && paginatedResumes.length > 0 && (
                  <div className="space-y-4">
                  {paginatedResumes.map((rankedResume) => (
                      <div key={rankedResume.filename} className="flex items-center gap-4">
                          <Checkbox
                              id={`compare-${rankedResume.filename}`}
                              checked={selectedForCompare.has(rankedResume.filename)}
                              onCheckedChange={(checked) => handleCompareSelect(rankedResume.filename, !!checked)}
                              disabled={selectedForCompare.size >= 3 && !selectedForCompare.has(rankedResume.filename)}
                          />
                          <div className="flex-1">
                              <CandidateCard
                                  rank={analysisResult.rankedResumes.findIndex(r => r.filename === rankedResume.filename) + 1}
                                  rankedResume={rankedResume}
                                  details={analysisResult.details[rankedResume.filename]}
                                  status={candidateStatuses[rankedResume.filename] || 'none'}
                                  onStatusChange={(newStatus) => handleStatusChange(rankedResume.filename, newStatus)}
                                  weights={weights}
                              />
                          </div>
                           <Button variant="ghost" size="icon" onClick={() => handleView(rankedResume.filename)}>
                              <Eye className="h-5 w-5" />
                          </Button>
                      </div>
                  ))}
                  </div>
                )}
              </TabsContent>
            </Tabs>
             {totalPages > 1 && (
              <div className="flex justify-center items-center gap-4 mt-6">
                <Button
                  variant="outline"
                  onClick={() => setCurrentPage((p) => p - 1)}
                  disabled={currentPage === 1}
                >
                  Previous
                </Button>
                <span className="text-sm text-muted-foreground">
                  Page {currentPage} of {totalPages}
                </span>
                <Button
                  variant="outline"
                  onClick={() => setCurrentPage((p) => p + 1)}
                  disabled={currentPage === totalPages}
                >
                  Next
                </Button>
              </div>
            )}
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2 text-sm text-gray-600 mb-8">
              <Button 
                variant="ghost" 
                size="sm" 
                onClick={onBack}
                className="flex items-center gap-2 text-gray-600 hover:text-gray-800"
              >
                <ArrowLeft className="w-4 h-4" />
                Back to Dashboard
              </Button>
            </div>

            <div className="text-center mb-8">
              <h2 className="text-2xl font-semibold text-black mb-2 font-['Bitter']">Upload & Configure Analysis</h2>
              <p className="text-lg text-gray-600 mb-4">
                Upload resumes and configure your analysis settings
              </p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 mb-8">
               <Card className="bg-[rgba(194,194,235,0.1)] shadow-sm">
                 <CardHeader className="bg-[rgba(194,194,235,1)]">
                   <CardTitle className="flex items-center gap-2">
                     <Upload className="w-5 h-5 text-blue-600" />
                     Upload Resumes
                   </CardTitle>
                   <CardDescription className="text-gray-700">
                     {`Upload up to ${SIZE} PDF, TXT or DOC/DOCX files (max 3MB each)`}
                   </CardDescription>
                 </CardHeader>
                 <CardContent className="p-6 space-y-4">
                   <div
                     className={`border-2 border-dashed rounded-lg p-6 text-center transition-all duration-200 cursor-pointer ${
                       isDragOver 
                         ? 'border-blue-400 bg-blue-50' 
                         : 'border-gray-300 hover:border-gray-400'
                     }`}
                     onDrop={(e) => { e.preventDefault(); setIsDragOver(false); handleResumeUpload(e.dataTransfer.files); }}
                     onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
                     onDragLeave={() => setIsDragOver(false)}
                     onClick={() => resumeFileInputRef.current?.click()}
                   >
                     <Upload className="w-8 h-8 text-gray-400 mx-auto mb-2" />
                     <p className="text-sm font-medium text-gray-700 mb-1">
                       Drop files here or click to browse
                     </p>
                     <p className="text-xs text-gray-500">
                       PDF, TXT, DOC/DOCX up to 3MB each
                     </p>
                     <input
                       ref={resumeFileInputRef}
                       type="file"
                       multiple
                       accept=".pdf,.txt,.doc,.docx"
                       className="hidden"
                       onChange={(e) => handleResumeUpload(e.target.files)}
                     />
                   </div>

                   <div className="flex items-center justify-between text-sm">
                     <span className="text-gray-600">Files uploaded:</span>
                     <span className={`font-medium ${resumeFiles.length > SIZE ? 'text-red-600' : 'text-gray-800'}`}>
                       {resumeFiles.length}/{SIZE}
                     </span>
                   </div>

                   {resumeFiles.length > 0 && (
                     <div className="space-y-2 max-h-64 overflow-y-auto p-1">
                       {resumeFiles.map((file, index) => (
                         <div
                           key={`${file.name}-${index}`}
                           className="flex items-center justify-between p-3 bg-gray-50 rounded-lg text-sm"
                         >
                           <div className="flex items-center gap-2 flex-1 min-w-0">
                             <FileText className="w-4 h-4 text-blue-600 flex-shrink-0" />
                             <div className="min-w-0 flex-1">
                               <p className="font-medium text-gray-800 truncate">{file.name}</p>
                               <p className="text-xs text-gray-500">{formatFileSize(file.size)}</p>
                             </div>
                           </div>
                           <div className="flex items-center gap-2 ml-2">
                             <CheckCircle className="w-4 h-4 text-green-600" />
                             <Button
                               variant="ghost"
                               size="sm"
                               onClick={() => removeResumeFile(index)}
                               className="h-6 w-6 p-0 text-gray-400 hover:text-red-500"
                             >
                               <X className="w-3 h-3" />
                             </Button>
                           </div>
                         </div>
                       ))}
                     </div>
                   )}
                 </CardContent>
               </Card>
               <Card className="bg-[rgba(194,194,235,0.1)] shadow-sm">
                <CardHeader className="bg-[rgba(194,194,235,1)]">
                  <CardTitle className="flex items-center gap-2">
                    <FileText className="w-5 h-5 text-green-600" />
                    Job Description
                  </CardTitle>
                  <CardDescription className="text-gray-700">
                    Upload a file or enter text below
                  </CardDescription>
                </CardHeader>
                <CardContent className="p-6 space-y-4">
                    <div
                        className={`border-2 border-dashed rounded-lg p-4 text-center transition-all duration-200 cursor-pointer ${
                        isJdDragOver 
                            ? 'border-green-400 bg-green-50' 
                            : 'border-gray-300 hover:border-gray-400'
                        }`}
                        onDrop={(e) => { e.preventDefault(); setIsJdDragOver(false); handleJdUpload(e.dataTransfer.files); }}
                        onDragOver={(e) => { e.preventDefault(); setIsJdDragOver(true); }}
                        onDragLeave={() => setIsJdDragOver(false)}
                        onClick={() => jdFileInputRef.current?.click()}
                    >
                        <FileText className="w-6 h-6 text-gray-400 mx-auto mb-2" />
                        <p className="text-sm font-medium text-gray-700 mb-1">
                            Drop JD file here or click to browse
                        </p>
                        <p className="text-xs text-gray-500">PDF, TXT, DOC/DOCX, max 3MB</p>
                        <input
                        ref={jdFileInputRef}
                        type="file"
                        accept=".pdf,.txt,.doc,.docx"
                        className="hidden"
                        onChange={(e) => handleJdUpload(e.target.files)}
                        />
                    </div>
                    {jobDescriptionFile.length > 0 && (
                        <div className="flex items-center justify-between p-3 bg-green-50 border border-green-200 rounded-lg text-sm">
                        <div className="flex items-center gap-2 flex-1 min-w-0">
                            <FileText className="w-4 h-4 text-green-600 flex-shrink-0" />
                            <div className="min-w-0 flex-1">
                            <p className="font-medium text-gray-800 truncate">{jobDescriptionFile[0].name}</p>
                            <p className="text-xs text-gray-500">{formatFileSize(jobDescriptionFile[0].size)}</p>
                            </div>
                        </div>
                        <div className="flex items-center gap-2 ml-2">
                            <CheckCircle className="w-4 h-4 text-green-600" />
                            <Button variant="ghost" size="sm" onClick={removeJdFile} className="h-6 w-6 p-0 text-gray-400 hover:text-red-500">
                                <X className="w-3 h-3" />
                            </Button>
                        </div>
                        </div>
                    )}
                    <div className="relative">
                        <div className="absolute inset-0 flex items-center">
                            <span className="w-full border-t" />
                        </div>
                        <div className="relative flex justify-center text-xs uppercase">
                            <span className="bg-slate-50 px-2 text-muted-foreground">Or</span>
                        </div>
                    </div>
                    <div>
                        <Label htmlFor="jd-text" className="text-sm font-medium text-gray-700 mb-2 block">
                            Paste Job Description Text
                        </Label>
                        <Textarea
                        id="jd-text"
                        placeholder="Enter the job description, requirements, and qualifications..."
                        value={jobDescription}
                        onChange={(e) => setJobDescription(e.target.value)}
                        rows={6}
                        className="resize-none"
                        />
                    </div>
                </CardContent>
              </Card>
              <Card className="bg-[rgba(194,194,235,0.05)] shadow-sm">
                <CardHeader className="bg-[rgba(194,194,235,0.92)]">
                  <CardTitle className="flex items-center gap-2">
                    <Sliders className="w-5 h-5 text-purple-600" />
                    Scoring Weights
                  </CardTitle>
                  <CardDescription className="text-gray-700">
                    Adjust the importance of each metric.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6 p-6 bg-[rgba(194,194,2_2,0.1)]">
                   <WeightSliders 
                      weights={weights}
                      onWeightsChange={setWeights}
                      disabled={isLoading}
                    />
                </CardContent>
              </Card>
            </div>

            <div className="flex justify-center">
              <Button 
                onClick={handleAnalyze}
                disabled={!canAnalyze}
                size="lg"
                className="h-14 px-12 bg-gradient-to-r from-blue-600 via-blue-700 to-blue-800 hover:opacity-90 text-white disabled:opacity-50 disabled:cursor-not-allowed text-lg"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                    {loadingStatus || 'Analyzing...'}
                  </>
                ) : (
                  <>
                    <Play className="w-5 h-5 mr-3" />
                    Analyze Resumes
                  </>
                )}
              </Button>
            </div>
          </>
        )}
      </main>

      {analysisResult && isComparisonModalOpen && (
        <ComparisonModal 
            isOpen={isComparisonModalOpen}
            onClose={() => setIsComparisonModalOpen(false)}
            results={comparisonResults}
            details={analysisResult.details}
        />
      )}
      
      {analysisResult && isViewerOpen && currentRankedResult && currentDetail && (
         <ResumeViewerModal
            isOpen={isViewerOpen}
            onClose={() => setIsViewerOpen(false)}
            result={currentRankedResult}
            details={currentDetail}
            resumeContent={analysisResult.resumes.find(r => r.filename === currentRankedResult.filename)?.content || ''}
            resumeUrl={currentResume?.url}
            onNext={() => setViewingIndex(i => (i + 1) % analysisResult.rankedResumes.length)}
            onPrev={() => setViewingIndex(i => (i - 1 + analysisResult.rankedResumes.length) % analysisResult.rankedResumes.length)}
            hasNext={viewingIndex < analysisResult.rankedResumes.length - 1}
            hasPrev={viewingIndex > 0}
        />
      )}
    </div>
  );
}