export interface Project {
  id: string;
  name: string;
  videoUrl: string;
  srtUrl: string;
  duration: number;
  createdAt: string;
  updatedAt: string;
}

export type BlockStatus = 'pending' | 'done';

export interface ProofreadBlock {
  id: string;
  projectId: string;
  index: number;
  startTime: number;
  endTime: number;
  originalText: string;
  correctedText: string;
  status: BlockStatus;
}

export interface Room {
  id: string;
  projectId: string;
  name: string;
  participants: Participant[];
  createdAt: string;
}

export interface Participant {
  id: string;
  name: string;
  color: string;
  isOnline: boolean;
}

export interface Version {
  id: string;
  projectId: string;
  label: string;
  snapshot: ProofreadBlock[];
  createdAt: string;
}

export interface VersionDiff {
  versionId: string;
  previousVersionId: string | null;
  changes: VersionChange[];
}

export interface VersionChange {
  blockId: string;
  blockIndex: number;
  field: string;
  oldValue: string;
  newValue: string;
}

export interface CursorPosition {
  userId: string;
  userName: string;
  userColor: string;
  blockIndex: number;
  field: 'originalText' | 'correctedText';
  offset: number;
}

export type OTOperationType = 'insert' | 'delete' | 'replace';

export interface OTOperation {
  id: string;
  type: OTOperationType;
  blockIndex: number;
  field: string;
  position: number;
  text: string;
  deletedText?: string;
  userId: string;
  revision: number;
  lamportTime: number;
  senderId: string;
}

export interface OTDocument {
  blocks: ProofreadBlock[];
  revision: number;
}

export interface SocketEvents {
  edit: (op: OTOperation) => void;
  cursor: (cursor: CursorPosition) => void;
  participant_join: (participant: Participant) => void;
  participant_leave: (userId: string) => void;
  ack: (revision: number) => void;
  webrtc_signal: (data: WebRTCSignalData) => void;
}

export interface WebRTCSignalData {
  type: 'offer' | 'answer' | 'ice-candidate';
  sdp?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
  fromUserId: string;
  toUserId: string;
}

export interface CreateProjectRequest {
  name: string;
  video: File;
  srt: File;
}

export interface CreateRoomRequest {
  projectId: string;
  name: string;
}

export interface JoinRoomRequest {
  roomId: string;
  userName: string;
}

export interface ExportSrtRequest {
  projectId: string;
  format?: 'srt' | 'vtt';
}

export interface CreateVersionRequest {
  projectId: string;
  label: string;
}

export interface MoveTimelineRequest {
  blockId: string;
  startTime?: number;
  endTime?: number;
}

export interface UpdateBlockRequest {
  blockId: string;
  correctedText?: string;
  status?: BlockStatus;
  startTime?: number;
  endTime?: number;
  userId?: string;
}

export type DiffType = 'timeline-offset' | 'text-diff' | 'both';
export type SuggestionStatus = 'pending' | 'accepted' | 'rejected';

export interface AISuggestion {
  id: string;
  projectId: string;
  blockIndex: number;
  originalText: string;
  suggestedText: string;
  startTimeOffset: number;
  endTimeOffset: number;
  textDiffRate: number;
  diffType: DiffType;
  status: SuggestionStatus;
  adoptedBy?: string;
  createdAt: string;
}

export interface PerUserStats {
  userId: string;
  editCount: number;
  aiAdoptCount: number;
  aiRejectCount: number;
  conflictResolutions: number;
  timelineAdjustments: number;
}

export interface ReportTotals {
  totalEdits: number;
  totalAiAdopts: number;
  totalAiRejects: number;
  totalConflicts: number;
  totalTimelineAdjusts: number;
  aiAdoptionRate: number;
  blocksCompleted: number;
  blocksTotal: number;
}

export interface AiSuggestionSummary {
  total: number;
  accepted: number;
  rejected: number;
  pending: number;
}

export interface ReportStats {
  perUser: PerUserStats[];
  totals: ReportTotals;
  aiSuggestionSummary: AiSuggestionSummary;
  projectInfo: {
    name: string;
    createdAt: string;
    blockCount: number;
    duration: number;
  };
}

export interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}
