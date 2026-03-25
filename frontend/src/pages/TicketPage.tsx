import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, User, Bot, Headphones, MessageSquare, Sparkles, AlertTriangle, CheckCircle, TrendingUp, Loader2, History, Users, RefreshCw, XCircle, Clock, ThumbsUp, Flag, RotateCcw } from 'lucide-react';
import LoadingSpinner from '../components/common/LoadingSpinner';
import { ticketsApi, analysisApi } from '../api/client';

interface ParsedMessage {
  sender: 'user' | 'agent' | 'bot' | 'note';
  content: string;
  timestamp: string;
  isImage?: boolean;
  imageUrl?: string;
}

interface CustomerTicketHistory {
  ticketId: string;
  subject: string;
  date: string;
  agentEmail: string;
  status: string;
  priority: string;
  csat?: number;
}

interface QAReview {
  status: 'approved' | 'flagged';
  note: string | null;
  reviewerName: string | null;
  reviewedAt: string;
}

interface QAAnalysis {
  qaScore: number;
  deductions: Array<{
    category: string;
    points: number;
    reason: string;
  }>;
  sopCompliance: {
    score: number;
    missedSteps: string[];
    correctlyFollowed: string[];
    matchedSOP: string | null;
  };
  sentiment: {
    customer: string;
    progression: string;
    agentTone: string;
  };
  customerContext: {
    isRepeatIssue: boolean;
    repeatIssueDetails: string | null;
    totalPreviousTickets: number;
    previousAgents: string[];
    customerExperience: string;
    recommendation: string | null;
  };
  resolution: {
    wasAbandoned: boolean;
    wasAutoResolved: boolean;
    customerIssueResolved: boolean;
    abandonmentDetails: string | null;
  };
  suggestions: string[];
  summary: string;
}

function parseMessages(messagesJson: string): ParsedMessage[] {
  try {
    const messages = JSON.parse(messagesJson || '[]');
    return messages
      .map((msg: any) => {
        // Determine sender type
        let sender: 'user' | 'agent' | 'bot' | 'note' = 'bot';
        if (msg.s === 'U') sender = 'user';
        else if (msg.s === 'A') sender = 'agent';
        else if (msg.s === 'N') sender = 'note';
        else if (msg.s === 'B') sender = 'bot';

        // Parse message content
        let content = '';
        let isImage = false;
        let imageUrl = '';

        if (typeof msg.m === 'string') {
          // Try to parse as JSON
          try {
            const parsed = JSON.parse(msg.m);
            if (parsed.message) {
              content = parsed.message;
            } else if (parsed.text) {
              content = parsed.text;
            } else if (parsed.quickReplies?.title) {
              content = parsed.quickReplies.title;
              if (parsed.quickReplies.options?.length > 0) {
                content += '\n[Options: ' + parsed.quickReplies.options.map((o: any) => o.title).join(', ') + ']';
              }
            } else if (parsed.image) {
              isImage = true;
              imageUrl = parsed.image;
              content = '[Image attachment]';
            } else if (parsed.event?.data?.message) {
              content = parsed.event.data.message;
            } else {
              content = msg.m;
            }
          } catch {
            // Plain text message
            content = msg.m;
          }
        }

        // Skip empty messages and system events
        if (!content || content.trim() === '' || content === '{ }') {
          return null;
        }

        return {
          sender,
          content,
          timestamp: msg.t || '',
          isImage,
          imageUrl
        };
      })
      .filter(Boolean) as ParsedMessage[];
  } catch (e) {
    console.error('Failed to parse messages:', e);
    return [];
  }
}

export default function TicketPage() {
  const { id } = useParams<{ id: string }>();
  const [analysis, setAnalysis] = useState<QAAnalysis | null>(null);
  const [customerHistory, setCustomerHistory] = useState<CustomerTicketHistory[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [review, setReview] = useState<QAReview | null>(null);
  const [isReviewing, setIsReviewing] = useState(false);
  const [pendingStatus, setPendingStatus] = useState<'approved' | 'flagged' | null>(null);
  const [noteInput, setNoteInput] = useState('');
  const [reviewerName, setReviewerName] = useState(() => localStorage.getItem('qa_reviewer_name') || '');

  // Fetch ticket details
  const { data: ticketData, isLoading } = useQuery({
    queryKey: ['ticket', id],
    queryFn: () => ticketsApi.getById(id!),
    enabled: !!id,
  });

  const ticket = ticketData?.data?.ticket;
  const messages = ticket?.MESSAGES_JSON ? parseMessages(ticket.MESSAGES_JSON) : [];

  // Auto-analyze when ticket loads
  useEffect(() => {
    if (!ticket || analysis || isAnalyzing) return;
    handleAnalyze(false);
  }, [ticket]);

  const handleAnalyze = async (forceRefresh = true) => {
    if (!id) return;
    setIsAnalyzing(true);
    setAnalysisError(null);
    try {
      const response = await analysisApi.getTicketAnalysis(id, forceRefresh);
      setAnalysis(response.data.analysis);
      setCustomerHistory(response.data.customerHistory || []);
      setReview(response.data.review || null);
    } catch (error: any) {
      setAnalysisError(error.response?.data?.error || 'Failed to analyze ticket');
    } finally {
      setIsAnalyzing(false);
    }
  };

  const openReviewModal = (status: 'approved' | 'flagged') => {
    if (!id) return;
    // Toggle off if same status clicked again
    if (review?.status === status) {
      handleClearReview();
      return;
    }
    setNoteInput(review?.note || '');
    setPendingStatus(status);
  };

  const handleClearReview = async () => {
    if (!id) return;
    setIsReviewing(true);
    try {
      await analysisApi.clearReview(id);
      setReview(null);
      setPendingStatus(null);
      setNoteInput('');
    } catch (error: any) {
      console.error('Failed to clear review:', error);
    } finally {
      setIsReviewing(false);
    }
  };

  const handleSubmitReview = async () => {
    if (!id || !pendingStatus) return;
    setIsReviewing(true);
    // Persist reviewer name for future reviews
    if (reviewerName.trim()) localStorage.setItem('qa_reviewer_name', reviewerName.trim());
    try {
      const response = await analysisApi.reviewTicket(
        id, pendingStatus,
        noteInput.trim() || undefined,
        reviewerName.trim() || undefined
      );
      setReview(response.data.review);
      setPendingStatus(null);
      setNoteInput('');
    } catch (error: any) {
      console.error('Failed to save review:', error);
    } finally {
      setIsReviewing(false);
    }
  };

  const getMessageIcon = (sender: string) => {
    switch (sender) {
      case 'user':
        return <User size={16} />;
      case 'bot':
        return <Bot size={16} />;
      case 'note':
        return <MessageSquare size={16} />;
      default:
        return <Headphones size={16} />;
    }
  };

  const getMessageStyle = (sender: string) => {
    switch (sender) {
      case 'user':
        return 'bg-uh-cyan/10 border-uh-cyan/30 ml-0 mr-auto';
      case 'bot':
        return 'bg-slate-50 border-slate-200 mx-auto';
      case 'note':
        return 'bg-uh-warning/10 border-uh-warning/30 mx-auto';
      default:
        return 'bg-uh-purple/10 border-uh-purple/30 ml-auto mr-0';
    }
  };

  const getSenderLabel = (sender: string) => {
    switch (sender) {
      case 'user': return 'Customer';
      case 'bot': return 'Bot';
      case 'note': return 'AI Summary';
      default: return 'Agent';
    }
  };

  const getScoreColor = (score: number) => {
    if (score >= 80) return 'text-uh-success';
    if (score >= 60) return 'text-uh-warning';
    return 'text-uh-error';
  };

  const getCategoryColor = (category: string) => {
    switch (category.toLowerCase()) {
      case 'fatal': return 'bg-uh-error/20 text-uh-error';
      case 'process': return 'bg-uh-warning/20 text-uh-warning';
      case 'opening': return 'bg-uh-cyan/20 text-uh-cyan';
      case 'closing': return 'bg-uh-purple/20 text-uh-purple';
      case 'chat_handling': return 'bg-slate-200 text-slate-700';
      default: return 'bg-slate-100 text-slate-500';
    }
  };

  const getCategoryLabel = (category: string) => {
    switch (category.toLowerCase()) {
      case 'opening': return 'Opening (-15%)';
      case 'process': return 'Process Miss (-40%)';
      case 'chat_handling': return 'Chat Handling (-30%)';
      case 'closing': return 'Closing (-15%)';
      case 'fatal': return 'FATAL (0%)';
      default: return category.toUpperCase();
    }
  };

  if (isLoading) {
    return (
      <div className="p-8 flex items-center justify-center min-h-screen">
        <LoadingSpinner text="Loading ticket..." />
      </div>
    );
  }

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <button
          onClick={() => window.history.back()}
          className="p-2 rounded-lg bg-slate-50 hover:bg-slate-100 transition-all"
        >
          <ArrowLeft size={20} />
        </button>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold">Ticket #{id}</h1>
            <span className={`px-3 py-1 rounded-full text-sm ${
              ticket?.TICKET_STATUS === 'RESOLVED'
                ? 'bg-uh-success/20 text-uh-success'
                : 'bg-uh-warning/20 text-uh-warning'
            }`}>
              {ticket?.TICKET_STATUS}
            </span>
          </div>
          <p className="text-slate-500 mt-1">{ticket?.SUBJECT}</p>
        </div>
        {/* Analyze Button */}
        <button
          onClick={() => handleAnalyze(true)}
          disabled={isAnalyzing}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-r from-uh-purple to-uh-cyan hover:opacity-90 disabled:opacity-50 transition-all font-medium"
        >
          {isAnalyzing ? (
            <>
              <Loader2 size={18} className="animate-spin" />
              Analyzing...
            </>
          ) : analysis ? (
            <>
              <RefreshCw size={18} />
              Re-analyze
            </>
          ) : (
            <>
              <Sparkles size={18} />
              Analyze with AI
            </>
          )}
        </button>
      </div>

      {/* Analysis Error */}
      {analysisError && (
        <div className="mb-6 p-4 rounded-xl bg-uh-error/10 border border-uh-error/30 text-uh-error">
          <div className="flex items-center gap-2">
            <AlertTriangle size={18} />
            <span>{analysisError}</span>
          </div>
        </div>
      )}

      {/* Analysis Results */}
      {analysis && (
        <div className="mb-6 space-y-4">
          {/* QA Score Card */}
          <div className={`card ${
            review?.status === 'approved'
              ? 'ring-2 ring-uh-success/50'
              : review?.status === 'flagged'
              ? 'ring-2 ring-uh-error/50'
              : ''
          }`}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <Sparkles size={20} className="text-uh-purple" />
                AI Analysis
                {review && (
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium flex items-center gap-1 ${
                    review.status === 'approved'
                      ? 'bg-uh-success/20 text-uh-success'
                      : 'bg-uh-error/20 text-uh-error'
                  }`}>
                    {review.status === 'approved' ? <ThumbsUp size={11} /> : <Flag size={11} />}
                    {review.status === 'approved' ? 'Approved' : 'Flagged'}
                    {review.reviewerName && <span className="opacity-70">by {review.reviewerName}</span>}
                  </span>
                )}
              </h2>
              <div className="flex items-center gap-3">
                {/* Approve / Flag buttons */}
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => openReviewModal('approved')}
                    disabled={isReviewing}
                    title={review?.status === 'approved' ? 'Remove approval' : 'Approve this QC analysis'}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all disabled:opacity-50 ${
                      review?.status === 'approved'
                        ? 'bg-uh-success text-white hover:bg-uh-success/80'
                        : 'bg-uh-success/10 text-uh-success hover:bg-uh-success/20 border border-uh-success/30'
                    }`}
                  >
                    {isReviewing && review?.status !== 'approved' ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : review?.status === 'approved' ? (
                      <RotateCcw size={14} />
                    ) : (
                      <ThumbsUp size={14} />
                    )}
                    {review?.status === 'approved' ? 'Undo' : 'Approve'}
                  </button>
                  <button
                    onClick={() => openReviewModal('flagged')}
                    disabled={isReviewing}
                    title={review?.status === 'flagged' ? 'Remove flag' : 'Flag this QC as inaccurate'}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all disabled:opacity-50 ${
                      review?.status === 'flagged'
                        ? 'bg-uh-error text-white hover:bg-uh-error/80'
                        : 'bg-uh-error/10 text-uh-error hover:bg-uh-error/20 border border-uh-error/30'
                    }`}
                  >
                    {isReviewing && review?.status !== 'flagged' ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : review?.status === 'flagged' ? (
                      <RotateCcw size={14} />
                    ) : (
                      <Flag size={14} />
                    )}
                    {review?.status === 'flagged' ? 'Undo' : 'Flag'}
                  </button>
                </div>
                <div className={`text-4xl font-bold ${getScoreColor(analysis.qaScore)}`}>
                  {analysis.qaScore}/100
                </div>
              </div>
            </div>

            {/* Notes input modal (inline) */}
            {pendingStatus && (
              <div className={`mb-4 p-4 rounded-xl border ${
                pendingStatus === 'approved'
                  ? 'bg-uh-success/5 border-uh-success/30'
                  : 'bg-uh-error/5 border-uh-error/30'
              }`}>
                <p className="text-sm font-medium mb-3 flex items-center gap-2">
                  {pendingStatus === 'approved' ? <ThumbsUp size={14} className="text-uh-success" /> : <Flag size={14} className="text-uh-error" />}
                  <span className={pendingStatus === 'approved' ? 'text-uh-success' : 'text-uh-error'}>
                    {pendingStatus === 'approved' ? 'Approving QC analysis' : 'Flagging QC analysis as inaccurate'}
                  </span>
                </p>
                <input
                  type="text"
                  value={reviewerName}
                  onChange={e => setReviewerName(e.target.value)}
                  placeholder="Your name *"
                  className="w-full text-sm border border-slate-200 rounded-lg p-2 mb-2 focus:outline-none focus:ring-2 focus:ring-uh-purple/40 bg-white"
                />
                <textarea
                  value={noteInput}
                  onChange={e => setNoteInput(e.target.value)}
                  placeholder={pendingStatus === 'flagged' ? 'Why is this analysis inaccurate? (optional)' : 'Add a note (optional)'}
                  rows={3}
                  className="w-full text-sm border border-slate-200 rounded-lg p-2 resize-none focus:outline-none focus:ring-2 focus:ring-uh-purple/40 bg-white"
                />
                <div className="flex items-center gap-2 mt-2">
                  <button
                    onClick={handleSubmitReview}
                    disabled={isReviewing}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium text-white transition-all disabled:opacity-50 ${
                      pendingStatus === 'approved' ? 'bg-uh-success hover:bg-uh-success/80' : 'bg-uh-error hover:bg-uh-error/80'
                    }`}
                  >
                    {isReviewing ? <Loader2 size={13} className="animate-spin" /> : null}
                    Submit
                  </button>
                  <button
                    onClick={() => { setPendingStatus(null); setNoteInput(''); }}
                    className="px-3 py-1.5 rounded-lg text-sm text-slate-500 hover:bg-slate-100 transition-all"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {/* Existing note display */}
            {(review?.note || review?.reviewerName) && !pendingStatus && (
              <div className={`mb-4 p-3 rounded-lg flex items-start gap-2 ${
                review.status === 'approved' ? 'bg-uh-success/10 border border-uh-success/20' : 'bg-uh-error/10 border border-uh-error/20'
              }`}>
                <MessageSquare size={14} className={`mt-0.5 shrink-0 ${review.status === 'approved' ? 'text-uh-success' : 'text-uh-error'}`} />
                <div className="flex-1 min-w-0">
                  {review.reviewerName && (
                    <p className="text-xs font-medium text-slate-600 mb-0.5">
                      Reviewed by <span className="text-slate-800">{review.reviewerName}</span>
                      <span className="text-slate-400 font-normal ml-1">· {review.reviewedAt}</span>
                    </p>
                  )}
                  {review.note && (
                    <p className={`text-sm ${review.status === 'approved' ? 'text-uh-success/90' : 'text-uh-error/90'}`}>{review.note}</p>
                  )}
                </div>
                <button
                  onClick={() => openReviewModal(review.status)}
                  className="text-xs text-slate-400 hover:text-slate-600 shrink-0"
                  title="Edit"
                >
                  Edit
                </button>
              </div>
            )}

            <p className="text-slate-600 mb-4">{analysis.summary}</p>

            {/* Resolution Status */}
            {analysis.resolution && (analysis.resolution.wasAbandoned || analysis.resolution.wasAutoResolved) && (
              <div className="mb-4 p-4 rounded-lg bg-uh-error/10 border border-uh-error/30">
                <div className="flex items-start gap-3">
                  <XCircle size={20} className="text-uh-error mt-0.5" />
                  <div className="flex-1">
                    <div className="flex items-center gap-2 flex-wrap mb-2">
                      {analysis.resolution.wasAbandoned && (
                        <span className="px-2 py-1 rounded text-xs bg-uh-error/20 text-uh-error font-medium">
                          ABANDONED
                        </span>
                      )}
                      {analysis.resolution.wasAutoResolved && (
                        <span className="px-2 py-1 rounded text-xs bg-uh-warning/20 text-uh-warning font-medium flex items-center gap-1">
                          <Clock size={12} />
                          AUTO-RESOLVED
                        </span>
                      )}
                      {!analysis.resolution.customerIssueResolved && (
                        <span className="px-2 py-1 rounded text-xs bg-uh-error/20 text-uh-error">
                          Issue NOT Resolved
                        </span>
                      )}
                    </div>
                    {analysis.resolution.abandonmentDetails && (
                      <p className="text-sm text-uh-error/90">{analysis.resolution.abandonmentDetails}</p>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Deductions */}
            {analysis.deductions.length > 0 && (
              <div className="mb-4">
                <h3 className="text-sm font-medium text-slate-500 mb-2">Deductions</h3>
                <div className="space-y-2">
                  {analysis.deductions.map((d, idx) => (
                    <div key={idx} className="flex items-start gap-3 p-3 rounded-lg bg-slate-50">
                      <span className={`px-2 py-1 rounded text-xs font-medium ${getCategoryColor(d.category)}`}>
                        {getCategoryLabel(d.category)}
                      </span>
                      <span className="text-uh-error font-mono text-sm">{d.points}</span>
                      <span className="text-sm text-slate-600 flex-1">{d.reason}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* SOP Compliance */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
              <div className="p-3 rounded-lg bg-slate-50">
                <h3 className="text-sm font-medium text-slate-500 mb-2">SOP Compliance</h3>
                <div className={`text-2xl font-bold ${getScoreColor(analysis.sopCompliance.score)}`}>
                  {analysis.sopCompliance.score}%
                </div>
                {analysis.sopCompliance.matchedSOP && (
                  <p className="text-xs text-slate-400 mt-1">Matched: {analysis.sopCompliance.matchedSOP}</p>
                )}
              </div>
              <div className="p-3 rounded-lg bg-slate-50">
                <h3 className="text-sm font-medium text-slate-500 mb-2">Sentiment</h3>
                <div className="space-y-1 text-sm">
                  <p><span className="text-slate-400">Customer:</span> {analysis.sentiment.customer}</p>
                  <p><span className="text-slate-400">Progression:</span> {analysis.sentiment.progression}</p>
                  <p><span className="text-slate-400">Agent Tone:</span> {analysis.sentiment.agentTone}</p>
                </div>
              </div>
            </div>

            {/* Customer Context */}
            {analysis.customerContext && (
              <div className="mb-4 p-4 rounded-lg bg-slate-50 border border-slate-200">
                <h3 className="text-sm font-medium text-slate-700 mb-3 flex items-center gap-2">
                  <History size={16} className="text-uh-purple" />
                  Customer Context
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      {analysis.customerContext.isRepeatIssue ? (
                        <span className="px-2 py-1 rounded text-xs bg-uh-error/20 text-uh-error flex items-center gap-1">
                          <RefreshCw size={12} />
                          REPEAT ISSUE
                        </span>
                      ) : (
                        <span className="px-2 py-1 rounded text-xs bg-uh-success/20 text-uh-success">
                          New Issue
                        </span>
                      )}
                      <span className="text-xs text-slate-400">
                        {analysis.customerContext.totalPreviousTickets} previous tickets
                      </span>
                    </div>
                    {analysis.customerContext.repeatIssueDetails && (
                      <p className="text-sm text-uh-error/80 mt-1">
                        {analysis.customerContext.repeatIssueDetails}
                      </p>
                    )}
                  </div>
                  <div>
                    <p className="text-sm">
                      <span className="text-slate-400">Experience:</span>{' '}
                      <span className={
                        analysis.customerContext.customerExperience === 'poor' ? 'text-uh-error' :
                        analysis.customerContext.customerExperience === 'good' ? 'text-uh-success' :
                        'text-slate-600'
                      }>
                        {analysis.customerContext.customerExperience}
                      </span>
                    </p>
                    {analysis.customerContext.previousAgents.length > 0 && (
                      <p className="text-xs text-slate-400 mt-1 flex items-center gap-1">
                        <Users size={12} />
                        Previous: {analysis.customerContext.previousAgents.slice(0, 3).join(', ')}
                        {analysis.customerContext.previousAgents.length > 3 && ` +${analysis.customerContext.previousAgents.length - 3} more`}
                      </p>
                    )}
                  </div>
                </div>
                {analysis.customerContext.recommendation && (
                  <div className="mt-3 p-2 rounded bg-uh-warning/10 border border-uh-warning/30">
                    <p className="text-sm text-uh-warning">
                      <strong>Recommendation:</strong> {analysis.customerContext.recommendation}
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* Customer History */}
            {customerHistory.length > 0 && (
              <div className="mb-4">
                <h3 className="text-sm font-medium text-slate-500 mb-2 flex items-center gap-2">
                  <History size={14} className="text-uh-cyan" />
                  Recent Tickets from This Customer
                </h3>
                <div className="space-y-1 max-h-[200px] overflow-y-auto">
                  {customerHistory.map((t) => (
                    <Link
                      key={t.ticketId}
                      to={`/ticket/${t.ticketId}`}
                      className="flex items-center justify-between p-2 rounded-lg bg-slate-50 hover:bg-slate-100 text-xs transition-all"
                    >
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        <span className="text-uh-cyan font-mono">#{t.ticketId}</span>
                        <span className="truncate text-slate-600">{t.subject}</span>
                      </div>
                      <div className="flex items-center gap-2 text-slate-400 shrink-0">
                        <span>{t.agentEmail?.split('@')[0]?.replace(/[._]/g, ' ')}</span>
                        <span className={`px-1.5 py-0.5 rounded text-[10px] ${
                          t.status === 'Resolved' ? 'bg-uh-success/20 text-uh-success' : 'bg-uh-warning/20 text-uh-warning'
                        }`}>
                          {t.status}
                        </span>
                        <span>{t.date}</span>
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            )}

            {/* Missed Steps */}
            {analysis.sopCompliance.missedSteps.length > 0 && (
              <div className="mb-4">
                <h3 className="text-sm font-medium text-slate-500 mb-2 flex items-center gap-2">
                  <AlertTriangle size={14} className="text-uh-error" />
                  Missed SOP Steps
                </h3>
                <ul className="space-y-1">
                  {analysis.sopCompliance.missedSteps.map((step, idx) => (
                    <li key={idx} className="text-sm text-uh-error/80 flex items-center gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-uh-error" />
                      {step}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Correctly Followed */}
            {analysis.sopCompliance.correctlyFollowed.length > 0 && (
              <div className="mb-4">
                <h3 className="text-sm font-medium text-slate-500 mb-2 flex items-center gap-2">
                  <CheckCircle size={14} className="text-uh-success" />
                  Correctly Followed
                </h3>
                <ul className="space-y-1">
                  {analysis.sopCompliance.correctlyFollowed.map((step, idx) => (
                    <li key={idx} className="text-sm text-uh-success/80 flex items-center gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-uh-success" />
                      {step}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Suggestions */}
            {analysis.suggestions.length > 0 && (
              <div>
                <h3 className="text-sm font-medium text-slate-500 mb-2 flex items-center gap-2">
                  <TrendingUp size={14} className="text-uh-cyan" />
                  Improvement Suggestions
                </h3>
                <ul className="space-y-1">
                  {analysis.suggestions.map((suggestion, idx) => (
                    <li key={idx} className="text-sm text-slate-600 flex items-center gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-uh-cyan" />
                      {suggestion}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Conversation */}
        <div className="lg:col-span-2 card">
          <h2 className="text-lg font-semibold mb-4">Conversation ({messages.length} messages)</h2>
          <div className="space-y-4 max-h-[700px] overflow-y-auto pr-2">
            {messages.length === 0 ? (
              <p className="text-slate-400 text-center py-8">
                No messages available
              </p>
            ) : (
              messages.map((msg, idx) => (
                <div
                  key={idx}
                  className={`p-4 rounded-xl border max-w-[85%] ${getMessageStyle(msg.sender)}`}
                >
                  <div className="flex items-center gap-2 mb-2 text-sm text-slate-500">
                    {getMessageIcon(msg.sender)}
                    <span className="font-medium">{getSenderLabel(msg.sender)}</span>
                    {msg.timestamp && (
                      <span className="text-xs text-slate-400">
                        {new Date(msg.timestamp).toLocaleTimeString()}
                      </span>
                    )}
                  </div>
                  {msg.isImage && msg.imageUrl ? (
                    <div>
                      <img
                        src={msg.imageUrl}
                        alt="Attachment"
                        className="max-w-full rounded-lg max-h-[300px] object-contain"
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.display = 'none';
                        }}
                      />
                      <p className="text-xs text-slate-400 mt-1">[Image attachment]</p>
                    </div>
                  ) : (
                    <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                  )}
                </div>
              ))
            )}
          </div>
        </div>

        {/* Right: Ticket Info */}
        <div className="space-y-6">
          <div className="card">
            <h2 className="text-lg font-semibold mb-4">Ticket Details</h2>
            <div className="space-y-4 text-sm">
              <div className="flex justify-between items-center py-2 border-b border-slate-200">
                <span className="text-slate-500">Status</span>
                <span className={`px-2 py-1 rounded text-xs ${
                  ticket?.TICKET_STATUS === 'RESOLVED'
                    ? 'bg-uh-success/20 text-uh-success'
                    : 'bg-uh-warning/20 text-uh-warning'
                }`}>
                  {ticket?.TICKET_STATUS}
                </span>
              </div>
              <div className="flex justify-between items-center py-2 border-b border-slate-200">
                <span className="text-slate-500">Agent</span>
                <Link
                  to={`/agent/${encodeURIComponent(ticket?.AGENT_EMAIL || '')}`}
                  className="text-uh-cyan hover:underline"
                >
                  {ticket?.AGENT_EMAIL?.split('@')[0].replace(/[._]/g, ' ')}
                </Link>
              </div>
              <div className="flex justify-between items-center py-2 border-b border-slate-200">
                <span className="text-slate-500">Customer</span>
                <Link
                  to={`/customer/${encodeURIComponent(ticket?.VISITOR_EMAIL || '')}`}
                  className="text-uh-cyan hover:underline text-xs"
                >
                  {ticket?.VISITOR_EMAIL}
                </Link>
              </div>
              <div className="flex justify-between items-center py-2 border-b border-slate-200">
                <span className="text-slate-500">CSAT</span>
                <span>{ticket?.TICKET_CSAT && ticket?.TICKET_CSAT !== 'NA' ? ticket.TICKET_CSAT : '-'}</span>
              </div>
              <div className="flex justify-between items-center py-2 border-b border-slate-200">
                <span className="text-slate-500">Messages</span>
                <span>{ticket?.MESSAGE_COUNT || messages.length}</span>
              </div>
              <div className="flex justify-between items-center py-2 border-b border-slate-200">
                <span className="text-slate-500">Group</span>
                <span>{ticket?.GROUP_NAME}</span>
              </div>
              <div className="flex justify-between items-center py-2 border-b border-slate-200">
                <span className="text-slate-500">Date</span>
                <span>{ticket?.DAY}</span>
              </div>
              <div className="flex justify-between items-center py-2">
                <span className="text-slate-500">Response Time</span>
                <span>
                  {ticket?.FIRST_RESPONSE_DURATION_SECONDS
                    ? `${ticket.FIRST_RESPONSE_DURATION_SECONDS}s`
                    : '-'}
                </span>
              </div>
            </div>
          </div>

          {/* Tags */}
          {ticket?.TAGS && (
            <div className="card">
              <h2 className="text-lg font-semibold mb-4">Tags</h2>
              <div className="flex flex-wrap gap-2">
                {(() => {
                  try {
                    const tags = JSON.parse(ticket.TAGS);
                    return Array.isArray(tags) ? tags : [ticket.TAGS];
                  } catch {
                    return ticket.TAGS.split(',');
                  }
                })().map((tag: string, idx: number) => (
                  <span
                    key={idx}
                    className="px-2 py-1 rounded-full text-xs bg-uh-purple/20 text-uh-purple"
                  >
                    {tag.trim()}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
